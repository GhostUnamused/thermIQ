import os, time
from dotenv import load_dotenv
from qdrant_client import QdrantClient
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

try:
    app = firebase_admin.get_app("thermiq_sync")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_sync")

db = firestore.client(app=app)
qdrant = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=120, prefer_grpc=False)

print("Scrolling Qdrant collection...")
source_docs = {}
offset = None
while True:
    result, next_offset = qdrant.scroll(
        collection_name="thermiq_chunks",
        limit=64,
        offset=offset,
        with_payload=True,
        with_vectors=False,
    )
    for point in result:
        p = point.payload or {}
        name = p.get("source_doc", "")
        if not name:
            continue
        if name not in source_docs:
            source_docs[name] = {
                "client":     p.get("client", ""),
                "doc_type":   p.get("doc_type", "other"),
                "source_url": p.get("source_url", ""),
                "count":      0,
                "ingested_at": p.get("ingested_at", ""),
            }
        source_docs[name]["count"] += 1
    if next_offset is None:
        break
    offset = next_offset

print(f"Found {len(source_docs)} unique source_doc values in Qdrant")

existing = {d.to_dict().get("doc_name") for d in db.collection("documents").stream()}
print(f"Already in Firestore documents collection: {len(existing)}")

seeded = 0
for name, meta in source_docs.items():
    if name in existing:
        print(f"  SKIP (exists): {name}")
        continue
    doc_id = f"orphan_{int(time.time() * 1000)}_{seeded}"
    db.collection("documents").document(doc_id).set({
        "doc_name":       name,
        "doc_type":       meta["doc_type"] or "other",
        "client":         meta["client"],
        "source_url":     meta["source_url"],
        "chunks_indexed": meta["count"],
        "pages_parsed":   None,
        "ingested_at":    meta["ingested_at"] or "2026-06-26T00:00:00Z",
    })
    print(f"  SEEDED: {name} ({meta['count']} chunks, client={meta['client'] or 'generic'})")
    seeded += 1

print(f"\nDone. Seeded {seeded} orphaned document(s).")
