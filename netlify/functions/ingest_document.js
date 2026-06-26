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

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
// Disable worker — not available in Node/serverless environments
pdfjsLib.GlobalWorkerOptions.workerSrc = '';
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Key, X-Allow-Benchmark',
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
    const {
      pdf_base64,
      doc_name,
      doc_type = 'manual',
      source_url = '',
      client = '',
      // source_type: "benchmark" or "client" — REQUIRED (mirrors api/ingest_document.js)
      source_type,
      // client_name: required when source_type == "client" (e.g. "ntpc_lara")
      client_name = '',
    } = body;
    const docClient = client.trim().toLowerCase();

    if (!pdf_base64 || !doc_name) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing required fields: pdf_base64, doc_name' }),
      };
    }

    // Validate source_type — kept in sync with api/ingest_document.js (Vercel)
    if (!source_type || !['benchmark', 'client'].includes(source_type)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Missing or invalid 'source_type'. Must be 'benchmark' (CEA standards/reference) or 'client' (a specific plant's documents).",
        }),
      };
    }

    // Benchmark sources are the fixed CEA yardstick for every plant. They must NOT be
    // uploadable through the public web endpoint — the INGEST_API_KEY lives in client JS,
    // so anyone with the link could otherwise poison the assessment baseline. Benchmarks
    // are seeded only via scripts/ingest_documents.py locally (which writes to Qdrant
    // directly and never hits this endpoint). To bypass for legitimate local benchmark
    // seeding, set header x-allow-benchmark to the INGEST_API_KEY.
    const allowBenchmark = event.headers['x-allow-benchmark'] || event.headers['X-Allow-Benchmark'];
    if (source_type === 'benchmark' && allowBenchmark !== process.env.INGEST_API_KEY) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Benchmark sources cannot be uploaded through this endpoint. They are the fixed CEA yardstick and are seeded locally via scripts/ingest_documents.py. Web uploads are limited to client plant documents.",
        }),
      };
    }
    if (source_type === 'client' && !client_name.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Field 'client_name' is required when source_type is 'client'. E.g. 'ntpc_lara', 'adani_raipur'.",
        }),
      };
    }

    if (pdf_base64.length > MAX_BASE64_BYTES) {
      return {
        statusCode: 413,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'PDF too large. Maximum ~6 MB. Use local ingest script for larger files.' }),
      };
    }

    // 1 — Decode and parse PDF using pdfjs-dist (legacy CJS build, esbuild-safe)
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    let text = '';
    let numPages = 0;
    try {
      const data = new Uint8Array(pdfBuffer);
      const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true });
      const pdf = await loadingTask.promise;
      numPages = pdf.numPages;
      const pageTexts = [];
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str || '').join(' ');
        if (pageText.trim().length > 20) pageTexts.push(pageText);
      }
      text = pageTexts.join('\n');
    } catch (pdfErr) {
      return {
        statusCode: 422,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `PDF parse failed: ${pdfErr.message}. File may be corrupted, encrypted, or image-based.` }),
      };
    }
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
    const resolvedClientName = source_type === 'client' ? client_name.trim().toLowerCase() : '';
    const points = chunks.map((chunk, i) => ({
      id:      uuidv4(),
      vector:  allEmbeddings[i],
      payload: {
        chunk_id:      chunk.chunk_id,
        source_doc:    doc_name,
        source_url,
        doc_type,
        client:        docClient,
        // source_type / client_name: kept in sync with api/ingest_document.js
        source_type,
        client_name:   resolvedClientName,
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

    // 5 — Update Firestore: system_meta counter + documents collection record
    const db = getFirestore(getFirebaseApp());
    await db.collection('system_meta').doc('config').set(
      {
        documents_ingested:   FieldValue.arrayUnion(doc_name),
        total_chunks_indexed: FieldValue.increment(chunks.length),
        last_ingestion_at:    ingestedAt,
      },
      { merge: true }
    );
    // Write a proper document record so the Documents page can list it
    const docId = `${source_type === 'client' ? resolvedClientName : 'benchmark'}_${Date.now()}`;
    await db.collection('documents').doc(docId).set({
      doc_name,
      doc_type,
      client:         docClient,
      source_url,
      source_type,
      client_name:    resolvedClientName,
      chunks_indexed: chunks.length,
      pages_parsed:   numPages,
      ingested_at:    ingestedAt,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        doc_name,
        doc_type,
        chunks_indexed: chunks.length,
        pages_parsed:   numPages,
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
