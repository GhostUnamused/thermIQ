"""
patch_source_type.py — one-time migration to add source_type to existing data

What it does:
  1. Reads every document from Firestore 'documents' collection
  2. Sets source_type = "benchmark" if client == "", else "client"
     Sets client_name = the client value (e.g. "ntpc"), or "" for benchmarks
  3. Updates Firestore doc with source_type + client_name fields
  4. Scrolls through ALL Qdrant points in thermiq_chunks
     Sets source_type on each point's payload based on its `client` field

Run once after deploying the source_type changes:
  python scripts/patch_source_type.py

Safe to re-run — it's idempotent (just overwrites with same values).
"""

import os
import sys
import time
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchAny

load_dotenv()

COLLECTION_NAME = "thermiq_chunks"
BATCH_SIZE = 100  # Qdrant scroll batch size

# ─── Firebase Setup ───────────────────────────────────────────────────────────

try:
    fb_app = firebase_admin.get_app("patch_source_type")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    fb_app = firebase_admin.initialize_app(cred, name="patch_source_type")

db = firestore.client(app=fb_app)

# ─── Step 1: Patch Firestore documents ────────────────────────────────────────

print("=" * 60)
print("Step 1: Patching Firestore 'documents' collection")
print("=" * 60)

docs_ref = db.collection("documents")
docs = list(docs_ref.stream())
print(f"Found {len(docs)} documents.\n")

for doc_snap in docs:
    data = doc_snap.to_dict()
    client_val = data.get("client", "").strip().lower()

    if client_val:
        source_type = "client"
        client_name = client_val
    else:
        source_type = "benchmark"
        client_name = ""

    # Skip if already tagged correctly
    if data.get("source_type") == source_type:
        print(f"  [skip] {doc_snap.id} — already tagged as {source_type}")
        continue

    docs_ref.document(doc_snap.id).update({
        "source_type": source_type,
        "client_name": client_name,
    })
    tag_label = f"{source_type}" + (f" (client_name={client_name})" if client_name else "")
    print(f"  [patched] {doc_snap.id} → {tag_label} | {data.get('doc_name', '?')}")

print(f"\nFirestore patching complete.\n")

# ─── Step 2: Patch Qdrant payloads ────────────────────────────────────────────

print("=" * 60)
print("Step 2: Patching Qdrant payload — adding source_type to all points")
print("=" * 60)

qdrant = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
    timeout=60,
)

# Scroll through all points and patch in batches
offset = None
total_patched = 0
total_scanned = 0

while True:
    scroll_result = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        limit=BATCH_SIZE,
        offset=offset,
        with_payload=True,
        with_vectors=False,
    )
    points, next_offset = scroll_result

    if not points:
        break

    total_scanned += len(points)

    # Group by source_type for efficient batched set_payload
    benchmark_ids = []
    client_ids_by_name = {}  # client_name → [point_ids]

    for point in points:
        payload = point.payload or {}
        client_val = payload.get("client", "").strip().lower()

        if client_val:
            if client_val not in client_ids_by_name:
                client_ids_by_name[client_val] = []
            client_ids_by_name[client_val].append(point.id)
        else:
            benchmark_ids.append(point.id)

    # Patch benchmark points
    if benchmark_ids:
        qdrant.set_payload(
            collection_name=COLLECTION_NAME,
            payload={"source_type": "benchmark", "client_name": ""},
            points=benchmark_ids,
        )
        total_patched += len(benchmark_ids)
        print(f"  Patched {len(benchmark_ids)} benchmark points")

    # Patch client points per client_name
    for cname, cids in client_ids_by_name.items():
        qdrant.set_payload(
            collection_name=COLLECTION_NAME,
            payload={"source_type": "client", "client_name": cname},
            points=cids,
        )
        total_patched += len(cids)
        print(f"  Patched {len(cids)} client points (client_name={cname})")

    print(f"  Batch done — scanned {total_scanned} so far, offset={next_offset}")

    if next_offset is None:
        break
    offset = next_offset
    time.sleep(0.3)  # courtesy pause

print(f"\nQdrant patching complete.")
print(f"Total scanned: {total_scanned} | Total patched: {total_patched}")
print("\nAll done. Verify by running:")
print("  python -c \"from qdrant_client import QdrantClient; ...")
print("  or check the Documents page on the live site.\"\n")
