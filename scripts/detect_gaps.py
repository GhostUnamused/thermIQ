"""
ThermIQ Gap Detection & Risk Scoring Engine  v2.0
===================================================
METHODOLOGY (benchmark-vs-client delta):
  - Benchmark sources  = CEA standards/guidelines ingested with source_type="benchmark"
                         These define what a well-run 500MW plant SHOULD document.
  - Client sources     = A specific plant's operational documents (source_type="client")
                         These are what the plant ACTUALLY has documented.
  - A gap             = A topic the benchmark checklist requires, where the CLIENT
                         corpus has weak or no coverage. Coverage is measured against
                         client documents ONLY — not the benchmarks.

Formula:  risk_score_cr = criticality × consequence_cr × exposure
  - criticality:   Expert-assigned 1–10 per procedure/equipment type [ASSUMPTION — labelled]
  - consequence_cr: avg revenue_lost_est_cr from CEA outage records for that equipment [DERIVED]
                    Falls back to ₹5 Cr default if no outage data exists [ASSUMPTION — labelled]
  - exposure:      1 - best_client_match_score (how uncovered the topic is in the client corpus)

Coverage thresholds (see COVERAGE_THRESHOLDS dict below):
  - best_client_match >= 0.62 → "covered"
  - best_client_match >= 0.45 → "partial"
  - best_client_match < 0.45  → "gap"

Writes results to Firestore `risk_scores` collection for the dashboard.
Each result includes full audit trail: benchmark_requirement, client_coverage_score,
threshold_applied, consequence_method.

Usage:
  python scripts/detect_gaps.py [--client CLIENT_NAME]

  --client CLIENT_NAME  Only search documents for this client (e.g. "ntpc").
                        Default: all client documents combined.
"""
import os
import sys
import time
import json
import argparse
from datetime import datetime

import requests
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

JINA_API_KEY = os.environ.get("JINA_API_KEY")
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

COLLECTION_NAME = "thermiq_chunks"

# ─── Coverage thresholds (documented config — single source of truth) ──────────
# These thresholds determine how a client's coverage score is interpreted.
# They were calibrated against Jina v3 COSINE similarity for operational text.
# Adjust here if you re-tune on a larger corpus — DO NOT change inline.
COVERAGE_THRESHOLDS = {
    "covered": 0.62,   # client best match >= this → topic is covered
    "partial":  0.45,  # client best match >= this → partially covered (some relevant text exists)
    # below "partial" → gap (client has no meaningful coverage of this topic)
}

# ─── Expected Knowledge Checklist ──────────────────────────────────────────────
# Each entry: (procedure/knowledge area, equipment_tag, gap_type, criticality 1-10)
# These represent what a well-documented 500MW coal thermal plant SHOULD have.
# Mapped to equipment tags used in both Qdrant payloads and CEA outage records.

EXPECTED_KNOWLEDGE = [
    # Boiler procedures — most common cause of forced outages
    {
        "id": "boiler_tube_failure_sop",
        "description": "Boiler tube leakage/failure emergency response procedure with shutdown sequence, isolation steps, and tube replacement guidelines",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 9,
        "query": "boiler tube leakage failure emergency response procedure shutdown isolation tube replacement steps",
    },
    {
        "id": "boiler_waterwall_inspection",
        "description": "Waterwall tube inspection schedule, NDT requirements, thickness measurement criteria, and condemning limits",
        "equipment_tag": "Boiler",
        "gap_type": "missing_inspection_procedure",
        "criticality": 8,
        "query": "waterwall tube inspection NDT thickness measurement condemning limits schedule criteria",
    },
    {
        "id": "superheater_maintenance",
        "description": "Superheater/reheater tube maintenance and replacement procedure including material specs and welding requirements",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 8,
        "query": "superheater reheater tube maintenance replacement material specification welding procedure",
    },
    {
        "id": "boiler_startup_procedure",
        "description": "Boiler cold/hot/warm startup procedure with firing rates, temperature ramp rates, and safety interlocks",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 7,
        "query": "boiler startup procedure cold hot warm firing rate temperature ramp safety interlocks sequence",
    },
    {
        "id": "air_preheater_maintenance",
        "description": "Air preheater maintenance procedure including basket replacement, seal adjustment, and fire detection/suppression",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 6,
        "query": "air preheater maintenance basket replacement seal adjustment fire detection APH",
    },

    # Turbine procedures
    {
        "id": "turbine_vibration_response",
        "description": "Turbine high vibration response procedure with trip thresholds, diagnostic steps, and bearing inspection requirements",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 9,
        "query": "turbine vibration high response trip threshold diagnostic bearing inspection procedure alarm",
    },
    {
        "id": "turbine_blade_inspection",
        "description": "HP/IP/LP turbine blade inspection procedure including erosion limits, FOD checks, and condemning criteria",
        "equipment_tag": "Turbine",
        "gap_type": "missing_inspection_procedure",
        "criticality": 8,
        "query": "turbine blade inspection HP LP IP erosion damage condemning criteria FOD foreign object",
    },
    {
        "id": "turbine_governor_valve_maintenance",
        "description": "Governor valve and control valve maintenance, testing, and calibration procedure",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 7,
        "query": "turbine governor valve control valve maintenance testing calibration procedure servo",
    },
    {
        "id": "turbine_oil_system",
        "description": "Turbine lubricating oil system maintenance including oil quality testing, purification, and bearing oil supply procedures",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 6,
        "query": "turbine lubricating oil system maintenance quality testing purification bearing oil supply procedure",
    },

    # Generator procedures
    {
        "id": "generator_stator_winding",
        "description": "Generator stator winding insulation resistance testing, partial discharge monitoring, and repair procedure",
        "equipment_tag": "Generator",
        "gap_type": "missing_sop",
        "criticality": 9,
        "query": "generator stator winding insulation resistance testing partial discharge monitoring repair procedure",
    },
    {
        "id": "generator_exciter_maintenance",
        "description": "Exciter maintenance procedure including brush inspection, slip ring conditioning, and AVR calibration",
        "equipment_tag": "Generator",
        "gap_type": "missing_sop",
        "criticality": 7,
        "query": "generator exciter maintenance brush inspection slip ring AVR automatic voltage regulator calibration",
    },

    # BFP procedures
    {
        "id": "bfp_seal_maintenance",
        "description": "Boiler feed pump mechanical seal replacement procedure including alignment, clearance checks, and commissioning",
        "equipment_tag": "BFP",
        "gap_type": "missing_sop",
        "criticality": 8,
        "query": "boiler feed pump BFP mechanical seal replacement alignment clearance commissioning procedure",
    },
    {
        "id": "bfp_impeller_wear",
        "description": "BFP impeller wear assessment criteria, replacement procedure, and performance restoration guidelines",
        "equipment_tag": "BFP",
        "gap_type": "missing_sop",
        "criticality": 6,
        "query": "boiler feed pump impeller wear assessment replacement performance restoration BFP",
    },

    # Condenser procedures
    {
        "id": "condenser_tube_leak_detection",
        "description": "Condenser tube leak detection and plugging procedure including vacuum drop test and helium leak testing",
        "equipment_tag": "Condenser",
        "gap_type": "missing_sop",
        "criticality": 7,
        "query": "condenser tube leak detection plugging vacuum drop test helium leak testing procedure",
    },
    {
        "id": "condenser_vacuum_low_response",
        "description": "Low condenser vacuum emergency response procedure with diagnostic checklist and corrective actions",
        "equipment_tag": "Condenser",
        "gap_type": "missing_sop",
        "criticality": 7,
        "query": "condenser vacuum low emergency response diagnostic checklist corrective actions air ingress ejector",
    },

    # Cooling Tower
    {
        "id": "cooling_tower_fill_inspection",
        "description": "Cooling tower fill/pack inspection, cleaning, and replacement procedure with structural assessment",
        "equipment_tag": "Cooling Tower",
        "gap_type": "missing_inspection_procedure",
        "criticality": 5,
        "query": "cooling tower fill pack inspection cleaning replacement structural assessment drift eliminator",
    },

    # Cross-cutting / regulatory
    {
        "id": "cea_mandatory_spares",
        "description": "CEA mandatory spare parts list for 500MW thermal units including capital spares and insurance spares inventory",
        "equipment_tag": "Boiler",
        "gap_type": "missing_reference",
        "criticality": 7,
        "query": "CEA mandatory spare parts list 500MW thermal capital spares insurance spares inventory",
    },
    {
        "id": "rm_life_extension_criteria",
        "description": "R&M and life extension criteria for thermal units beyond design life including RLA methodology and assessment framework",
        "equipment_tag": "Boiler",
        "gap_type": "missing_reference",
        "criticality": 6,
        "query": "renovation modernization life extension criteria thermal units RLA residual life assessment design life",
    },
]

# Threshold aliases — use COVERAGE_THRESHOLDS dict above; these are removed.
# (Kept as comments for diff clarity — delete in a future cleanup pass.)


def embed_query(query_text):
    """Embed a query using Jina v3 (retrieval.query task)."""
    response = requests.post(
        "https://api.jina.ai/v1/embeddings",
        headers={
            "Authorization": f"Bearer {JINA_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "jina-embeddings-v3",
            "input": [query_text],
            "task": "retrieval.query",
        },
    )
    response.raise_for_status()
    return response.json()["data"][0]["embedding"]


def search_qdrant_client_only(embedding, client_name=None, limit=5):
    """Search Qdrant filtered to CLIENT documents only.

    This is the key fix: gap coverage is measured against what the PLANT
    has documented — not against the CEA benchmark documents. Searching the
    benchmarks for coverage would be a category error: it would tell you that
    the CEA spec mentions boiler tubes (which it does, everywhere) rather than
    that THIS plant has a boiler tube inspection procedure.

    Args:
        embedding: Jina v3 query embedding
        client_name: If provided, further filter to this specific client
                     (e.g. "ntpc"). If None, searches all client docs.
        limit: number of results to return
    """
    qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)

    # Base filter: client documents only
    must_conditions = [
        FieldCondition(key="source_type", match=MatchValue(value="client"))
    ]

    # Optionally narrow to a specific client plant
    if client_name:
        must_conditions.append(
            FieldCondition(key="client_name", match=MatchValue(value=client_name.lower()))
        )

    client_filter = Filter(must=must_conditions)

    for attempt in range(3):
        try:
            response = qdrant.query_points(
                collection_name=COLLECTION_NAME,
                query=embedding,
                query_filter=client_filter,
                limit=limit,
                with_payload=True,
            )
            return response.points
        except Exception as e:
            if attempt < 2:
                wait = 2 ** (attempt + 1)
                print(f"  ⚠ Qdrant timeout (attempt {attempt+1}/3), retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  ✖ Qdrant failed after 3 attempts: {e}")
                return []


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq_gaps")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.environ["FIREBASE_PROJECT_ID"],
            "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="thermiq_gaps")
    return firestore.client(app=app)


def load_outage_stats(db):
    """Load CEA outage data and compute average revenue impact per equipment tag."""
    outages = [doc.to_dict() for doc in db.collection("cea_outages").stream()]
    
    stats = {}  # equipment_tag → { count, total_revenue_cr, avg_revenue_cr, total_mw }
    for o in outages:
        tag = o.get("equipment_tag", "Other")
        if tag not in stats:
            stats[tag] = {"count": 0, "total_revenue_cr": 0.0, "total_mw": 0.0}
        stats[tag]["count"] += 1
        stats[tag]["total_revenue_cr"] += o.get("revenue_lost_est_cr", 0)
        stats[tag]["total_mw"] += o.get("mw_lost", 0)
    
    for tag, s in stats.items():
        s["avg_revenue_cr"] = round(s["total_revenue_cr"] / s["count"], 2) if s["count"] > 0 else 0
    
    return stats


def detect_gaps(client_name=None):
    """Main gap detection: benchmark checklist vs client-only Qdrant search.

    Args:
        client_name: Restrict search to this client's documents (e.g. "ntpc").
                     If None, searches all documents tagged source_type="client".
    """
    print("=" * 70)
    print("ThermIQ Gap Detection v2.0 — Benchmark-vs-Client Delta")
    print("=" * 70)
    if client_name:
        print(f"  Assessing client: {client_name}")
    else:
        print(f"  Assessing: ALL client documents combined")
    print(f"  Coverage thresholds: covered ≥{COVERAGE_THRESHOLDS['covered']}, "
          f"partial ≥{COVERAGE_THRESHOLDS['partial']}, gap <{COVERAGE_THRESHOLDS['partial']}")
    print()

    db = get_firestore_client()

    # Load real CEA outage stats for consequence scoring
    print("Loading CEA outage statistics...")
    outage_stats = load_outage_stats(db)
    for tag, s in sorted(outage_stats.items()):
        print(f"  {tag}: {s['count']} outages, avg ₹{s['avg_revenue_cr']} Cr/outage")

    print(f"\nScanning {len(EXPECTED_KNOWLEDGE)} benchmark checklist items...")
    print(f"  Searching CLIENT documents only (source_type='client')\n")

    results = []

    for i, expected in enumerate(EXPECTED_KNOWLEDGE):
        print(f"[{i+1}/{len(EXPECTED_KNOWLEDGE)}] {expected['id']}")

        # Embed the query
        embedding = embed_query(expected["query"])
        time.sleep(0.3)  # rate limit courtesy

        # Search ONLY client documents — this is the critical change vs v1
        client_results = search_qdrant_client_only(embedding, client_name=client_name, limit=5)

        # Best match score against client corpus
        best_client_score = client_results[0].score if client_results else 0
        avg_client_score = (
            sum(r.score for r in client_results) / len(client_results)
            if client_results else 0
        )

        # Coverage assessment using documented thresholds
        if best_client_score >= COVERAGE_THRESHOLDS["covered"]:
            coverage_status = "covered"
        elif best_client_score >= COVERAGE_THRESHOLDS["partial"]:
            coverage_status = "partial"
        else:
            coverage_status = "gap"

        # Exposure: how exposed are we because of missing client coverage?
        # 1.0 = completely exposed (client has nothing on this topic)
        # 0.0 = fully covered (client docs score >= 1.0)
        exposure = round(max(0, 1.0 - best_client_score), 3)

        # Consequence from real outage data — labelled as "derived" or "assumed"
        tag_stats = outage_stats.get(expected["equipment_tag"], {})
        linked_outages = tag_stats.get("count", 0)
        if linked_outages > 0:
            consequence_cr = tag_stats.get("avg_revenue_cr", 5.0)
            consequence_method = "derived_from_outage_data"
        else:
            consequence_cr = 5.0  # ₹5 Cr default when no outage data exists
            consequence_method = "assumed_default_5cr_no_outage_data"

        # Risk score: criticality × consequence × exposure
        # Note: criticality is expert-assigned (ASSUMPTION — see EXPECTED_KNOWLEDGE above)
        risk_score_cr = round(expected["criticality"] * consequence_cr * exposure, 2)

        # Top client sources
        top_sources = []
        for r in client_results[:3]:
            payload = r.payload or {}
            top_sources.append({
                "doc": payload.get("source_doc", ""),
                "client_name": payload.get("client_name", ""),
                "source_type": payload.get("source_type", "client"),
                "score": round(r.score, 3),
                "chunk_preview": (payload.get("text", ""))[:120],
            })

        result = {
            "gap_id": expected["id"],
            "description": expected["description"],
            "equipment_tag": expected["equipment_tag"],
            "gap_type": expected["gap_type"],

            # Audit trail — every number is traceable
            "benchmark_requirement": expected["query"],  # what CEA expects
            "client_name_assessed": client_name or "all_clients",
            "best_match_score": round(best_client_score, 3),  # from client docs only
            "avg_match_score": round(avg_client_score, 3),
            "coverage_threshold_used": COVERAGE_THRESHOLDS,  # documented config

            "coverage_status": coverage_status,
            "exposure_score": exposure,

            # Risk formula components, each labelled
            "criticality_score": expected["criticality"],
            "criticality_method": "expert_assigned_assumption",  # honest label
            "consequence_cr": consequence_cr,
            "consequence_method": consequence_method,  # "derived" or "assumed"
            "linked_outages": linked_outages,
            "risk_score_cr": risk_score_cr,

            "top_client_sources": top_sources,
            "scanned_at": datetime.utcnow().isoformat() + "Z",
        }

        results.append(result)

        status_icon = {"covered": "✅", "partial": "⚠️", "gap": "🔴"}[coverage_status]
        print(f"  {status_icon} {coverage_status.upper()} | client_score={best_client_score:.3f} | "
              f"exposure={exposure:.3f} | risk=₹{risk_score_cr} Cr "
              f"[consequence={consequence_method[:7]}]")
        if top_sources:
            print(f"     Best client match: '{top_sources[0]['doc'][:50]}' (score={top_sources[0]['score']:.3f})")
        else:
            print(f"     No client documents match this topic.")
    
    # Sort by risk score descending
    results.sort(key=lambda r: r["risk_score_cr"], reverse=True)
    
    # Write to Firestore
    print("\n" + "=" * 70)
    print("Writing results to Firestore risk_scores collection...")
    
    # Clear existing risk_scores first
    existing = list(db.collection("risk_scores").stream())
    for doc in existing:
        doc.reference.delete()
    print(f"  Cleared {len(existing)} existing risk_score records.")
    
    for result in results:
        doc_id = result["gap_id"]
        db.collection("risk_scores").document(doc_id).set(result)
    print(f"  Written {len(results)} gap analysis records.")
    
    # Summary
    print("\n" + "=" * 70)
    print("GAP DETECTION SUMMARY")
    print("=" * 70)
    
    gaps = [r for r in results if r["coverage_status"] == "gap"]
    partial = [r for r in results if r["coverage_status"] == "partial"]
    covered = [r for r in results if r["coverage_status"] == "covered"]
    total_risk = sum(r["risk_score_cr"] for r in results)
    critical_risk = sum(r["risk_score_cr"] for r in results if r["risk_score_cr"] > 300)
    high_risk = sum(r["risk_score_cr"] for r in results if 100 <= r["risk_score_cr"] <= 300)
    
    print(f"\n  Total areas scanned:    {len(results)}")
    print(f"  ✅ Covered:             {len(covered)}")
    print(f"  ⚠️  Partially covered:   {len(partial)}")
    print(f"  🔴 Gaps detected:       {len(gaps)}")
    print(f"\n  Total risk exposure:    ₹{total_risk:.1f} Cr")
    print(f"  Critical risk (>300):   ₹{critical_risk:.1f} Cr")
    print(f"  High risk (100-300):    ₹{high_risk:.1f} Cr")
    
    print("\n  Top 5 gaps by risk:")
    for i, r in enumerate(results[:5]):
        status_icon = {"covered": "✅", "partial": "⚠️", "gap": "🔴"}[r["coverage_status"]]
        print(f"  {i+1}. {status_icon} ₹{r['risk_score_cr']:>8.1f} Cr | {r['equipment_tag']:<14} | {r['description'][:60]}...")
    
    print("\nDone. Dashboard at https://ghostunamused.github.io/thermIQ/dashboard.html should now show updated gap data.")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ThermIQ Gap Detection v2.0")
    parser.add_argument("--client", default=None, help="Filter to a specific client name (e.g. 'ntpc')")
    args = parser.parse_args()
    detect_gaps(client_name=args.client)
