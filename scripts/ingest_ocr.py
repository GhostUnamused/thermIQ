"""
OCR-based ingestion for scanned/image PDFs: pdf2image + tesseract -> chunks -> Jina embeddings -> Qdrant.

Use this instead of ingest_documents.py when pypdf returns no text (scanned PDFs).

Usage:
  python scripts/ingest_ocr.py <pdf_path> <doc_type> <source_doc_name> <source_url> [client]

Requirements (system):
  tesseract-ocr        (apt: sudo apt install tesseract-ocr)
  poppler-utils        (apt: sudo apt install poppler-utils)

Requirements (pip):
  pdf2image pytesseract
  (plus same as ingest_documents.py: qdrant-client firebase-admin requests python-dotenv)
"""
import json
import os
import sys
import time
import uuid
from datetime import datetime

import requests
from dotenv import load_dotenv
from pdf2image import convert_from_path
import pytesseract
import platform
import glob
_POPPLER_PATH = None
if platform.system() == "Windows":
    _tess_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(_tess_path):
        pytesseract.pytesseract.tesseract_cmd = _tess_path
    _poppler_candidates = glob.glob(
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-*\Library\bin")
    )
    if _poppler_candidates:
        _POPPLER_PATH = _poppler_candidates[0]
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
OCR_DPI = 200          # lower = faster but less accurate; 200 is a good balance
MIN_PAGE_CHARS = 50    # skip pages with fewer chars after OCR (blank or noise)

EQUIPMENT_KEYWORDS = {
    "Boiler": [
        "boiler", "furnace", "super heater", "superheater",
        "economiser", "air preheater", "steam drum", "burner",
    ],
    "Turbine": [
        "turbine", "hp turbine", "lp turbine", "ip turbine",
        "blade", "governor", "nozzle", "rotor",
    ],
    "Generator": [
        "generator", "stator", "rotor winding", "exciter", "avr", "alternator",
    ],
    "BFP": ["boiler feed pump", "bfp", "feed pump", "seal water", "impeller"],
    "Condenser": ["condenser", "cooling water", "hotwell", "vacuum", "ejector"],
    "Cooling Tower": ["cooling tower", "ct fill", "drift eliminator", "basin", "blowdown"],
}


def extract_pages_ocr(pdf_path):
    """Convert each PDF page to image and OCR it. Returns list of (page_num, text)."""
    print(f"Converting PDF pages to images at {OCR_DPI} DPI (this may take a few minutes)...")
    pages_text = []

    # Process in batches of 10 pages to keep memory manageable
    from pypdf import PdfReader
    total_pages = len(PdfReader(pdf_path).pages)
    print(f"Total pages: {total_pages}")

    batch_size = 10
    for batch_start in range(1, total_pages + 1, batch_size):
        batch_end = min(batch_start + batch_size - 1, total_pages)
        images = convert_from_path(
            pdf_path,
            dpi=OCR_DPI,
            first_page=batch_start,
            last_page=batch_end,
            poppler_path=_POPPLER_PATH,
        )
        for i, image in enumerate(images):
            page_num = batch_start + i
            text = pytesseract.image_to_string(image, lang="eng")
            if len(text.strip()) >= MIN_PAGE_CHARS:
                pages_text.append((page_num, text))
            if page_num % 10 == 0:
                print(f"  OCR'd page {page_num}/{total_pages}...")

    print(f"Usable pages after OCR: {len(pages_text)}/{total_pages}")
    return pages_text


def chunk_pages(pages, doc_slug):
    chunks = []
    chunk_index = 0
    full_words = []
    for page_number, text in pages:
        for word in text.split():
            full_words.append((word, page_number))

    i = 0
    while i < len(full_words):
        window = full_words[i: i + CHUNK_WORDS]
        if not window:
            break
        words = [w for w, _ in window]
        page_number = window[0][1]
        chunk_text = " ".join(words)
        chunk_id = f"{doc_slug}_chunk_{chunk_index:04d}"
        chunks.append({
            "chunk_id": chunk_id,
            "chunk_index": chunk_index,
            "page_number": page_number,
            "text": chunk_text,
        })
        chunk_index += 1
        i += CHUNK_WORDS - CHUNK_OVERLAP

    return chunks


def extract_equipment_tags(text):
    lowered = text.lower()
    return [eq for eq, kws in EQUIPMENT_KEYWORDS.items() if any(k in lowered for k in kws)]


def embed_batch(texts):
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
    response.raise_for_status()
    return [item["embedding"] for item in response.json()["data"]]


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.environ["FIREBASE_PROJECT_ID"],
            "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="thermiq")
    return firestore.client(app=app)


def main():
    if len(sys.argv) < 5:
        print(
            "Usage: python scripts/ingest_ocr.py <pdf_path> <doc_type> "
            "<source_doc_name> <source_url> [client]"
        )
        print("  client: optional, e.g. 'ntpc' for plant-specific docs (default: '')")
        sys.exit(1)

    pdf_path, doc_type, source_doc_name, source_url = sys.argv[1:5]
    doc_client = sys.argv[5] if len(sys.argv) > 5 else ""
    doc_slug = source_doc_name.lower().replace(" ", "_")

    start_time = time.time()

    print(f"OCR-ingesting: {pdf_path}")
    pages = extract_pages_ocr(pdf_path)

    print("Chunking text...")
    chunks = chunk_pages(pages, doc_slug)
    print(f"Created {len(chunks)} chunks.")

    if len(chunks) == 0:
        print("ERROR: 0 chunks created. OCR may have failed or PDF is truly empty.")
        sys.exit(1)

    print("Tagging equipment per chunk...")
    for chunk in chunks:
        chunk["equipment_tags"] = extract_equipment_tags(chunk["text"])

    print("Embedding chunks in batches of 8...")
    embeddings = []
    for i in range(0, len(chunks), 8):
        batch = chunks[i: i + 8]
        batch_embeddings = embed_batch([c["text"] for c in batch])
        embeddings.extend(batch_embeddings)
        print(f"  Embedded batch {i // 8 + 1} ({len(batch)} chunks).")
        time.sleep(1)

    print("Connecting to Qdrant...")
    qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=120)

    existing = [c.name for c in qdrant.get_collections().collections]
    if COLLECTION_NAME not in existing:
        print(f"Creating collection '{COLLECTION_NAME}'...")
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=1024, distance=Distance.COSINE),
        )

    print("Building Qdrant points...")
    os.makedirs("data/chunks", exist_ok=True)
    points = []
    ingested_at = datetime.utcnow().isoformat() + "Z"
    for chunk, embedding in zip(chunks, embeddings):
        payload = {
            "chunk_id": chunk["chunk_id"],
            "source_doc": source_doc_name,
            "source_url": source_url,
            "doc_type": doc_type,
            "client": doc_client,
            "equipment_tags": chunk["equipment_tags"],
            "section": "",
            "page_number": chunk["page_number"],
            "text": chunk["text"],
            "chunk_index": chunk["chunk_index"],
            "ingested_at": ingested_at,
            "ocr": True,  # flag so we know this came through OCR
        }
        points.append(PointStruct(id=str(uuid.uuid4()), vector=embedding, payload=payload))
        with open(f"data/chunks/{chunk['chunk_id']}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print("Upserting to Qdrant in batches of 20...")
    upsert_count = 0
    for i in range(0, len(points), 20):
        batch = points[i: i + 20]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=batch)
        upsert_count += len(batch)
        print(f"  Upserted {upsert_count}/{len(points)} points.")

    print("Updating Firestore system_meta...")
    db = get_firestore_client()
    db.collection("system_meta").document("config").set(
        {
            "documents_ingested": firestore.ArrayUnion([source_doc_name]),
            "total_chunks_indexed": firestore.Increment(len(chunks)),
            "last_ingestion_at": ingested_at,
        },
        merge=True,
    )

    elapsed = time.time() - start_time
    print("\n--- OCR Ingestion Summary ---")
    print(f"Source: {source_doc_name}")
    print(f"Client: {doc_client or '(standard layer)'}")
    print(f"Chunks created: {len(chunks)}")
    print(f"Qdrant upserts: {upsert_count}")
    print(f"Time taken: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
