/**
 * ingest_drive — large-file ingestion via a Google Drive share link.
 *
 * POST /api/ingest_drive   Auth: X-Ingest-Key
 * Body: { drive_url, doc_name, doc_type, client_name }
 *
 * Why this exists: Vercel's platform request-body cap (~4.5 MB) bounds direct
 * uploads to ~3 MB PDFs. For anything bigger, the user uploads the file to
 * their own Google Drive, sets sharing to "Anyone with the link — Viewer",
 * and pastes the link here. This endpoint never touches the file itself — it:
 *   1. extracts the Drive file ID from the pasted link,
 *   2. writes an `ingest_jobs/{job_id}` record to Firestore (status: queued),
 *   3. dispatches .github/workflows/drive-ingest.yml, which downloads the
 *      public file and runs the SAME local Python ingest engine
 *      (scripts/ingest_documents.py) that seeds benchmarks — zero drift.
 * The doc's source_url is set to Drive's embeddable /preview URL, so in-app
 * preview works automatically.
 *
 * Same GITHUB_DISPATCH_TOKEN + dispatch pattern as api/trigger_gap_scan.js.
 * Client-only: benchmarks stay locked to local seeding (task-034 posture).
 */
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

const GITHUB_OWNER  = 'GhostUnamused';
const GITHUB_REPO   = 'thermIQ';
const WORKFLOW_FILE = 'drive-ingest.yml';

const VALID_DOC_TYPES = ['sop', 'manual', 'technical_spec', 'tariff_petition', 'guideline', 'regulatory', 'operational', 'plant_specific', 'other'];

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

// Accepts the common Drive share-link shapes and returns the file ID, or null.
//   https://drive.google.com/file/d/<ID>/view?usp=sharing
//   https://drive.google.com/open?id=<ID>
//   https://drive.google.com/uc?id=<ID>&export=download
function extractDriveFileId(url) {
  if (!/^https:\/\/drive\.google\.com\//i.test(url)) return null;
  const m = url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
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
    return res.status(500).json({ error: 'GITHUB_DISPATCH_TOKEN is not configured on the server — Drive ingestion is not wired up yet.' });
  }

  const body = req.body || {};
  const driveUrl   = (body.drive_url || '').toString().trim();
  const docName    = (body.doc_name || '').toString().trim();
  const docType    = VALID_DOC_TYPES.includes(body.doc_type) ? body.doc_type : 'manual';
  const clientName = (body.client_name || '').toString().trim().toLowerCase();

  if (!driveUrl || !docName) return res.status(400).json({ error: 'Missing required fields: drive_url, doc_name' });
  if (!clientName)           return res.status(400).json({ error: 'Missing required field: client_name' });
  if (clientName === 'benchmark') return res.status(403).json({ error: 'Benchmark documents are seeded locally only — Drive ingestion is for plant documents.' });

  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) {
    return res.status(400).json({
      error: 'Not a recognizable Google Drive file link. Expected a link like https://drive.google.com/file/d/FILE_ID/view — use "Share → Copy link" on the file (not a folder), with access set to "Anyone with the link".',
    });
  }

  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const jobId = `drive_${clientName}_${Date.now()}`;

  try {
    const db = getFirestore(getFirebaseApp());

    // Dedupe: same file already queued/processing for this client → don't re-dispatch.
    // Single-field query + JS filter — avoids needing a Firestore composite index.
    const dupeSnap = await db.collection('ingest_jobs')
      .where('drive_file_id', '==', fileId)
      .limit(10)
      .get();
    const dupe = dupeSnap.docs.find((d) => {
      const j = d.data();
      return j.client_name === clientName && ['queued', 'processing'].includes(j.status);
    });
    if (dupe) {
      return res.status(200).json({ queued: false, already_running: true, job_id: dupe.id });
    }

    await db.collection('ingest_jobs').doc(jobId).set({
      job_id:        jobId,
      status:        'queued',
      drive_file_id: fileId,
      drive_url:     driveUrl,
      source_url:    previewUrl,
      doc_name:      docName,
      doc_type:      docType,
      client_name:   clientName,
      source_type:   'client',
      error:         '',
      created_at:    new Date().toISOString(),
      created_at_ms: Date.now(),
    });

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { job_id: jobId } }),
      }
    );
    if (!ghRes.ok) {
      const ghBody = await ghRes.text();
      await db.collection('ingest_jobs').doc(jobId).set(
        { status: 'failed', error: `GitHub dispatch failed (${ghRes.status})` }, { merge: true });
      throw new Error(`GitHub dispatch failed (${ghRes.status}): ${ghBody}`);
    }

    return res.status(200).json({
      queued: true,
      job_id: jobId,
      preview_url: previewUrl,
      message: 'Ingestion queued — the document is downloaded and indexed in the background (typically 1–3 minutes). It will appear in Plant Documents when ready.',
    });
  } catch (e) {
    console.error('ingest_drive error:', e);
    return res.status(500).json({ error: e.message });
  }
};
