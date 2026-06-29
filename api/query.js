/**
 * query.js — ThermIQ Agentic RAG endpoint v2.1
 * POST /api/query   Body: { query: string, client?: string }
 *
 * LLM cascade (most capable → most available):
 *   1. gemini-2.5-flash      — agentic (function calling, 4 tools)
 *   2. gemini-2.0-flash      — agentic (function calling)
 *   3. gemini-2.0-flash-lite — agentic (function calling)
 *   4. OpenRouter            — non-agentic fallback; tries 3 free models in sequence,
 *                              injects context directly, uses correct system/user split
 *
 * NOTE: on the Gemini free tier, only gemini-2.5-flash has any daily quota (20
 * req/day) — 2.0-flash and 2.0-flash-lite report quota limit 0 and always 429.
 * They're kept in the cascade as fast (sub-second) no-ops; OpenRouter is the
 * real fallback once the 2.5-flash daily quota is spent.
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
// Gemini cascade — model × key matrix.
// GEMINI_API_KEY  = primary key   (env var, always set)
// GEMINI_API_KEY2 = secondary key (optional; if set, doubles the daily free quota)
// GEMINI_API_KEY3 = tertiary key  (optional; triples quota)
// All three keys try gemini-2.5-flash first, then 2.0-flash, then 2.0-flash-lite.
// Having 3 keys gives ~60 quality responses/day on the free tier.
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

function getGeminiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2,
    process.env.GEMINI_API_KEY3,
  ].filter(Boolean);
  return keys.length ? keys : [process.env.GEMINI_API_KEY];
}

// OpenRouter free-tier cascade.
// - llama-3.3-70b is strong (70B) but slow — bumped timeout to 18s to let it finish
// - deepseek/deepseek-r1:free is a reasoning model, very good for analysis questions
// - nemotron-nano-9b is the last resort (small but reliable)
// gpt-oss-120b:free removed — that model doesn't exist on OR and always 404s
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'nvidia/nemotron-nano-9b-v2:free',
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

ANSWER STYLE — NON-NEGOTIABLE:
- Audience = plant engineers and O&M managers. They know the jargon. No definitions, no hand-holding.
- Target 150–300 words. Simple questions get shorter answers. Never pad to fill space.
- Lead with the number or the finding. "₹28.6 Cr at risk. Cause: waterwall erosion, 51% doc coverage." NOT "The consequence value represents the estimated financial impact of..."
- Short, direct sentences. Dense paragraphs or a tight numbered list — never both in the same answer.
- No filler phrases: no "In essence", "In summary", "The solution lies in", "It's worth noting", "This means that", "It is important to"
- For broad "what are the issues/risks" questions: TOP 3 gaps by ₹, one sentence why each is critical, one action each. Stop.
- For specific/technical questions: cite the value, CEA clause, or outage record. Skip the background — they already know it.
- If docs are missing, say "SOP gap — draft using CEA STS Clause X." Don't explain what an SOP is.
- Distinguish: "CEA STS requires..." vs "Plant docs show..." vs "CEA outage records show..."
- Don't apologise for limited docs — pivot immediately to what can be done`;

// Shorter system prompt for OpenRouter fallback models (to save tokens / improve reliability)
const FALLBACK_SYSTEM_PROMPT = `You are ThermIQ, an AI analyst for NTPC and Indian thermal power plants.
Answer using the provided context data. Audience = plant engineers. They know the terminology.

RULES:
- 150–300 words target. Short questions get short answers. Never pad.
- Lead with the ₹ figure or technical finding immediately. No preamble.
- No definitions, no explaining what an SOP or criticality score "is".
- No filler: no "In essence", "In summary", "It's important to note", "The solution lies in".
- For broad risk/gap questions: TOP 3 by ₹ risk only. One line why critical, one concrete action. Stop.
- For technical questions: cite the specific CEA clause, UT thickness threshold, MTTR, or outage record. No background.
- Follow-up questions ("same question", "explain more"): use conversation history, don't restart from scratch.
- Distinguish: "CEA STS requires..." vs "Plant docs show..." vs "CEA outage records show..."`;


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

// The @qdrant/js-client-rest `timeout` constructor option is a no-op in the
// installed version (no AbortController/signal wiring in its fetcher) — so
// Qdrant/Firestore calls have no real network timeout unless we wrap them
// ourselves. Every call below that hits Qdrant or Firestore is wrapped with
// this so a single slow request can't silently eat the whole 60s Vercel cap.
const DEFAULT_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// ─── Embed a query via Jina ────────────────────────────────────────────────────
async function embedQuery(query) {
  const r = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jina-embeddings-v3', input: [query], task: 'retrieval.query' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Jina embed failed: ${r.status}`);
  return (await r.json()).data[0].embedding;
}

// ─── Tool implementations ──────────────────────────────────────────────────────

async function toolSearchKnowledgeBase({ query, source_type = 'both' }, clientName) {
  const embedding = await embedQuery(query);
  const qdrant    = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, timeout: 8000 });

  const makeFilter = (srcType) => {
    const must = [{ key: 'source_type', match: { value: srcType } }];
    if (srcType === 'client' && clientName) must.push({ key: 'client_name', match: { value: clientName } });
    return { must };
  };

  let hits = [];
  if (source_type === 'both') {
    const [bm, cl] = await Promise.all([
      withTimeout(qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter('benchmark'), limit: 4, with_payload: true }), DEFAULT_TIMEOUT_MS, 'qdrant benchmark search'),
      withTimeout(qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter('client'),    limit: 4, with_payload: true }), DEFAULT_TIMEOUT_MS, 'qdrant client search'),
    ]);
    hits = [...bm.map(h => ({ ...h, _type: 'benchmark' })), ...cl.map(h => ({ ...h, _type: 'client' }))];
  } else {
    const r = await withTimeout(qdrant.search('thermiq_chunks', { vector: embedding, filter: makeFilter(source_type), limit: 6, with_payload: true }), DEFAULT_TIMEOUT_MS, 'qdrant search');
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
    let snap   = await withTimeout(db.collection('risk_scores').where('client_name', '==', cn).get(), DEFAULT_TIMEOUT_MS, 'firestore risk_scores');
    let gaps   = snap.docs.map(d => ({ gap_id: d.id, ...d.data() }));

    if (!gaps.length) {
      // Legacy fallback: pre-namespacing records have no client_name
      const all = await withTimeout(db.collection('risk_scores').get(), DEFAULT_TIMEOUT_MS, 'firestore risk_scores legacy');
      gaps = all.docs.map(d => ({ gap_id: d.id, ...d.data() })).filter(g => !g.client_name);
    }
    if (!gaps.length) return `No risk registry data found for "${cn}".`;

    gaps.sort((a, b) => (b.risk_score_cr || 0) - (a.risk_score_cr || 0));
    const total      = gaps.reduce((s, g) => s + (g.risk_score_cr || 0), 0);
    // Canonical writer (scripts/detect_gaps.py) and the dashboard both use
    // `coverage_status`. Keep status/gap_status as legacy fallbacks only.
    const statusOf   = g => g.coverage_status || g.status || g.gap_status || 'gap';
    const gapCount   = gaps.filter(g => statusOf(g) === 'gap').length;
    const partCount  = gaps.filter(g => statusOf(g) === 'partial').length;

    const lines = gaps.map((g, i) => {
      const topic   = g.topic || g.gap_id;
      const crit    = g.criticality_score ?? '?';
      const consq   = g.consequence_cr ?? '?';
      const expo    = g.exposure_score ?? '?';
      const score   = g.risk_score_cr != null ? g.risk_score_cr.toFixed(1) : '?';
      const cov     = g.client_score  != null ? `${(g.client_score * 100).toFixed(0)}%` : '?';
      const status  = statusOf(g).toUpperCase();
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
    const snap = await withTimeout(db.collection('cea_outages').where('equipment_tag', '==', tag).orderBy('date_out', 'desc').limit(10).get(), DEFAULT_TIMEOUT_MS, 'firestore cea_outages');
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
      || m.includes('empty answer') || m.includes('timed out');
}

// Vercel's hard 60s function cap means a worst-case cascade through 3 Gemini
// models + 3 OpenRouter models must stay well under budget. Bound each Gemini
// attempt so a slow/hung call can't eat the whole request on its own.
const GEMINI_MODEL_TIMEOUT_MS = 10000;

// Format frontend history ({ role: 'user'|'assistant', content }) for Gemini's
// startChat history format ({ role: 'user'|'model', parts: [{ text }] }).
// Gemini requires the history to alternate user/model and END on model — drop the
// trailing user turn (the current query) if it slipped in, and skip any entries
// that don't have content (e.g. empty assistant messages during errors).
function formatHistoryForGemini(history) {
  const clean = (history || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }));
  // Gemini rejects history that ends on a user turn — trim it.
  // (The caller already excludes the new query from history, but be defensive.)
  while (clean.length > 0 && clean[clean.length - 1].role === 'user') {
    clean.pop();
  }
  return clean;
}

async function runGeminiAgentic(modelName, query, clientName, db, history = [], apiKey = null) {
  const genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model:            modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  });

  const geminiHistory = formatHistoryForGemini(history);
  const chat  = model.startChat({
    tools:   [{ functionDeclarations: TOOL_DEFINITIONS }],
    history: geminiHistory,
  });
  const turn1 = await withTimeout(chat.sendMessage(query), GEMINI_MODEL_TIMEOUT_MS, modelName);
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

  const turn2  = await withTimeout(chat.sendMessage(responses), GEMINI_MODEL_TIMEOUT_MS, modelName);
  const answer = turn2.response.text();
  if (!answer.trim()) throw new Error(`${modelName} returned an empty answer after tool execution`);
  return { answer, toolsUsed, model: modelName };
}

// ─── Shared context builder (used by NIM and OpenRouter) ──────────────────────
async function buildFallbackContext(query, clientName, db) {
  const [embedding, registry] = await Promise.all([
    embedQuery(query),
    toolGetRiskRegistry({ client_name: clientName || 'ntpc' }, db),
  ]);
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, timeout: 8000 });
  const [bm, cl] = await Promise.all([
    withTimeout(qdrant.search('thermiq_chunks', { vector: embedding, filter: { must: [{ key: 'source_type', match: { value: 'benchmark' } }] }, limit: 3, with_payload: true }), DEFAULT_TIMEOUT_MS, 'qdrant benchmark'),
    withTimeout(qdrant.search('thermiq_chunks', { vector: embedding, filter: { must: [{ key: 'source_type', match: { value: 'client'    } }] }, limit: 3, with_payload: true }), DEFAULT_TIMEOUT_MS, 'qdrant client'),
  ]);
  const docContext = [...bm, ...cl].map(h => {
    const p   = h.payload || {};
    const tag = p.source_type === 'benchmark' ? `[Benchmark: ${p.source_doc}]` : `[Client: ${p.source_doc}]`;
    return `${tag} — ${p.section || ''}\n${(p.text || '').slice(0, 500)}`;
  }).join('\n\n---\n\n');
  const userContent =
    `Question: ${query}\n\n` +
    `--- RISK REGISTRY (live data) ---\n${registry.slice(0, 2500)}\n\n` +
    `--- KNOWLEDGE BASE (top matches) ---\n${docContext.slice(0, 2000)}\n\n` +
    `Answer the question using the above data and your knowledge of Indian thermal power plants.`;
  return userContent;
}

// ─── NVIDIA NIM fallback (non-agentic, OpenAI-compatible) ─────────────────────
// meta/llama-3.3-70b-instruct via NIM — ~1000 free credits/month, high quality
async function runNIMFallback(query, clientName, db, history = []) {
  if (!process.env.NIM_API_KEY) throw new Error('NIM_API_KEY not configured');

  const userContent = await buildFallbackContext(query, clientName, db);

  const controller = new AbortController();
  const nimTimeout = setTimeout(() => controller.abort(), 20000); // 70B needs up to 20s

  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.NIM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta/llama-3.3-70b-instruct',
      messages: [
        { role: 'system', content: FALLBACK_SYSTEM_PROMPT },
        ...( (history || []).slice(-6).map(m => ({
          role:    m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })) ),
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      top_p:       0.7,
      max_tokens:  2500,
      stream:      false,
    }),
    signal: controller.signal,
  });
  clearTimeout(nimTimeout);

  if (!r.ok) {
    const err = await r.text().catch(() => String(r.status));
    throw new Error(`NIM HTTP ${r.status}: ${err}`);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('NIM returned empty content');
  return { answer: text, model: 'meta/llama-3.3-70b-instruct (NIM)', toolsUsed: ['search_knowledge_base', 'get_risk_registry'] };
}

// ─── OpenRouter fallback (non-agentic, direct context injection) ───────────────
// Injects the risk registry + knowledge base directly into the prompt.
// Tries each free model in OPENROUTER_MODELS until one succeeds.
async function runOpenRouterFallback(query, clientName, db, history = []) {
  const userContent = await buildFallbackContext(query, clientName, db);

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  for (const orModel of OPENROUTER_MODELS) {
    try {
      const controller = new AbortController();
      const orTimeout  = orModel.includes('llama') || orModel.includes('deepseek') ? 18000 : 8000;
      const timeout    = setTimeout(() => controller.abort(), orTimeout); // longer timeout for big models (llama-70B, deepseek-r1 need 12-18s)

      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ghostunamused.github.io/thermIQ',
          'X-Title':      'ThermIQ',
        },
        body: JSON.stringify({
          model:    orModel,
          messages: [
            { role: 'system', content: FALLBACK_SYSTEM_PROMPT },
            // Conversation history — last 3 exchanges so the model can resolve
            // follow-up questions like "same question" or "explain the first one"
            ...( (history || []).slice(-6).map(m => ({
              role:    m.role === 'assistant' ? 'assistant' : 'user',
              content: String(m.content || ''),
            })) ),
            { role: 'user', content: userContent },
          ],
          max_tokens:  2500,
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
    const body    = req.body || {};
    const query   = (body.query || '').trim();
    const client  = (body.client || '').trim().toLowerCase();
    // history: array of {role:'user'|'assistant', content:string} — prior turns
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    if (!query) return res.status(400).json({ error: "Missing 'query' field." });

    const db = getFirestore(getFirebaseApp());

    // ── Gemini cascade: model × key matrix ──────────────────────────────────
    // Try each model with each API key before giving up on Gemini entirely.
    // Order: 2.5-flash/key1 → 2.5-flash/key2 → 2.5-flash/key3 → 2.0-flash/key1 → …
    // This maximises the chance of hitting a key that still has daily quota.
    const geminiKeys = getGeminiKeys();
    for (const geminiModel of GEMINI_MODELS) {
      for (const apiKey of geminiKeys) {
        try {
          const result = await runGeminiAgentic(geminiModel, query, client, db, history, apiKey);
          return res.status(200).json({
            answer:     result.answer,
            tools_used: result.toolsUsed,
            model_used: result.model,
          });
        } catch (err) {
          if (!isThrottleError(err)) throw err; // real error — stop trying Gemini
          console.warn(`[query] ${geminiModel} key …${apiKey.slice(-4)} throttled (${err.message})`);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // ── NIM fallback (Gemini quota exhausted) ────────────────────────────────
    // meta/llama-3.3-70b-instruct via NVIDIA NIM — high quality, ~1000 free credits/month
    console.log('[query] All Gemini models throttled — trying NIM (llama-3.3-70b)');
    try {
      const nimResult = await runNIMFallback(query, client, db, history);
      return res.status(200).json({
        answer:     nimResult.answer,
        tools_used: nimResult.toolsUsed,
        model_used: nimResult.model,
      });
    } catch (nimErr) {
      console.warn(`[query] NIM failed (${nimErr.message}), falling back to OpenRouter`);
    }

    // ── OpenRouter fallback (NIM also failed) ────────────────────────────────
    console.log('[query] NIM failed — falling back to OpenRouter free tier');
    const result = await runOpenRouterFallback(query, client, db, history);
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
