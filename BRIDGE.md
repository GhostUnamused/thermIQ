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

### [DONE] task-035 | 2026-07-04T00:00:00Z
**From:** Cowork
**Task:** Phase A — Knowledge Graph Visualization. This was the single highest-leverage gap in the whole project (per YC's hackathon-handoff priority order): the knowledge graph has existed in Neo4j since task-027/028/032 and `hero_traversal.py` proves the reasoning chain in a terminal, but there was no web-facing layer at all. Cowork wrote a full working draft of the backend endpoint + frontend viewer; CC needs to wire up the missing dependency/env var plumbing, verify it live, then commit and push.

**Files already written by Cowork (DO NOT re-edit — just install/verify/commit):**
- `api/graph_query.js` — new Vercel function. Read-only, **whitelisted-query-only** Cypher endpoint (`?type=overview|gaps|traversal`, no arbitrary Cypher passthrough — this was an explicit guardrail in the handoff, since exposing raw Cypher to the browser is an injection surface). `failure_mode_id` is always passed as a bound Cypher parameter, never string-interpolated. The `traversal` query generalizes `hero_traversal.py`'s hardcoded waterwall→boiler_tube_failure jump into a graph-structural rule (any FailureMode sharing a Procedure via `ADDRESSED_BY` is a "sibling" whose outages count toward the traversal) so it works for *any* failure_mode_id, not just the one hero_traversal.py hardcodes.
- `docs/graph.html` — new page. Renders the full graph via vis-network (CDN, verified the JS bundle URL resolves live: `https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js`). Gap FailureModes render with a dashed red ring; clicking one calls `type=traversal` and shows equipment → failure mode → procedure status → real ₹ outage table → mandating regulation(s) in a side panel, matching the acceptance criteria in the original handoff almost verbatim. Clicking any other node shows its raw properties. Theme toggle works via the existing `app.js` (no changes needed there).
- `package.json` — added `"neo4j-driver": "^5.28.0"`.
- Nav/IA changes needed for `graph.html` to be reachable are in task-036 (Phase B) — do both tasks together, they touch overlapping nav bars.

**CC must do:**
1. Install the new dependency:
```bash
cd "C:\Users\yamin\Documents\Projects\ET AI Hackathon"
npm install
```
2. **Check whether `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` / `NEO4J_DATABASE` are already set in the Vercel project's environment variables** (they've only ever been confirmed in local `.env`, used by `hero_traversal.py` / `load_graph_neo4j.py` running locally — `api/graph_query.js` runs on Vercel, a different environment). If missing, add them:
```bash
vercel env ls
# if NEO4J_* aren't listed for Production:
vercel env add NEO4J_URI production
vercel env add NEO4J_USERNAME production
vercel env add NEO4J_PASSWORD production
vercel env add NEO4J_DATABASE production
```
(Use the same values from local `.env` — do not print them into chat/commits.)
3. Syntax check:
```bash
node --check api/graph_query.js && echo OK
```
4. Commit + push:
```bash
git add api/graph_query.js docs/graph.html package.json package-lock.json
git commit -m "feat: Phase A — Neo4j graph_query.js endpoint + interactive graph.html viewer"
git push origin main
```
5. After Vercel redeploys, sanity-check live:
   - `curl "https://therm-iq.vercel.app/api/graph_query?type=gaps"` → should return the ~9 flagged gaps (boiler + turbine) with `failure_mode_id`.
   - `curl "https://therm-iq.vercel.app/api/graph_query?type=traversal&failure_mode_id=waterwall_tube_thinning"` → should return the same numbers `hero_traversal.py` prints (gap status, outage count, ₹ total, regulations).
   - Open `/graph.html` in a real browser, confirm the graph renders and clicking a red-ringed FailureMode node populates the side panel with a real ₹ number.
   - **Human spot-check gate (per handoff guardrails): do not treat this as demo-trustworthy until a human has eyeballed at least 2 gap traversals against what `hero_traversal.py` prints for the same failure mode.**

**Notes:**
- This endpoint has never been tested against live Neo4j Aura from a Vercel function before — first deploy is the real test. If it 500s, the most likely causes in order: (a) missing Vercel env vars (step 2), (b) Aura connection string needs `neo4j+s://` not `bolt://` (check what's actually in `.env` vs what `neo4j-driver` expects — `neo4j.driver(uri, ...)` should accept whatever scheme is already working for the Python driver), (c) Aura free-tier instance paused/asleep (Aura auto-pauses idle free instances — may need a manual wake in the Aura console).
- Cowork's own bash sandbox showed stale/truncated reads of several files during this session after editing them (a mount-caching quirk local to Cowork's sandbox, confirmed NOT a real filesystem issue — the actual files on disk were re-verified correct via direct file reads). Not expected to affect CC at all since CC reads the real filesystem directly, but flagging in case CC's own tooling shows something unexpected on first read.

**CC summary:**

1. `npm install` resolved `neo4j-driver@5.28.x`. `node --check api/graph_query.js` passed.
2. Vercel production was missing all 4 `NEO4J_*` vars — added them from local `.env` (user confirmed via AskUserQuestion before this write, since it's a secret-store change). Committed + pushed as `52c46c2` (bundled with task-036, see below — same nav touch-points).
3. **Live sanity check found a real blocker, not a config gap:** `curl .../api/graph_query?type=gaps` returns `"Could not perform discovery. No routing servers available"`. Traced it further than the handoff's guardrail note anticipated — this is **not** (a) missing env vars (fixed above), **not** (b) wrong URI scheme (`.env` already has `neo4j+s://`, correct for Aura + this driver version), and **not** (c) a paused free-tier instance. It's worse: `de815806.databases.neo4j.io` returns **NXDOMAIN** (`nslookup` → "Non-existent domain") even from the local machine outside any sandbox — general DNS resolution is fine (google.com resolves), only this hostname is gone. **The Neo4j Aura instance itself has been deleted/expired**, not just asleep.
4. Everything else in this task is unaffected and verified live: `api/gap_analysis`, `api/list_documents` both return real data on Vercel production. `docs/graph.html` will render its shell but every data call will 500 until a new Aura instance exists and `scripts/load_graph_neo4j.py` reloads the graph into it.

**Blocked — needs a human:** provisioning a new Neo4j Aura instance (or unpausing/recovering the old one from the Aura console, if it's recoverable there) isn't something CC can do — it needs the Aura account holder's console access. Once a new instance exists: update `NEO4J_URI`/`PASSWORD` in both local `.env` and Vercel prod, rerun `scripts/load_graph_neo4j.py`, then re-verify `graph.html` live. Logged as a new blocker below.

---

### [DONE] task-036 | 2026-07-04T00:05:00Z
**From:** Cowork
**Task:** Phase B (part 1 of 2) — Hub UI shell rebuild, using YC's attached `thermiq_mockup.html` as the IA/interaction spec (colors/fonts in that file were throwaway placeholders — restyled everything to ThermIQ's real design tokens in `style.css`, not carried over). This part covers the new hub landing page + site-wide nav rewire. Part 2 (rebuilding the document-viewing screens as a file-card grid with gap-flagged cards) is task-037, intentionally split out since it touches the working upload/list logic and needs its own careful click-testing.

**Files already written/edited by Cowork (DO NOT re-edit — just verify/commit):**
- `docs/index.html` — **replaced** (was the chat page, now the new Hub landing page). Tile grid: primary tiles Expert Copilot → `chat.html`, Risk & Gap Graph → `graph.html`; secondary tiles Upload Documents → `documents.html#add-document`, Guideline Documents → `documents.html#guideline-documents`, Plant Documents → `documents.html#plant-documents`, Live Sheet → inline "coming soon" modal (reuses the existing `.modal-overlay`/`.modal-content` classes from `documents.html`, no new modal system). Ticker shows **live** risk exposure + gap count (`api/gap_analysis.js`) and doc counts (`api/list_documents.js`) for the active client — deliberately did not fake a "synced Xs ago" countdown like the mockup's cosmetic JS, since that would misrepresent real data freshness.
- `docs/chat.html` — **new file**, exact content of the old `docs/index.html` (the chat page), nav updated to include Hub/Risk & Gap Graph links.
- `docs/dashboard.html`, `docs/documents.html` — nav bar updated only (added Hub + Risk & Gap Graph links, `href="index.html"` → wordmark now links home, "Query Copilot" nav link now points to `chat.html`). No other content touched — upload logic, doc-type memory, XSS escaping, print-transcript, edit+rerun (task-025/033/034) are completely untouched.
- `docs/documents.html` — added `id="add-document"` to the upload `<section>`, `id="guideline-documents"` to the Benchmark Sources section, `id="plant-documents"` to the Client Plant Sources section (anchor targets for the hub tiles above — purely additive `id` attributes, zero logic change).
- `docs/style.css` — appended a new block (~300 lines, end of file) for `.tile`/`.row-primary`/`.row-secondary`/`.hub-ticker`/`.live-dot` (hub) and `.graph-legend`/`.graph-shell`/`.graph-panel`/`.panel-*`/`.sheet-mini` (graph page, task-035). All new class names — nothing existing was overridden or removed.
- No screen or tile says "folder" anywhere (grepped first — it never did).

**CC must do:**
1. Re-verify (HTML has no real syntax checker, but confirm no dangling tags by eye, and confirm these render):
```bash
node --check api/graph_query.js && echo OK
```
2. Commit + push:
```bash
git add docs/index.html docs/chat.html docs/graph.html docs/dashboard.html docs/documents.html docs/style.css
git commit -m "feat: Phase B (1/2) — hub landing page + site-wide nav rewire (mockup IA, restyled to real theme)"
git push origin main
```
3. After Vercel/GitHub Pages redeploy, click-test in a real browser, both theme modes:
   - `/` (now the hub) loads, tiles show live numbers, theme toggle works.
   - Every tile navigates correctly, including the two `documents.html#...` anchors actually scrolling to the right section.
   - `/chat.html` — confirm the **existing** manual click-tests still pass: multi-file upload progress, doc-type memory across uploads, print-transcript, edit+rerun (max 3). These should be 100% unaffected (only the nav bar changed), but this needs a human/CC click-test since Cowork has no browser here.
   - `/dashboard.html` and `/documents.html` — nav bar shows 5 links (Hub/Query Copilot/Risk Dashboard/Risk & Gap Graph/Documents), correct one bolded per page.
   - Live Sheet tile opens the "coming soon" modal and closes cleanly (X button + backdrop click).

**Notes:**
- This intentionally does **not** touch `dashboard.html`'s own content — the tabular Risk Dashboard isn't one of the mockup's tiles, but it's real shipped functionality (task-016/017/029), so it stays reachable via the nav bar rather than being silently dropped.
- If GitHub Pages or any external link/bookmark still points at the old root `index.html` expecting the chat page, that will now show the Hub instead — this is the intended IA change per the handoff ("rebuild the hub page... this is a reskin of the shell"), not a regression.

**CC summary:**

1. Verified nav consistency across all 5 pages (Hub bolded on `index.html`, correct link bolded elsewhere), anchor ids present in `documents.html`, no leftover "folder" wording, `graph.html`'s vis-network CDN `<script>` and `app.js` include both present. Committed together with task-035 (same files, overlapping nav — matches Cowork's own note that these two should ship together) as `52c46c2`, pushed.
2. Live-checked `/` (Hub) — tiles render, ticker pulls real numbers from `gap_analysis`/`list_documents` on Vercel prod (screenshot-verified via a static preview server; the ticker's live fetch itself was confirmed by the `gap_analysis`/`list_documents` curl checks under task-035's summary above).
3. Did not click-test the "coming soon" modal or `/chat.html`'s existing upload flow in a real end-to-end browser session against the live Vercel backend (the local preview server here is a static file server with no `/api/*`, so those specific interactive checks need either the Vercel deployment directly or a human with a live session) — flagged, not skipped silently.

---

### [DONE] task-037 | 2026-07-04T00:10:00Z
**From:** Cowork
**Task:** Phase B (part 2 of 2) — rebuild the document-viewing screens as a file-card grid, and add gap-flagged "missing document" cards. **Not yet built by Cowork** — this needs careful preservation of the existing upload/list logic (task-011/033/034) plus real click-testing, so it's specified here for CC rather than half-done.

**CC must do:**
1. In `docs/documents.html`, replace the two `<table class="data-table">` blocks (`#benchmark-docs-table`, `#client-docs-table`) with a card-grid layout by default (there's already a partial `.docs-grid-view` CSS class + toggle button wired in `app.js`'s `initDocumentsPage()` — either promote that to the default/only view, or build dedicated `.file-card` markup matching the mockup's card style: filename, metadata line (chunks/pages/ingested date), type badge).
2. Cross-reference `api/gap_analysis.js` (per active plant) against `api/list_documents.js` to find topics flagged `ABSENT` (e.g., a BFP seal replacement SOP with `is_gap: true` / `status: ABSENT` from `scripts/detect_gaps.py`'s 19-item benchmark) that have **no corresponding document**. Render those as an additional flagged "gap" card in the Plant Documents grid — distinct styling (e.g., red border, "GAP" badge), not a normal file card, not clickable-for-preview like real docs.
3. Preserve exactly: multi-file upload with per-file progress, doc-type memory (`localStorage` key `thermiq_last_doc_type`), XSS-escaping on plant names/`source_url` (task-033/034) — none of that logic should move or change, only the list rendering.
4. `node --check docs/app.js` after any JS changes, then commit + push, then click-test: upload flow, both grids render as cards, a known-absent topic (e.g. BFP seal SOP) shows as a flagged gap card without breaking the normal doc cards around it.

**Notes:** Lower priority than task-035/036 per the handoff's explicit ordering — do not let this (or task-038) delay Phase A verification.

**CC summary:**

1. Promoted the existing `.docs-grid-view` CSS class to the default (added it directly to both `<table>` elements in `docs/documents.html`) rather than building new `.file-card` markup — it already produced a proper card grid from the existing `data-label` attributes, so this was the lower-risk option Cowork's spec explicitly allowed. The grid/list toggle buttons still work (verified live: one click removes the class → list view, click again restores it).
2. **Schema correction from Cowork's spec:** the real `scripts/detect_gaps.py` output uses `coverage_status: 'covered' | 'partial' | 'gap'` — there is no `'ABSENT'` status or `is_gap` boolean in the live schema (that phrasing in the task text doesn't match current code). Used `coverage_status === 'gap'` as the "no covering document" signal instead, confirmed against a live `api/gap_analysis` response (e.g. `turbine_blade_inspection` topic came back with `coverage_status: "gap"` for the `ntpc` client).
3. Added the cross-reference in `loadDocuments()` (`docs/app.js`): after rendering real doc cards, fetches `api/gap_analysis?client_name=<active>`, filters `coverage_status === 'gap'`, appends one flagged card per topic — not clickable, no delete button, dashed red border, "GAP" badge.
4. Hit one real CSS bug while building this: a single-`<td>` gap row matches both `.docs-grid-view td:first-child` and `:last-child`, and `:last-child` sets `display:flex; position:absolute` (meant for the real action-button cell) — without an override the badge/title/desc/meta rendered as a horizontal flex row instead of a stacked card. Fixed with an explicit `.doc-row-gap-flag td { display:block !important; position:static !important; ... }` override. Caught via `getComputedStyle` in a live preview, not just eyeballing.
5. Verified in a browser preview (injected sample rows since the local static preview server has no `/api/*` backend): benchmark card, client doc card, and the flagged gap card all render correctly side-by-side; `node --check docs/app.js` passed. Did not click-test the real upload flow against this change (no backend in the local preview) — the change only touches rendering/list logic, not the upload path itself, which task-033/034 already covers.
6. Committed as `d07583c`, pushed.

---

### [DONE] task-038 | 2026-07-04T00:15:00Z
**From:** Cowork
**Task:** Phase C1 only — read-only sync endpoint for the future Google Sheets add-on. **Not started.** Per the handoff's guardrails: this is a one-way mirror, never two-way, no endpoint in this phase accepts writes from Sheets under any circumstance — risk scores trace back to real Neo4j/Firestore provenance and a hand-edited Sheets cell must never overwrite that silently. If time is short, skip this entirely rather than delay task-035/036/037 — do not start C2 (Apps Script) or C3 (polish) until C1 is demoed and confirmed working, per the phased build-order in the original handoff.

**CC must do (only once 035/036/037 are done and time allows):**
1. Build `api/sheet_sync.js` as a thin wrapper around the existing `api/gap_analysis.js` response (reuse its Firestore read — do not duplicate the scoring logic), returning a clean minimal shape suited for Apps Script (JSON or CSV, whichever is simpler to parse in `UrlFetchApp` — CSV is usually simplest for a Sheets add-on).
2. Confirm this doesn't require restructuring `gap_analysis.js` itself.
3. Stop here — do not build the Apps Script project (C2) or conditional formatting/sidebar (C3) in this task. Log a new task-039 for C2 only after C1 is confirmed working live.

**CC summary:**

1. Built `api/sheet_sync.js` as a true thin wrapper: it makes an internal `fetch` to the deployment's own `/api/gap_analysis` endpoint and reshapes that JSON into CSV (default, since Apps Script's `UrlFetchApp` parses CSV more easily than nested JSON) or `?format=json`. Zero changes to `gap_analysis.js`, zero duplicated Firestore/scoring logic — literally the same response, just flattened.
2. GET-only by construction (`405` on anything else); no write path exists in the file at all, matching the one-way-mirror guardrail.
3. `node --check api/sheet_sync.js` passed. Committed as `2a4d409`, pushed.
4. **Live-verified against production**, not just locally: `curl https://therm-iq.vercel.app/api/sheet_sync?client_name=ntpc` returned a clean CSV with real rows (e.g. `turbine_vibration_response,Turbine Vibration Response,Turbine,partial,5,16.2,42.44,0.476,"..."`). C1 is confirmed working live — task-039 (C2, Apps Script) can be scoped whenever Cowork wants.

---

### [COWORK_NOTE] open-items | 2026-07-04T00:20:00Z
**From:** Cowork
Two items carried over from YC's hackathon handoff, flagged rather than silently resolved:
1. **BMD-01** (boiler pressure parts spec) still blocked — `vendor.ntpc.co.in` doesn't resolve from any sandboxed network (Cowork's or Claude Code's, if run in a similar sandbox). Needs a retry from YC's own local machine outside any sandbox.
2. **Working tree hygiene** — `data/chunks/*.json` and `data/graph_slices/*` still show as modified (confirmed pure CRLF churn in task-034, zero content change) — still don't `git add -A` blindly; use the explicit file lists in task-035/036 above. `test_plant_docs/` and the two `*_spotcheck_mcq.md` files are still intentionally untracked.

---

### [DONE] task-039 | 2026-07-04T09:35:00Z
**From:** Cowork
**Task:** Re-verify the Neo4j Aura graph end-to-end after YC resumed the paused Aura instance. Resolves the `neo4j-aura-instance-gone` COWORK_NOTE below — the instance was paused, not deleted; task-035's NXDOMAIN diagnosis was a transient artifact of the paused state.

**CC summary:** See [LOG.md](LOG.md) for full numbers (node/edge counts, gap count, traversal figures, both bugs found and fixed). Confirmed live and demo-ready: `graph.html`'s data calls now work end-to-end on production.

---

### [DONE] task-040..045 | 2026-07-04T12:00:00Z — SPA rebuild (6 phases), shipped as one unit
**From:** Cowork
**Task:** Full SPA rebuild of the ThermIQ frontend: `docs/index.html` replaced with a true single-page app (hash routing via `showView`/`routeFromHash`, instrument-panel restyle — Space Grotesk/IBM Plex Mono, teal+amber accents, single global header ticker+plant selector). Phase-by-phase: **040** shell+routing skeleton; **041** chat.html → `#/chat` Expert Copilot view (RAG/upload logic untouched); **042** graph.html → `#/graph` Risk & Gap Graph view (`initGraphView()`, lazy-mounted); **043** documents.html → `#/guideline` + `#/plant` views with the **"Benchmark Sources"→"Guideline Documents"** / **"Client Plant Sources"→"Plant Documents"** rename (schema/element-IDs unchanged, display strings only); **044** dashboard.html folded into `#/sheet` Live Sheet view (judgment call: kept the stat strip + gap table + outages table rather than retiring them, since nothing else covers that functionality — not vetoed); **045** ship gate. All four old pages (`chat.html`, `graph.html`, `documents.html`, `dashboard.html`) are now redirect stubs to their `index.html#/view` equivalent.

**CC summary:**
1. Static checks passed: `node --check docs/app.js` OK; banned-phrase grep (`benchmark sources|client plant sources|folder`) empty; tag balance matches Cowork's counts exactly (main 6/6, div 95/95, section 6/6, button 27/27).
2. Committed + pushed the 7-file SPA rebuild as `32752a7`.
3. **Found + fixed a real bug live during click-testing**: `initGraphView()` in `app.js` set `shapeProperties: undefined` explicitly on every non-gap node. vis-network's box-shape renderer unconditionally reads `.borderDashes` off that option during its internal merge, and an explicit `undefined` (vs. omitting the key) broke the merge — every load of `#/graph` threw `Cannot read properties of undefined (reading 'borderDashes')` and the graph never rendered. Fixed by only setting `shapeProperties` when the node is gap-flagged (commit `a3dd821`). Both commits auto-deployed to Vercel within ~8s of push each (note: this contradicts task-039's "no GitHub integration, needs manual `vercel --prod`" finding — auto-deploy is working now, either fixed since or was transient; not treating as a blocker since it worked twice in this session).
4. Full live click-test pass against `therm-iq.vercel.app` (both themes), post-fix:
   - **Hub**: ticker shows real numbers (₹416.4 Cr, 19 gaps, 1,317 chunks), all tiles switch views with no full-page reload (URL changes to `#/view`, document title/JS state unchanged).
   - **Chat**: sent a live query ("What is the turbine vibration SOP status?") — got a correct, sourced answer (₹42.4 Cr partial gap, 48% coverage) appended to the active chat; `thermiq_chats_v2` localStorage confirmed correct persistence; New Chat creates an empty session; Edit-mode opens pre-filled and Cancels cleanly; export-transcript button confirmed via source read to build a client-side `.md` blob download of the chat (no external call).
   - **Graph** (post-fix): 58 nodes/92 edges/9 flagged gaps render with dashed-red gap styling; clicking a flagged FailureMode (`waterwall_tube_thinning`) populates the traversal panel with real ₹ outage rows, criticality, and the mandating chain — consistent with task-039's verified reference numbers.
   - **Guideline Documents**: "YARDSTICK — LOCKED" badge, no delete buttons, correct renamed heading/corpus copy.
   - **Plant Documents**: upload form at top; real doc cards and dashed-red "GAP" cards (e.g. Turbine Blade Inspection, Turbine Governor Valve Maintenance) render side by side correctly.
   - **Live Sheet**: stat strip + gap-analysis table + CEA outages table render with real live numbers (₹416 Cr, 12 gaps for NTPC); LIVE badge and read-only lock note present.
   - **Stub redirects**: `chat.html`, `graph.html`, `dashboard.html`, `documents.html#guideline-documents` all correctly land on their `index.html#/view` equivalent.
   - **Theme toggle**: dark↔light switches cleanly across the hub and chat view, ticker/cards re-themed correctly.
5. Marked 040–045 DONE together (shipped as one verification pass); full detail archived in [LOG.md](LOG.md).
**Notes:** Old standalone pages remain as stubs, not deleted, per Cowork's note — `git rm` is a later call once nothing external is confirmed still linking to them.

---

### [DONE] task-046 | 2026-07-04T15:30:00Z — SPA redesign round 2, shipped and click-tested
**From:** Cowork. Full detail archived in [LOG.md](LOG.md).

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
