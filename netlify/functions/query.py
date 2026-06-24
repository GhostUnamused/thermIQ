import json
import os

import requests
import google.generativeai as genai
from qdrant_client import QdrantClient

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
}

JINA_API_KEY = os.environ.get("JINA_API_KEY")
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

SYSTEM_PROMPT = (
    "You are ThermIQ, an expert AI assistant for thermal power plant engineers "
    "and maintenance teams in India. Answer ONLY from the provided source documents. "
    "If the answer is not in the sources, say clearly: 'This information is not "
    "available in the current ThermIQ knowledge base.' Always cite sources by number "
    "(e.g., 'According to Source 1...'). Be precise and technical — include specific "
    "values, thresholds, part numbers, and procedures where available."
)


def embed_query(query):
    response = requests.post(
        "https://api.jina.ai/v1/embeddings",
        headers={
            "Authorization": f"Bearer {JINA_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "jina-embeddings-v3",
            "input": [query],
            "task": "retrieval.query",
        },
    )
    response.raise_for_status()
    return response.json()["data"][0]["embedding"]


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
        query = (body.get("query") or "").strip()
        if not query:
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Missing or empty 'query' field."}),
            }

        # Step 1 — embed the query
        query_vector = embed_query(query)

        # Step 2 — search Qdrant
        client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
        results = client.search(
            collection_name="thermiq_chunks",
            query_vector=query_vector,
            limit=5,
            with_payload=True,
        )

        if not results:
            return {
                "statusCode": 200,
                "headers": CORS_HEADERS,
                "body": json.dumps(
                    {
                        "answer": "No relevant documents found in the ThermIQ "
                        "knowledge base for this query.",
                        "sources": [],
                        "chunks_retrieved": 0,
                    }
                ),
            }

        # Step 3 — build context string and sources list
        context_parts = []
        sources = []
        for i, result in enumerate(results, start=1):
            payload = result.payload or {}
            source_doc = payload.get("source_doc", "")
            section = payload.get("section", "")
            text = payload.get("text", "")
            context_parts.append(f"[SOURCE {i}] {source_doc} — {section}:\n{text}")
            sources.append(
                {
                    "doc": source_doc,
                    "section": section,
                    "page": payload.get("page_number"),
                    "score": round(result.score, 3),
                    "url": payload.get("source_url", ""),
                }
            )
        context_text = "\n\n".join(context_parts)

        # Step 4 — generate with Gemini
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash")
        prompt = (
            f"{SYSTEM_PROMPT}\n\nQuestion: {query}\n\nSource Documents:\n{context_text}"
        )
        response = model.generate_content(prompt)

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(
                {
                    "answer": response.text,
                    "sources": sources,
                    "chunks_retrieved": len(results),
                }
            ),
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
