"""
Local one-time ingestion script: PDF -> chunks -> Jina embeddings -> Qdrant.

Usage:
  python scripts/ingest_documents.py <pdf_path> <doc_type> <source_doc_name> <source_url>
"""
import json
import os
import sys
import time
import uuid
from datetime import datetime

import requests
from dotenv import load_dotenv
from pypdf import PdfReader
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

JINA_API_KEY = os.environ.get("JINA_API_KEY")
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

COLLECTION_NAME = "thermiq_chunks"
CHUNK_WORDS = 400
CHUNK_OVERLAP = 50

EQUIPMENT_KEYWORDS = {
    "Boiler": [
        "boiler",
        "furnace",
        "super heater",
        "superheater",
        "economiser",
        "air preheater",
        "steam drum",
        "burner",
    ],
    "Turbine": [
        "turbine",
        "hp turbine",
        "lp turbine",
        "ip turbine",
        "blade",
        "governor",
        "nozzle",
        "rotor",
    ],
    "Generator": [
        "generator",
        "stator",
        "rotor winding",
        "exciter",
        "avr",
        "alternator",
    ],
    "BFP": ["boiler feed pump", "bfp", "feed pump", "seal water", "impeller"],
    "Condenser": ["condenser", "cooling water", "hotwell", "vacuum", "ejector"],
    "Cooling Tower": [
        "cooling tower",
        "ct fill",
        "drift eliminator",
        "basin",
        "blowdown",
    ],
}


def extract_pages(pdf_path):
    reader = PdfReader(pdf_path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if len(text.strip()) < 50:
            continue
        pages.append((i, text))
    return pages


def chunk_pages(pages, doc_slug):
    chunks = []
    chunk_index = 0

    full_words = []
    for page_number, text in pages:
        for word in text.split():
            full_words.append((word, page_number))

    i = 0
    while i < len(full_words):
        window = full_words[i : i + CHUNK_WORDS]
        if not window:
            break
        words = [w for w, _ in window]
        page_number = window[0][1]
        chunk_text = " ".join(words)
        chunk_id = f"{doc_slug}_chunk_{chunk_index:04d}"
        chunks.append(
            {
                "chunk_id": chunk_id,
                "chunk_index": chunk_index,
                "page_number": page_number,
                "text": chunk_text,
            }
        )
        chunk_index += 1
        i += CHUNK_WORDS - CHUNK_OVERLAP

    return chunks


def extract_equipment_tags(text):
    lowered = text.lower()
    matched = []
    for equipment, keywords in EQUIPMENT_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            matched.append(equipment)
    return matched


def embed_batch(texts):
    for attempt in range(6):
        response = requests.post(
            "https://api.jina.ai/v1/embeddings",
            headers={
                "Authorization": f"Bearer {JINA_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "jina-embeddings-v3",
                "input": texts,
                "task": "retrieval.passage",
            },
        )
        if response.status_code == 429 and attempt < 5:
            wait = 2 ** (attempt + 2)
            print(f"  Jina 429 rate limit, retrying in {wait}s ...")
            time.sleep(wait)
            continue
        response.raise_for_status()
        break
    data = response.json()["data"]
    return [item["embedding"] for item in data]


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq")
    except ValueError:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": os.environ["FIREBASE_PROJECT_ID"],
                "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace(
                    "\\n", "\n"
                ),
                "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        app = firebase_admin.initialize_app(cred, name="thermiq")
    return firestore.client(app=app)


def main():
    if len(sys.argv) < 5:
        print(
            "Usage: python scripts/ingest_documents.py <pdf_path> <doc_type> "
            "<source_doc_name> <source_url> [client]"
        )
        print("  client: optional, e.g. 'ntpc' for plant-specific docs (default: '')")
        sys.exit(1)

    pdf_path, doc_type, source_doc_name, source_url = sys.argv[1:5]
    doc_client = sys.argv[5] if len(sys.argv) > 5 else ""
    doc_slug = source_doc_name.lower().replace(" ", "_")

    start_time = time.time()

    print(f"Extracting text from {pdf_path} ...")
    pages = extract_pages(pdf_path)
    print(f"Extracted {len(pages)} usable pages.")

    print("Chunking text ...")
    chunks = chunk_pages(pages, doc_slug)
    print(f"Created {len(chunks)} chunks.")

    print("Tagging equipment per chunk ...")
    for chunk in chunks:
        chunk["equipment_tags"] = extract_equipment_tags(chunk["text"])

    print("Embedding chunks in batches of 8 ...")
    embeddings = []
    for i in range(0, len(chunks), 8):
        batch = chunks[i : i + 8]
        batch_texts = [c["text"] for c in batch]
        batch_embeddings = embed_batch(batch_texts)
        embeddings.extend(batch_embeddings)
        print(f"  Embedded batch {i // 8 + 1} ({len(batch)} chunks).")
        time.sleep(1)

    print("Connecting to Qdrant ...")
    client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=120)

    existing_collections = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing_collections:
        print(f"Creating collection '{COLLECTION_NAME}' ...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=1024, distance=Distance.COSINE),
        )

    print("Building points and saving chunk fallback files ...")
    os.makedirs("data/chunks", exist_ok=True)
    points = []
    ingested_at = datetime.utcnow().isoformat() + "Z"
    for chunk, embedding in zip(chunks, embeddings):
        payload = {
            "chunk_id": chunk["chunk_id"],
            "source_doc": source_doc_name,
            "source_url": source_url,
            "doc_type": doc_type,
            "client": doc_client,  # "" for standard/regulatory docs; "ntpc" etc. for plant-specific
            "equipment_tags": chunk["equipment_tags"],
            "section": "",
            "page_number": chunk["page_number"],
            "text": chunk["text"],
            "chunk_index": chunk["chunk_index"],
            "ingested_at": ingested_at,
        }
        points.append(
            PointStruct(id=str(uuid.uuid4()), vector=embedding, payload=payload)
        )

        with open(f"data/chunks/{chunk['chunk_id']}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print("Upserting to Qdrant in batches of 20 ...")
    upsert_count = 0
    for i in range(0, len(points), 20):
        batch = points[i : i + 20]
        client.upsert(collection_name=COLLECTION_NAME, points=batch)
        upsert_count += len(batch)
        print(f"  Upserted {upsert_count}/{len(points)} points.")

    print("Updating Firestore system_meta ...")
    db = get_firestore_client()
    config_ref = db.collection("system_meta").document("config")
    config_ref.set(
        {
            "documents_ingested": firestore.ArrayUnion([source_doc_name]),
            "total_chunks_indexed": firestore.Increment(len(chunks)),
            "last_ingestion_at": ingested_at,
        },
        merge=True,
    )

    elapsed = time.time() - start_time
    print("\n--- Ingestion Summary ---")
    print(f"Chunks created: {len(chunks)}")
    print(f"Qdrant upserts: {upsert_count}")
    print(f"Time taken: {elapsed:.2f}s")


if __name__ == "__main__":
    main()
