# ThermIQ — Cowork ↔ Claude Code Bridge

> **Protocol:** Cowork writes PENDING tasks here. CC reads this file on startup (or when the watcher triggers), implements each PENDING task in order, then updates status. When a task is DONE, CC appends a compact 3-line summary to LOG.md and removes (or strikes) the task from this file.
>
> **Watcher:** `python scripts/watch_bridge.py` — polls every 3s, prints all `[PENDING]` task blocks and exits when BRIDGE.md changes. CC re-runs it after completing each task to wait for the next.
>
> **Completed task history:** See [LOG.md](LOG.md) — compact 3-line entries per task, not loaded by CC on startup.

---

## Active Queue

### [DONE] task-033 | 2026-06-30T17:30:00Z
**From:** Cowork
**Task:** Ship the document-upload fixes: (1) serverless PDF parser bug, (2) multi-file upload, (3) persistent Document Type. Cowork edited all files — CC installs the new dep, syntax-checks, commits, pushes (Vercel auto-deploys).

**Root cause of the bug YC hit:** `api/ingest_document.js` used `pdfjs-dist/legacy` which tries to spawn a fake worker (`Cannot find module './pdf.worker.js'`) that doesn't bundle on Vercel → every upload failed with "PDF parse failed: Setting up fake worker failed".

**Files already edited by Cowork (DO NOT re-edit — just commit):**
- `api/ingest_document.js` — replaced pdfjs with **`unpdf`** (worker-free, serverless-safe), loaded via dynamic `await import('unpdf')` since it's ESM-only. Uses `getDocumentProxy` + `extractText(pdf, {mergePages:true})`. `node --check` passed (Cowork ran it).
- `package.json` — removed `pdfjs-dist`, added `"unpdf": "^0.12.1"`.
- `docs/documents.html` — file input now `multiple`; drop-zone hint text updated.
- `docs/app.js` — `initUpload` reworked: accepts many files, ingests them **sequentially** (one POST per file, respecting the single-doc endpoint + Jina limits) with per-file progress and a final success/failure summary; single file still uses the editable Document Name field, multiple files derive each name from its filename; **Document Type persists** via `localStorage` key `thermiq_last_doc_type`; plant name no longer cleared between uploads. `node --check` passed.

**CC must do:**
1. Install the new dependency so it's in node_modules + lockfile (there is currently NO package-lock.json — running install will create one, which is fine to commit):
```bash
cd "C:\Users\yamin\Documents\Projects\ET AI Hackathon"
npm install
```
If `unpdf@^0.12.1` does not resolve, install the latest 0.x: `npm install unpdf@latest` and leave whatever version it picks in package.json.
2. Re-verify syntax:
```bash
node --check api/ingest_document.js && node --check docs/app.js && echo OK
```
3. Commit + push (explicit files; if `npm install` created `package-lock.json`, include it):
```bash
git add api/ingest_document.js package.json docs/documents.html docs/app.js package-lock.json
git commit -m "fix: serverless PDF parse (pdfjs->unpdf) + multi-file upload + persistent doc type"
git push origin main
```
4. After Vercel redeploys, sanity check: on `/documents.html`, upload the 3 test PDFs in `test_plant_docs/` at once under plant `test1` (or `saraighat`) and confirm they ingest with chunk/page counts and NO "fake worker" error. Report the result (chunks/pages per file) in your CC summary.

**Notes:**
- `unpdf` is ESM-only; the dynamic `import()` inside the async handler is intentional — do not convert it to a top-level `require`.
- Only `api/ingest_document.js` used pdfjs; removing it from package.json is safe.
- This unblocks YC's "different plant" hardcoding test (the test_plant_docs set).

**CC summary:**

1. `npm install` — resolved `unpdf@0.12.1`, removed `pdfjs-dist`, created `package-lock.json`.
2. Syntax check — `node --check api/ingest_document.js` and `node --check docs/app.js` both passed.
3. Committed `api/ingest_document.js`, `package.json`, `docs/documents.html`, `docs/app.js`, `package-lock.json` and pushed (`abe17ab`).
4. **Sanity check (API test against live Vercel):** uploaded all 3 `test_plant_docs/` PDFs to plant `saraighat` via the API. All 3 succeeded — **no "fake worker" error**, PDF parse worked cleanly with `unpdf`:
   - `Turbine High Vibration Emergency Response SOP` → chunks=2, pages=1
   - `Turbine Blade Inspection Procedure` → chunks=1, pages=1
   - `Boiler Tube Failure Emergency Response SOP` → chunks=2, pages=1

   (PDFs are 1-page synthetic fixtures — chunk counts are correct for their size.) The `test_plant_docs/` data is now live in Qdrant under `client_name=saraighat`; run `python scripts/detect_gaps.py --client saraighat` to compute gap scores for the new plant.

---

### [DONE] task-034 | 2026-07-03T00:00:00Z
**From:** Cowork
**Task:** Commit and push a batch of uncommitted working-tree fixes that Cowork reviewed and verified (syntax-checked, cross-referenced against the API readers they support). No further edits needed — just commit and push.

**Files already edited (DO NOT re-edit — just commit):**
- `CLAUDE.md` — deadline updated to July 20, 2026; docs updated for the BRIDGE/LOG two-file split (matches what's already on disk in BRIDGE.md/LOG.md).
- `scripts/detect_gaps.py` — writes `client_name` field on every `risk_scores` doc and namespaces doc IDs as `<client>__<gap_id>`; only clears that namespace's old records instead of wiping every client's scores on each run. This closes a real bug: `api/gap_analysis.js` and `api/clear_client.js` already expected this shape but `detect_gaps.py` wasn't writing it, so per-client dashboards were silently falling back to the legacy/global view and any re-run nuked other plants' data.
- `scripts/ingest_ocr.py` — writes `source_type`/`client_name` fields and a `documents/` collection record, mirroring `scripts/ingest_documents.py` exactly (with `"ocr": true` added). Previously OCR-ingested docs were invisible to gap detection and the Documents UI.
- `api/ingest_document.js` — size limit corrected 8MB→~4.3MB base64 (~3MB PDF), matching Vercel's real ~4.5MB body cap; removed a dead `module.exports.config.bodyParser.sizeLimit` override that doesn't do anything on Vercel's Node runtime.
- `docs/app.js` + `docs/documents.html` — client-side upload limit and copy updated to match the corrected 3MB server limit; XSS fix so plant names and `source_url` are escaped (or validated as http(s)) before hitting `innerHTML`.
- `api/query.js` — guards `runGeminiAgentic` against responses with no candidates (safety-blocked/malformed Gemini output) so it falls through to the NIM/OpenRouter fallback cascade instead of crashing with an unhandled exception.

**CC must do:**
1. Re-verify syntax (should already pass — Cowork ran these):
```bash
node --check api/ingest_document.js && node --check api/query.js && node --check docs/app.js && python -m py_compile scripts/detect_gaps.py scripts/ingest_ocr.py && echo OK
```
2. Commit and push (explicit files — do NOT `git add -A`, see Notes):
```bash
git add CLAUDE.md scripts/detect_gaps.py scripts/ingest_ocr.py api/ingest_document.js api/query.js docs/app.js docs/documents.html
git commit -m "fix: namespace gap-detection risk_scores by client, OCR ingest documents-collection parity, correct Vercel upload size limit, harden query.js against empty Gemini responses, XSS escape in app.js"
git push origin main
```
3. After Vercel redeploys, if convenient, sanity-check one gap-detection run for a namespaced client (`python scripts/detect_gaps.py --client <plant>`) and confirm `api/gap_analysis.js?client_name=<plant>` returns that plant's scores without touching other clients' records.

**Notes:**
- Do NOT `git add -A` / commit `data/chunks/*.json` or `data/graph_slices/*` — Cowork confirmed (via `git diff --ignore-all-space`) those diffs are pure CRLF line-ending churn from an editor re-save, zero content change. Committing them would just create ~600 files of noise.
- Leave `test_plant_docs/`, `data/graph_slices/boiler_spotcheck_mcq.md`, `data/graph_slices/turbine_spotcheck_mcq.md`, and `.claude/settings.local.json` untracked for now — not part of this task; ask before adding them.

**CC summary:**

1. Syntax check — `node --check` on the 3 JS files and `python -m py_compile` on the 2 Python files all passed.
2. Hit a stale `.git/index.lock` (dated 2026-07-02T22:41, no running git process) — removed it, then staged exactly the 7 listed files and committed.
3. Committed and pushed as `32f89c3`. Left `test_plant_docs/`, the two `data/graph_slices/*_spotcheck_mcq.md` files, and other untracked items alone per Notes. Did not run the optional post-deploy gap-detection sanity check (not required to close the task).

---

### Task format (Cowork uses this when writing new tasks)

```
### [PENDING] task-XXX | YYYY-MM-DDTHH:MM:SSZ
**From:** Cowork
**Task:** Short description
**Files changed by Cowork:** list any files already edited (CC should not re-edit unless instructed)
**CC must do:**
- step 1
- step 2
**Notes:** any context
```

Status markers: `[PENDING]` → `[IN_PROGRESS]` → `[DONE]` (then move to LOG.md) | `[FAILED: reason]` | `[COWORK_NOTE]`
