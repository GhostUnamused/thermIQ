# ThermIQ — Completed Task Log

> Archive of all completed bridge tasks. **CC does not read this on startup** — it's for human reference only.
> Format per entry: task ID | date | one-line description | key outcome | commit hash (if any).

---

## task-056 | 2026-07-11 | DONE
Round-3 feature batch: Drive folder ingest+sync, multi-format uploads (docx/xlsx/csv/txt/gdocs), AI relevance gate (Gemini, fails open, override checkbox), delete-profile action, failed-job dismiss, navy dark theme, theme-aware graph, resizable upload panel, live-sheet toolbar moved to top bar. Added missing `GEMINI_API_KEY` GitHub secret (user-confirmed first). First deploy failed — 13 `api/*.js` files exceeded Vercel Hobby's 12-Serverless-Functions cap; fixed by removing the dead `api/ingest_trigger.js` stub, redeployed clean. DOM/JS-level live verification confirmed: multi-format file accept, Drive textarea, relevance checkbox, panel resize, delete-profile/sync-drive buttons, navy `--bg`, graph theme functions, top-bar sheet actions, hover-pause removed from marquee. End-to-end flows (real relevance-gate reject, folder sync add/remove, gdoc ingest, failed-job dismiss) not exercised — needs real test files/Drive links. Commits: ea21fef, cd5f3c2, 090444c.

## task-055b | 2026-07-11 | DONE
Chat UX overhaul: Enter-to-send (Shift+Enter newline), Stop-generation button with AbortController, one-click suggestion/follow-up chips, Shorter/Simplify/Checklist quick actions, long-answer collapse, light-mode-by-default. Committed by Cowork locally as 968a44f; CC pushed it to origin. Live click-test deferred to a follow-up browser session. Commit: 968a44f

## task-055a | 2026-07-11 | DONE
Large-file ingest via pasted Google Drive link (new `api/ingest_drive.js` + `.github/workflows/drive-ingest.yml` + `scripts/ingest_from_drive.py`, dispatched via existing `GITHUB_DISPATCH_TOKEN`), small direct uploads now store the original PDF in `docs/uploads/` for in-app preview, viewer normalizes Drive/Dropbox links to embeddable form. All syntax checks passed (`node --check` x4, `py_compile`). Live end-to-end verification (small-file commit, large-file GH Action run, restricted-link failure path, viewer regression) deferred to a follow-up browser session. Commit: 6536717

## task-054 | 2026-07-11 | DONE
Shipped three UI/feature changes: (1) Google Sheet synced with ThermIQ theming (navy title band, teal accents, ₹ Cr formats, frozen header); (2) CEA outages moved off Live Sheet → hub marquee strip + expandable full-history panel; (3) one-click "Generate Risk Report (PDF)" button on Live Sheet (print-window from quantified-only gap_analysis, no assumed-default ₹ figures). All code verified + committed + pushed. Live click-test blocked pending Vercel auto-deploy (~2–8 min typical). Commit: b1a351c.

## task-050 | 2026-07-06 | DONE
Live Sheet section shows two buttons: primary "Open Google Sheet ↗" linking to the demo sheet, secondary "Download CSV" keeping the raw `api/sheet_sync` feed. Added `.sheet-actions-buttons` + `.btn-sheet-csv--secondary` CSS. Commit: f2c31c5

## task-051 | 2026-07-06 | DONE
Total Risk Exposure now sums only CEA-outage-backed (quantified) rows — assumed-default gaps excluded from headline ₹ figure. Unquantifiable+undocumented topics rendered in a new "Documentation Needed" section with upload links. Chunks-indexed ticker scoped to benchmark + active client's own docs only (no longer the whole-collection total). `node --check docs/app.js` passed. Commit: f2c31c5

## task-052 | 2026-07-06 | DONE
Live Sheet button href changed from `/edit` to `/copy` — Google's native copy-to-Drive prompt, visitors get their own Sheet+bound-script copy. Label updated to "Get Your Own Live Sheet ↗". Sharing-permission caveat (must be "Anyone with link: Viewer") unchanged — requires YC to flip in Drive. Commit: f2c31c5

## task-053 | 2026-07-06 | DONE
Verification recap confirming task-051/052 are the correct shape. No new code. `node --check docs/app.js` passed independently. All changes shipped in f2c31c5.

## task-049 | 2026-07-05 | DONE
Three automation gaps: (1) CEA ingest was failing — GH secrets present but lookback only tried today/yesterday while CEA publishes 2-3 days late; fixed `fetch_cea_outage.py` to try up to 5 days back (July 2 data now fetches successfully). (2) Neo4j keepalive: `scripts/neo4j_keepalive.py` + `.github/workflows/neo4j-keepalive.yml` committed — GH secrets (NEO4J_*, JINA_API_KEY, QDRANT_URL, QDRANT_API_KEY) blocked by auto-mode classifier, need user to authorize and run `gh secret set` or add via GitHub UI. (3) Gap scan auto-trigger: `api/trigger_gap_scan.js` + `.github/workflows/gap-scan.yml` + `docs/app.js` committed; `GITHUB_DISPATCH_TOKEN` (GitHub PAT with Actions:write) must be added to Vercel by YC. All code at commit `02dfaf1`. Blocked: 7 GH secrets + 1 Vercel secret need human action before workflows go live.

## task-048 | 2026-07-05 | DONE
Ran `detect_gaps.py --client saraighat` — wrote 19 gap records (₹374.3 Cr total risk; 3 covered, 3 partial, 13 gaps). Verified live: `api/gap_analysis?client_name=saraighat` returns 19 rows; `api/sheet_sync?client_name=saraighat` returns CSV rows. Committed `docs/index.html` copy fix (stale "add-on pending" → correct C2 shipped copy). Commit `c2dcebe`.

## task-047 | 2026-07-05 | DONE
Committed `apps-script/Code.gs` + `appsscript.json` — Phase C2 Google Apps Script skeleton (container-bound "ThermIQ" menu: Sync Now / Enable-Disable Auto-Refresh / Set Client-Plant Name / Re-apply Protection). Pulls from the existing read-only `api/sheet_sync.js` (GET only, no write-back path anywhere in the script). Cowork live-demoed against a real Google Sheet this session: `syncNow` pulled 19 real NTPC gap rows, a single time-based auto-refresh trigger fires every 10 min without duplicating, and `Range.protect()` locks the synced block to the script owner only (file-owner-can-still-edit is expected Sheets platform behavior, not a bug — a true non-owner reject-test still needs a second test account, flagged as a follow-up before a live audience demo).
No code changes needed on CC's side — files matched the task spec exactly (`ls apps-script/` confirmed both files present, no stray files). Nothing to redeploy: Apps Script isn't part of the Vercel/GitHub Pages pipeline.
Commit: 5e74dc4.

---

## task-046 | 2026-07-04 | DONE
SPA redesign round 2 shipped: Inter/JetBrains Mono site-wide, chat sidebar collapse → 54px icon rail, chat/docs fully namespaced per plant profile (`thermiq_chats_v2__<plant>`, "＋ New plant profile…" in header), upload rebuilt as a draggable floating panel with Plant/Guideline destination toggle and per-file progress dock, document tables replaced with real `.doc-card` grids + in-app viewer modal, hub tiles reworked (gradient surfaces, no side stripes).
Click-tested live against therm-iq.vercel.app (both themes): icon rail collapse/expand, plant switch correctly swaps chats/docs/ticker (NTPC ↔ saraighat, ticker recalculates to ₹0/0 gaps for the empty profile), upload panel drag + Guideline toggle hides doc-type field, Guideline Documents cards show no delete button on seeded CEA docs, Plant Documents cards show delete buttons + dashed-red non-clickable GAP cards, in-app viewer opens with "Open original ↗" + close, light theme renders cleanly. No regressions found.
Commit: 0c1e1d8.

---

## task-040..045 | 2026-07-04 | DONE
Full SPA rebuild shipped: `docs/index.html` is now a true single-page app (hash routing, instrument-panel restyle) covering Hub/Chat/Graph/Guideline Documents/Plant Documents/Live Sheet; old standalone pages are redirect stubs; "Benchmark/Client Plant Sources" renamed to "Guideline/Plant Documents".
Found + fixed a real live bug while click-testing: `initGraphView()` set `shapeProperties: undefined` on non-gap nodes, breaking vis-network's option merge and crashing every graph load ("Cannot read properties of undefined (reading 'borderDashes')") — fixed by only setting the key for gap nodes. Full click-test pass (both themes) against Vercel prod confirmed all 6 views, 4 stub redirects, chat send/new/edit/export, and graph traversal all work correctly with real live data.
Commits: 32752a7 (SPA rebuild), a3dd821 (graph render fix).

---

## task-039 | 2026-07-04 | DONE
Aura instance confirmed **resumed, not gone** (`driver.verify_connectivity()` succeeded on attempt 1 — task-035's NXDOMAIN diagnosis was the paused-instance state, not deletion). Reloaded both slices: boiler 36 nodes/60 edges, turbine 23 nodes/32 edges. `hero_traversal.py` vs `graph_query.js?type=traversal&failure_mode_id=waterwall_tube_thinning` match exactly: PARTIAL, criticality 5, 18 outages, ₹211.85 Cr, same 2 regulations (CEA STS 500MW + IBR Pressure Parts) — the sibling-generalization is confirmed a no-op for this graph. Turbine outage total (5 events) = ₹81.0 Cr exactly, matching task-032's reference figure. **Could not find any "₹22.0 Cr Gadarwara" outage anywhere in the loaded graph, `data/graph_slices/*.json`, or repo** — flagging rather than smoothing over; that reference figure from the task text doesn't correspond to current data.
**Found + fixed a real bug** while testing locally: `graph_query.js`'s `overview` and `traversal` branches ran 3 queries via `Promise.all` on one shared Neo4j session, which the driver rejects ("Queries cannot be run directly on a session with an open transaction") — `gaps` (single query) was unaffected, which is why task-035 never caught it. Fixed with a per-query session helper (`runQueryOwnSession`). Also discovered mid-task that this Vercel project has **no GitHub integration** — `git push` does not trigger a deploy (production was serving a build from 2h earlier despite the push); deployed the fix manually via `vercel --prod` (user-confirmed both the push and the manual deploy, since both were outside the harness's default-allowed actions). Live-verified after redeploy: `?type=gaps` returns the same 9 gaps, `?type=traversal` returns the same numbers as above, both HTTP 200.
Commits: fd38c23 (fix). Manual deploy: `dpl_JooHSuMAuojWYdsB2DuoNYaj4GN1`, aliased to therm-iq.vercel.app.

---

## task-038 | 2026-07-04 | DONE
Built `api/sheet_sync.js` — read-only CSV/JSON mirror for the future Sheets add-on; internal-fetches `api/gap_analysis.js`'s own response and reshapes it, zero duplicated Firestore/scoring logic, GET-only (no write path exists).
Live-verified on production: real CSV rows returned for `client_name=ntpc`.
Commit: 2a4d409

## task-037 | 2026-07-04 | DONE
Document card grid: promoted the existing `.docs-grid-view` CSS class to default view for both benchmark/client tables (toggle still switches to list); `app.js` cross-references `api/gap_analysis` (`coverage_status === 'gap'`, corrected from the task spec's stale `'ABSENT'`/`is_gap` field names) against the doc list and renders flagged "missing document" cards, distinct dashed-red styling, not clickable.
Fixed a real CSS bug where a single-`<td>` gap row inherited `display:flex`/`position:absolute` from the grid view's `:last-child` rule, meant for action buttons.
Commit: d07583c

## task-036 | 2026-07-04 | DONE
Hub landing page + site-wide nav rewire, verified live: tiles render with real ticker numbers from `gap_analysis`/`list_documents`, nav consistent across all 5 pages, anchor deep-links present in `documents.html`.
Did not click-test the interactive upload flow / "coming soon" modal end-to-end against live Vercel (local preview has no backend) — flagged for a follow-up human click-test.
Commit: 52c46c2 (bundled with task-035)

## task-035 | 2026-07-04 | DONE (partially blocked)
Built + shipped `api/graph_query.js` (whitelisted Cypher, no passthrough) and `docs/graph.html` (vis-network viewer); added missing `NEO4J_*` Vercel prod env vars (user-confirmed, since it's a secret-store write).
**Found the real blocker while sanity-checking live:** the Neo4j Aura instance is gone, not paused — `de815806.databases.neo4j.io` is NXDOMAIN. Code is correct and will work once a human provisions a new Aura instance and reruns `load_graph_neo4j.py`; logged as a COWORK_NOTE in BRIDGE.md with full remediation steps.
Commit: 52c46c2

---

## task-034 | 2026-07-04 | DONE
Committed batch of Cowork-verified fixes: `detect_gaps.py` namespaces `risk_scores` by `client_name` (per-client wipe instead of global), `ingest_ocr.py` now writes `documents` collection parity with `ingest_documents.py`, `ingest_document.js` upload size cap corrected to ~4.3MB (matches Vercel's real body limit), `query.js` guards `runGeminiAgentic` against empty/safety-blocked responses, `app.js`/`documents.html` XSS-escape plant names and `source_url` before `innerHTML`.
Hit a stale `.git/index.lock` (2 days old, no live process) — removed before committing.
Commit: 32f89c3

---

## task-032 | 2026-06-29 | DONE
Phase 2 Turbine graph extraction + additive Neo4j load (mirrors Phase 1 boiler pipeline).
5 turbine outages ₹81.0 Cr; 4 gaps (vibration PARTIAL, blade inspection ABSENT, governor valve PARTIAL, lube oil PARTIAL). 23 nodes / 32 edges merged into existing boiler graph.
Commit: 6a5a1c8

---

## task-031 | 2026-06-29 | DONE
Replace broken PowerShell watcher with stdlib Python `watch_bridge.py`; `git rm` watch_bridge.ps1; update CLAUDE.md watcher reference.
Commit: acf332a

---

## task-030 | 2026-06-29 | DONE
Phase 1 spot-check fixes: re-ran boiler extraction (raised max_output_tokens 1024→2048 to fix waterwall regression), all citations now real (no more "Found in: unknown"), gap labels rewritten as "Failure mode → Procedure status", jargon glossary added (SOP/MFT/RFET). Re-loaded Neo4j (36 nodes / 60 edges, idempotent MERGE).
Commit: ca0b7bc

---

## task-029 | 2026-06-29 | DONE  *(dashboard redesign)*
Dashboard readability: plain-language coverage column (dot + label + bar), self-explaining metric chips with (i) tooltips per row, removed raw jargon strings. `node --check` passed.
Commit: 8ba08b4

---

## task-028b | 2026-06-29 | DONE  *(repo cleanup — reuses task-028 number)*
Repo-wide consistency cleanup: `coverage_status` field unified, v2 recompute engine (`recompute_gaps.js`) retired to 410 tombstone, 10 legacy scripts `git rm`'d, dashboard/docs drift fixed, frontend versioned to v0.4.
Commit: 5577dee

---

## task-028 | 2026-06-29 | DONE  *(Neo4j loader)*
Install neo4j driver; load boiler slice (36 nodes / 60 edges) into Neo4j Aura via idempotent MERGE; run hero traversal (waterwall → gap → outages → ₹211.85 Cr → IBR/CEA regulations). Delete plaintext creds file.
Commit: (scripts committed, hero_traversal.py + load_graph_neo4j.py)

---

## task-027 | 2026-06-28 | DONE  *(Phase 1 Boiler graph extraction)*
Run boiler graph extraction harness: fixed qdrant-client 1.18 API (`query_points`), Gemini key rotation + NIM/OpenRouter fallback cascade, `max_output_tokens` 400→1024. Final: 5 gaps (2 ABSENT, 3 PARTIAL), 18 outages ₹211.8 Cr, 36 nodes / 60 edges. Waterwall correctly PARTIAL with RFET citation.
Commit: 67a3b0b

---

## task-027b | 2026-06-28 | DONE  *(demo-safety / key rotation)*
Rotate INGEST_API_KEY (`d15f9ec8…` → `82cc078d…`), update Vercel env, hide Recompute button (v2.0 endpoint would overwrite live v3.0 data).
Commit: 7908742

---

## task-026 | 2026-06-28 | DONE
AI answer style: 150–300 word target, lead with ₹ finding, no filler phrases. Print CSS: force full chat history to render (break out of flex overflow constraints).
Commit: 3f752f9

---

## task-025 | 2026-06-28 | DONE
Chat UX: copy button (all bubbles), edit + rerun (max 3 per message), print transcript button. `callAPI()` helper extracted; `activeEditIdx` state scoped inside `initQueryCopilot`.
Commit: 5b8874b

---

## task-024 | 2026-06-28 | DONE
Gemini key rotation (key × model matrix across `GEMINI_API_KEY/2/3`), NIM fallback tier (`meta/llama-3.3-70b-instruct`), deepseek-r1:free added to OpenRouter cascade, per-model timeouts raised. All 3 Gemini keys + `NIM_API_KEY` added to Vercel.
Commit: 6a8e926

---

## task-023 | 2026-06-28 | DONE
Multi-turn chat: send last-6-message history to backend; Gemini `startChat({ history })` + OpenRouter history prepend. Cycling typing indicator (4-stage text). `max_tokens` 1500→2500 on OpenRouter.
Commit: 0eb1793 + 417fd54

---

## task-022 | 2026-06-27 | DONE
Agentic RAG v2.1: full Gemini cascade (2.5-flash → 2.0-flash → 2.0-flash-lite), 4 function-calling tools, OpenRouter fallback with per-model `AbortController` timeouts. Fixed 5 real bugs post-deploy (503 cascade, dead model IDs, dead OR free models, Vercel 60s cap, Jina/Qdrant missing timeouts).
Multiple commits; final live: HTTP 200 sub-30s on all 3 query types.

---

## task-021 | 2026-06-27 | DONE
Backfill Firestore `documents` records for IPS2025 (120 chunks) + BMD-32 (3 chunks); update `ingest_documents.py` to write `documents` collection on every future run.
Commit: d6a220e

---

## task-020 | 2026-06-27 | DONE
Client namespacing: per-plant gap scoring, plant selector UI (dashboard + documents pages), `clear_client` endpoint (Qdrant + Firestore wipe for one plant). In-place migration: 19 records renamed `ntpc__<gap>`, ₹416.4 Cr preserved. Netlify hole closed (user deleted Netlify team → dead endpoint now 404s).
Commit: 047e419

---

## task-019 | 2026-06-27 | DONE  *(Phase 1 only; Phase 2 = task-020)*
Benchmark upload lockdown: web endpoint now client-only (403 on `source_type=benchmark`), benchmark radio removed from `documents.html`, `x-allow-benchmark` bypass header added for local scripting. Verified live: 403 on benchmark POST, 200 on client POST.
Commit: f63529f

---

## task-018 | 2026-06-26 | DONE
Ingest IPS2025 (120 chunks) + BMD-32 (3 chunks) as `client=ntpc`; `patch_source_type.py` → 1312 points patched; `detect_gaps.py` rerun → 7 gaps shifted GAP→PARTIAL, total risk ₹503.9→₹416.4 Cr. (BMD-01 failed DNS, skipped.)
Commit: 5793709 (.gitignore only; PDFs correctly gitignored)

---

## task-017 | 2026-06-26 | DONE
`detect_gaps.py` v3.0 rewrite: criticality 1–5 (sourced to CEA/Vasudha data), consequence from actual CEA outage records, 19 gaps (added `flame_failure_response_sop`), every gap stores citations. Dashboard: "/5 [sourced]" badge, expandable "▶ sources" panel per row. Reran: 19 GAPs, ₹503.9 Cr.
Commit: 15edc34

---

## task-016 | 2026-06-26 | DONE
Gap-intent detection in `query.js`: keyword detector → parallel Firestore `risk_scores` fetch → `[Gap Analysis: ThermIQ Risk Registry]` context injection, bypasses confidence floor. Verified: gap question returns 18 records, normal doc question unaffected.
Commit: e5da5f6

---

## task-015 | 2026-06-26 | DONE
Benchmark-vs-client RAG rework: `source_type` tagging on all chunks/docs, client-filtered gap detection, confidence floor 0.50, labelled source retrieval `[Benchmark]`/`[Client]`, documents page split. Created Qdrant payload indexes (`source_type`, `client_name`) — without these, filtered searches silently returned all-GAP defaults. Reran detect_gaps: 18 gaps, ₹908.6 Cr.
Commit: e808dac

---

## task-014 | 2026-06-26 | DONE
Vercel migration (Netlify billing exhausted): 8 `api/*.js` Vercel functions + `vercel.json` + root `package.json`. Added `"outputDirectory": "docs"` after build succeeded but root 404'd. Frontend `BACKEND` constant updated to `https://therm-iq.vercel.app`.
Commits: 0c35cdc + 98c2afe

---

## task-013 | 2026-06-26 | DONE  *(no standard task header — inline request)*
Full DB rebuild: wiped 1209 Qdrant points + 6 Firestore docs + 18 risk_scores. Reingested 6 source docs (1189 chunks total). Fixed real bugs in `ingest_documents.py`/`ingest_ocr.py` (timeout, duplicate-point, Jina 429 retry, Windows tesseract/poppler paths). Ran `detect_gaps.py`: 18 records, ₹604.5 Cr. Diagnosed Netlify billing freeze (every build silently skipped since `4f2797a`).
Commit: e304176

---

## task-012 | 2026-06-26 | DONE
Delete document endpoint (`delete_document.js`) + UI (trash button per row, colspan 8). `sync_qdrant_to_documents.py` seeded 1 orphaned doc (`6a38ce305640d ET AI Hackathon 2026 Problem Statements`, 16 chunks).
Commit: b08dc3a

---

## task-011 | 2026-06-26 | DONE
Documents tab (`documents.html`): upload form + doc list. Client selector in query copilot. Gap dashboard locked with overlay (unlock via Documents). `list_documents.js` Netlify function. Cleared seeded `risk_scores`, seeded `documents` collection with 6 real records.
Commit: 88dd104

---

## task-010 | 2026-06-25 | DONE
OCR ingestion pipeline (`ingest_ocr.py`): pdf2image + tesseract. Ingested Kahalgaon (58 chunks, 196s) + Lara (106 chunks, 518s) tariff PDFs. Total Qdrant: 1193 points. Installed tesseract + poppler on Windows via winget.
Commit: 2ac5f9b

---

## task-009 | 2026-06-25 | SUPERSEDED
Replaced by task-010 (OCR approach confirmed working; no need for alternative text-based downloads).

---

## task-008 | 2026-06-25 | DONE
MW→kWh revenue formula fix (×1000 correction). Added `client` field to `ingest_documents.py`. Downloaded + ingested 3 CEA PDFs (108 chunks). NTPC tariff PDFs confirmed scanned → 0 chunks (triggered task-010). Real CEA fetch: 59 outage records written after schema rewrite for actual dgr10 `.xls` format.
Commit: (scripts only — revenue formula fix)

---

## task-007 | 2026-06-25 | DONE
Replace `pdf-parse` (broken on Netlify esbuild) with `pdfjs-dist@3` (CJS legacy build). Fix CEA URL scheme. End-to-end ingest test: 200, 2 chunks indexed, cleaned up afterward.
Commit: 9e69e45

---

## task-006 | 2026-06-25 | DONE  *(superseded by task-007)*
Diagnosed `pdf-parse` `FormatError: bad XRef entry` on Netlify (local works, deployed breaks — esbuild bundler interaction). Auth gate confirmed working (401/401). Root cause and fix landed in task-007.

---

## task-005 | 2026-06-25 | DONE
Document upload endpoint (`ingest_document.js`): pdf-parse → chunk → Jina embed → Qdrant upsert → Firestore meta. Auth gate added (`X-Ingest-Key`). CEA outage fetch: real npp.gov.in URL stale → seeded 25 placeholder records (`source: "sample_seed"`).
Commit: e6bd6a9

---

## task-004 | 2026-06-25 | DONE
UI/UX overhaul: dark/light theme system, glassmorphism header, chat history sidebar (multi-chat with auto-titling), `thermiq_chats_v2` localStorage schema with v1 migration, mobile responsive sidebar.
Commit: (single commit, all 4 frontend files)

---

## task-003 | 2026-06-25 | DONE
Chat UI rewrite: scrollable bubbles, localStorage history, typing indicator, auto-resize textarea. Re-added DOMPurify sanitization around `marked.parse()` (Cowork's rewrite had dropped it).
Commit: (with DOMPurify fix)

---

## task-002 | 2026-06-25 | DONE
OpenRouter fallback (`claude-3-5-haiku` → later `meta-llama/llama-3.3-70b-instruct:free`) when Gemini throttles. Netlify MCP env-var write confirmed unreliable (must verify via `env:list` or live test, not just tool return value).
Commit: (query.js + .env.example)

---

## task-001 | 2026-06-25 | DONE
Initial bridge setup: marked.js markdown rendering, 250-word answer limit, BRIDGE.md + CLAUDE.md + watch_bridge.ps1 created. Flagged `innerHTML` + `marked.parse()` XSS risk (addressed in task-003).
Commit: (6 files, first push)

---

*Log initialized by Cowork on 2026-06-30 during BRIDGE.md restructure.*
