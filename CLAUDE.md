# ThermIQ — Project Instructions for Claude Code & Cowork

## What is ThermIQ
ET AI Hackathon 2026, Problem #8 — Industrial Knowledge Intelligence for thermal power plants.
Quantifies knowledge gaps as ₹ crore operational risk.
Formula: `risk_score_cr = criticality_score × consequence_cr × exposure_score`

**Builder:** YC (IIM Amritsar IPM student, no coding background — Claude is the dev partner)
**Deadline:** ~July 20, 2026

**Live URLs:**
- Frontend (GitHub Pages mirror): https://ghostunamused.github.io/thermIQ
- Frontend + Backend (Vercel, primary): https://therm-iq.vercel.app
- GitHub: https://github.com/GhostUnamused/thermIQ

> **Netlify is dead.** The Netlify team was deleted 2026-06-27; `thermiq-674.netlify.app` 404s permanently. Vercel (`api/*.js`) is the sole live backend. Do not edit a `netlify/functions/` directory expecting it to deploy — it no longer exists in this repo.

---

## Tech Stack

| Layer | Service |
|---|---|
| Frontend | GitHub Pages (`/docs`) + Vercel (serves `/docs` as root) |
| Backend | Vercel Functions (`api/*.js`) |
| Vector DB | Qdrant Cloud — collection `thermiq_chunks`, 1024-dim COSINE |
| Embeddings | Jina AI v3 (`jina-embeddings-v3`) |
| LLM | Gemini 2.5 Flash |
| Structured Data | Firebase Firestore (`risk_scores`, `cea_outages`, `system_meta`) |
| Ingestion | Local Python scripts (`scripts/`) |

---

## Cowork ↔ Claude Code Bridge Protocol

Cowork (Claude in the desktop app) cannot push to GitHub, run local scripts, or make git commits.
Claude Code handles all of those. They communicate through **`BRIDGE.md`** (active queue) and **`LOG.md`** (completed history).

### Two-file design
- **`BRIDGE.md`** — active tasks only (PENDING / IN_PROGRESS). Stays small so CC can read it cheaply on every startup. No completed task text lives here.
- **`LOG.md`** — append-only archive of completed tasks, one compact 3-line entry per task. CC does **not** read LOG.md on startup.

### How it works

1. **Cowork** writes a `[PENDING]` task to `BRIDGE.md` using the format below.
2. **Claude Code** reads `BRIDGE.md` on startup, implements each `[PENDING]` task in order, then:
   - Marks the task `[DONE]` or `[FAILED: reason]` in `BRIDGE.md`
   - Appends a compact summary to `LOG.md` (3 lines max: what was done, key outcome, commit hash)
   - Removes (or leaves as a 1-line stub) the completed task from `BRIDGE.md` to keep it lean
3. To stay live, CC runs `python scripts/watch_bridge.py` — polls every 3s, prints all `[PENDING]` blocks and exits on any change. CC implements, updates, then re-runs the watcher.

### Claude Code startup checklist
**Every time Claude Code opens this project**, do this first:
1. Read `BRIDGE.md` (small — active tasks only)
2. Implement any `[PENDING]` tasks in order
3. For each completed task: update status in `BRIDGE.md`, append 3-line summary to `LOG.md`
4. Commit and push if the task requires it

### Task format Cowork uses in BRIDGE.md

```
### [PENDING] task-XXX | YYYY-MM-DDTHH:MM:SSZ
**From:** Cowork
**Task:** Short description
**Files changed by Cowork:** list of files already edited (CC should not re-edit these unless instructed)
**CC must do:**
- step 1
- step 2
**Notes:** any context
```

### LOG.md entry format (CC writes this when done)

```
## task-XXX | YYYY-MM-DD | DONE
One-line description of what was done.
Key outcome (metrics, errors fixed, etc). Commit: <hash>
```

### Status markers
- `[PENDING]` — Cowork has written this, CC has not yet acted
- `[IN_PROGRESS]` — CC is working on it
- `[DONE]` — CC completed it (full details in LOG.md)
- `[FAILED: reason]` — CC could not complete it
- `[COWORK_NOTE]` — Cowork leaving a follow-up note

---

## Key file locations

```
ET AI Hackathon/
├── CLAUDE.md                      ← you are here
├── BRIDGE.md                      ← active task queue (read this on startup; keep it lean)
├── LOG.md                         ← completed task archive (human reference; CC does not read on startup)
├── scripts/
│   └── watch_bridge.py            ← CC runs `python scripts/watch_bridge.py` to stay awake on BRIDGE.md
├── docs/
│   ├── index.html                 ← Query Copilot UI
│   ├── dashboard.html             ← Risk Dashboard UI
│   ├── documents.html             ← Documents manager (benchmark/client split)
│   ├── app.js                     ← all frontend logic
│   └── style.css                  ← dark navy/orange theme
├── api/                            ← Vercel functions (the live backend)
│   ├── _cors.js                   ← shared CORS helper (not an endpoint, doesn't count toward the function cap)
│   ├── query.js                   ← Jina → Qdrant → Gemini RAG (+ NIM/OpenRouter fallback)
│   ├── gap_analysis.js            ← Firestore risk_scores reader
│   ├── cea_outage.js              ← Firestore cea_outages reader
│   ├── ingest_document.js         ← authenticated PDF/DOCX/XLSX/CSV/TXT upload → Qdrant + Firestore
│   ├── ingest_drive.js            ← Drive link/folder ingest → dispatches drive-ingest.yml
│   ├── delete_job.js              ← dismiss an ingest_jobs record
│   ├── list_documents.js / delete_document.js / clear_client.js
│   ├── graph_query.js             ← Neo4j read-only whitelisted-query endpoint
│   ├── sheet_sync.js              ← CSV mirror of gap_analysis for the Sheets add-on
│   └── trigger_gap_scan.js        ← dispatches gap-scan.yml for unscored plants
└── scripts/
    ├── ingest_documents.py        ← PDF → chunks → Jina → Qdrant (text PDFs)
    ├── ingest_ocr.py              ← OCR ingest for scanned/image PDFs
    ├── detect_gaps.py             ← CANONICAL gap engine → Firestore risk_scores (1-5 scale)
    └── fetch_cea_outage.py        ← CEA outage data → Firestore cea_outages (daily GH Action)
```

> **Gap scoring has ONE source of truth: `scripts/detect_gaps.py`** (19 items,
> criticality 1-5, writes `risk_scores` with `topic`/`coverage_status`/`client_score`).
> The dashboard and `api/query.js` read this shape. The old JS twin
> `api/recompute_gaps.js` drifted (1-10 scale, different schema) and was retired/removed.

## Deploy instructions (for Claude Code)

**Frontend** — push to `main`, GitHub Actions deploys `/docs` to GitHub Pages automatically. Vercel also redeploys `/docs` as its root on every push.

**Backend** — push to `main`, Vercel auto-deploys from `api/*.js` (no Netlify involved — that backend no longer exists).

> **Vercel Hobby plan caps a deployment at 12 Serverless Functions** — each file directly under `api/` (excluding `_cors.js`, a shared helper, not a route) counts as one. Currently at the cap. Adding a new `api/*.js` endpoint requires retiring or merging an existing one first, or the deploy fails with `exceeded_serverless_functions_per_deployment` (a hard error, not a warning — check `vercel inspect --logs <url>` or the Vercel dashboard if a deploy shows Error status with no visible build failure).

**After any file change**, always:
```bash
git add -A
git commit -m "description of change"
git push origin main
```

## Environment variables
All secrets live in the Vercel dashboard and local `.env`. Never commit `.env`. A `VERCEL_TOKEN` is persisted in the gitignored `.env` for CLI auth — check there before asking the user for one.
