/**
 * query.js — ThermIQ Agentic RAG endpoint v2.1
 * POST /api/query   Body: { query: string, client?: string }
 *
 * LLM cascade (most capable → most available):
 *   1. gemini-2.5-flash  — agentic (function calling, 4 tools)
 *   2. gemini-2.0-flash  — agentic (function calling, separate rate-limit quota)
 *   3. gemini-1.5-flash  — agentic (function calling, another separate quota)
 *   4. OpenRouter        — non-agentic fallback; tries 3 free models in sequence,
 *                          injects context directly, uses correct system/user split
 *
 * Tools Gemini can call:
 *   search_knowledge_base  → Qdrant (CEA standards + NTPC plant docs)
 *   get_risk_registry      → Firestore risk_scores (live gap analysis)
 *   search_web             → Jina Search API (no new key needed)
 *   get_outage_records     → Firestore cea_outages
 */

const { QdrantClient }                         = require('@qdrant/js-client-rest');
const { GoogleGenerativeAI }                   = require('@google/generative-ai');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore }                         = require('firebase-admin/firestore');
const setCors                                  = require('./_cors');

// ─── Firebase ──────────────────────────────────────────────────────────────────
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

// ─── LLM model lists ───────────────────────────────────────────────────────────
// Gemini cascade: each has its own rate-limit quota — exhausting 2.5 doesn't
// block 2.0 or 1.5. All three support function calling identically.
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

// OpenRouter free-tier cascade. Tried in order; moves to next on any error or timeout.
// llama-3.3-70b is best quality but gets overloaded. gemini-2.0-flash-exp:free goes
// through Google's own serving via OR routing (different quota from direct Gemini).
// mistral-7b is the reliable last resort — smaller but almost always available.
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'mistralai/mistral-7b-instruct:free',
];

// ─── System prompt (full — used by Gemini with function calling) ───────────────
const SYSTEM_PROMPT = `You are ThermIQ, an expert AI analyst for thermal power plant operations in India.
You serve plant engineers, O&M teams, and senior management at utilities like NTPC, Adani Power, Tata Power, and state gencos.

YOUR DOMAIN EXPERTISE — USE IT FREELY:

Indian thermal power plants:
- Supercritical (660 MW, 800 MW) and subcritical units (200 MW, 500 MW)
- Boiler systems: waterwall tubes, superheaters (primary/secondary/platen), reheaters, economizers, air preheaters (rotary Ljungström), pulverizers, burners, wind boxes
- Steam turbines: HP/IP/LP stages, blade erosion, rotor bow, diaphragm issues, governing valves
- Generators: stator winding, field winding, excitation systems, hydrogen cooling, AVR
- Auxiliaries: Boiler Feed Pumps (BFPs) — seal water, impeller wear; condensers and hotwell; ejectors; cooling towers (natural/mechanical draft), fill deterioration; coal handling; ash handling (ESP)

NTPC specifics:
- India's largest power generator: 67+ GW installed, ~25 thermal stations
- Key stations: Singrauli (2000 MW), Korba (2100 MW), Ramagundam (2600 MW), Vindhyachal (4760 MW), Rihand (3000 MW), Sipat (2980 MW), Farakka (2100 MW), Kahalgaon (2340 MW), Lara (1600 MW)
- Operates under continuous availability model with annual overhauls

Regulatory framework:
- CEA Technical Standards for Construction; Standard Technical Specification for 500 MW units; mandatory spare holding requirements
- CERC NAPAF norms: 85% availability factor for coal units; two-part tariff; forced outages reduce capacity charge recovery
- CEA forced outage reporting: monthly Performance Review, annual Generation Profile

Common failure modes at Indian coal plants (from CEA outage statistics):
- Boiler tube failures: #1 cause, 30–40% of forced outage hours — waterwall corrosion/erosion, superheater creep, faulty welds
- Flame failures: #2 cause — coal quality variation, mill tripping, flame scanner issues
- Turbine vibration/trips: LP blade erosion, rotor unbalance, bearing failure
- BFP failures: seal water, cavitation at low load
- Condenser vacuum loss: tube fouling, ejector malfunction, tube leak
- Cooling tower: PVC fill deterioration, basin sludge, drift eliminator blockage

ThermIQ gap framework:
- risk_score_cr = criticality_score (1–5) × consequence_cr (₹ Crore) × exposure_score (0–1)
- exposure_score = inverse of documentation coverage (1 = complete gap, 0 = fully documented)
- Current NTPC assessment: 19 knowledge gaps, ~₹416 Cr total risk

YOUR 4 TOOLS — call them intelligently, in parallel when useful:
1. search_knowledge_base — CEA standards + NTPC plant docs in the vector DB
2. get_risk_registry     — live gap analysis with ₹ scores; USE for any question about issues, risks, priorities, what needs fixing
3. search_web            — internet search for current NTPC news, CEA reports, industry data
4. get_outage_records    — actual CEA historical failure records by equipment type

ANSWER PRINCIPLES:
- Synthesize: domain knowledge + tool results
- Be specific: name equipment, cite ₹ figures, prioritise actions
- Distinguish: "CEA standard requires..." vs "Plant documents show..." vs "CEA outage data shows..."
- Don't apologise for limited docs — you have knowledge and tools, use them`;

// Shorter system prompt for OpenRouter fallback models (to save tokens / improve reliability)
const FALLBACK_SYSTEM_PROMPT = `You are ThermIQ, an AI analyst for NTPC and Indian thermal power plants.
Answer questions about thermal power plant knowledge gaps, risks, operations, and maintenance using the provided context data.
Be specific: cite ₹ figures from the risk registry, name equipment, give prioritised recommendations.
Distinguish between what CEA standards require vs what the plant documents vs general industry knowledge.`;

// ─── Tool definitions (used by all Gemini models) ─────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'search_knowledge_base',
    description:
      'Search the ThermIQ vector knowledge base — CEA Standard Technical Specification for 500 MW units and NTPC plant documents (IPS2025 O&M conference, BMD-32 waterwall spec, NTPC tariff petitions). Use for specific technical procedures, values, thresholds, or standards.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query:       { type: 'STRING', description: 'Technical search query — be specific about equipment, procedure, or standard' },
        source_type: { type: 'STRING', enum: ['benchmark', 'client', 'both'], description: '"benchmark" = CEA standards, "client" = NTPC plant docs, "both" = all (default)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_risk_registry',
    description:
      'Get the live ThermIQ knowledge gap risk assessment. Returns all 19 gaps with criticality scores, ₹ consequence, exposure scores, doc coverage %, and total ₹ Cr at risk. CALL THIS for any question about: issues/problems the plant faces, what needs fixing, risks, gaps, costs, priorities, or gap analysis scores.',
    parameters: {
      type: 'OBJECT',
      properties: {
        client_name: { type: 'STRING', description: 'Plant identifier, e.g. "ntpc". Defaults to ntpc.' },
      },
    },
  },
  {
    name: 'search_web',
    description:
      'Search the internet for current information. Use for: recent NTPC news, latest CEA outage statistics, current power sector policy, recent equipment incidents, industry benchmarks, or any topic needing up-to-date data.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Web search query — be specific, e.g. "NTPC plant availability factor 2024 CEA report"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_outage_records',
    description:
      'Get actual CEA forced outage records for a specific equipment type. Returns historical events with MW lost, ₹ revenue impact, station, and failure reason. Use for evidence-based risk quantification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        equipment_tag: { type: 'STRING', description: 'One of: Boiler, Turbine, Generator, BFP, Condenser, Cooling Tower' },
      },
      required: ['equipment_tag'],
    },
  },
];

// ─── Embed a query via Jina ────────────────────────────────────────────────────
async function embedQuery(query) {
  const r = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jina-embeddings-v3', input: [query], task: 'retrieval.query' }),
  });
  if (!r.ok) throw new Error(`Jina embed failed: ${r.status}`);
  return (await r.json()).data[0].embedding;
}

// ─── Tool implementations ──────────────────────────────────────────────────────

async function toolSearchKnowledgeBase({ query, source_type = 'both' }, clientName) {
  const embedding = await embedQuery(query);
  const qdrant    = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });

  const makeFilter = (srcType) => {
    const must = [{ key: 'source_type', match: { value: srcType } }];
    if (srcType === 'client' && clientName) must.push({ key: 'client_name', match: { value: clientName } });
    return { must };
  };

  let hits = [];
  if (source_type === 'both') {
    const [bm, cl] = await Promise.all([
      qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter('benchmark'), limit: 4, with_payload: true }),
      qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter('client'),    limit: 4, with_payload: true }),
    ]);
    hits = [...bm.map(h => ({ ...h, _type: 'benchmark' })), ...cl.map(h => ({ ...h, _type: 'client' }))];
  } else {
    const r = await qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter(source_type), limit: 6, with_payload: true });
    hits = r.map(h => ({ ...h, _type: source_type }));
  }

  if (!hits.length) return 'No relevant chunks found in the knowledge base.';

  hits.sort((a, b) => b.score - a.score);

  return `Best relevance: ${Math.round(hits[0].score * 100)}%\n\n` + hits.slice(0, 6).map(h => {
    const p   = h.payload || {};
    const tag = h._type === 'benchmark'
      ? `[Benchmark: ${p.source_doc || 'CEA Standard'}]`
      : `[Client: ${(p.client_name || 'plant').toUpperCase()} — ${p.source_doc || 'plant document'}]`;
    return `${tag} (${Math.round(h.score * 100)}%) — ${p.section || 'General'}\n${(p.text || '').slice(0, 800)}`;
  }).join('\n\n---\n\n');
}

async function toolGetRiskRegistry({ client_name = 'ntpc' }, db) {
  try {
    const cn   = (client_name || 'ntpc').trim().toLowerCase();
    let snap   = await db.collection('risk_scores').where('client_name', '==', cn).get();
    let gaps   = snap.docs.map(d => ({ gap_id: d.id, ...d.data() }));

    if (!gaps.length) {
      // Legacy fallback: pre-namespacing records have no client_name
      const all = await db.collection('risk_scores').get();
      gaps = all.docs.map(d => ({ gap_id: d.id, ...d.data() })).filter(g => !g.client_name);
    }
    if (!gaps.length) return `No risk registry data found for "${cn}".`;

    gaps.sort((a, b) => (b.risk_score_cr || 0) - (a.risk_score_cr || 0));
    const total      = gaps.reduce((s, g) => s + (g.risk_score_cr || 0), 0);
    const gapCount   = gaps.filter(g => (g.status || g.gap_status) === 'gap').length;
    const partCount  = gaps.filter(g => (g.status || g.gap_status) === 'partial').length;

    const lines = gaps.map((g, i) => {
      const topic   = g.topic || g.gap_id;
      const crit    = g.criticality_score ?? '?';
      const consq   = g.consequence_cr ?? '?';
      const expo    = g.exposure_score ?? '?';
      const score   = g.risk_score_cr != null ? g.risk_score_cr.toFixed(1) : '?';
      const cov     = g.client_score  != null ? `${(g.client_score * 100).toFixed(0)}%` : '?';
      const status  = (g.status || g.gap_status || 'gap').toUpperCase();
      const src     = g.criticality_source ? ` [${g.criticality_source}]` : '';
      return `${i + 1}. ${topic} [${status}] — criticality ${crit}/5${src} × ₹${consq}Cr × exposure ${expo} = ₹${score}Cr | doc coverage: ${cov}`;
    });

    return [
      `ThermIQ Risk Registry — ${cn.toUpperCase()} | ${gaps.length} gaps | ₹${total.toFixed(1)}Cr total risk`,
      `${gapCount} full gaps, ${partCount} partial coverage`,
      `Formula: risk_score = criticality(1-5) × consequence(₹Cr) × exposure(0-1)`,
      '', ...lines,
    ].join('\n');
  } catch (e) {
    return `Error reading risk registry: ${e.message}`;
  }
}

async function toolSearchWeb({ query }) {
  try {
    const r = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: {
        Authorization:   `Bearer ${process.env.JINA_API_KEY}`,
        Accept:          'text/plain',
        'X-Retain-Images': 'none',
        'X-No-Cache':    'true',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return `Web search HTTP ${r.status} for: "${query}"`;
    const text = await r.text();
    return text.slice(0, 4000) + (text.length > 4000 ? '\n[truncated]' : '');
  } catch (e) {
    return `Web search error: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`;
  }
}

const VALID_EQUIPMENT_TAGS = ['Boiler', 'Turbine', 'Generator', 'BFP', 'Condenser', 'Cooling Tower'];

async function toolGetOutageRecords({ equipment_tag }, db) {
  try {
    const tag = VALID_EQUIPMENT_TAGS.find(t => t.toLowerCase() === (equipment_tag || '').toLowerCase()) || equipment_tag;
    const snap = await db.collection('cea_outages').where('equipment_tag', '==', tag).orderBy('date_out', 'desc').limit(10).get();
    if (!snap.docs.length) return `No outage records for "${tag}". Valid tags: ${VALID_EQUIPMENT_TAGS.join(', ')}`;

    const rows    = snap.docs.map(d => {
      const o = d.data();
      return `${o.date_out} | ${o.station} Unit ${o.unit} | ${o.failure_reason_raw} | ${o.mw_lost}MW | ₹${o.revenue_lost_est_cr}Cr`;
    });
    const totCr   = snap.docs.reduce((s, d) => s + (d.data().revenue_lost_est_cr || 0), 0);
    const totMW   = snap.docs.reduce((s, d) => s + (d.data().mw_lost || 0), 0);
    return [`CEA Outage Records — ${tag} (${rows.length} events)`, `Total: ₹${totCr.toFixed(1)}Cr impact | ${totMW}MW-events`, '', ...rows].join('\n');
  } catch (e) {
    return `Error fetching outage records: ${e.message}`;
  }
}

async function executeTool(fnCall, context) {
  const { name, args = {} } = fnCall;
  switch (name) {
    case 'search_knowledge_base': return toolSearchKnowledgeBase(args, context.clientName);
    case 'get_risk_registry':     return toolGetRiskRegistry(args, context.db);
    case 'search_web':            return toolSearchWeb(args);
    case 'get_outage_records':    return toolGetOutageRecords(args, context.db);
    default:                      return `Unknown tool: ${name}`;
  }
}

// ─── Agentic Gemini call (shared by all three Gemini models) ──────────────────
function isThrottleError(err) {
  const m = (err.message || '').toLowerCase();
  return m.includes('429') || m.includes('quota') || m.includes('resource_exhausted') || m.includes('rate limit') || m.includes('too many requests')
      || m.includes('503') || m.includes('service unavailable') || m.includes('high demand') || m.includes('overloaded')
      || m.includes('empty answer');
}

async function runGeminiAgentic(modelName, query, clientName, db) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model:            modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  });

  const chat  = model.startChat({ tools: [{ functionDeclarations: TOOL_DEFINITIONS }] });
  const turn1 = await chat.sendMessage(query);
  const parts1 = turn1.response.candidates[0].content.parts;
  const calls  = parts1.filter(p => p.functionCall);

  if (!calls.length) {
    // Gemini answered from domain knowledge — that's fine
    return { answer: turn1.response.text(), toolsUsed: [], model: modelName };
  }

  // Execute all tool calls in parallel
  const toolsUsed = [];
  const responses = await Promise.all(
    calls.map(async (p) => {
      const result = await executeTool(p.functionCall, { clientName, db });
      toolsUsed.push(p.functionCall.name);
      return { functionResponse: { name: p.functionCall.name, response: { result } } };
    })
  );

  const turn2  = await chat.sendMessage(responses);
  const answer = turn2.response.text();
  if (!answer.trim()) throw new Error(`${modelName} returned an empty answer after tool execution`);
  return { answer, toolsUsed, model: modelName };
}

// ─── OpenRouter fallback (non-agentic, direct context injection) ───────────────
// Injects the risk registry + knowledge base directly into the prompt.
// Tries each free model in OPENROUTER_MODELS until one succeeds.
async function runOpenRouterFallback(query, clientName, db) {
  // Gather context in parallel
  const [embedding, registry] = await Promise.all([
    embedQuery(query),
    toolGetRiskRegistry({ client_name: clientName || 'ntpc' }, db),
  ]);

  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
  const [bm, cl] = await Promise.all([
    qdrant.search('thermiq_chunks', { vector: embedding, filter: { must: [{ key: 'source_type', match: { value: 'benchmark' } }] }, limit: 3, with_payload: true }),
    qdrant.search('thermiq_chunks', { vector: embedding, filter: { must: [{ key: 'source_type', match: { value: 'client'    } }] }, limit: 3, with_payload: true }),
  ]);

  const docContext = [...bm, ...cl].map(h => {
    const p   = h.payload || {};
    const tag = p.source_type === 'benchmark' ? `[Benchmark: ${p.source_doc}]` : `[Client: ${p.source_doc}]`;
    return `${tag} — ${p.section || ''}\n${(p.text || '').slice(0, 500)}`;
  }).join('\n\n---\n\n');

  // Keep user content concise — free models have small effective context windows
  const userContent =
    `Question: ${query}\n\n` +
    `--- RISK REGISTRY (live data) ---\n${registry.slice(0, 2500)}\n\n` +
    `--- KNOWLEDGE BASE (top matches) ---\n${docContext.slice(0, 2000)}\n\n` +
    `Answer the question using the above data and your knowledge of Indian thermal power plants.`;

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  for (const orModel of OPENROUTER_MODELS) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 25000); // 25s per model

      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ghostunamused.github.io/thermIQ',
          'X-Title':      'ThermIQ',
        },
        body: JSON.stringify({
          model:      orModel,
          messages:   [
            { role: 'system', content: FALLBACK_SYSTEM_PROMPT },  // proper system/user split
            { role: 'user',   content: userContent },
          ],
          max_tokens:  1024,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!r.ok) {
        const err = await r.text().catch(() => r.status);
        console.warn(`[fallback] ${orModel} → HTTP ${r.status}: ${err}`);
        continue; // try next model
      }

      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) { console.warn(`[fallback] ${orModel} returned empty content`); continue; }

      return { answer: text, model: orModel, toolsUsed: ['search_knowledge_base', 'get_risk_registry'] };

    } catch (e) {
      const reason = e.name === 'AbortError' ? 'timed out (25s)' : e.message;
      console.warn(`[fallback] ${orModel} → ${reason}`);
      // continue to next model
    }
  }

  throw new Error('All fallback models exhausted — Gemini is throttled and no OpenRouter model responded');
}

// ─── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body   = req.body || {};
    const query  = (body.query || '').trim();
    const client = (body.client || '').trim().toLowerCase();
    if (!query) return res.status(400).json({ error: "Missing 'query' field." });

    const db = getFirestore(getFirebaseApp());

    // ── Gemini cascade: 2.5-flash → 2.0-flash → 1.5-flash ───────────────────
    for (const geminiModel of GEMINI_MODELS) {
      try {
        const result = await runGeminiAgentic(geminiModel, query, client, db);
        return res.status(200).json({
          answer:     result.answer,
          tools_used: result.toolsUsed,
          model_used: result.model,
        });
      } catch (err) {
        if (!isThrottleError(err)) throw err; // real error — stop trying Gemini
        console.warn(`[query] ${geminiModel} throttled, trying next...`);
        await new Promise(r => setTimeout(r, 1000)); // brief pause before next Gemini model
      }
    }

    // ── OpenRouter fallback (all Gemini models throttled) ─────────────────────
    console.log('[query] All Gemini models throttled — falling back to OpenRouter');
    const result = await runOpenRouterFallback(query, client, db);
    return res.status(200).json({
      answer:     result.answer,
      tools_used: result.toolsUsed,
      model_used: result.model,
    });

  } catch (e) {
    console.error('[query] Fatal:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
