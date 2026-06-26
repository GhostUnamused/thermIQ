/**
 * ingest_document — PDF ingestion endpoint
 * POST /api/ingest_document
 * Body (JSON): { pdf_base64: string, doc_name: string, doc_type: string, source_url?: string, client?: string }
 *
 * Pipeline: base64 PDF → pdfjs-dist → chunk (400 words, 50 overlap) →
 *            Jina embed (batches of 8) → Qdrant upsert → Firestore update
 *
 * Size limit: ~8 MB base64 (~6 MB PDF). Use local script for larger files.
 */

// Increase Vercel body size limit for this function (base64 PDFs are large)
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');
const setCors = require('./_cors');

const COLLECTION_NAME = 'thermiq_chunks';
const CHUNK_WORDS     = 400;
const CHUNK_OVERLAP   = 50;
const JINA_BATCH_SIZE = 8;
const MAX_BASE64_BYTES = 8 * 1024 * 1024; // 8 MB

const EQUIPMENT_KEYWORDS = {
  Boiler:          ['boiler','furnace','super heater','superheater','economiser','air preheater','steam drum','burner'],
  Turbine:         ['turbine','hp turbine','lp turbine','ip turbine','blade','governor','nozzle','rotor'],
  Generator:       ['generator','stator','rotor winding','exciter','avr','alternator'],
  BFP:             ['boiler feed pump','bfp','feed pump','seal water','impeller'],
  Condenser:       ['condenser','cooling water','hotwell','vacuum','ejector'],
  'Cooling Tower': ['cooling tower','ct fill','drift eliminator','basin','blowdown'],
};

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

function extractEquipmentTags(text) {
  const lower = text.toLowerCase();
  return Object.entries(EQUIPMENT_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([tag]) => tag);
}

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
    const {
      pdf_base64,
      doc_name,
      doc_type = 'manual',
      source_url = '',
      client = '',
      // source_type: "benchmark" or "client" — REQUIRED
      // Benchmarks = CEA/regulatory standards that define the yardstick.
      // Clients    = a specific plant's own operational documents being assessed.
      source_type,
      // client_name: required when source_type == "client" (e.g. "ntpc_lara")
      client_name = '',
    } = body;
    const docClient = client.trim().toLowerCase();

    if (!pdf_base64 || !doc_name) {
      return res.status(400).json({ error: 'Missing required fields: pdf_base64, doc_name' });
    }

    // Validate source_type — this is the critical new field
    if (!source_type || !['benchmark', 'client'].includes(source_type)) {
      return res.status(400).json({
        error: "Missing or invalid 'source_type'. Must be 'benchmark' (CEA standards/reference) or 'client' (a specific plant's documents).",
      });
    }

    // Benchmark sources are the fixed CEA yardstick for every plant. They must NOT be
    // uploadable through the public web endpoint — the INGEST_API_KEY lives in client JS,
    // so anyone with the link could otherwise poison the assessment baseline. Benchmarks
    // are seeded only via scripts/ingest_documents.py locally (which reads the real key
    // from .env and is never exposed to the browser). To bypass this for legitimate local
    // benchmark seeding, set header x-allow-benchmark to the INGEST_API_KEY.
    if (source_type === 'benchmark' && req.headers['x-allow-benchmark'] !== process.env.INGEST_API_KEY) {
      return res.status(403).json({
        error: "Benchmark sources cannot be uploaded through this endpoint. They are the fixed CEA yardstick and are seeded locally via scripts/ingest_documents.py. Web uploads are limited to client plant documents.",
      });
    }
    if (source_type === 'client' && !client_name.trim()) {
      return res.status(400).json({
        error: "Field 'client_name' is required when source_type is 'client'. E.g. 'ntpc_lara', 'adani_raipur'.",
      });
    }

    // Check size (base64 string length as proxy for byte size)
    if (pdf_base64.length > MAX_BASE64_BYTES) {
      return res.status(413).json({
        error: 'PDF too large. Maximum ~6 MB. Use local ingest script for larger files.',
      });
    }

    // 1 — Decode and parse PDF
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
      return res.status(422).json({
        error: `PDF parse failed: ${pdfErr.message}. File may be corrupted, encrypted, or image-based.`,
      });
    }

    if (text.trim().length < 100) {
      return res.status(422).json({
        error: 'Could not extract meaningful text from PDF. Check if the file is scanned/image-based.',
      });
    }

    // 2 — Chunk
    const docSlug = doc_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const chunks = chunkText(text, docSlug);
    if (!chunks.length) {
      return res.status(422).json({ error: 'No chunks generated.' });
    }
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
        chunk_id:       chunk.chunk_id,
        source_doc:     doc_name,
        source_url,
        doc_type,
        client:         docClient,
        // source_type / client_name: the two new fields that power gap detection filtering
        source_type,
        client_name:    resolvedClientName,
        equipment_tags: chunk.equipment_tags,
        section:        '',
        page_number:    null,
        text:           chunk.text,
        chunk_index:    chunk.chunk_index,
        ingested_at:    ingestedAt,
      },
    }));

    for (let i = 0; i < points.length; i += 50) {
      await qdrant.upsert(COLLECTION_NAME, { points: points.slice(i, i + 50) });
    }

    // 5 — Update Firestore
    const db = getFirestore(getFirebaseApp());
    await db.collection('system_meta').doc('config').set(
      {
        documents_ingested:   FieldValue.arrayUnion(doc_name),
        total_chunks_indexed: FieldValue.increment(chunks.length),
        last_ingestion_at:    ingestedAt,
      },
      { merge: true }
    );
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

    // If a client document was just ingested, trigger gap recomputation.
    // Fire-and-forget — dashboard reflects updated gaps within ~60 seconds.
    if (source_type === 'client') {
      const recomputeUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['host']}/api/recompute_gaps`;
      fetch(recomputeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ingest-key': process.env.INGEST_API_KEY,
        },
        body: JSON.stringify({
          client_name: resolvedClientName,
          triggered_by: 'ingest',
          doc_name,
        }),
      }).catch((err) => console.error('[ingest_document] recompute_gaps trigger failed:', err.message));
    }

    return res.status(200).json({
      success:        true,
      doc_name,
      doc_type,
      source_type,
      client_name:    resolvedClientName,
      chunks_indexed: chunks.length,
      pages_parsed:   numPages,
      ingested_at:    ingestedAt,
      message:        source_type === 'client'
        ? 'Document ingested. Gap analysis will recompute in ~60 seconds.'
        : 'Benchmark document ingested successfully.',
    });
  } catch (e) {
    console.error('ingest_document error:', e);
    return res.status(500).json({ error: e.message });
  }
};
