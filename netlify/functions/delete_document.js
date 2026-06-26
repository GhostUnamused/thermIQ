/**
 * delete_document — removes a document from Qdrant + Firestore
 * POST /api/delete_document
 * Body (JSON): { doc_id: string }   ← Firestore 'documents' collection ID
 * Auth: X-Ingest-Key header required
 *
 * Steps:
 *   1. Read document record from Firestore to get doc_name + chunks_indexed
 *   2. Delete all Qdrant points where payload.source_doc == doc_name
 *   3. Delete Firestore documents/{doc_id}
 *   4. Decrement system_meta/config.total_chunks_indexed
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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth check — same key as ingest
  const providedKey = event.headers['x-ingest-key'] || event.headers['X-Ingest-Key'];
  if (!process.env.INGEST_API_KEY || providedKey !== process.env.INGEST_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { doc_id } = body;

    if (!doc_id) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing required field: doc_id' }),
      };
    }

    const db = getFirestore(getFirebaseApp());
    const docRef = db.collection('documents').doc(doc_id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `Document '${doc_id}' not found in documents collection` }),
      };
    }

    const { doc_name, chunks_indexed = 0 } = docSnap.data();

    // 1 — Delete all Qdrant points for this document
    const qdrant = new QdrantClient({
      url:    process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    await qdrant.delete(COLLECTION_NAME, {
      filter: {
        must: [{ key: 'source_doc', match: { value: doc_name } }],
      },
    });

    // 2 — Delete Firestore document record
    await docRef.delete();

    // 3 — Update system_meta counter (decrement chunks, remove from ingested list)
    await db.collection('system_meta').doc('config').set(
      {
        total_chunks_indexed: FieldValue.increment(-chunks_indexed),
        documents_ingested:   FieldValue.arrayRemove(doc_name),
      },
      { merge: true }
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success:        true,
        doc_id,
        doc_name,
        chunks_removed: chunks_indexed,
      }),
    };
  } catch (e) {
    console.error('delete_document error:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
