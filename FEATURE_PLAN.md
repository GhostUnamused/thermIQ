# ThermIQ — Feature Plan (final sprint, July 11–20)

Prioritized spec for the 8 agreed features. Effort in Cowork+CC sessions (1 session ≈ one BRIDGE task cycle incl. test + deploy). Plant-vs-plant comparison dropped (would raise multi-tenant auth questions the demo model deliberately avoids).

---

## Tier 1 — Demo wow (build first)

### 1. What-if Simulator
**What:** On the dashboard, each gap row gets a "Simulate fix" toggle. Toggling marks the gap as documented → headline ₹ Cr exposure recalculates live, with a delta badge ("−₹42.3 Cr if closed"). A summary strip shows "Closing top 3 gaps removes ₹X Cr of exposure."
**Why:** Turns the registry into a decision tool; the before/after ₹ number is the single best 10-second demo moment.
**How:** Pure client-side in `docs/app.js` — re-run `criticality × consequence × exposure` with `coverage_status` overridden to `covered`. No backend change, no Firestore write. Reset button restores real state; simulated state clearly labeled "SIMULATION" so it never looks like real data.
**Effort:** 1 session. **Risk:** low.

### 2. Chat ↔ Graph linking
**What:** (a) When a chat answer mentions a known failure mode / gap topic, append a "View in graph →" chip that opens the Graph view focused on that node. (b) Clicking a graph node shows a mini panel with gap status + ₹ figure + "Ask ThermIQ about this" button that pre-fills a chat question.
**Why:** Ties the two hero features into one narrative loop instead of two separate tabs.
**How:** Frontend-only. Keyword-match answer text against the 19 gap `topic` strings (already fetched for the ticker). Graph deep-link via hash param (`#graph?focus=<failure_mode_id>`); `initGraphView()` already loads nodes, add `network.focus()` + `selectNodes()`. Node-click panel uses existing `graph_query.js?type=traversal` data.
**Effort:** 1–2 sessions. **Risk:** low-medium (vis-network focus/param plumbing; graph view had fragile option-merge history — regression-test node render).

---

## Tier 2 — Demo safety (build second)

### 3. Demo / onboarding mode
**What:** First visit to the Hub triggers a 4-step overlay tour: Hub tiles → ask a sample question (one-click chips already exist) → dashboard gap row + simulate → graph traversal. Re-launchable via a "?" button. Optional `?demo=1` URL to force it for judges.
**Why:** Judges land cold; prevents the blank-stare minute and scripts your own walkthrough.
**How:** Lightweight hand-rolled overlay in `app.js` (no library — avoid new deps): positioned tooltip cards keyed to element selectors, `localStorage` flag `thermiq_tour_done`. Steps skip gracefully if a target element is missing (e.g., empty plant profile).
**Effort:** 1 session. **Risk:** low.

### 4. Ingest status feedback
**What:** Doc cards show a lifecycle badge: `Uploading → Indexing → Ready (N chunks)` for direct uploads; `Queued (GitHub Action) → Indexing → Ready` for Drive-link ingests. Chat input shows a subtle "1 document still indexing" note while pending.
**Why:** Drive-link ingest (task-055a) is async via GH Action — right now users get zero signal when a doc becomes queryable. Kills the "did my upload work?" anxiety live on stage.
**How:** Poll `api/list_documents` every ~10s while any doc is pending; the drive-ingest workflow already writes the Firestore `documents` record on completion, so appearance in the list = Ready. For richer state, add a `status` field written at dispatch time by `api/ingest_drive.js` (`queued`) and flipped by `scripts/ingest_from_drive.py` (`ready`) — small backend touch.
**Effort:** 1–2 sessions (1 if polling-only, 2 with the `status` field). **Risk:** low.

### 5. Empty states
**What:** A fresh plant profile currently shows ₹0 / empty tables. Replace with purposeful empty states: dashboard → "No gap scan yet for this plant — upload a document or run a scan" with CTA buttons; docs view → drop-zone invitation; chat → sample-question chips scoped to "no plant docs yet".
**Why:** The "＋ New plant profile" flow is part of the pitch (any plant can onboard); an empty screen undercuts it.
**How:** Frontend-only conditionals in `app.js` render paths where row count = 0. Reuse existing upload-panel and suggestion-chip components.
**Effort:** 0.5–1 session. **Risk:** low.

---

## Tier 3 — Depth & trust (build if Tier 1–2 land by ~July 16)

### 6. Gap remediation kit
**What:** Each gap row gets "Generate action plan": Gemini drafts a 1-page SOP outline / remediation checklist grounded in the benchmark docs (CEA/IBR chunks for that topic), rendered in a modal with "Download PDF" (reuse the task-054 print-window pattern).
**Why:** Moves the pitch from "we found gaps" to "we help close them" — the strongest answer to "so what does the plant do next?"
**How:** New `api/remediate.js` (or a mode flag on `api/query.js` to reuse the whole fallback cascade): retrieve top-k benchmark chunks filtered by gap topic, prompt for a structured checklist, return markdown. Cache result in `localStorage` per gap to avoid burning Gemini quota on repeat clicks.
**Effort:** 2 sessions. **Risk:** medium (LLM output quality needs prompt iteration; quota use).

### 7. Clickable citations
**What:** Chat answers currently cite `[Benchmark]`/`[Client]` labels as dead text. Make each citation a link that opens the in-app viewer (task-046 modal) at the source document; uploads stored in `docs/uploads/` since task-055a open directly.
**Why:** Verifiability on stage — "don't trust it, click it."
**How:** `api/query.js` already knows chunk payloads (doc name, source_url); return a `sources[]` array alongside the answer, render as chips under the bubble wired to the existing viewer modal. Benchmark docs without a stored PDF fall back to `source_url`. Page-level deep-linking is out of scope (chunk → page mapping not stored).
**Effort:** 1–2 sessions. **Risk:** medium (touches query.js response shape — regression-test all three query types).

### 8. Answer honesty badges
**What:** Small metadata line under each answer: "Grounded in N chunks · M from your plant docs", plus a warning tag "⚠ Answered from benchmark guidelines only — no plant-specific document found" when zero client chunks retrieved.
**Why:** Preempts the hallucination question every judge asks an RAG product; cheap credibility.
**How:** Piggybacks on #7's `sources[]` array (counts + source_type split). If built together, marginal cost is near zero — bundle into the same BRIDGE task.
**Effort:** 0.5 session (bundled with #7). **Risk:** low.

---

## Suggested schedule (9 days)

| Days | Build |
|---|---|
| Jul 11–13 | #1 What-if simulator, #2 Chat↔Graph |
| Jul 13–15 | #3 Demo tour, #4 Ingest status, #5 Empty states |
| Jul 15–17 | #7 Citations + #8 Honesty badges (one task), #6 Remediation kit |
| Jul 18–20 | Freeze. Full click-test both themes, verify Vercel deploy manually (`vercel --prod` — push alone does NOT deploy), rehearse demo script |

**Cut order if time runs out:** #6 first, then #7/#8, then #4. Never cut #1 or #3.

**Standing cautions:** every deploy needs manual `vercel --prod` verification; the pending live click-tests from tasks 054/055a/055b should be cleared before stacking new features on top.
