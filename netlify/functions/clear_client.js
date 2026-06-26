/**
 * clear_client — wipe ALL data for one client/plant namespace (Netlify mirror)
 * POST /api/clear_client   Body: { client_name }   Auth: X-Ingest-Key
 */
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const providedKey = event.headers['x-ingest-key'] || event.headers['X-Ingest-Key'];
  if (!process.env.INGEST_API_KEY || providedKey !== process.env.INGEST_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const clientName = (body.client_name || '').toString().trim().toLowerCase();
    if (!clientName) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required field: client_name' }) };
    if (clientName === 'benchmark') return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Refusing to clear the benchmark namespace.' }) };

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

    // 3 — risk_scores for this client
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

    // 4 — counters
    const metaUpdate = { total_chunks_indexed: FieldValue.increment(-chunksRemoved) };
    if (docNamesRemoved.length) metaUpdate.documents_ingested = FieldValue.arrayRemove(...docNamesRemoved);
    await db.collection('system_meta').doc('config').set(metaUpdate, { merge: true });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true, client_name: clientName,
        documents_removed: docNamesRemoved.length, chunks_removed: chunksRemoved,
        risk_scores_removed: riskRemoved, message: `Cleared all data for plant "${clientName}".`,
      }),
    };
  } catch (e) {
    console.error('clear_client error:', e);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
