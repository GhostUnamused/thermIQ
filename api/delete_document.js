/**
 * delete_document — removes a document from Qdrant + Firestore
 * POST /api/delete_document
 * Body (JSON): { doc_id: string }
 * Auth: X-Ingest-Key header required
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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providedKey = req.headers['x-ingest-key'];
  if (!process.env.INGEST_API_KEY || providedKey !== process.env.INGEST_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body || {};
    const { doc_id } = body;

    if (!doc_id) {
      return res.status(400).json({ error: 'Missing required field: doc_id' });
    }

    const db = getFirestore(getFirebaseApp());
    const docRef = db.collection('documents').doc(doc_id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: `Document '${doc_id}' not found in documents collection` });
    }

    const { doc_name, chunks_indexed = 0, source_type } = docSnap.data();

    // Benchmark documents are the fixed yardstick — not user-deletable.
    // Deleting them would silently change the assessment baseline for every plant.
    if (source_type === 'benchmark') {
      return res.status(403).json({
        error: `Cannot delete benchmark document "${doc_name}". Benchmark sources (CEA standards and guidelines) are the fixed yardstick for all gap assessments. If you need to update a benchmark, contact the system administrator.`,
      });
    }

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

    // 3 — Update system_meta counter
    await db.collection('system_meta').doc('config').set(
      {
        total_chunks_indexed: FieldValue.increment(-chunks_indexed),
        documents_ingested:   FieldValue.arrayRemove(doc_name),
      },
      { merge: true }
    );

    // NOTE: No in-request gap recompute. Gap scoring has a single source of truth,
    // the offline engine scripts/detect_gaps.py. Re-run it to refresh risk_scores
    // after deletes/uploads; the dashboard reflects the new scores on next load.

    return res.status(200).json({
      success:        true,
      doc_id,
      doc_name,
      chunks_removed: chunks_indexed,
      message:        'Document deleted. Gap scores are refreshed by the offline gap engine (scripts/detect_gaps.py).',
    });
  } catch (e) {
    console.error('delete_document error:', e);
    return res.status(500).json({ error: e.message });
  }
};
