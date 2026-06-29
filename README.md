# ThermIQ — Industrial Knowledge Intelligence

AI-powered knowledge platform for thermal power plants. Quantifies knowledge
gaps as ₹ crore operational risk.

## Architecture
- Frontend: GitHub Pages (docs/) + Vercel (serves docs/ as root)
- Backend: Vercel Functions (api/*.js)
- Vector DB: Qdrant Cloud (collection `thermiq_chunks`)
- Embeddings: Jina AI (jina-embeddings-v3)
- Generation: Gemini 2.5 Flash, with NVIDIA NIM and OpenRouter fallbacks
- Structured Data: Firebase Firestore
- Data Pipeline: GitHub Actions (daily CEA outage fetch)

## Setup

### Environment Variables (Vercel Dashboard / local .env)
See `.env.example` for the full list, including optional fallback keys
(NIM_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY2/3).

### Ingest Benchmark Documents (CEA standards — the yardstick)
python scripts/ingest_documents.py <pdf_path> guideline "CEA Tech Spec 500MW" <url>
For scanned/image PDFs use scripts/ingest_ocr.py instead.

### Compute Knowledge Gaps (single source of truth for risk_scores)
python scripts/detect_gaps.py
Writes the gap risk registry to Firestore `risk_scores`, which the Risk
Dashboard reads. Re-run after ingesting new client documents.

### Run CEA Outage Fetch Manually
python scripts/fetch_cea_outage.py

## Risk Formula
risk_score_cr = criticality_score (1-5) × consequence_cr (₹ Cr) × exposure_score (0-1)
- criticality: 1-5, sourced to CEA outage frequency + CERC regulations
- consequence_cr: avg revenue impact from CEA outage records (₹5.0/kWh, LBNL/Ember 2024)
- exposure: 1 − best client-corpus match score
