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
  'where available. Keep every answer under 250 words. Use bullet points ' +
  'or numbered steps for procedures. Do not repeat the question.';

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
    if (!query) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Missing or empty 'query' field." }),
      };
    }

    // Step 1 — embed the query
    const embedding = await embedQuery(query);

    // Step 2 — search Qdrant
    const client = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });
    const results = await client.search('thermiq_chunks', {
      vector: embedding,
      limit: 5,
      with_payload: true,
    });

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

    // Step 4 — generate with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    const result = await model.generateContent(
      `Question: ${query}\n\nSource Documents:\n${contextText}`
    );
    const answer = result.response.text();

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        answer,
        sources,
        chunks_retrieved: results.length,
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
