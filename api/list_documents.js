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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const db = getFirestore(getFirebaseApp());
    const snapshot = await db
      .collection('documents')
      .orderBy('ingested_at', 'desc')
      .limit(100)
      .get();

    const documents = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Also surface in-flight / recently-failed Drive ingestion jobs so the UI
    // can render "processing…" cards and poll until they resolve. Completed
    // jobs are excluded (their real `documents` record supersedes them);
    // failures older than 24h age out of the list.
    let jobs = [];
    try {
      const jobsSnap = await db
        .collection('ingest_jobs')
        .where('status', 'in', ['queued', 'processing', 'failed'])
        .limit(20)
        .get();
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      jobs = jobsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((j) => j.status !== 'failed' || (j.created_at_ms || 0) > dayAgo);
    } catch (jobsErr) {
      // Jobs are additive — a missing index or read error must not break the doc list.
      console.error('list_documents: ingest_jobs read failed:', jobsErr.message);
    }

    return res.status(200).json({ documents, count: documents.length, jobs });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
