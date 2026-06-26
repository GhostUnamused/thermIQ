"""
One-time cleanup: removes stale seed outage records and orphan test document from Firestore.

1. Deletes all `cea_outages` where source == "sample_seed" (pre-fix revenue formula, ~1000x off)
2. Deletes orphan test document `orphan_1782460430367_0` from `documents` collection
"""
import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

try:
    app = firebase_admin.get_app("thermiq_cleanup")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_cleanup")

db = firestore.client(app=app)

# 1. Delete stale seed outage records
print("=== Cleaning stale seed outage records ===")
deleted_outages = 0
for doc in db.collection("cea_outages").stream():
    data = doc.to_dict()
    if data.get("source") == "sample_seed":
        doc.reference.delete()
        print(f"  Deleted cea_outages/{doc.id} — {data.get('station', '?')} {data.get('unit', '?')} (revenue was Rs.{data.get('revenue_lost_est_cr', '?')} Cr)")
        deleted_outages += 1

print(f"Deleted {deleted_outages} stale seed outage records.\n")

# 2. Delete orphan test document
print("=== Cleaning orphan test document ===")
orphan_ref = db.collection("documents").document("orphan_1782460430367_0")
orphan_snap = orphan_ref.get()
if orphan_snap.exists:
    data = orphan_snap.to_dict()
    print(f"  Found orphan: {data.get('doc_name', '?')} ({data.get('chunks_indexed', 0)} chunks)")
    orphan_ref.delete()
    print("  Deleted documents/orphan_1782460430367_0")
else:
    print("  Orphan doc not found (already cleaned?)")

print("\nDone. Stale data removed.")
