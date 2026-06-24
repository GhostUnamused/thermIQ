# thermIQ

RAG-based risk copilot for thermal power plant maintenance, built on CEA outage data, regulatory/technical documents, and Firestore-tracked risk gaps.

## Structure

- `netlify/functions/` — RAG query, gap analysis, outage data, and ingestion-trigger endpoints
- `docs/` — static frontend served via GitHub Pages / Netlify
- `scripts/` — local ingestion, CEA outage fetch, and Firestore seeding scripts
- `.github/workflows/cea-ingest.yml` — daily CEA outage ingest job

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. `pip install -r requirements.txt`
3. `python scripts/ingest_documents.py` to seed the Qdrant collection.

## Environment Variables

See `.env.example`. In production these are set in the Netlify dashboard, never committed.
