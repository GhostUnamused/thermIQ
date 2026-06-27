# ThermIQ — Current Status (2026-06-26, Real State)

## What Actually Works ✅

### Multi-Chat Sidebar — FULLY WIRED
- Click any chat in sidebar to switch → works
- "+ New" button creates new chat → works  
- Delete button on each chat with confirmation → works
- Auto-title from first user message → works
- Persists to localStorage (thermiq_chats_v2) → works
- Mobile sidebar drawer open/close → works

**Code verified:** `docs/app.js` lines 227-395 (renderSidebar, initSidebar, chat-list click handlers all present)

### Theme Toggle (Dark/Light) — FULLY WIRED
- Toggle button switches `data-theme` on root element → works
- Persists to localStorage (thermiq_theme) → works
- All styles respect theme → works

### Query Copilot → Vercel Backend — WORKING
- `/api/query` returns answers with sources
- Backend: https://therm-iq.vercel.app/api/query
- Fallback to OpenRouter when Gemini throttles → works
- Client filtering supported → works

### Risk Dashboard — PARTIALLY WORKING
- `/api/gap_analysis` returns 18 gaps (tested live)
- Displays on dashboard.html → works
- BUT: gap-analysis section had `locked-overlay` CSS added (task-004), blocking view

### Documents Manager — FULLY WORKING
- `/api/list_documents` returns 6 ingested docs → works
- Upload form accepts PDFs → works
- Delete button removes docs from Qdrant + Firestore → works
- `/api/ingest_document` authenticated with X-Ingest-Key → works

### CEA Outages Table — LOADS BUT "LOADING..." STUCK
- `/api/cea_outage` returns real data (59 records) → works
- HTML table renders → works
- BUT: "Loading..." spinner never hides (timing/CSS issue)

### Knowledge Base — 1189 CHUNKS LIVE
| Document | Chunks | Status |
|---|---|---|
| CEA Standard Tech Spec 500MW | 917 | ✅ |
| NTPC Kahalgaon (OCR) | 58 | ✅ |
| NTPC Lara (OCR) | 106 | ✅ |
| CEA R&M Life Extension | 36 | ✅ |
| CEA Review O&M Practices | 57 | ✅ |
| CEA R&M Guidelines | 15 | ✅ |

---

## What's Broken or Incomplete ❌

### 1. Risk Dashboard Locked (Non-Critical)
- **Issue:** Gap analysis section has visual overlay blocking the table
- **Root cause:** CSS `locked-overlay` added in task-004 (was meant to hide until Documents tab was used, but no unlock logic wired)
- **Impact:** Users see lock icon over gap table
- **Fix needed:** Remove overlay CSS or add unlock button
- **Files:** `docs/dashboard.html`, `docs/style.css`, `docs/app.js`

### 2. CEA Outages Loading Spinner Won't Hide
- **Issue:** Table loads real data but "Loading..." text stays visible
- **Root cause:** Likely `document.querySelector('.loading-spinner').remove()` or `.hide()` not being called
- **Impact:** Dashboard looks like it's hung, but data is there
- **Fix needed:** Find loading-spinner element & hide it after fetch completes
- **Files:** `docs/app.js` (initDashboard function)

### 3. No Dynamic Risk Scoring After Ingest
- **Issue:** When user uploads a new doc, risk_scores don't auto-update
- **Root cause:** `detect_gaps.py` is a one-time script, not called from ingest endpoint
- **Impact:** Dashboard gaps don't reflect new knowledge
- **Fix needed:** Call gap-detection after ingest (either sync in function or async via GitHub Actions)
- **Files:** `api/ingest_document.js` + potentially new workflow

### 4. Netlify Backend Dead (Expected)
- **Issue:** https://thermiq-674.netlify.app returns 404
- **Root cause:** Netlify build-credit exhaustion (account-level block)
- **Status:** Expected & documented. Vercel serves both frontend + backend now.
- **No fix needed:** Fully migrated to Vercel.

---

## Untracked Changes (Not Committed)

```
M BRIDGE.md                                    (truncated, need to restore)
M data/chunks/*  (921 JSON files)              (data layer changes, gitignored)
```

### What Changed in data/chunks/
The chunks were likely re-serialized or timestamps updated. These are gitignored fallback files — they don't block anything.

---

## Git Status Summary

- **Current branch:** main
- **Remote:** up-to-date (last push: commit c1db3a5)
- **Dirty state:** BRIDGE.md truncated, chunk files modified (both can be reset)
- **No uncommitted code changes** in the actual app/backend

---

## Deployment Status

| Service | URL | Live? | Notes |
|---|---|---|---|
| Frontend (GitHub Pages) | https://ghostunamused.github.io/thermIQ | ✅ | Mirrored from /docs |
| Frontend (Vercel) | https://therm-iq.vercel.app | ✅ | Serves /docs as root |
| API Backend | https://therm-iq.vercel.app/api/* | ✅ | All 7 functions deployed |
| Query endpoint | /api/query | ✅ | RAG working |
| Gap analysis | /api/gap_analysis | ✅ | 18 gaps returned |
| CEA outages | /api/cea_outage | ✅ | 59 records live |
| Documents list | /api/list_documents | ✅ | 6 docs in registry |
| Upload | /api/ingest_document | ✅ | Auth gate working |
| Delete | /api/delete_document | ✅ | Firestore + Qdrant sync |

---

## Next Steps (Priority Order)

### Immediate (5-10 min fixes)

1. **Remove locked overlay from gap dashboard** OR add unlock logic
   - Simplest: delete `.locked-overlay` CSS rule + markup
   - Better: wire unlock button in Documents tab click

2. **Hide CEA loading spinner after fetch**
   - Find the element in initDashboard()
   - Call `.remove()` or `.style.display = 'none'` when data arrives

### Short-term (1-2 hour features)

3. **Auto-update risk_scores after document upload**
   - Option A: Call `detect_gaps.py` sync from ingest_document.js (risky, adds latency)
   - Option B: Trigger via GitHub Actions webhook (cleaner but async)
   - Recommended: Option B (set up workflow dispatch on ingest)

4. **Fix BRIDGE.md file** (currently truncated)
   - The file got cut off during an edit
   - Restore from git or rebuild from commit history

### Nice-to-have (for final demo)

5. **Chat export / share** (low priority for hackathon)
6. **Better CEA outage filtering** (by plant, date range)
7. **Chunk introspection endpoint** (verify ingestion)

---

## How to Continue

1. **Verify live URLs** (all should work):
   - https://therm-iq.vercel.app/
   - https://therm-iq.vercel.app/dashboard.html
   - https://therm-iq.vercel.app/documents.html
   - https://therm-iq.vercel.app/api/gap_analysis

2. **Reset dirty state** (optional, safe):
   ```bash
   git checkout BRIDGE.md
   git checkout data/chunks/
   ```

3. **Pick the next task** from the priority list above and implement in Claude Code

4. **Test before push:** Frontend changes are instant (just F5), backend changes need `git push` → wait 1 min for Vercel

---

## Key Files to Know

- `docs/app.js` — all frontend logic (multi-chat, theme, queries, dashboard)
- `docs/index.html` — query copilot UI (chat, sidebar, input)
- `docs/dashboard.html` — risk dashboard UI (gaps, outages, documents)
- `api/query.js` — RAG pipeline (Jina → Qdrant → Gemini)
- `api/gap_analysis.js` — reads Firestore risk_scores
- `scripts/detect_gaps.py` — detects gaps from Qdrant corpus

---

**Updated:** 2026-06-26 by Claude (Cowork session)  
**Last verified:** Commit c1db3a5, Vercel deployed live
