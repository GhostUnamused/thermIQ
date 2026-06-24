"""
Seeds Firestore with initial config and known knowledge-gap risk scores
so the dashboard is populated before any real document ingestion happens.
"""
import os
from datetime import datetime

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

RISK_SCORES = {
    "gap_boiler_tube_sop": {
        "description": "No emergency response SOP for boiler tube failure found in document corpus",
        "equipment": "Boiler",
        "failure_category": "tube_failure",
        "criticality_score": 9,
        "consequence_cr": 62.5,
        "exposure_score": 0.85,
        "risk_score_cr": 477.6,
        "gap_type": "missing_procedure",
        "supporting_outage_count": 28,
    },
    "gap_turbine_vibration_threshold": {
        "description": "Turbine vibration alarm thresholds not documented in plant operating procedures",
        "equipment": "Turbine",
        "failure_category": "vibration",
        "criticality_score": 8,
        "consequence_cr": 78.3,
        "exposure_score": 0.65,
        "risk_score_cr": 407.5,
        "gap_type": "incomplete_spec",
        "supporting_outage_count": 19,
    },
    "gap_bfp_seal_replacement": {
        "description": "BFP seal replacement procedure not found in maintenance documentation corpus",
        "equipment": "BFP",
        "failure_category": "seal_failure",
        "criticality_score": 8,
        "consequence_cr": 45.2,
        "exposure_score": 0.70,
        "risk_score_cr": 252.9,
        "gap_type": "missing_procedure",
        "supporting_outage_count": 12,
    },
    "gap_condenser_vacuum_restoration": {
        "description": "Condenser vacuum restoration procedure absent from available SOPs",
        "equipment": "Condenser",
        "failure_category": "vacuum_loss",
        "criticality_score": 7,
        "consequence_cr": 38.4,
        "exposure_score": 0.60,
        "risk_score_cr": 161.3,
        "gap_type": "missing_procedure",
        "supporting_outage_count": 8,
    },
    "gap_generator_winding_inspection": {
        "description": "No stator winding inspection schedule found in maintenance records",
        "equipment": "Generator",
        "failure_category": "electrical_fault",
        "criticality_score": 7,
        "consequence_cr": 55.0,
        "exposure_score": 0.50,
        "risk_score_cr": 192.5,
        "gap_type": "no_maintenance_record",
        "supporting_outage_count": 6,
    },
    "gap_cooling_tower_fill_schedule": {
        "description": "Cooling tower fill inspection and replacement schedule not documented",
        "equipment": "Cooling Tower",
        "failure_category": "fill_degradation",
        "criticality_score": 6,
        "consequence_cr": 22.1,
        "exposure_score": 0.55,
        "risk_score_cr": 72.9,
        "gap_type": "no_maintenance_record",
        "supporting_outage_count": 5,
    },
}


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq")
    except ValueError:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": os.environ["FIREBASE_PROJECT_ID"],
                "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace(
                    "\\n", "\n"
                ),
                "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
        app = firebase_admin.initialize_app(cred, name="thermiq")
    return firestore.client(app=app)


def main():
    db = get_firestore_client()

    db.collection("system_meta").document("config").set(
        {
            "last_cea_fetch": None,
            "total_chunks_indexed": 0,
            "documents_ingested": [],
            "qdrant_collection": "thermiq_chunks",
            "version": "0.1.0",
        }
    )
    print("Seeded system_meta/config")

    now = datetime.utcnow().isoformat() + "Z"
    for gap_id, data in RISK_SCORES.items():
        doc = {**data, "evidence_chunks": [], "last_updated": now}
        db.collection("risk_scores").document(gap_id).set(doc)
        print(f"Seeded risk_scores/{gap_id}")


if __name__ == "__main__":
    main()
