"""
migrate_risk_scores_namespace.py — one-time Phase 2 (task-020) migration.

Moves the existing GLOBAL risk_scores records (written by detect_gaps.py v3.0,
no client_name field, doc id == gap_id) into the per-client namespace:
    <gap_id>  ->  ntpc__<gap_id>  with client_name="ntpc"

Why not call /api/recompute_gaps for this? Because recompute_gaps.js is still the
v2.0 methodology (criticality 1-10, flat consequence default, 18 items) and would
OVERWRITE the live v3.0 set (criticality 1-5, sourced consequence, 19 items incl.
flame_failure_response_sop). This script preserves the exact v3.0 numbers
(~Rs 416 Cr / 19 gaps) while giving them a client_name so per-plant isolation works.

Idempotent: docs that already have a client_name (or an id containing "__") are skipped.

Run:  python scripts/migrate_risk_scores_namespace.py [client_name]
      (client_name defaults to "ntpc")
"""
import os
import sys

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

TARGET_CLIENT = (sys.argv[1] if len(sys.argv) > 1 else "ntpc").strip().lower()


def get_db():
    try:
        app = firebase_admin.get_app("thermiq_migrate")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.environ["FIREBASE_PROJECT_ID"],
            "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="thermiq_migrate")
    return firestore.client(app=app)


def main():
    db = get_db()
    risk_ref = db.collection("risk_scores")
    docs = list(risk_ref.stream())
    print(f"Found {len(docs)} risk_scores records. Target namespace: {TARGET_CLIENT}")

    migrated = 0
    skipped = 0
    for d in docs:
        data = d.to_dict() or {}
        if data.get("client_name") or "__" in d.id:
            print(f"  SKIP (already namespaced): {d.id}")
            skipped += 1
            continue

        new_id = f"{TARGET_CLIENT}__{d.id}"
        new_data = dict(data)
        new_data["client_name"] = TARGET_CLIENT
        risk_ref.document(new_id).set(new_data)
        risk_ref.document(d.id).delete()
        print(f"  MIGRATED: {d.id} -> {new_id}")
        migrated += 1

    print(f"\nDone. migrated={migrated}, skipped={skipped}")
    # Report the post-migration total for the target client (sanity check).
    after = list(risk_ref.where("client_name", "==", TARGET_CLIENT).stream())
    total = round(sum((x.to_dict() or {}).get("risk_score_cr", 0) for x in after), 1)
    print(f"Post-migration: {len(after)} records for '{TARGET_CLIENT}', total risk = Rs {total} Cr")


if __name__ == "__main__":
    main()
