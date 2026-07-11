/**
 * delete_job — dismiss a Drive ingest job record (typically a failed one)
 * POST /api/delete_job   Body: { job_id }   Auth: X-Ingest-Key
 *
 * Failed jobs otherwise linger as FAILED cards for 24h; this lets the user
 * dismiss them explicitly. Queued/processing jobs can also be removed —
 * that only hides the card (a GitHub Actions run already in flight still
 * finishes; its resulting document can then be deleted normally).
 */
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

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

  try {
    const jobId = ((req.body || {}).job_id || '').toString().trim();
    if (!jobId) return res.status(400).json({ error: 'Missing required field: job_id' });

    const db = getFirestore(getFirebaseApp());
    const ref = db.collection('ingest_jobs').doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: `Job '${jobId}' not found.` });

    await ref.delete();
    return res.status(200).json({ success: true, job_id: jobId });
  } catch (e) {
    console.error('delete_job error:', e);
    return res.status(500).json({ error: e.message });
  }
};
