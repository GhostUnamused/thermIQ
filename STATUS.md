# ThermIQ — Status Update

**This update:** 2026-07-18
**Previous status snapshot:** 2026-07-04 (superseded — described a pre-SPA, pre-graph-viewer state)
**Deadline:** ~July 20, 2026 (~2 days out)

---

## What's changed since the 2026-07-04 update

**1. Frontend is now a true SPA.** `docs/index.html` was rebuilt as a hash-routed single-page app (`#/chat`, `#/graph`, `#/guideline`, `#/plant`, `#/sheet`) with an instrument-panel restyle (Space Grotesk/IBM Plex Mono, teal+amber accents) and a single global header ticker + plant selector. Old standalone pages (`chat.html`, `graph.html`, `documents.html`, `dashboard.html`) are now redirect stubs. Two rounds of polish shipped after (task-046 redesign round 2, task-058/059 demo tour + typography + plant dropdown).

**2. Knowledge graph now has a web-facing layer.** This was the biggest gap flagged in the 2026-07-04 update ("no frontend graph view exists") — it's built, live, and click-tested. `api/graph_query.js` (whitelisted Cypher, no raw passthrough) + `#/graph` view render 58 nodes/92 edges via vis-network; clicking a flagged FailureMode shows the real ₹ traversal (outage rows, criticality, mandating regulations). Neo4j Aura auto-pause was hit once (task-035/039) and resolved; a keep-alive GitHub Action (`neo4j-keepalive.yml`) now runs daily to prevent recurrence.

**3. Gap-scoring pipeline matured through several rounds of YC pushback.**
- task-048/049: automated the "new plant has zero gap scores" failure mode — gap scans now auto-trigger from the frontend the moment an unscored plant's tab is viewed (`api/trigger_gap_scan.js` dispatches a GitHub Action), no manual `detect_gaps.py` run needed.
- task-051: fixed a real correctness issue YC caught — the dashboard's "Total Risk Exposure" was blending real CEA-outage-backed numbers with flat assumed-default guesses. Now only `linked_outages > 0` rows count toward the headline ₹ figure; unquantifiable/undocumented topics get an "Documentation Needed" prompt instead of a fabricated price.
- **task-064 (2026-07-18, today):** validated a rewritten engine, `scripts/detect_gaps_v4.py` — per-item (not per-tag-averaged) consequence, Gemini-adjudicated coverage with cited quotes, A/B/C evidence grading, failure/regulatory tranche split. Dry-run against `ntpc`: 3A/9B/7C grades, 18/19 items got live LLM adjudication, 9/17 flagged for consequence divergence >2.5× (2 large outliers: generator_stator_winding, turbine_blade_inspection). Failure-tranche total ₹2,223.3 Cr vs v3's ₹416.4 Cr headline — real jump, not a bug, but the 2 outlier items need a human MW/MTTR sanity check before this ships. **v3 remains the live engine; v4 is committed but unreferenced by any reader.**

**4. Live Sheet went through two redesigns and landed on a browser-only Excel export.** The original Apps Script Google Sheet (task-047/050) had a "Restricted" sharing setting that YC couldn't get judges past, and only ever showed one hardcoded plant. **task-063 (2026-07-12)** replaced it entirely: "Download Excel (.xlsx)" now generates a themed, per-plant workbook client-side via ExcelJS (lazy CDN load) — no Google account, no OAuth, no new Vercel function, no sharing-permission dependency. `apps-script/Code.gs` is deprecated but left for reference.

**5. Document upload pipeline hardened further.** Document-viewing screens are now a card grid (task-037) instead of tables, with gap-flagged "no document" cards cross-referenced against `coverage_status: 'gap'`. CEA outages ingest, gap-scan trigger, and Neo4j keep-alive are all now scheduled/event-driven GitHub Actions rather than manual scripts.

**6. Repo hygiene.** `api/recompute_gaps.js` twin retired long ago; Netlify's entire team was deleted 2026-06-27 — Vercel is now the sole live backend (`netlify/functions/` is archival dead code, do not edit expecting it to deploy).

**7. Bridge queue is empty.** No `[PENDING]` or `[IN_PROGRESS]` tasks — Claude Code is caught up through commit `56c2c4e`.

---

## Open items carried over (still true, still unresolved)

- **BMD-01** (boiler pressure parts spec) still not ingested — `vendor.ntpc.co.in` doesn't resolve from any sandboxed network; needs a retry from YC's own local machine outside any sandbox.
- **Google Sheet sharing** (if YC still wants the old Apps Script sheet reachable for anyone) remains "Restricted" — moot now that task-063 replaced it as the primary path, but the old sheet/script is still there if wanted later.
- **detect_gaps_v4.py swap-in decision** — needs YC to review the 2 consequence-divergence outliers (stator winding, turbine blade) before this becomes the new live scoring engine. If it ships, `docs/app.js`'s `initDashboard()` quantified/needsDocs split (task-051) must be updated to use v4's tranche/`evidence_grade` fields instead of `linked_outages`.
- **GITHUB_DISPATCH_TOKEN** (task-049) — needed for the auto-gap-scan trigger to fire from Vercel; confirm it's set in Vercel prod if new plants are still being onboarded before the deadline.
- Working tree periodically shows `data/chunks/*.json` / `data/graph_slices/*` as modified — confirmed pure CRLF churn in task-034, not real content changes; don't `git add -A` blindly, use explicit file lists (see BRIDGE.md task history for precedent).

---

## Suggested next move

With ~2 days to the deadline, the highest-leverage remaining decision is **task-064's swap-in**: review the two consequence-divergence outliers with YC, decide whether v4 ships before the deadline or v3 stays for the demo. Everything else (SPA, graph viewer, Excel export, gap-scan automation) is built, live, and click-tested — this is the one open architectural decision left.
