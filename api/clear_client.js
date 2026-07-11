/**
 * clear_client — wipe ALL data for one client/plant namespace
 * POST /api/clear_client   Body: { client_name }   Auth: X-Ingest-Key
 */
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const setCors = require('./_cors');

const COLLECTION_NAME = 'thermiq_chunks';

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
    const clientName = ((req.body || {}).client_name || '').toString().trim().toLowerCase();
    if (!clientName) return res.status(400).json({ error: 'Missing required field: client_name' });
    if (clientName === 'benchmark') return res.status(403).json({ error: 'Refusing to clear the benchmark namespace.' });

    const db = getFirestore(getFirebaseApp());

    // 1 — Qdrant chunks for this client
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
    await qdrant.delete(COLLECTION_NAME, {
      filter: { must: [
        { key: 'source_type', match: { value: 'client' } },
        { key: 'client_name',  match: { value: clientName } },
      ] },
    });

    // 2 — Firestore documents for this client
    const docsSnap = await db.collection('documents').where('client_name', '==', clientName).get();
    let chunksRemoved = 0;
    const docNamesRemoved = [];
    const docBatch = db.batch();
    docsSnap.docs.forEach((d) => {
      const data = d.data();
      chunksRemoved += data.chunks_indexed || 0;
      if (data.doc_name) docNamesRemoved.push(data.doc_name);
      docBatch.delete(d.ref);
    });
    await docBatch.commit();

    // 3 — risk_scores for this client (namespaced id "<client>__<gap>" or client_name field)
    const riskSnap = await db.collection('risk_scores').get();
    const riskBatch = db.batch();
    let riskRemoved = 0;
    riskSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.client_name === clientName || d.id.startsWith(`${clientName}__`)) {
        riskBatch.delete(d.ref);
        riskRemoved += 1;
      }
    });
    await riskBatch.commit();

    // 3.5 — ingest jobs (queued/processing/failed Drive cards) + Drive sync
    // registration for this client. Without this, "Clear this plant" left
    // failed job cards behind (YC hit this on 2026-07-11).
    const jobsSnap = await db.collection('ingest_jobs').where('client_name', '==', clientName).get();
    let jobsRemoved = 0;
    if (!jobsSnap.empty) {
      const jobsBatch = db.batch();
      jobsSnap.docs.forEach((d) => { jobsBatch.delete(d.ref); jobsRemoved += 1; });
      await jobsBatch.commit();
    }
    await db.collection('drive_sync').doc(clientName).delete().catch(() => {});

    // 4 — counters
    const metaUpdate = { total_chunks_indexed: FieldValue.increment(-chunksRemoved) };
    if (docNamesRemoved.length) metaUpdate.documents_ingested = FieldValue.arrayRemove(...docNamesRemoved);
    await db.collection('system_meta').doc('config').set(metaUpdate, { merge: true });

    return res.status(200).json({
      success: true, client_name: clientName,
      documents_removed: docNamesRemoved.length, chunks_removed: chunksRemoved,
      risk_scores_removed: riskRemoved, ingest_jobs_removed: jobsRemoved,
      message: `Cleared all data for plant "${clientName}".`,
    });
  } catch (e) {
    console.error('clear_client error:', e);
    return res.status(500).json({ error: e.message });
  }
};
