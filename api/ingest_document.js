/**
 * ingest_document — PDF ingestion endpoint
 * POST /api/ingest_document
 * Body (JSON): { pdf_base64: string, doc_name: string, doc_type: string, source_url?: string, client?: string }
 *
 * Pipeline: base64 PDF → unpdf (serverless-safe) → chunk (400 words, 50 overlap) →
 *            Jina embed (batches of 8) → Qdrant upsert → Firestore update
 *
 * Size limit: Vercel's platform request-body cap is ~4.5 MB, which bounds the
 * PDF to roughly ~3 MB after base64 overhead. Larger uploads are rejected at
 * the platform edge (413) before this code runs. Use the local script
 * (scripts/ingest_documents.py) for larger files.
 */

// PDF text extraction uses `unpdf` — a worker-free, serverless-safe wrapper around
// pdfjs. The previous `pdfjs-dist/legacy` path tried to spawn a fake worker
// (`Cannot find module './pdf.worker.js'`) which doesn't bundle on Vercel.
// unpdf is ESM-only, so it is loaded via dynamic import() inside the handler.
const { QdrantClient } = require('@qdrant/js-client-rest');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');
const setCors = require('./_cors');

const COLLECTION_NAME = 'thermiq_chunks';
const CHUNK_WORDS     = 400;
const CHUNK_OVERLAP   = 50;
const JINA_BATCH_SIZE = 8;
// Vercel's platform body cap is ~4.5 MB — anything above that dies at the edge
// with a bare 413 before this code runs, so the in-code limit must sit below it.
const MAX_BASE64_BYTES = Math.floor(4.3 * 1024 * 1024); // ≈3 MB PDF after base64 overhead

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
        error: 'PDF too large. Maximum ~3 MB (Vercel request-body cap). Use local ingest script for larger files.',
      });
    }

    // 1 — Decode and parse PDF (via unpdf — no worker, serverless-safe)
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    let text = '';
    let numPages = 0;
    try {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const data = new Uint8Array(pdfBuffer);
      const pdf = await getDocumentProxy(data);
      numPages = pdf.numPages;
      const extracted = await extractText(pdf, { mergePages: true });
      // unpdf returns { totalPages, text } where text is a string when mergePages:true,
      // or an array of per-page strings otherwise. Handle both defensively.
      text = Array.isArray(extracted.text) ? extracted.text.join('\n') : (extracted.text || '');
      if (typeof extracted.totalPages === 'number') numPages = extracted.totalPages;
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

    const docSlug = doc_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    // 1.5 — Store the original PDF so it's previewable in-app.
    // Originals were previously discarded (only extracted text was indexed),
    // which is why locally-uploaded docs had no preview. Now: commit the PDF
    // into docs/uploads/ via the GitHub Contents API — GitHub Pages + Vercel
    // both serve /docs as the site root, so the file gets a stable public URL.
    // Only when the uploader didn't supply their own source_url; non-fatal on
    // failure (ingestion still succeeds, just without a preview).
    // Requires GITHUB_DISPATCH_TOKEN to have Contents: read/write on the repo.
    let resolvedSourceUrl = source_url;
    if (!resolvedSourceUrl && process.env.GITHUB_DISPATCH_TOKEN) {
      try {
        const storedName = `${docSlug}_${Date.now()}.pdf`;
        const ghRes = await fetch(
          `https://api.github.com/repos/GhostUnamused/thermIQ/contents/docs/uploads/${storedName}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
              'Accept': 'application/vnd.github+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: `chore: store uploaded document ${doc_name}`,
              content: pdf_base64,
            }),
          }
        );
        if (ghRes.ok) {
          resolvedSourceUrl = `https://therm-iq.vercel.app/uploads/${storedName}`;
        } else {
          console.error(`PDF store to repo failed (${ghRes.status}): ${await ghRes.text()}`);
        }
      } catch (storeErr) {
        console.error('PDF store to repo failed:', storeErr.message);
      }
    }

    // 2 — Chunk
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
        source_url:     resolvedSourceUrl,
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
      source_url:     resolvedSourceUrl,
      source_type,
      client_name:    resolvedClientName,
      chunks_indexed: chunks.length,
      pages_parsed:   numPages,
      ingested_at:    ingestedAt,
    });

    // NOTE: No in-request gap recompute. Gap scoring has a single source of truth,
    // the offline engine scripts/detect_gaps.py. Uploading a client doc adds it to
    // the RAG index immediately; re-run detect_gaps.py to refresh the gap scores.

    return res.status(200).json({
      success:        true,
      doc_name,
      doc_type,
      source_url:     resolvedSourceUrl,
      source_type,
      client_name:    resolvedClientName,
      chunks_indexed: chunks.length,
      pages_parsed:   numPages,
      ingested_at:    ingestedAt,
      message:        source_type === 'client'
        ? 'Document ingested. Gap scores are refreshed by the offline gap engine (scripts/detect_gaps.py).'
        : 'Benchmark document ingested successfully.',
    });
  } catch (e) {
    console.error('ingest_document error:', e);
    return res.status(500).json({ error: e.message });
  }
};
