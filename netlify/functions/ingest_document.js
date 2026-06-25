/**
 * ingest_document — PDF ingestion endpoint
 * POST /api/ingest_document
 * Body (JSON): { pdf_base64: string, doc_name: string, doc_type: string, source_url?: string }
 *
 * Pipeline: base64 PDF → pdf-parse → chunk (400 words, 50 overlap) →
 *            Jina embed (batches of 8) → Qdrant upsert → Firestore system_meta update
 *
 * Size limit: enforced at 8 MB base64 (~6 MB PDF). For larger docs, use local script.
 */

const pdfParse = require('pdf-parse');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const COLLECTION_NAME = 'thermiq_chunks';
const CHUNK_WORDS = 400;
const CHUNK_OVERLAP = 50;
const JINA_BATCH_SIZE = 8;
const MAX_BASE64_BYTES = 8 * 1024 * 1024; // 8 MB

const EQUIPMENT_KEYWORDS = {
  Boiler:         ['boiler','furnace','super heater','superheater','economiser','air preheater','steam drum','burner'],
  Turbine:        ['turbine','hp turbine','lp turbine','ip turbine','blade','governor','nozzle','rotor'],
  Generator:      ['generator','stator','rotor winding','exciter','avr','alternator'],
  BFP:            ['boiler feed pump','bfp','feed pump','seal water','impeller'],
  Condenser:      ['condenser','cooling water','hotwell','vacuum','ejector'],
  'Cooling Tower':['cooling tower','ct fill','drift eliminator','basin','blowdown'],
};

// ─── Firebase init (shared across warm invocations) ──────────────────────────
let firebaseApp;
function getFirebaseApp() {
  if (!getApps().length) {
    firebaseApp = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  } else {
    firebaseApp = getApp();
  }
  return firebaseApp;
}

// ─── Text chunking ────────────────────────────────────────────────────────────
function chunkText(text, docSlug) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0, idx = 0;
  while (i < words.length) {
    const window = words.slice(i, i + CHUNK_WORDS);
    if (!window.length) break;
    chunks.push({
      chunk_id:    `${docSlug}_chunk_${String(idx).padStart(4, '0')}`,
      chunk_index: idx,
      text:        window.join(' '),
    });
    idx++;
    i += CHUNK_WORDS - CHUNK_OVERLAP;
  }
  return chunks;
}

// ─── Equipment tagging ────────────────────────────────────────────────────────
function extractEquipmentTags(text) {
  const lower = text.toLowerCase();
  return Object.entries(EQUIPMENT_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([tag]) => tag);
}

// ─── Jina embedding ───────────────────────────────────────────────────────────
async function embedBatch(texts) {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: texts,
      task: 'retrieval.passage',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jina API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data.map(item => item.embedding);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const providedKey = event.headers['x-ingest-key'] || event.headers['X-Ingest-Key'];
  if (!process.env.INGEST_API_KEY || providedKey !== process.env.INGEST_API_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { pdf_base64, doc_name, doc_type = 'manual', source_url = '' } = body;

    if (!pdf_base64 || !doc_name) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing required fields: pdf_base64, doc_name' }),
      };
    }
    if (pdf_base64.length > MAX_BASE64_BYTES) {
      return {
        statusCode: 413,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'PDF too large. Maximum ~6 MB. Use local ingest script for larger files.' }),
      };
    }

    // 1 — Decode and parse PDF
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text || '';
    if (text.trim().length < 100) {
      return {
        statusCode: 422,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Could not extract meaningful text from PDF. Check if the file is scanned/image-based.' }),
      };
    }

    // 2 — Chunk
    const docSlug = doc_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const chunks = chunkText(text, docSlug);
    if (!chunks.length) {
      return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No chunks generated.' }) };
    }

    // Tag equipment per chunk
    chunks.forEach(c => { c.equipment_tags = extractEquipmentTags(c.text); });

    // 3 — Embed in batches
    const allEmbeddings = [];
    for (let i = 0; i < chunks.length; i += JINA_BATCH_SIZE) {
      const batch = chunks.slice(i, i + JINA_BATCH_SIZE);
      const embs = await embedBatch(batch.map(c => c.text));
      allEmbeddings.push(...embs);
    }

    // 4 — Upsert to Qdrant
    const qdrant = new QdrantClient({
      url:    process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    const ingestedAt = new Date().toISOString();
    const points = chunks.map((chunk, i) => ({
      id:      uuidv4(),
      vector:  allEmbeddings[i],
      payload: {
        chunk_id:      chunk.chunk_id,
        source_doc:    doc_name,
        source_url,
        doc_type,
        equipment_tags: chunk.equipment_tags,
        section:       '',
        page_number:   null,
        text:          chunk.text,
        chunk_index:   chunk.chunk_index,
        ingested_at:   ingestedAt,
      },
    }));

    // Upsert in batches of 50
    for (let i = 0; i < points.length; i += 50) {
      await qdrant.upsert(COLLECTION_NAME, { points: points.slice(i, i + 50) });
    }

    // 5 — Update Firestore system_meta
    const db = getFirestore(getFirebaseApp());
    await db.collection('system_meta').doc('config').set(
      {
        documents_ingested:  FieldValue.arrayUnion(doc_name),
        total_chunks_indexed: FieldValue.increment(chunks.length),
        last_ingestion_at:   ingestedAt,
      },
      { merge: true }
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        doc_name,
        doc_type,
        chunks_indexed: chunks.length,
        pages_parsed:   parsed.numpages,
        ingested_at:    ingestedAt,
      }),
    };
  } catch (e) {
    console.error('ingest_document error:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
