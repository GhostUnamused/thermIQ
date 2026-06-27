import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

load_dotenv()
try:
    app = firebase_admin.get_app("thermiq_wipe")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_wipe")
db = firestore.client(app=app)

qdrant = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=120)

print("Deleting Qdrant collection 'thermiq_chunks'...")
qdrant.delete_collection("thermiq_chunks")
print("Recreating empty collection...")
qdrant.create_collection(
    collection_name="thermiq_chunks",
    vectors_config=VectorParams(size=1024, distance=Distance.COSINE),
)
qdrant.create_payload_index("thermiq_chunks", field_name="source_type", field_schema="keyword")
qdrant.create_payload_index("thermiq_chunks", field_name="client_name", field_schema="keyword")
info = qdrant.get_collection("thermiq_chunks")
print(f"Qdrant thermiq_chunks now has {info.points_count} points.")

print("Clearing Firestore 'documents' collection...")
count = 0
for doc in db.collection("documents").stream():
    doc.reference.delete()
    count += 1
print(f"Deleted {count} documents records.")

print("Clearing Firestore 'risk_scores' collection...")
count = 0
for doc in db.collection("risk_scores").stream():
    doc.reference.delete()
    count += 1
print(f"Deleted {count} risk_scores records.")

print("Resetting system_meta/config...")
db.collection("system_meta").document("config").set({
    "documents_ingested": [],
    "total_chunks_indexed": 0,
    "last_ingestion_at": None,
}, merge=False)

print("Done. Database wiped and reset.")
