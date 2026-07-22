# Prompt for Cowork — build the ThermIQ pitch deck

You are helping me build the **Presentation Deck** deliverable for the ET AI Hackathon 2026 submission. The working folder is my ThermIQ project. Before writing a single slide, do the analysis below — do not assume you know the project, read it.

## Step 1 — Understand the problem we're solving
- Read `Competition brief.pdf` in the project root. We are **Problem #8: "AI for Industrial Knowledge Intelligence: Unified Asset & Operations Brain."** Read that section in full: the problem context, the challenge statement, "what you may build," suggested technologies, expected deliverables, evaluation focus, and the judging criteria weights (Innovation 25%, Business Impact 25%, Technical Excellence 20%, Scalability 15%, User Experience 15%).
- The deck must visibly map our solution back to what this problem statement asked for.

## Step 2 — Understand what we actually built
Read these to reconstruct the real solution, its logic, and its current state (do not invent features):
- `STATUS.md` — the latest ground-truth status of what is shipped and live.
- `CLAUDE.md` — tech stack, live URLs, architecture, the core risk formula.
- `README.md` — the risk formula and data sources in plain terms.
- `LOG.md` — the build history (how the solution evolved, what problems were solved).
- `ThermIQ_Architecture.svg` — the finished architecture diagram; use it (or a screenshot of it) as the architecture slide.
- Skim the code so the deck is accurate: `api/*.js` (the live backend — query.js is the RAG orchestrator with a Jina → Qdrant → Gemini → NIM → OpenRouter fallback chain), `scripts/detect_gaps.py` (the canonical gap-scoring engine), and `docs/` (the frontend SPA: Query Copilot, Risk Dashboard, Knowledge Graph, Documents, Live Sheet).

## Step 3 — Honesty guardrails (important to me)
- Use **only real, live numbers.** The live gap-scoring engine is **v3 (`scripts/detect_gaps.py`)**, which produces **₹416.4 Cr** total risk for the `ntpc` plant across 19 gaps. `detect_gaps_v4.py` exists but is **not live** — do NOT present its dry-run figures (e.g. ₹2,223 Cr) as our headline.
- No fabricated metrics, fake benchmarks, or invented accuracy percentages. Where we don't have a measured number, describe the capability qualitatively rather than inventing a statistic.
- The core value proposition is: **quantify knowledge gaps as ₹ crore operational risk**, using the formula `risk_score_cr = criticality (1–5) × consequence (₹ Cr, from real CEA outage data) × exposure (0–1, corpus coverage gap)`. Explain the logic of each term.
- It's a research-preview prototype, not a shipped enterprise product — frame it as such, confidently but truthfully.

## Step 4 — Build the deck
Suggested flow (adjust as the content warrants), roughly 10–14 slides:
1. Title — ThermIQ, one-line positioning, my name (YC, IIM Amritsar), Problem #8.
2. The problem — the knowledge-fragmentation / retiring-workforce pain, using the brief's framing and stats.
3. Our thesis — turn scattered plant documents into a queryable, ₹-quantified operational brain.
4. Solution overview — the three layers: RAG Query Copilot, Knowledge-Gap Detection, Risk Quantification Dashboard (+ Knowledge Graph).
5. Live demo screenshots / walkthrough (leave placeholders if you can't capture them).
6. Architecture — use `ThermIQ_Architecture.svg`.
7. The risk model — explain the formula and why each factor is grounded in real data (CEA outages, CEA/CERC benchmarks).
8. Knowledge graph — failure modes → outages → equipment → regulations.
9. Why it's innovative / technically strong (map to the judging criteria).
10. Business impact & scalability — per-plant namespacing, benchmark-vs-client design, multi-plant.
11. What's real today vs. roadmap (honest).
12. Closing — links (live app, GitHub) and ask.

## Step 5 — Format
- **Use Canva if a Canva connector/tool is available** — search for it first and, if present, build the deck there so I get an editable, well-designed result. If Canva isn't available, fall back to a `.pptx` via the pptx skill (or a polished HTML deck), and tell me which you used and why.
- Match the architecture diagram's clean, light, professional style — muted palette, strong typography, minimal text per slide, one idea per slide.
- Save the final file into the project folder and show it to me.

Before you start building slides, briefly confirm your understanding of the problem and our solution back to me, then proceed.
