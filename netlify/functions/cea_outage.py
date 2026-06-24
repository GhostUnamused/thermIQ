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
            db.collection("cea_outages")
            .order_by("date_out", direction=firestore.Query.DESCENDING)
            .limit(30)
            .stream()
        )

        outages = []
        total_forced_outages = 0
        total_mw_lost = 0
        total_revenue_lost_cr = 0
        outages_by_equipment = {}

        for doc in docs:
            data = doc.to_dict()
            outages.append(data)

            if data.get("outage_type") == "forced":
                total_forced_outages += 1

            total_mw_lost += data.get("mw_lost", 0) or 0
            total_revenue_lost_cr += data.get("revenue_lost_est_cr", 0) or 0

            equipment_tag = data.get("equipment_tag", "Other")
            outages_by_equipment[equipment_tag] = (
                outages_by_equipment.get(equipment_tag, 0) + 1
            )

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(
                {
                    "outages": outages,
                    "total_forced_outages": total_forced_outages,
                    "total_mw_lost": total_mw_lost,
                    "total_revenue_lost_cr": round(total_revenue_lost_cr, 2),
                    "outages_by_equipment": outages_by_equipment,
                }
            ),
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)}),
        }
