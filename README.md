# ThermIQ — Industrial Knowledge Intelligence

AI-powered knowledge platform for thermal power plants. Quantifies knowledge
gaps as ₹ crore operational risk.

## Architecture
- Frontend: GitHub Pages (docs/)
- Backend: Netlify Functions (Python)
- Vector DB: Qdrant Cloud
- Embeddings: Jina AI (jina-embeddings-v3)
- Generation: Gemini 2.5 Flash
- Structured Data: Firebase Firestore
- Data Pipeline: GitHub Actions (daily CEA XLS)

## Setup

### Environment Variables (Netlify Dashboard)
GEMINI_API_KEY, JINA_API_KEY, QDRANT_URL, QDRANT_API_KEY,
FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL

### Ingest Documents
python scripts/ingest_documents.py <pdf_path> regulatory "CEA Tech Spec 500MW" <url>

### Seed Initial Data
python scripts/seed_firestore.py

### Run CEA Fetch Manually
python scripts/fetch_cea_outage.py

## Risk Formula
risk_score_cr = criticality_score × consequence_cr × exposure_score
