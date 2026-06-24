"""
Downloads the CEA daily generation outage report and upserts forced-outage
records into Firestore (cea_outages collection).

Run daily by .github/workflows/cea-ingest.yml.
"""
import os
from datetime import datetime, timedelta

import openpyxl
import requests
from dotenv import load_dotenv
from io import BytesIO

import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

EQUIPMENT_RULES = [
    (["BOILER", "FURNACE", "SUPER HEATER", "ECONOMISER", "TUBE"], "Boiler"),
    (["TURBINE", "BLADE", "ROTOR", "GOVERNOR"], "Turbine"),
    (["GENERATOR", "STATOR", "WINDING", "EXCITER"], "Generator"),
    (["CONDENSER", "VACUUM", "HOTWELL"], "Condenser"),
    (["FEED PUMP", "BFP", "BOILER FEED"], "BFP"),
    (["COOLING TOWER"], "Cooling Tower"),
]

FAILURE_CATEGORY_RULES = [
    (["TUBE LEAKAGE", "TUBE BURST", "TUBE FAILURE"], "tube_failure"),
    (["VIBRATION", "VIBRATIONS HIGH"], "vibration"),
    (["VACUUM"], "vacuum_loss"),
    (["SEAL"], "seal_failure"),
    (["BLADE"], "blade_damage"),
    (["WINDING", "INSULATION", "FLASHOVER"], "electrical_fault"),
    (["FEED PUMP", "BFP"], "pump_failure"),
]

REVENUE_RATE_PER_KWH = 4.5
DEFAULT_OUTAGE_HOURS = 72


def map_equipment_tag(reason):
    reason_upper = reason.upper()
    for keywords, tag in EQUIPMENT_RULES:
        if any(kw in reason_upper for kw in keywords):
            return tag
    return "Other"


def map_failure_category(reason):
    reason_upper = reason.upper()
    for keywords, category in FAILURE_CATEGORY_RULES:
        if any(kw in reason_upper for kw in keywords):
            return category
    return "unclassified"


def build_url(date):
    return (
        f"https://npp.gov.in/public-reports/cea/daily/dgr/"
        f"{date.strftime('%Y')}/{date.strftime('%m')}/{date.strftime('%d')}/"
        f"dgr{date.strftime('%d%m%Y')}.xls"
    )


def download_report():
    for days_back in (0, 1):
        date = datetime.utcnow() - timedelta(days=days_back)
        url = build_url(date)
        try:
            response = requests.get(url, timeout=30)
            if response.status_code == 200 and len(response.content) > 0:
                print(f"Fetched CEA report for {date.date()} from {url}")
                return response.content
        except requests.RequestException as e:
            print(f"Failed to fetch {url}: {e}")
    raise RuntimeError("Could not fetch CEA outage report for today or yesterday.")


def find_header_row(sheet):
    for row_idx in range(1, 6):
        row_values = [
            str(cell.value).strip().lower() if cell.value else ""
            for cell in sheet[row_idx]
        ]
        if any("station" in v for v in row_values):
            return row_idx, row_values
    raise RuntimeError("Could not locate header row in CEA report.")


def column_index(headers, candidates):
    for i, header in enumerate(headers):
        for candidate in candidates:
            if candidate in header:
                return i
    return None


def parse_report(content):
    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    sheet = wb.active

    header_row_idx, headers = find_header_row(sheet)

    col_station = column_index(headers, ["station"])
    col_unit = column_index(headers, ["unit"])
    col_capacity = column_index(headers, ["installed capacity"])
    col_outage_mw = column_index(headers, ["outage mw", "outage (mw)"])
    col_date_out = column_index(headers, ["date of outage"])
    col_expected_return = column_index(headers, ["expected date of return", "expected return"])
    col_reason = column_index(headers, ["reason for outage", "reason"])

    records = []
    for row in sheet.iter_rows(min_row=header_row_idx + 1, values_only=True):

        def get(col):
            return row[col] if col is not None and col < len(row) else None

        station = get(col_station)
        unit = get(col_unit)
        capacity = get(col_capacity)
        outage_mw = get(col_outage_mw)
        date_out = get(col_date_out)
        expected_return = get(col_expected_return)
        reason = get(col_reason)

        if not station or not outage_mw or not reason:
            continue
        try:
            outage_mw = float(outage_mw)
        except (TypeError, ValueError):
            continue
        if outage_mw <= 0 or not str(reason).strip():
            continue

        records.append(
            {
                "station": str(station).strip(),
                "unit": str(unit).strip() if unit else "",
                "capacity_mw": float(capacity) if capacity else None,
                "mw_lost": outage_mw,
                "date_out": date_out,
                "expected_return": expected_return,
                "reason": str(reason).strip(),
            }
        )

    return records


def to_date_string(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    return str(value) if value else ""


def compute_outage_hours(date_out, expected_return):
    if isinstance(date_out, datetime) and isinstance(expected_return, datetime):
        return (expected_return - date_out).total_seconds() / 3600
    return DEFAULT_OUTAGE_HOURS


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
    content = download_report()
    records = parse_report(content)

    db = get_firestore_client()
    total_mw_lost = 0
    total_revenue_lost_cr = 0
    processed = 0

    for record in records:
        equipment_tag = map_equipment_tag(record["reason"])
        failure_category = map_failure_category(record["reason"])
        outage_hours = compute_outage_hours(record["date_out"], record["expected_return"])
        revenue_lost_est_cr = (record["mw_lost"] * outage_hours * REVENUE_RATE_PER_KWH) / 10000000

        date_out_str = to_date_string(record["date_out"])
        doc_id = (
            f"{record['station']}_{record['unit']}_{date_out_str}"
            .replace(" ", "_")
            .replace("/", "-")
        )

        doc = {
            "station": record["station"],
            "unit": record["unit"],
            "capacity_mw": record["capacity_mw"],
            "mw_lost": record["mw_lost"],
            "outage_type": "forced",
            "date_out": date_out_str,
            "expected_return": to_date_string(record["expected_return"]),
            "failure_reason_raw": record["reason"],
            "equipment_tag": equipment_tag,
            "failure_category": failure_category,
            "outage_hours": outage_hours,
            "revenue_lost_est_cr": round(revenue_lost_est_cr, 2),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }

        db.collection("cea_outages").document(doc_id).set(doc, merge=True)

        total_mw_lost += record["mw_lost"]
        total_revenue_lost_cr += revenue_lost_est_cr
        processed += 1

    print(f"Processed {processed} outage records.")
    print(f"Total MW lost: {total_mw_lost:.1f}")
    print(f"Total revenue impact: Rs. {total_revenue_lost_cr:.2f} crore")


if __name__ == "__main__":
    main()
