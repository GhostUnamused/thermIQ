# ThermIQ — Completed Task Log

> Archive of all completed bridge tasks. **CC does not read this on startup** — it's for human reference only.
> Format per entry: task ID | date | one-line description | key outcome | commit hash (if any).

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
