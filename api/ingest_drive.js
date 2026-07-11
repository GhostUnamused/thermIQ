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

// Accepts the common Drive/Docs share-link shapes and returns { kind, id }, or null.
//   file:   https://drive.google.com/file/d/<ID>/view · /open?id=<ID> · /uc?id=<ID>
//   folder: https://drive.google.com/drive/folders/<ID>
//   gdoc:   https://docs.google.com/(document|spreadsheets|presentation)/d/<ID>
function parseDriveLink(url) {
  let m = url.match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/i);
  if (m) return { kind: 'folder', id: m[1] };
  m = url.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/i);
  if (m) return { kind: 'gdoc', id: m[2], gdoc_type: m[1] };
  if (!/^https:\/\/drive\.google\.com\//i.test(url)) return null;
  m = url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? { kind: 'file', id: m[1] } : null;
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
  const docName    = (body.doc_name || '').toString().trim(); // optional — worker falls back to the Drive filename
  const docType    = VALID_DOC_TYPES.includes(body.doc_type) ? body.doc_type : 'manual';
  const clientName = (body.client_name || '').toString().trim().toLowerCase();
  const isSync     = !!body.sync; // folder re-sync: worker also deletes docs removed from the folder
  const skipRelevance = !!body.skip_relevance_check;

  if (!driveUrl)   return res.status(400).json({ error: 'Missing required field: drive_url' });
  if (!clientName) return res.status(400).json({ error: 'Missing required field: client_name' });
  if (clientName === 'benchmark') return res.status(403).json({ error: 'Benchmark documents are seeded locally only — Drive ingestion is for plant documents.' });

  const parsed = parseDriveLink(driveUrl);
  if (!parsed) {
    return res.status(400).json({
      error: 'Not a recognizable Google Drive link. Supported: file links (drive.google.com/file/d/…), folder links (drive.google.com/drive/folders/…), and native Google Docs/Sheets/Slides links — shared as "Anyone with the link".',
    });
  }
  const { kind, id: fileId } = parsed;

  const previewUrl = kind === 'gdoc'
    ? `https://docs.google.com/${parsed.gdoc_type}/d/${fileId}/preview`
    : (kind === 'file' ? `https://drive.google.com/file/d/${fileId}/preview` : '');
  const jobId = `drive_${clientName}_${Date.now()}`;

  try {
    const db = getFirestore(getFirebaseApp());

    // Dedupe: same file/folder already queued/processing for this client → don't re-dispatch.
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
      link_kind:     kind,               // 'file' | 'folder' | 'gdoc'
      gdoc_type:     parsed.gdoc_type || '',
      sync:          isSync,
      skip_relevance_check: skipRelevance,
      drive_file_id: fileId,             // file, doc, or folder ID depending on kind
      drive_url:     driveUrl,
      source_url:    previewUrl,
      doc_name:      docName || (kind === 'folder' ? 'Drive folder import' : 'Drive document'),
      doc_name_given: !!docName,
      doc_type:      docType,
      client_name:   clientName,
      source_type:   'client',
      error:         '',
      created_at:    new Date().toISOString(),
      created_at_ms: Date.now(),
    });

    // Folder links double as this plant's registered sync source.
    if (kind === 'folder') {
      await db.collection('drive_sync').doc(clientName).set({
        client_name: clientName,
        folder_id:   fileId,
        folder_url:  driveUrl,
        doc_type:    docType,
        updated_at:  new Date().toISOString(),
      }, { merge: true });
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
      link_kind: kind,
      preview_url: previewUrl,
      message: kind === 'folder'
        ? 'Folder ingestion queued — every supported file inside is downloaded and indexed in the background. The folder is also registered for one-click re-sync.'
        : 'Ingestion queued — the document is downloaded and indexed in the background (typically 1–3 minutes). It will appear in Plant Documents when ready.',
    });
  } catch (e) {
    console.error('ingest_drive error:', e);
    return res.status(500).json({ error: e.message });
  }
};
