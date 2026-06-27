import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from qdrant_client import QdrantClient

load_dotenv()
try:
    app = firebase_admin.get_app("thermiq_check")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_check")
db = firestore.client(app=app)
rs = list(db.collection("risk_scores").stream())
print(f"risk_scores: {len(rs)} docs")
for d in rs:
    print(" -", d.id)
docs = list(db.collection("documents").stream())
print(f"documents: {len(docs)} docs")
for d in docs:
    print(" -", d.id, d.to_dict().get("doc_name"))

qdrant = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
info = qdrant.get_collection("thermiq_chunks")
print(f"qdrant thermiq_chunks points_count: {info.points_count}")
