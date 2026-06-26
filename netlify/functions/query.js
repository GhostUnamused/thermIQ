const { QdrantClient } = require('@qdrant/js-client-rest');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

const SYSTEM_INSTRUCTION =
  'You are ThermIQ, an expert AI assistant for thermal power plant ' +
  'engineers and maintenance teams in India. Answer ONLY from the ' +
  'provided source documents. If the answer is not in the sources, ' +
  "say clearly: 'This information is not available in the current " +
  "ThermIQ knowledge base.' Always cite sources by number " +
  "(e.g., 'According to Source 1...'). Be precise and technical — " +
  'include specific values, thresholds, part numbers, and procedures ' +
  'where available. Keep every answer under 400 words. Use bullet points ' +
  'or numbered steps for procedures. Do not repeat the question.';

// OpenRouter fallback — llama-3.3-70b-instruct:free is consistently available
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
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key not configured');
  }
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://thermiq-674.netlify.app',
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
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errText}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

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
  if (!response.ok) {
    throw new Error(`Jina embeddings request failed: ${response.status}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const query = (body.query || '').trim();
    // client filter: lowercase, e.g. "ntpc". Empty string = no filter (all docs).
    const client = (body.client || '').trim().toLowerCase();

    if (!query) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Missing or empty 'query' field." }),
      };
    }

    // Step 1 — embed the query
    const embedding = await embedQuery(query);

    // Step 2 — search Qdrant (with optional client filter)
    const qdrantClient = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    const searchParams = {
      vector: embedding,
      limit: 5,
      with_payload: true,
    };

    // When a client is specified, include both that client's docs AND generic
    // regulatory/standard docs (client == '') — so standards always apply.
    if (client) {
      searchParams.filter = {
        should: [
          { key: 'client', match: { value: client } },
          { key: 'client', match: { value: '' } },
        ],
      };
    }

    const results = await qdrantClient.search('thermiq_chunks', searchParams);

    if (!results || results.length === 0) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          answer:
            'No relevant documents found in the ThermIQ knowledge base for this query.',
          sources: [],
          chunks_retrieved: 0,
        }),
      };
    }

    // Step 3 — build context string and sources list
    const contextParts = [];
    const sources = [];
    results.forEach((result, i) => {
      const payload = result.payload || {};
      const sourceDoc = payload.source_doc || '';
      const section = payload.section || '';
      const text = payload.text || '';
      contextParts.push(`[SOURCE ${i + 1}] ${sourceDoc} — ${section}:\n${text}`);
      sources.push({
        doc: sourceDoc,
        section,
        page: payload.page_number,
        score: Math.round(result.score * 1000) / 1000,
        url: payload.source_url || '',
      });
    });
    const contextText = contextParts.join('\n\n');
    const llmPrompt = `Question: ${query}\n\nSource Documents:\n${contextText}`;

    // Step 4 — generate with three-level fallback:
    //   gemini-2.5-flash → (throttled, wait 2s) → gemini-2.0-flash → OpenRouter
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

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        answer,
        sources,
        chunks_retrieved: results.length,
        model_used,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
