/**
 * trigger_gap_scan — kick off scripts/detect_gaps.py for a client that has
 * never been scored, so a newly onboarded plant doesn't sit at "0 gaps"
 * forever (that silently-empty state, not an actual scan, is what confused
 * YC on the Saraighat profile — see BRIDGE.md task-048/049).
 *
 * POST /api/trigger_gap_scan   Body: { client_name }   Auth: X-Ingest-Key
 *
 * This does NOT run detect_gaps.py itself — Vercel functions are Node, the
 * scoring engine is Python (Qdrant + Firestore + Jina embeddings). Instead it
 * dispatches .github/workflows/gap-scan.yml via the GitHub Actions API and
 * returns immediately; the frontend polls /api/gap_analysis afterward until
 * real rows show up (a scan typically takes well under two minutes).
 *
 * A Firestore flag in `gap_scan_jobs/{client_name}` prevents piling up
 * duplicate workflow runs if the tab that triggered this reloads, or two
 * tabs hit the same plant at once. The flag self-expires after 5 minutes so
 * a failed/hung run doesn't permanently block re-triggering.
 */
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

const GITHUB_OWNER = 'GhostUnamused';
const GITHUB_REPO = 'thermIQ';
const WORKFLOW_FILE = 'gap-scan.yml';
const STALE_JOB_MS = 5 * 60 * 1000; // 5 minutes

function getFirebaseApp() {
  if (!getApps().length) {
    return initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
  return getApp();
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const providedKey = req.headers['x-ingest-key'];
  if (!process.env.INGEST_API_KEY || providedKey !== process.env.INGEST_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    return res.status(500).json({
      error: 'GITHUB_DISPATCH_TOKEN is not configured on the server — gap-scan auto-trigger is not wired up yet.',
    });
  }

  const clientName = ((req.body || {}).client_name || '').toString().trim().toLowerCase();
  if (!clientName) return res.status(400).json({ error: 'Missing required field: client_name' });
  if (clientName === 'benchmark') return res.status(403).json({ error: 'Refusing to gap-scan the benchmark namespace.' });

  try {
    const db = getFirestore(getFirebaseApp());
    const jobRef = db.collection('gap_scan_jobs').doc(clientName);
    const jobSnap = await jobRef.get();
    const existing = jobSnap.exists ? jobSnap.data() : null;

    if (existing && existing.status === 'running' && (Date.now() - (existing.triggered_at_ms || 0)) < STALE_JOB_MS) {
      return res.status(200).json({ triggered: false, already_running: true, client_name: clientName });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { client_name: clientName } }),
      }
    );

    if (!ghRes.ok) {
      const body = await ghRes.text();
      throw new Error(`GitHub dispatch failed (${ghRes.status}): ${body}`);
    }

    await jobRef.set({ status: 'running', triggered_at_ms: Date.now(), client_name: clientName }, { merge: true });

    return res.status(200).json({ triggered: true, client_name: clientName });
  } catch (e) {
    console.error('trigger_gap_scan error:', e);
    return res.status(500).json({ error: e.message });
  }
};
