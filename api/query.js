/**
 * query.js — ThermIQ RAG endpoint
 * POST /api/query
 * Body: { query: string, client?: string }
 *
 * Pipeline:
 *   1. Embed query via Jina v3
 *   2. Search Qdrant — retrieve from BOTH benchmark and client docs, labelled separately
 *   3. Fetch relevant CEA outage records from Firestore (for equipment-related queries)
 *   4. Confidence floor: if best score < 0.50, answer honestly states limited coverage
 *   5. Generate with Gemini (with OpenRouter fallback), using a prompt that:
 *      - Cites every claim to a labelled source [Benchmark: ...] or [Client: ...]
 *      - Refuses to invent procedures not in the retrieved text
 *      - Distinguishes "CEA standard requires X" from "this plant documents Y"
 */

const { QdrantClient } = require('@qdrant/js-client-rest');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const setCors = require('./_cors');

// ─── Confidence floor ─────────────────────────────────────────────────────────
// If the best match score is below this threshold, we say the corpus has limited
// coverage rather than generating a potentially fabricated answer.
const RETRIEVAL_CONFIDENCE_FLOOR = 0.50;

// ─── System instruction ───────────────────────────────────────────────────────
// Instructs the model to: label every source as Benchmark or Client,
// refuse to fabricate, distinguish standard requirements from plant practice.
const SYSTEM_INSTRUCTION = `You are ThermIQ, an AI knowledge assistant for thermal power plant engineers and maintenance teams in India.

CRITICAL RULES — follow these exactly:
1. Answer ONLY from the provided sources. Do not invent procedures, specifications, or values that are not in the source text.
2. Every factual claim must be cited using the exact label provided: [Benchmark: doc name] or [Client: doc name] or [Outage data].
3. Distinguish carefully between: "The CEA standard requires..." (from a Benchmark source) vs "This plant's documents show..." (from a Client source). These are different things.
4. If a question asks about the plant's actual practice but only Benchmark sources cover the topic, say: "The CEA standard specifies X, but no plant-specific documentation was found in the client corpus covering this procedure."
5. If sources are weak or off-topic, say so explicitly: "The available documents have limited coverage of this topic."
6. Be precise and technical — include specific values, thresholds, part numbers, and procedures where the source text contains them.
7. Keep answers under 450 words. Use numbered steps for procedures. Do not repeat the question.`;

// ─── OpenRouter fallback ──────────────────────────────────────────────────────
const OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const OPENROUTER_URL   = 'https://openrouter.ai/api/v1/chat/completions';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isThrottleError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

// ─── Firebase Init ────────────────────────────────────────────────────────────
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

// ─── Generators ───────────────────────────────────────────────────────────────
async function generateWithGemini(prompt, modelName) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateWithOpenRouter(prompt) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter API key not configured');
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ghostunamused.github.io/thermIQ',
      'X-Title': 'ThermIQ',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user',   content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Embed query ──────────────────────────────────────────────────────────────
async function embedQuery(query) {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [query],
      task: 'retrieval.query',
    }),
  });
  if (!response.ok) throw new Error(`Jina embeddings failed: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding;
}

// ─── Gap intent detection ─────────────────────────────────────────────────────
// If the query is about knowledge gaps, risk scores, or costs, we pull the
// risk_scores Firestore data and inject it directly — the Qdrant corpus won't
// contain this information, so semantic search alone will always fail.
const GAP_INTENT_KEYWORDS = [
  'gap', 'gaps', 'knowledge gap',
  'risk', 'risk score', 'at risk', 'exposure',
  'cost', 'costing', 'crore', '₹', 'cr ',
  'missing', 'not documented', 'undocumented',
  'calculated', 'calculation', 'formula',
  'coverage', 'covered', 'uncovered',
  'explain the gap', 'what is missing',
];

function isGapQuery(query) {
  const q = query.toLowerCase();
  return GAP_INTENT_KEYWORDS.some(kw => q.includes(kw));
}

async function fetchGapData(db) {
  try {
    const snapshot = await db
      .collection('risk_scores')
      .orderBy('risk_score_cr', 'desc')
      .limit(20)
      .get();
    return snapshot.docs.map(d => ({ gap_id: d.id, ...d.data() }));
  } catch (e) {
    console.error('[query] fetchGapData error:', e.message);
    return [];
  }
}

function buildGapContext(gaps) {
  if (!gaps || gaps.length === 0) return null;

  const total = gaps.reduce((s, g) => s + (g.risk_score_cr || 0), 0);
  const lines = gaps.map((g, i) => {
    const topic       = g.topic || g.gap_id;
    const crit        = g.criticality_score ?? '?';
    const consq       = g.consequence_cr ?? '?';
    const expo        = g.exposure_score ?? '?';
    const score       = g.risk_score_cr != null ? g.risk_score_cr.toFixed(1) : '?';
    const clientScore = g.client_score   != null ? (g.client_score * 100).toFixed(0) + '%' : '?';
    const method      = g.consequence_method || 'derived';
    return (
      `${i + 1}. **${topic}**\n` +
      `   • Client doc coverage: ${clientScore}\n` +
      `   • Criticality: ${crit}/5 | Consequence: ₹${consq} Cr | Exposure: ${expo}\n` +
      `   • Risk score = ${crit} × ₹${consq} Cr × ${expo} = **₹${score} Cr** (consequence method: ${method})`
    );
  });

  return (
    `[Gap Analysis: ThermIQ Risk Registry — ${gaps.length} gaps, total ₹${total.toFixed(1)} Cr]\n\n` +
    `Formula: risk_score_cr = criticality_score × consequence_cr × exposure_score\n` +
    `  • criticality_score (1–5): how operationally critical this knowledge area is\n` +
    `  • consequence_cr (₹ Crore): estimated financial impact of a failure in this area\n` +
    `  • exposure_score (0–1): inverse of client doc coverage (0 = fully covered, 1 = total gap)\n\n` +
    lines.join('\n\n')
  );
}

// ─── Fetch relevant outage records ────────────────────────────────────────────
// Brings CEA outage data into the RAG context for equipment/failure queries.
// We fetch the 5 most recent outages and filter by keyword relevance.
const OUTAGE_EQUIPMENT_KEYWORDS = {
  Boiler:          ['boiler', 'furnace', 'superheater', 'super heater', 'economiser', 'air preheater', 'waterwall', 'burner'],
  Turbine:         ['turbine', 'blade', 'governor', 'rotor', 'vibration', 'bearing'],
  Generator:       ['generator', 'stator', 'exciter', 'avr', 'alternator', 'winding'],
  BFP:             ['boiler feed pump', 'bfp', 'feed pump', 'seal water', 'impeller'],
  Condenser:       ['condenser', 'vacuum', 'hotwell', 'ejector', 'tube leak'],
  'Cooling Tower': ['cooling tower', 'fill', 'drift eliminator'],
};

async function fetchRelevantOutages(db, query) {
  const queryLower = query.toLowerCase();
  const relevantTags = Object.entries(OUTAGE_EQUIPMENT_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => queryLower.includes(kw)))
    .map(([tag]) => tag);

  if (relevantTags.length === 0) return [];

  try {
    let snapshot;
    if (relevantTags.length === 1) {
      // Single tag — can use equality filter
      snapshot = await db.collection('cea_outages')
        .where('equipment_tag', '==', relevantTags[0])
        .orderBy('date_out', 'desc')
        .limit(5)
        .get();
    } else {
      // Multiple tags — fetch recent and filter client-side
      snapshot = await db.collection('cea_outages')
        .orderBy('date_out', 'desc')
        .limit(30)
        .get();
    }

    const outages = snapshot.docs
      .map(d => d.data())
      .filter(o => relevantTags.includes(o.equipment_tag))
      .slice(0, 5);

    return outages;
  } catch (e) {
    console.error('[query] fetchRelevantOutages error:', e.message);
    return [];
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const query  = (body.query || '').trim();
    const client = (body.client || '').trim().toLowerCase();

    if (!query) return res.status(400).json({ error: "Missing or empty 'query' field." });

    // ── Step 1: Embed query + init DB ────────────────────────────────────────
    const gapIntent = isGapQuery(query);

    const [embedding, db] = await Promise.all([
      embedQuery(query),
      Promise.resolve(getFirestore(getFirebaseApp())),
    ]);

    // ── Step 2: Search Qdrant — retrieve from BOTH source types ─────────────
    const qdrantClient = new QdrantClient({
      url:    process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    // Build base filter — optionally narrow by client
    const buildFilter = (sourceType) => {
      const must = [{ key: 'source_type', match: { value: sourceType } }];
      if (client && sourceType === 'client') {
        must.push({ key: 'client_name', match: { value: client } });
      }
      return { must };
    };

    // Run benchmark + client searches in parallel for speed
    const [benchmarkHits, clientHits] = await Promise.all([
      qdrantClient.search('thermiq_chunks', {
        vector: embedding,
        filter: buildFilter('benchmark'),
        limit: 4,
        with_payload: true,
      }),
      qdrantClient.search('thermiq_chunks', {
        vector: embedding,
        filter: buildFilter('client'),
        limit: 4,
        with_payload: true,
      }),
    ]);

    // ── Step 3: Confidence floor (with gap-data bypass) ─────────────────────
    const allHits = [...benchmarkHits, ...clientHits].sort((a, b) => b.score - a.score);
    const bestScore = allHits.length > 0 ? allHits[0].score : 0;

    // If gap intent detected, fetch gap data now (in parallel with the confidence check)
    const gapDataRaw = gapIntent ? await fetchGapData(db) : [];
    const gapContext = buildGapContext(gapDataRaw);

    // Only trigger confidence floor if we ALSO have no gap data to fall back on
    if (bestScore < RETRIEVAL_CONFIDENCE_FLOOR && !gapContext) {
      const weakSources = allHits.slice(0, 3).map((h, i) => ({
        doc:     h.payload?.source_doc || `Source ${i + 1}`,
        section: h.payload?.section || '',
        score:   Math.round(h.score * 1000) / 1000,
        source_type: h.payload?.source_type || 'unknown',
        url:     h.payload?.source_url || '',
      }));
      return res.status(200).json({
        answer: `**Limited coverage in the ThermIQ knowledge base.**\n\nThe best match found for your query scored ${Math.round(bestScore * 100)}% confidence, which is below the threshold for a reliable answer (50%).\n\nThis likely means:\n- The specific procedure or topic you're asking about is not in the current client plant documents\n- The available documents cover this equipment type in a general/design context rather than operationally\n\nConsider uploading the plant's SOPs, inspection procedures, or maintenance manuals as client documents to improve coverage on this topic.`,
        sources: weakSources,
        chunks_retrieved: allHits.length,
        confidence_floor_triggered: true,
        best_score: Math.round(bestScore * 1000) / 1000,
      });
    }

    // ── Step 4: Fetch relevant outage records ────────────────────────────────
    const relevantOutages = await fetchRelevantOutages(db, query);

    // ── Step 5: Build context — label each chunk as Benchmark or Client ──────
    const contextParts = [];
    const sources = [];

    // Benchmark chunks first — provide the "what the standard says" context
    benchmarkHits.forEach((result, i) => {
      const payload = result.payload || {};
      const label = `[Benchmark: ${payload.source_doc || 'CEA Standard'}]`;
      contextParts.push(`${label} — ${payload.section || 'General'}:\n${payload.text || ''}`);
      sources.push({
        doc:         payload.source_doc || '',
        section:     payload.section || '',
        page:        payload.page_number,
        score:       Math.round(result.score * 1000) / 1000,
        url:         payload.source_url || '',
        source_type: 'benchmark',
        label,
      });
    });

    // Client chunks — what this plant's documents actually contain
    clientHits.forEach((result, i) => {
      const payload = result.payload || {};
      const clientLabel = payload.client_name
        ? `${payload.client_name.toUpperCase()} plant`
        : 'Client plant';
      const label = `[Client: ${clientLabel} — ${payload.source_doc || 'plant document'}]`;
      contextParts.push(`${label} — ${payload.section || 'General'}:\n${payload.text || ''}`);
      sources.push({
        doc:         payload.source_doc || '',
        section:     payload.section || '',
        page:        payload.page_number,
        score:       Math.round(result.score * 1000) / 1000,
        url:         payload.source_url || '',
        source_type: 'client',
        client_name: payload.client_name || '',
        label,
      });
    });

    // Outage records as additional context
    if (relevantOutages.length > 0) {
      const outageContext = relevantOutages.map(o =>
        `Station: ${o.station}, Unit: ${o.unit}, Equipment: ${o.equipment_tag}, ` +
        `Reason: ${o.failure_reason_raw}, MW Lost: ${o.mw_lost}, ` +
        `Revenue Impact: ₹${o.revenue_lost_est_cr} Cr, Date: ${o.date_out}`
      ).join('\n');
      contextParts.push(`[Outage data: CEA forced outage records]\n${outageContext}`);
      sources.push({
        doc: 'CEA Forced Outage Records',
        section: `${relevantOutages.length} relevant outages`,
        score: null,
        source_type: 'outage_data',
        label: '[Outage data: CEA forced outage records]',
      });
    }

    // Inject gap/risk registry data when the query is about gaps or costs
    if (gapContext) {
      contextParts.unshift(gapContext);   // put gap data first — it's the primary answer
      sources.unshift({
        doc: 'ThermIQ Risk Registry',
        section: `${gapDataRaw.length} knowledge gaps`,
        score: null,
        source_type: 'gap_registry',
        label: '[Gap Analysis: ThermIQ Risk Registry]',
      });
    }

    const contextText = contextParts.join('\n\n---\n\n');
    const llmPrompt = `Question: ${query}\n\nSources:\n${contextText}`;

    // ── Step 6: Generate answer ───────────────────────────────────────────────
    let answer;
    let model_used = 'gemini-2.5-flash';
    try {
      answer = await generateWithGemini(llmPrompt, 'gemini-2.5-flash');
    } catch (err1) {
      if (!isThrottleError(err1)) throw err1;
      await sleep(2000);
      try {
        model_used = 'gemini-2.0-flash';
        answer = await generateWithGemini(llmPrompt, 'gemini-2.0-flash');
      } catch (err2) {
        if (!isThrottleError(err2)) throw err2;
        model_used = OPENROUTER_MODEL;
        answer = await generateWithOpenRouter(llmPrompt);
      }
    }

    return res.status(200).json({
      answer,
      sources,
      chunks_retrieved: allHits.length,
      best_score: Math.round(bestScore * 1000) / 1000,
      outage_records_used: relevantOutages.length,
      gap_records_used: gapDataRaw.length,
      model_used,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
