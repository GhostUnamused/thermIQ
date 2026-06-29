# ThermIQ — Project Instructions for Codex & Cowork

## What is ThermIQ
ET AI Hackathon 2026, Problem #8 — Industrial Knowledge Intelligence for thermal power plants.
Quantifies knowledge gaps as ₹ crore operational risk.
Formula: `risk_score_cr = criticality_score × consequence_cr × exposure_score`

**Builder:** YC (IIM Amritsar IPM student, no coding background — Codex is the dev partner)
**Deadline:** ~July 1, 2026

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

## Cowork ↔ Codex Bridge Protocol

Cowork (Codex in the desktop app) cannot push to GitHub, run local scripts, or make git commits.
Codex handles all of those. They communicate through **`BRIDGE.md`** in this folder.

### How it works

1. **Cowork** writes tasks to `BRIDGE.md` in the format below and updates this log after making file edits.
2. **Codex** (running inside the Codex desktop app) reads `BRIDGE.md` on startup, finds any `PENDING` tasks, implements them, then updates each task's status to `DONE` or `FAILED` with a note.
3. Optionally run `scripts/watch_bridge.ps1` in a PowerShell terminal — it watches `BRIDGE.md` and beeps + prompts you to switch to Codex when Cowork writes a new task.
4. Both sides append to the log — never delete old entries. Completed tasks stay for audit trail.

### Codex startup checklist
**Every time Codex opens this project**, do this first:
1. Read `BRIDGE.md`
2. If any tasks are marked `[PENDING]`, implement them in order
3. Update each task to `[DONE]` or `[FAILED: reason]` when finished
4. Commit and push if the task requires it (check task instructions)

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

### Status markers
- `[PENDING]` — Cowork has written this, CC has not yet acted
- `[IN_PROGRESS]` — CC is working on it (CC updates this itself)
- `[DONE]` — CC completed it, include summary of what was done
- `[FAILED: reason]` — CC could not complete it, include error/reason
- `[COWORK_NOTE]` — Cowork leaving a follow-up note on a completed task

---

## Key file locations

```
ET AI Hackathon/
├── AGENTS.md                      ← you are here
├── BRIDGE.md                      ← Cowork ↔ CC communication log
├── scripts/
│   └── watch_bridge.ps1           ← run this to auto-watch BRIDGE.md
├── docs/
│   ├── index.html                 ← Query Copilot UI
│   ├── dashboard.html             ← Risk Dashboard UI
│   ├── documents.html             ← Documents manager (benchmark/client split)
│   ├── app.js                     ← all frontend logic
│   └── style.css                  ← dark navy/orange theme
├── api/                            ← Vercel functions (the live backend)
│   ├── _cors.js                   ← shared CORS helper (not an endpoint)
│   ├── query.js                   ← Jina → Qdrant → Gemini RAG (+ NIM/OpenRouter fallback)
│   ├── gap_analysis.js            ← Firestore risk_scores reader
│   ├── cea_outage.js              ← Firestore cea_outages reader
│   ├── ingest_document.js         ← authenticated PDF upload → Qdrant + Firestore
│   ├── list_documents.js / delete_document.js / clear_client.js
│   └── ingest_trigger.js          ← stub (ingestion is local only)
│   (recompute_gaps.js is RETIRED — returns 410; pending git rm)
└── scripts/
    ├── ingest_documents.py        ← PDF → chunks → Jina → Qdrant (text PDFs)
    ├── ingest_ocr.py              ← OCR ingest for scanned/image PDFs
    ├── detect_gaps.py             ← CANONICAL gap engine → Firestore risk_scores (1-5 scale)
    └── fetch_cea_outage.py        ← CEA outage data → Firestore cea_outages (daily GH Action)
```

> **Gap scoring has ONE source of truth: `scripts/detect_gaps.py`** (19 items,
> criticality 1-5, writes `risk_scores` with `topic`/`coverage_status`/`client_score`).
> The dashboard and `api/query.js` read this shape. The old JS twin
> `api/recompute_gaps.js` drifted (1-10 scale, different schema) and is retired.

## Deploy instructions (for Codex)

**Frontend** — push to `main`, GitHub Actions deploys `/docs` to GitHub Pages automatically. Vercel also redeploys `/docs` as its root on every push.

**Backend** — push to `main`, Vercel auto-deploys from `api/*.js` (no Netlify involved — that backend no longer exists).

**After any file change**, always:
```bash
git add -A
git commit -m "description of change"
git push origin main
```

## Environment variables
All secrets live in the Vercel dashboard and local `.env`. Never commit `.env`. A `VERCEL_TOKEN` is persisted in the gitignored `.env` for CLI auth — check there before asking the user for one.

## Imported Claude Cowork project instructions
