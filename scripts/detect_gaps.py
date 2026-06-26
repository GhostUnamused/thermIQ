"""
ThermIQ Gap Detection & Risk Scoring Engine

Queries the Qdrant knowledge base against a predefined checklist of expected
procedures/knowledge areas for thermal power plants (500MW coal). For each
expected area, measures how well the corpus covers it (via cosine similarity),
then computes a risk score linked to real CEA outage data.

Formula:  risk_score_cr = criticality × consequence_cr × exposure
  - criticality:  expert-assigned 1-10 per equipment/procedure type
  - consequence:  avg revenue_lost_est_cr from matching CEA outages (real data)
  - exposure:     1 - max_similarity_score (how much of the gap is uncovered)

Writes results to Firestore `risk_scores` collection for the dashboard.

Usage:
  python scripts/detect_gaps.py
"""
import os
import sys
import time
import json
from datetime import datetime

import requests
from dotenv import load_dotenv
from qdrant_client import QdrantClient
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

JINA_API_KEY = os.environ.get("JINA_API_KEY")
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")

COLLECTION_NAME = "thermiq_chunks"

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

# Coverage thresholds — what score means "covered" vs "gap"
COVERAGE_GOOD = 0.55      # similarity >= this → well covered
COVERAGE_PARTIAL = 0.40   # similarity >= this → partially covered
# Below COVERAGE_PARTIAL → gap detected


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


def search_qdrant(embedding, limit=5):
    """Search Qdrant for the top matching chunks. Retries on timeout."""
    client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)
    for attempt in range(3):
        try:
            response = client.query_points(
                collection_name=COLLECTION_NAME,
                query=embedding,
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


def detect_gaps():
    """Main gap detection: query Qdrant for each expected knowledge area, score coverage."""
    print("=" * 70)
    print("ThermIQ Gap Detection & Risk Scoring Engine")
    print("=" * 70)
    
    db = get_firestore_client()
    
    # Load real CEA outage stats for consequence scoring
    print("\nLoading CEA outage statistics...")
    outage_stats = load_outage_stats(db)
    for tag, s in sorted(outage_stats.items()):
        print(f"  {tag}: {s['count']} outages, avg ₹{s['avg_revenue_cr']} Cr/outage, total {s['total_mw']:.0f} MW")
    
    print(f"\nScanning {len(EXPECTED_KNOWLEDGE)} expected knowledge areas against Qdrant...\n")
    
    results = []
    
    for i, expected in enumerate(EXPECTED_KNOWLEDGE):
        print(f"[{i+1}/{len(EXPECTED_KNOWLEDGE)}] {expected['id']}")
        
        # Embed the query
        embedding = embed_query(expected["query"])
        time.sleep(0.3)  # Rate limit courtesy
        
        # Search Qdrant
        search_results = search_qdrant(embedding, limit=5)
        
        # Best match score
        best_score = search_results[0].score if search_results else 0
        avg_score = sum(r.score for r in search_results) / len(search_results) if search_results else 0
        
        # Coverage assessment
        if best_score >= COVERAGE_GOOD:
            coverage_status = "covered"
        elif best_score >= COVERAGE_PARTIAL:
            coverage_status = "partial"
        else:
            coverage_status = "gap"
        
        # Exposure score: how exposed are we due to missing knowledge?
        # 1.0 = completely exposed (no relevant docs), 0.0 = fully covered
        exposure = round(max(0, 1.0 - best_score), 3)
        
        # Consequence from real outage data
        tag_stats = outage_stats.get(expected["equipment_tag"], {})
        consequence_cr = tag_stats.get("avg_revenue_cr", 5.0)  # fallback to ₹5 Cr
        linked_outages = tag_stats.get("count", 0)
        
        # Risk score: criticality × consequence × exposure
        risk_score_cr = round(expected["criticality"] * consequence_cr * exposure, 2)
        
        # Top sources
        top_sources = []
        for r in search_results[:3]:
            payload = r.payload or {}
            top_sources.append({
                "doc": payload.get("source_doc", ""),
                "score": round(r.score, 3),
                "chunk_preview": (payload.get("text", ""))[:120],
            })
        
        result = {
            "gap_id": expected["id"],
            "description": expected["description"],
            "equipment_tag": expected["equipment_tag"],
            "gap_type": expected["gap_type"],
            "criticality_score": expected["criticality"],
            "best_match_score": round(best_score, 3),
            "avg_match_score": round(avg_score, 3),
            "coverage_status": coverage_status,
            "exposure_score": exposure,
            "consequence_cr": consequence_cr,
            "linked_outages": linked_outages,
            "risk_score_cr": risk_score_cr,
            "top_sources": top_sources,
            "scanned_at": datetime.utcnow().isoformat() + "Z",
        }
        
        results.append(result)
        
        status_icon = {"covered": "✅", "partial": "⚠️", "gap": "🔴"}[coverage_status]
        print(f"  {status_icon} {coverage_status.upper()} | best={best_score:.3f} | exposure={exposure:.3f} | risk=₹{risk_score_cr} Cr")
        print(f"     Top match: {top_sources[0]['doc'][:50] if top_sources else 'none'} ({top_sources[0]['score']:.3f})" if top_sources else "     No matches")
    
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
    
    print("\nDone. Dashboard at https://ghostunamused.github.io/thermIQ/dashboard.html should now show real gap data.")
    return results


if __name__ == "__main__":
    detect_gaps()
