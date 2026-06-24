import json
import os

import firebase_admin
from firebase_admin import credentials, firestore

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
}

_firebase_app = None


def get_firebase_app():
    global _firebase_app
    if _firebase_app is None:
        try:
            _firebase_app = firebase_admin.get_app("thermiq")
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
            _firebase_app = firebase_admin.initialize_app(cred, name="thermiq")
    return _firebase_app


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        app = get_firebase_app()
        db = firestore.client(app=app)

        docs = (
            db.collection("risk_scores")
            .order_by("risk_score_cr", direction=firestore.Query.DESCENDING)
            .limit(20)
            .stream()
        )

        gaps = []
        total_risk_cr = 0
        for doc in docs:
            data = doc.to_dict()
            risk_score_cr = data.get("risk_score_cr", 0)
            total_risk_cr += risk_score_cr
            gaps.append(
                {
                    "gap_id": doc.id,
                    "gap_description": data.get("description"),
                    "equipment": data.get("equipment"),
                    "risk_score_cr": risk_score_cr,
                    "criticality_score": data.get("criticality_score"),
                    "consequence_cr": data.get("consequence_cr"),
                    "exposure_score": data.get("exposure_score"),
                    "gap_type": data.get("gap_type"),
                    "supporting_outage_count": data.get("supporting_outage_count"),
                }
            )

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(
                {
                    "gaps": gaps,
                    "total_risk_cr": total_risk_cr,
                    "gap_count": len(gaps),
                }
            ),
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
