# ThermIQ — Industrial Knowledge Intelligence

AI-powered knowledge platform for thermal power plants. Quantifies knowledge
gaps as ₹ crore operational risk.

Live: https://therm-iq.vercel.app (mirror: https://ghostunamused.github.io/thermIQ)

## Architecture
- Frontend: static single-page app in `docs/` (served by Vercel and GitHub Pages)
- Backend: Vercel Functions (`api/*.js`)
- Vector DB: Qdrant Cloud (collection `thermiq_chunks`)
- Embeddings: Jina AI (jina-embeddings-v3)
- Generation: Gemini 2.5 Flash, with NVIDIA NIM and OpenRouter fallbacks
- Structured data: Firebase Firestore
- Knowledge graph: Neo4j Aura
- Pipelines: GitHub Actions (daily CEA outage fetch, gap scans, Drive ingest, Neo4j keep-alive)

## Local setup (fresh clone)

```bash
git clone https://github.com/GhostUnamused/thermIQ.git
cd thermIQ
cp .env.example .env            # fill in keys (same values as the Vercel dashboard)
npm install                     # deps for api/*.js
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
```

Preview the frontend: `python -m http.server 5173 --directory docs` (it calls the
live Vercel backend). To run the API locally too: `npx vercel dev` (after `npx vercel link`).

Deploys are automatic: pushing to `main` redeploys Vercel (frontend + API) and GitHub Pages.
GitHub Actions secrets must mirror the keys listed in `.env.example`.

## Claude Code plugins

The repo pins the `brag` and `frontend-design` plugins in `.claude/settings.json`. To install them for your
user account on a new machine: `powershell -ExecutionPolicy Bypass -File scripts\install_claude_plugins.ps1`
(Windows) or `sh scripts/install_claude_plugins.sh` (macOS/Linux).

## Common tasks

Ingest benchmark documents (CEA standards — the yardstick):

    python scripts/ingest_documents.py <pdf_path> guideline "CEA Tech Spec 500MW" <url>

For scanned/image PDFs use `scripts/ingest_ocr.py` instead.

Compute knowledge gaps (single source of truth for `risk_scores`):

    python scripts/detect_gaps.py [--client NAME]

Fetch CEA outages manually: `python scripts/fetch_cea_outage.py`

## Risk formula
risk_score_cr = criticality_score (1-5) × consequence_cr (₹ Cr) × exposure_score (0-1)
- criticality: 1-5, sourced to CEA outage frequency + CERC regulations
- consequence_cr: avg revenue impact from CEA outage records (₹5.0/kWh, LBNL/Ember 2024)
- exposure: 1 − best client-corpus match score
