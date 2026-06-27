import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()
try:
    app = firebase_admin.get_app("thermiq_clear")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_clear")

db = firestore.client(app=app)
count = 0
for doc in db.collection("risk_scores").stream():
    doc.reference.delete()
    print(f"Deleted risk_scores/{doc.id}")
    count += 1
print(f"Done - risk_scores collection cleared. ({count} deleted)")
