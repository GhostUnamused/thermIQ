import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()
try:
    app = firebase_admin.get_app("thermiq_seed_docs")
except ValueError:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq_seed_docs")

db = firestore.client(app=app)

docs = [
    {"doc_name": "CEA Standard Technical Specification 500MW", "doc_type": "technical_spec", "client": "", "source_url": "https://cea.nic.in", "chunks_indexed": 921, "pages_parsed": None, "ingested_at": "2026-06-24T00:00:00Z"},
    {"doc_name": "CEA R&M Life Extension Report 2023",          "doc_type": "regulatory",     "client": "", "source_url": "https://cea.nic.in/wp-content/uploads/news_live/2023/08/Final_Report_on_various_aspects_of_RM_and_LE.pdf", "chunks_indexed": 36, "pages_parsed": 42, "ingested_at": "2026-06-25T00:00:00Z"},
    {"doc_name": "CEA Review of O&M Practices Thermal Power",   "doc_type": "operational",    "client": "", "source_url": "https://cea.nic.in/wp-content/uploads/2020/04/4.pdf", "chunks_indexed": 57, "pages_parsed": 67, "ingested_at": "2026-06-25T00:00:00Z"},
    {"doc_name": "CEA R&M Guidelines",                         "doc_type": "regulatory",     "client": "", "source_url": "https://cea.nic.in/old/reports/others/thermal/trm/R_ampGuideline.pdf", "chunks_indexed": 15, "pages_parsed": 17, "ingested_at": "2026-06-25T00:00:00Z"},
    {"doc_name": "NTPC Kahalgaon II Tariff Petition 2019-24",  "doc_type": "tariff_petition","client": "ntpc", "source_url": "https://ntpc.co.in/sites/default/files/inline-files/Kahalgaon-II-Tariff-Petition-2019-24.pdf", "chunks_indexed": 58, "pages_parsed": 76, "ingested_at": "2026-06-25T00:00:00Z"},
    {"doc_name": "NTPC Lara Tariff Petition 2019-24",          "doc_type": "tariff_petition","client": "ntpc", "source_url": "https://ntpc.co.in/sites/default/files/inline-files/Lara-Tariff-Petition-19-24_.pdf", "chunks_indexed": 106, "pages_parsed": 198, "ingested_at": "2026-06-25T00:00:00Z"},
]

for i, d in enumerate(docs):
    doc_id = f"seed_{i:03d}_{d['client'] or 'generic'}"
    db.collection("documents").document(doc_id).set(d)
    print(f"Seeded documents/{doc_id}: {d['doc_name']}")
print("Done.")
