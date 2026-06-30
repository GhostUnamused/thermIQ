"""
ThermIQ Phase 2 — Turbine Vertical Slice Extraction
====================================================
Pulls Turbine-relevant chunks from Qdrant, classifies each expected procedure
as EXISTS / PARTIAL / ABSENT using Gemini (with NIM/OpenRouter fallback), then
builds a knowledge graph JSON and a human-readable review report for the
spot-check gate.

This mirrors extract_boiler_graph.py (Phase 1) — same proven LLM machinery
(Gemini key rotation + NIM/OpenRouter cascade) — but for the Turbine family.

OUTPUTS (both in data/graph_slices/):
  turbine_slice.json   — machine-readable graph (nodes + edges), ready for Neo4j
  turbine_review.md    — plain-English summary for YC's spot-check gate

USAGE:
  python scripts/extract_turbine_graph.py            # live run (uses Gemini + Qdrant)
  python scripts/extract_turbine_graph.py --dry-run  # no API calls, tests the pipeline only

DEPENDENCY INSTALL (if needed):
  pip install qdrant-client google-generativeai firebase-admin requests python-dotenv
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

# ─── Environment ──────────────────────────────────────────────────────────────
JINA_API_KEY          = os.environ.get("JINA_API_KEY", "")
QDRANT_URL            = os.environ.get("QDRANT_URL", "")
QDRANT_API_KEY        = os.environ.get("QDRANT_API_KEY", "")
GEMINI_API_KEY        = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_KEY2       = os.environ.get("GEMINI_API_KEY2", "")
GEMINI_API_KEY3       = os.environ.get("GEMINI_API_KEY3", "")
NIM_API_KEY           = os.environ.get("NIM_API_KEY", "")
OPENROUTER_API_KEY    = os.environ.get("OPENROUTER_API_KEY", "")
FIREBASE_PROJECT_ID   = os.environ.get("FIREBASE_PROJECT_ID", "")
FIREBASE_PRIVATE_KEY  = os.environ.get("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
FIREBASE_CLIENT_EMAIL = os.environ.get("FIREBASE_CLIENT_EMAIL", "")

COLLECTION_NAME = "thermiq_chunks"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "graph_slices"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── Import ontology ──────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from graph_ontology import (
    TURBINE_EQUIPMENT,
    TURBINE_FAILURE_MODES,
    TURBINE_PROCEDURES,
    TURBINE_REGULATIONS,
)

TURBINE_PARENT = "steam_turbine_500mw"

# Maps a CEA outage failure_category to the most specific Turbine failure mode.
# Anything unrecognised falls back to high vibration (the catch-all trip cause).
CEA_CATEGORY_TO_FM = {
    "vibration": "turbine_high_vibration",
    "blade_damage": "turbine_blade_damage",
}
DEFAULT_FM = "turbine_high_vibration"

# ─── Gemini client (with key rotation) ───────────────────────────────────────
class GeminiKeyRotator:
    """Holds the active Gemini key/model and can rotate to the next key
    on quota exhaustion, instead of being locked to one key for the run."""

    def __init__(self, keys):
        self.keys = [k for k in keys if k]
        if not self.keys:
            raise RuntimeError(
                "All Gemini keys exhausted or missing. "
                "Run with --dry-run to test the pipeline without API calls."
            )
        self.idx = -1
        self.exhausted = False
        self._advance_to_working_key()

    def _configure(self):
        import google.generativeai as genai
        genai.configure(api_key=self.keys[self.idx])
        self.model = genai.GenerativeModel("gemini-2.5-flash")

    def _advance_to_working_key(self):
        """From the current position, try each remaining key with a cheap
        probe call until one works (used at startup)."""
        import google.generativeai as genai
        while self.idx + 1 < len(self.keys):
            self.idx += 1
            try:
                self._configure()
                self.model.generate_content("ping", generation_config={"max_output_tokens": 5})
                print(f"  Gemini key active: ...{self.keys[self.idx][-6:]}")
                return
            except Exception as e:
                if "quota" in str(e).lower() or "429" in str(e):
                    print(f"  Key ...{self.keys[self.idx][-6:]} quota exhausted, trying next...")
                else:
                    raise
        raise RuntimeError(
            "All Gemini keys exhausted or missing. "
            "Run with --dry-run to test the pipeline without API calls."
        )

    def rotate(self):
        """Switch to the next key. Returns False if none remain."""
        if self.idx + 1 >= len(self.keys):
            self.exhausted = True
            return False
        self.idx += 1
        self._configure()
        print(f"  Rotated to Gemini key ...{self.keys[self.idx][-6:]}")
        return True

    def generate_content(self, *args, **kwargs):
        return self.model.generate_content(*args, **kwargs)

# ─── Qdrant client ────────────────────────────────────────────────────────────
def get_qdrant():
    from qdrant_client import QdrantClient
    return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)

# ─── Firestore client ─────────────────────────────────────────────────────────
def get_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore
    try:
        app = firebase_admin.get_app("graph_extract")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": FIREBASE_PROJECT_ID,
            "private_key": FIREBASE_PRIVATE_KEY,
            "client_email": FIREBASE_CLIENT_EMAIL,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="graph_extract")
    return firestore.client(app=app)

# ─── Jina embedding ───────────────────────────────────────────────────────────
def embed_query(text):
    import requests as req
    r = req.post(
        "https://api.jina.ai/v1/embeddings",
        headers={
            "Authorization": f"Bearer {JINA_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "input": [text],
            "model": "jina-embeddings-v3",
            "task": "retrieval.query",
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]

# ─── LLM fallback cascade (Gemini exhausted → NIM → OpenRouter free tier) ──────
OPENROUTER_FALLBACK_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free",
    "nvidia/nemotron-nano-9b-v2:free",
]

def call_nim(prompt, timeout=20):
    import requests as req
    if not NIM_API_KEY:
        raise RuntimeError("NIM_API_KEY not configured")
    r = req.post(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {NIM_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "meta/llama-3.3-70b-instruct",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 1024,
        },
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def call_openrouter(prompt, timeout=18):
    import requests as req
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    last_err = None
    for model in OPENROUTER_FALLBACK_MODELS:
        try:
            r = req.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://ghostunamused.github.io/thermIQ",
                    "X-Title": "ThermIQ",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 1024,
                },
                timeout=timeout,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"all OpenRouter models failed: {last_err}")

def call_llm_fallback_cascade(prompt):
    """Gemini's keys are all exhausted — try NIM, then OpenRouter free models."""
    try:
        return call_nim(prompt), "NIM (llama-3.3-70b)"
    except Exception as e:
        print(f"    ⚠  NIM failed ({str(e)[:60]}), trying OpenRouter...")
    raw = call_openrouter(prompt)
    return raw, "OpenRouter"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Pull Turbine chunks from Qdrant
# ══════════════════════════════════════════════════════════════════════════════

def pull_turbine_chunks(qdrant, top_k=8):
    """For each Turbine procedure, run its search query against Qdrant
    and collect the most relevant chunks. Returns { procedure_id: [chunk, ...] }."""
    print("\n[1/4] Pulling Turbine chunks from Qdrant...")
    results_by_proc = {}

    for proc_id, proc in TURBINE_PROCEDURES.items():
        print(f"  Searching for: {proc['label'][:55]}...")
        vec = embed_query(proc["qdrant_query"])

        hits = qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=vec,
            limit=top_k,
            with_payload=True,
        ).points
        chunks = []
        for hit in hits:
            payload = hit.payload or {}
            chunks.append({
                "id": str(hit.id),
                "score": round(hit.score, 4),
                "text": payload.get("text", ""),
                # Both ingest paths store the doc name in "source_doc".
                "source": payload.get(
                    "source_doc",
                    payload.get("source_name",
                    payload.get("doc_name", payload.get("filename", "unknown")))
                ),
                "source_type": payload.get("source_type", "unknown"),
                "client_name": payload.get("client_name", ""),
                "page": payload.get("page_num", payload.get("page", "")),
            })

        results_by_proc[proc_id] = chunks
        top_score = chunks[0]["score"] if chunks else "n/a"
        print(f"    → {len(chunks)} chunks | top similarity: {top_score}")
        time.sleep(0.4)  # stay within Jina rate limits

    return results_by_proc


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Pull Turbine CEA outage events from Firestore
# ══════════════════════════════════════════════════════════════════════════════

def pull_turbine_outages(db):
    """Fetch all outage events tagged equipment_tag='Turbine' from Firestore."""
    print("\n[2/4] Pulling Turbine outage events from Firestore...")
    snap = db.collection("cea_outages").where("equipment_tag", "==", "Turbine").get()

    outages = []
    for doc in snap:
        d = doc.to_dict()
        outages.append({
            "event_id": doc.id,
            "station": d.get("station", ""),
            "unit": d.get("unit", ""),
            "mw_lost": d.get("mw_lost", 0),
            "date_out": d.get("date_out", ""),
            "outage_hours": round(d.get("outage_hours", 0), 1),
            "revenue_lost_est_cr": round(d.get("revenue_lost_est_cr", 0), 2),
            "failure_reason_raw": d.get("failure_reason_raw", ""),
            "failure_category": d.get("failure_category", "unclassified"),
        })

    total_cr = sum(o["revenue_lost_est_cr"] for o in outages)
    avg_cr = total_cr / len(outages) if outages else 0
    print(f"  → {len(outages)} Turbine outage events found")
    print(f"  → Total ₹ impact: {total_cr:.1f} Cr  |  Avg per event: {avg_cr:.1f} Cr")
    return outages


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Classify each procedure via Gemini (NIM/OpenRouter fallback)
# ══════════════════════════════════════════════════════════════════════════════

EXTRACTION_PROMPT = """\
You are a knowledge engineer building a graph for an Indian thermal power plant.

I will give you a passage from a technical document and one specific question.
Your job: classify whether the passage contains an actual documented procedure for the topic.

DOCUMENT: {source} ({source_type} document)
---
{text}
---

QUESTION: Does this passage contain a formal, actionable procedure or SOP for:
"{procedure_label}"

A REAL PROCEDURE means: there are actual steps an operator or technician could follow
(numbered steps, acceptance criteria, specific thresholds, decision points, etc.).
A TOPIC MENTION means: the procedure is referenced or discussed but the actual steps
are not given in this passage.

Respond with ONLY valid JSON (no markdown fences, no commentary):
{{
  "status": "EXISTS" | "PARTIAL" | "ABSENT" | "NOT_RELEVANT",
  "evidence_quote": "<exact quote from the text, max 150 chars, or null>",
  "key_details": ["specific threshold or step found, e.g. '250 micron trip limit'", "..."],
  "what_is_missing": "<if PARTIAL: the specific element absent, e.g. 'no trip threshold given'; if EXISTS/ABSENT: null>"
}}

Status definitions:
  EXISTS      — actual procedure steps are present; an operator could follow them
  PARTIAL     — topic is discussed but key elements (steps, thresholds, criteria) are absent
  ABSENT      — topic is not mentioned in this passage at all
  NOT_RELEVANT — passage is unrelated to this procedure topic
"""


def _parse_classification_json(raw):
    """Strip markdown fences (if a model ignores instructions) and parse JSON."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def classify_procedure(gemini, proc_id, proc, chunks):
    """Send the top-3 most relevant chunks to an LLM one at a time, cascading
    Gemini (all keys) -> NIM -> OpenRouter free models if Gemini is exhausted."""
    STATUS_RANK = {"EXISTS": 4, "PARTIAL": 3, "ABSENT": 2, "NOT_RELEVANT": 1}
    evidence_items = []
    best_status = "ABSENT"

    for chunk in chunks[:3]:
        if not chunk["text"].strip():
            continue

        prompt = EXTRACTION_PROMPT.format(
            source=chunk["source"],
            source_type=chunk["source_type"],
            text=chunk["text"][:2500],
            procedure_label=proc["label"],
        )

        raw = None
        model_used = "gemini-2.5-flash"

        if not gemini.exhausted:
            for attempt in range(3):
                try:
                    response = gemini.generate_content(
                        prompt,
                        generation_config={"max_output_tokens": 2048},
                    )
                    raw = response.text.strip()
                    break
                except Exception as e:
                    msg = str(e)
                    if "quota" in msg.lower() or "429" in msg:
                        if gemini.rotate():
                            print(f"    ⚠  Quota hit on attempt {attempt + 1}, rotated key, retrying...")
                        else:
                            print("    ⚠  All Gemini keys exhausted — falling back to NIM/OpenRouter")
                            break
                    else:
                        print(f"    ⚠  Gemini error: {msg[:80]}")
                        break

        if raw is None:
            try:
                raw, model_used = call_llm_fallback_cascade(prompt)
            except Exception as e:
                print(f"    ⚠  Fallback cascade failed for {proc_id} / chunk {chunk['id']}: {str(e)[:80]}")
                time.sleep(1.2)
                continue

        try:
            result = _parse_classification_json(raw)
        except json.JSONDecodeError:
            print(f"    ⚠  JSON parse failed for {proc_id} / chunk {chunk['id']} (via {model_used})")
            time.sleep(1.2)
            continue

        status = result.get("status", "NOT_RELEVANT")
        if STATUS_RANK.get(status, 0) > STATUS_RANK.get(best_status, 0):
            best_status = status

        if status in ("EXISTS", "PARTIAL"):
            evidence_items.append({
                "source": chunk["source"],
                "source_type": chunk["source_type"],
                "similarity_score": chunk["score"],
                "status": status,
                "quote": result.get("evidence_quote"),
                "key_details": result.get("key_details") or [],
                "what_is_missing": result.get("what_is_missing"),
            })

        time.sleep(1.2)

    all_details = [d for item in evidence_items for d in (item.get("key_details") or [])]
    return {
        "status": best_status,
        "evidence": evidence_items,
        "key_details": list(dict.fromkeys(all_details)),
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Build the graph JSON
# ══════════════════════════════════════════════════════════════════════════════

def build_graph(chunks_by_proc, outages, classifications):
    """Assemble all nodes and edges from the ontology + extraction results."""
    nodes = []
    edges = []
    node_ids = set()

    def add_node(node_dict):
        if node_dict["id"] not in node_ids:
            nodes.append(node_dict)
            node_ids.add(node_dict["id"])

    # ── Equipment nodes ───────────────────────────────────────────────────────
    for eq_id, eq in TURBINE_EQUIPMENT.items():
        add_node({"id": eq_id, "type": "Equipment", "label": eq["label"]})

    # HAS_SUB_COMPONENT edges (Turbine → HP, IP/LP, blades, bearings, ...)
    for child_id in TURBINE_EQUIPMENT[TURBINE_PARENT].get("sub_components", []):
        if child_id in TURBINE_EQUIPMENT:
            edges.append({"from": TURBINE_PARENT, "type": "HAS_SUB_COMPONENT", "to": child_id})

    # ── Failure mode nodes ────────────────────────────────────────────────────
    for fm_id, fm in TURBINE_FAILURE_MODES.items():
        add_node({"id": fm_id, "type": "FailureMode", "label": fm["label"]})
        edges.append({"from": fm["equipment"], "type": "HAS_FAILURE_MODE", "to": fm_id})

    # ── Procedure nodes + ADDRESSED_BY edges ──────────────────────────────────
    for proc_id, proc in TURBINE_PROCEDURES.items():
        cl = classifications.get(proc_id, {"status": "ABSENT", "evidence": [], "key_details": []})
        status = cl["status"]

        add_node({
            "id": proc_id,
            "type": "Procedure",
            "label": proc["label"],
            "status": status,
            "criticality": proc["criticality"],
            "gap_id": proc["gap_id"],
            "evidence_count": len(cl["evidence"]),
            "evidence": cl["evidence"],
            "key_details": cl["key_details"],
            "is_gap": (status == "ABSENT") or (status == "PARTIAL" and proc["criticality"] >= 4),
        })

        for fm_id in proc.get("addresses_failure_modes", []):
            edges.append({
                "from": fm_id,
                "type": "ADDRESSED_BY",
                "to": proc_id,
                "status": status,
                "is_gap": status == "ABSENT" or (status == "PARTIAL" and proc["criticality"] >= 4),
            })

    # ── Regulation nodes + REQUIRED_BY edges ──────────────────────────────────
    for reg_id, reg in TURBINE_REGULATIONS.items():
        add_node({"id": reg_id, "type": "Regulation", "label": reg["label"]})
        for proc_ref in reg.get("requires_procedures", []):
            if proc_ref in TURBINE_PROCEDURES:
                edges.append({"from": proc_ref, "type": "REQUIRED_BY", "to": reg_id})

    # ── OutageEvent nodes ─────────────────────────────────────────────────────
    for o in outages:
        ev_id = f"outage_{o['event_id']}"
        add_node({
            "id": ev_id,
            "type": "OutageEvent",
            "label": f"{o['station']} — {o['date_out']}",
            "station": o["station"],
            "unit": o["unit"],
            "mw_lost": o["mw_lost"],
            "date_out": o["date_out"],
            "outage_hours": o["outage_hours"],
            "revenue_lost_est_cr": o["revenue_lost_est_cr"],
            "failure_reason_raw": o["failure_reason_raw"],
            "failure_category": o["failure_category"],
        })
        # Link each outage to the most specific failure mode for its category.
        fm_target = CEA_CATEGORY_TO_FM.get(o["failure_category"], DEFAULT_FM)
        edges.append({"from": ev_id, "type": "INSTANCE_OF", "to": fm_target})
        edges.append({"from": ev_id, "type": "OCCURRED_AT", "to": TURBINE_PARENT})

    # ── Meta ──────────────────────────────────────────────────────────────────
    turbine_outage_total_cr = sum(o["revenue_lost_est_cr"] for o in outages)
    gap_nodes = [n for n in nodes if n.get("type") == "Procedure" and n.get("is_gap")]
    meta = {
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "slice": "Turbine",
        "node_count": len(nodes),
        "edge_count": len(edges),
        "outage_events": len(outages),
        "total_outage_revenue_cr": round(turbine_outage_total_cr, 1),
        "confirmed_gaps": len(gap_nodes),
        "gap_ids": [n["gap_id"] for n in gap_nodes],
    }

    return {"nodes": nodes, "edges": edges, "meta": meta}


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Generate human-readable spot-check report
# ══════════════════════════════════════════════════════════════════════════════

STATUS_DISPLAY = {
    "EXISTS": "DOCUMENTED",
    "PARTIAL": "PARTIALLY DOCUMENTED",
    "ABSENT": "NOT DOCUMENTED (ABSENT)",
}


def _failure_mode_labels(proc_id):
    """Plain-English failure-mode label(s) this procedure addresses, so the report
    separates the failure mode (a real risk) from the procedure status (the gap)."""
    proc = TURBINE_PROCEDURES[proc_id]
    labels = [TURBINE_FAILURE_MODES[fm_id]["label"] for fm_id in proc.get("addresses_failure_modes", [])]
    return " / ".join(labels) if labels else "—"


def generate_review(graph, outages):
    """Plain-English markdown report for YC to review. No jargon required."""
    meta = graph["meta"]

    lines = [
        "# ThermIQ — Turbine Slice Spot-Check",
        f"_Generated {meta['extracted_at'][:10]}_",
        "",
        "> **How to use this:** Read through the Gap Summary section.",
        "> For each 🔴 or ⚠️ item, ask yourself: does it make sense that this document",
        "> wouldn't exist at a power plant? If something looks obviously wrong, let Cowork know.",
        "> You don't need to know what the procedure actually says — just whether the logic holds.",
        "",
        "---",
        "",
        f"**Graph size:** {meta['node_count']} nodes · {meta['edge_count']} edges",
        f"**Real outage events:** {meta['outage_events']} (from CEA daily report, npp.gov.in)",
        f"**Total ₹ at stake:** ₹{meta['total_outage_revenue_cr']} Cr (across all Turbine outages in the data)",
        f"**Confirmed gaps:** {meta['confirmed_gaps']}",
        "",
        "---",
        "",
        "## The Equipment Family",
        "",
        "We are looking at one type of equipment: **the Steam Turbine**, and its parts.",
        "The turbine is the giant spinning machine that the boiler's steam pushes to",
        "turn the generator and make electricity. Its parts are separate nodes in the",
        "graph, connected by 'contains' edges.",
        "",
        "| Node | What it is in plain English |",
        "|------|----------------------------|",
        "| Steam Turbine (500MW class) | The big multi-stage machine steam spins to make power |",
        "| HP Turbine | The high-pressure section where the hottest steam enters first |",
        "| IP / LP Turbine | The intermediate & low-pressure sections steam expands through next |",
        "| Turbine Blades | The angled metal blades the steam pushes against to spin the shaft |",
        "| Turbine Bearings | The oil-cushioned supports the spinning shaft rests on |",
        "| Governing / Control Valves | The valves that control how much steam reaches the turbine |",
        "| Lube Oil System | The oil that lubricates and cools the bearings |",
        "",
        "---",
        "",
        "## Jargon Glossary",
        "",
        "A few abbreviations show up below. Quick definitions before you hit them:",
        "",
        "- **SOP** = Standard Operating Procedure (written step-by-step instructions)",
        "- **HP / IP / LP** = High / Intermediate / Low Pressure turbine sections",
        "- **FOD** = Foreign Object Damage (debris striking and damaging a blade)",
        "- **NDT / PT / RT** = Non-Destructive Testing methods (inspecting metal without cutting it)",
        "- **EHC** = Electro-Hydraulic Control (the system that drives the governor valves)",
        "- **TAN** = Total Acid Number (a lube-oil quality/ageing measurement)",
        "- **ISO 7919 / 10816** = the international standards that set turbine vibration limits",
        "",
        "---",
        "",
        "## Gap Summary",
        "",
        "_Each item below separates the **failure mode** (a real physical risk the equipment",
        "faces) from the **procedure status** (whether a written SOP for handling it actually",
        "exists in our documents). A 🔴/⚠️ status describes the missing or incomplete",
        "*procedure* — it does NOT mean the failure mode itself is rare or absent._",
        "",
        "_🔴 = No procedure found anywhere in the document corpus (confirmed gap)_",
        "_⚠️ = Topic mentioned in documents but no actual SOP steps found (partial gap)_",
        "_✅ = Full procedure found_",
        "",
    ]

    proc_nodes = sorted(
        [n for n in graph["nodes"] if n["type"] == "Procedure"],
        key=lambda n: -n.get("criticality", 0),
    )

    for n in proc_nodes:
        status = n.get("status", "ABSENT")
        crit = n.get("criticality", "?")
        emoji = {"EXISTS": "✅", "PARTIAL": "⚠️", "ABSENT": "🔴"}.get(status, "❓")
        is_gap = n.get("is_gap", False)
        status_display = STATUS_DISPLAY.get(status, status)
        fm_labels = _failure_mode_labels(n["id"])

        lines.append(f"### {emoji} Failure mode: {fm_labels}")
        lines.append(f"**Procedure checked:** {n['label']}")
        lines.append(f"**Criticality:** {crit}/5 · **Procedure status:** {status_display}"
                     + (" · **THIS IS A GAP**" if is_gap else ""))
        lines.append("")

        evidence = n.get("evidence", [])
        if evidence:
            sources = list(dict.fromkeys(e["source"] for e in evidence))
            lines.append(f"**Found in:** {', '.join(sources)}")
            for e in evidence[:2]:
                if e.get("quote"):
                    lines.append(f"> *\"{e['quote']}\"*")
            details = n.get("key_details", [])
            if details:
                lines.append(f"**Specific details extracted:** {' · '.join(details[:4])}")
            missing = next((e.get("what_is_missing") for e in evidence if e.get("what_is_missing")), None)
            if missing:
                lines.append(f"**What's missing from these documents:** {missing}")
        else:
            lines.append("_Not found in any document in the corpus._")

        lines.append("")

    # ── Real outage events ────────────────────────────────────────────────────
    lines += [
        "---",
        "",
        "## Real Turbine Outage Events (from CEA data)",
        "",
        "These are actual forced outages from India's national power portal.",
        "Each one is a real event that cost real money.",
        f"Total Turbine events in our dataset: **{len(outages)}**",
        "",
        "| Station | Unit | MW Lost | Date | ₹ Est. | Raw Reason |",
        "|---------|------|---------|------|--------|------------|",
    ]
    for o in sorted(outages, key=lambda x: -x["revenue_lost_est_cr"])[:15]:
        reason = (o["failure_reason_raw"] or "")[:55]
        lines.append(
            f"| {o['station']} | {o['unit']} | {o['mw_lost']:.0f} MW"
            f" | {o['date_out']} | ₹{o['revenue_lost_est_cr']:.1f} Cr | {reason} |"
        )
    if not outages:
        lines.append("| _(no Turbine-tagged outages in the current CEA dataset)_ | | | | | |")
    lines.append("")

    # ── Hero traversal demo ────────────────────────────────────────────────────
    lines += [
        "---",
        "",
        "## The Demo Query (Hero Traversal)",
        "",
        "This is the question ThermIQ should answer end-to-end once the graph is in Neo4j:",
        "",
        "> *An operator sees turbine shaft vibration climbing toward the trip limit on Unit 3.*",
        "> *What is the documented response procedure and trip threshold? Has high vibration*",
        "> *caused forced outages at other Indian plants? What's the revenue exposure?*",
        "",
        "**What the graph traversal does:**",
        "1. Equipment: Turbine Bearings → FailureMode: Turbine High Vibration",
        "2. Any real outage events linked to this failure? (INSTANCE_OF edges)",
        "3. Does a Procedure exist that addresses it? (ADDRESSED_BY edge)",
        "4. Is that procedure ABSENT/PARTIAL? → confirmed gap → link to risk score",
        "5. Which regulation requires this procedure? (REQUIRED_BY → ISO 7919/10816, CEA STS)",
        "6. What is the ₹ exposure? (consequence from outage events × criticality × exposure)",
        "",
        "---",
        "",
        "## Your Review Checklist",
        "",
        "You just need to answer these questions — no technical knowledge required:",
        "",
        "- [ ] Do the **outage station names** look like real Indian plant names?",
        "- [ ] Do the **failure mode names** (High Vibration, Blade Damage, etc.) sound like real turbine problems?",
        "- [ ] Does the **gap logic** make sense? (if a plant has no documented vibration-response SOP, that's a gap)",
        "- [ ] Is there anything that looks **obviously wrong or weird**?",
        "- [ ] Does the **hero query** (rising vibration on Unit 3) feel like a realistic plant scenario?",
        "",
        "Reply to Cowork with your answers and we proceed to Neo4j loading.",
    ]

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def make_dry_run_data():
    """Minimal fake data so the pipeline can be tested without any API calls."""
    chunks_by_proc = {proc_id: [] for proc_id in TURBINE_PROCEDURES}
    outages = [
        {
            "event_id": "NTPC_VINDHYACHAL_7_2026-06-24",
            "station": "NTPC VINDHYACHAL",
            "unit": "7",
            "mw_lost": 500,
            "date_out": "2026-06-24",
            "outage_hours": 96,
            "revenue_lost_est_cr": 24.0,
            "failure_reason_raw": "TURBINE HIGH VIBRATION TRIP [DRY RUN]",
            "failure_category": "vibration",
        },
        {
            "event_id": "NTPC_KORBA_3_2026-06-25",
            "station": "NTPC KORBA",
            "unit": "3",
            "mw_lost": 500,
            "date_out": "2026-06-25",
            "outage_hours": 240,
            "revenue_lost_est_cr": 60.0,
            "failure_reason_raw": "LP TURBINE BLADE DAMAGE [DRY RUN]",
            "failure_category": "blade_damage",
        },
    ]
    classifications = {
        proc_id: {"status": "ABSENT", "evidence": [], "key_details": []}
        for proc_id in TURBINE_PROCEDURES
    }
    # Simulate that a CEA spec partially covers the vibration response (limits but no SOP).
    classifications["turbine_vibration_response_sop"] = {
        "status": "PARTIAL",
        "evidence": [{
            "source": "CEA STS 500MW Turbine Section [DRY RUN]",
            "source_type": "benchmark",
            "similarity_score": 0.69,
            "status": "PARTIAL",
            "quote": "vibration monitoring system shall trip the unit at the design limit",
            "key_details": ["vibration monitoring mandatory", "trip at design limit"],
            "what_is_missing": "No numeric trip threshold (e.g. 250 µm) or operator response steps given",
        }],
        "key_details": ["vibration monitoring mandatory", "trip at design limit"],
    }
    return chunks_by_proc, outages, classifications


def main():
    parser = argparse.ArgumentParser(description="Extract Turbine knowledge graph slice")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Skip all API calls; use synthetic data to test the pipeline"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("ThermIQ — Turbine Graph Extraction  (Phase 2)")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    if args.dry_run:
        print("\n⚠  DRY RUN: using synthetic data, no API calls made")
        chunks_by_proc, outages, classifications = make_dry_run_data()
    else:
        gemini        = GeminiKeyRotator([GEMINI_API_KEY, GEMINI_API_KEY2, GEMINI_API_KEY3])
        qdrant        = get_qdrant()
        db            = get_firestore()

        # Step 1 — Qdrant
        chunks_by_proc = pull_turbine_chunks(qdrant)

        # Step 2 — Firestore outages
        outages = pull_turbine_outages(db)

        # Step 3 — Gemini classification
        print("\n[3/4] Classifying procedures via Gemini...")
        classifications = {}
        for proc_id, proc in TURBINE_PROCEDURES.items():
            print(f"  → {proc_id}...")
            classifications[proc_id] = classify_procedure(
                gemini, proc_id, proc, chunks_by_proc.get(proc_id, [])
            )
            status = classifications[proc_id]["status"]
            print(f"     Status: {status}")

    # Step 4 — Build graph
    print("\n[4/4] Building graph...")
    graph = build_graph(chunks_by_proc, outages, classifications)
    meta = graph["meta"]
    print(f"  → {meta['node_count']} nodes · {meta['edge_count']} edges")
    print(f"  → {meta['confirmed_gaps']} confirmed gaps")

    # Write outputs
    slice_path = OUTPUT_DIR / "turbine_slice.json"
    with open(slice_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Graph JSON → {slice_path}")

    review_path = OUTPUT_DIR / "turbine_review.md"
    review_text = generate_review(graph, outages)
    with open(review_path, "w", encoding="utf-8") as f:
        f.write(review_text)
    print(f"✓ Review   → {review_path}")

    # Terminal gap summary
    print("\n━━━ GAP SUMMARY ━━━")
    for n in sorted(
        [x for x in graph["nodes"] if x["type"] == "Procedure"],
        key=lambda x: -x.get("criticality", 0),
    ):
        status = n.get("status", "ABSENT")
        emoji = {"EXISTS": "✅", "PARTIAL": "⚠️", "ABSENT": "🔴"}.get(status, "❓")
        gap_flag = " ← GAP" if n.get("is_gap") else ""
        status_display = STATUS_DISPLAY.get(status, status)
        fm_labels = _failure_mode_labels(n["id"])
        print(f"  {emoji} [{n['criticality']}/5] Failure mode: {fm_labels} -> "
              f"Procedure '{n['label']}': {status_display}{gap_flag}")

    print("\nDone. Share turbine_review.md with YC for the spot-check gate.")


if __name__ == "__main__":
    main()
