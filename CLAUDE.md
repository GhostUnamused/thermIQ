# ThermIQ — Project Instructions for Claude Code & Cowork

## What is ThermIQ
ET AI Hackathon 2026, Problem #8 — Industrial Knowledge Intelligence for thermal power plants.
Quantifies knowledge gaps as ₹ crore operational risk.
Formula: `risk_score_cr = criticality_score × consequence_cr × exposure_score`

**Builder:** YC (IIM Amritsar IPM student, no coding background — Claude is the dev partner)
**Deadline:** ~July 1, 2026

**Live URLs:**
- Frontend: https://ghostunamused.github.io/thermIQ
- Backend: https://thermiq-674.netlify.app
- GitHub: https://github.com/GhostUnamused/thermIQ

---

## Tech Stack

| Layer | Service |
|---|---|
| Frontend | GitHub Pages (`/docs`) |
| Backend | Netlify Functions (JavaScript) |
| Vector DB | Qdrant Cloud — collection `thermiq_chunks`, 1024-dim COSINE |
| Embeddings | Jina AI v3 (`jina-embeddings-v3`) |
| LLM | Gemini 2.5 Flash |
| Structured Data | Firebase Firestore (`risk_scores`, `cea_outages`, `system_meta`) |
| Ingestion | Local Python scripts (`scripts/`) |

---

## Cowork ↔ Claude Code Bridge Protocol

Cowork (Claude in the desktop app) cannot push to GitHub, run local scripts, or make git commits.
Claude Code handles all of those. They communicate through **`BRIDGE.md`** in this folder.

### How it works

1. **Cowork** writes tasks to `BRIDGE.md` in the format below and updates this log after making file edits.
2. **Claude Code** (running inside the Claude desktop app) reads `BRIDGE.md` on startup, finds any `PENDING` tasks, implements them, then updates each task's status to `DONE` or `FAILED` with a note.
3. Optionally run `scripts/watch_bridge.ps1` in a PowerShell terminal — it watches `BRIDGE.md` and beeps + prompts you to switch to Claude Code when Cowork writes a new task.
4. Both sides append to the log — never delete old entries. Completed tasks stay for audit trail.

### Claude Code startup checklist
**Every time Claude Code opens this project**, do this first:
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
├── CLAUDE.md                      ← you are here
├── BRIDGE.md                      ← Cowork ↔ CC communication log
├── scripts/
│   └── watch_bridge.ps1           ← run this to auto-watch BRIDGE.md
├── docs/
│   ├── index.html                 ← Query Copilot UI
│   ├── dashboard.html             ← Risk Dashboard UI
│   ├── app.js                     ← all frontend logic
│   └── style.css                  ← dark navy/orange theme
├── netlify/functions/
│   ├── query.js                   ← Jina → Qdrant → Gemini RAG
│   ├── gap_analysis.js            ← Firestore risk_scores reader
│   ├── cea_outage.js              ← Firestore cea_outages reader
│   └── ingest_trigger.js          ← stub (ingestion is local only)
└── scripts/
    ├── ingest_documents.py        ← PDF → chunks → Jina → Qdrant
    ├── fetch_cea_outage.py        ← CEA XLS → Firestore cea_outages
    └── seed_firestore.py          ← one-time seed (already ran)
```

## Deploy instructions (for Claude Code)

**Frontend** — push to `main`, GitHub Actions deploys `/docs` to GitHub Pages automatically.

**Backend** — push to `main`, Netlify auto-deploys from `netlify/functions/`.

**After any file change**, always:
```bash
git add -A
git commit -m "description of change"
git push origin main
```

## Environment variables
All secrets live in Netlify dashboard and local `.env`. Never commit `.env`.
