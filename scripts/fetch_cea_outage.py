"""
Downloads the CEA daily generation outage report and upserts forced-outage
records into Firestore (cea_outages collection).

Run daily by .github/workflows/cea-ingest.yml.
"""
import os
from datetime import datetime, timedelta

import xlrd
import requests
from dotenv import load_dotenv

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

# Revenue rate used to convert MW-hours lost into ₹ Crore opportunity cost.
# Source: LBNL / Ember "Least-Cost Pathway for India's Power System" (2024)
#   — India's existing coal fleet weighted average all-in tariff: ₹4.78/kWh.
#   Rounded up to ₹5.00/kWh to include grid balancing / imbalance costs that
#   a forced outage imposes on the system beyond the plant's own variable cost.
# Previous value was ₹4.5/kWh (no source) — corrected 2026-06-26.
REVENUE_RATE_PER_KWH = 5.0
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


def build_url(date, report_num):
    """New URL format (as of 2026):
    /public-reports/cea/daily/dgr/{DD-MM-YYYY}/dgr{N}-{YYYY-MM-DD}.xls
    Report 10 = Daily Maintenance Report (Coal, Lignite & Nuclear)
    Report 11 = Daily Maintenance Report (Thermal & others)
    """
    date_folder = date.strftime("%d-%m-%Y")
    date_file = date.strftime("%Y-%m-%d")
    return (
        f"https://npp.gov.in/public-reports/cea/daily/dgr/"
        f"{date_folder}/dgr{report_num}-{date_file}.xls"
    )


def download_report():
    # Try today and yesterday, and report numbers 10 then 11
    # (both are Daily Maintenance Reports — 10 is coal/lignite/nuclear, 11 is thermal)
    for days_back in (0, 1):
        date = datetime.utcnow() - timedelta(days=days_back)
        for report_num in (10, 11, 9):
            url = build_url(date, report_num)
            try:
                response = requests.get(url, timeout=30)
                if response.status_code == 200 and len(response.content) > 1000:
                    print(f"Fetched CEA report dgr{report_num} for {date.date()} from {url}")
                    return response.content
                else:
                    print(f"  Skip {url} — status {response.status_code} / size {len(response.content)}")
            except requests.RequestException as e:
                print(f"  Failed {url}: {e}")
    raise RuntimeError("Could not fetch CEA outage report. Check URL pattern at npp.gov.in/dgrReports")


def load_rows(content):
    """CEA serves legacy binary .xls (OLE2/CFBF), not .xlsx — read with xlrd."""
    wb = xlrd.open_workbook(file_contents=content)
    sheet = wb.sheet_by_index(0)
    return [
        [sheet.cell_value(r, c) for c in range(sheet.ncols)]
        for r in range(sheet.nrows)
    ]


def find_header_row(rows):
    for row_idx in range(0, 8):
        row_values = [str(v).strip().lower() if v != "" else "" for v in rows[row_idx]]
        if any("station" in v for v in row_values):
            return row_idx, row_values
    raise RuntimeError("Could not locate header row in CEA report.")


def parse_dgr_datetime(value):
    """CEA dates come through as plain text 'DD/MM/YYYY HH24:MM', not Excel date cells."""
    if not value or not str(value).strip():
        return None
    try:
        return datetime.strptime(str(value).strip(), "%d/%m/%Y %H:%M")
    except ValueError:
        return None


def column_index(headers, candidates):
    for i, header in enumerate(headers):
        for candidate in candidates:
            if candidate in header:
                return i
    return None


def parse_report(content):
    rows = load_rows(content)
    header_row_idx, headers = find_header_row(rows)

    # Real CEA "Daily Maintenance Report" columns (no single "outage MW" or
    # "installed capacity" column — forced outage MW is split into
    # Major/Minor, and capacity isn't reported here at all).
    col_station = column_index(headers, ["power station", "station"])
    col_unit = column_index(headers, ["unit"])
    col_forced_major = column_index(headers, ["forced maintenance (major)"])
    col_forced_minor = column_index(headers, ["forced maintenance (minor)"])
    col_date_out = column_index(headers, ["date& time of maintenance", "date and time of maintenance"])
    col_expected_return = column_index(headers, ["expected/sync date of return", "expected return"])
    col_reason = column_index(headers, ["reasons/present status", "reason"])

    records = []
    for row in rows[header_row_idx + 1:]:

        def get(col):
            return row[col] if col is not None and col < len(row) else None

        station = get(col_station)
        unit = get(col_unit)
        major_mw = get(col_forced_major)
        minor_mw = get(col_forced_minor)
        date_out = get(col_date_out)
        expected_return = get(col_expected_return)
        reason = get(col_reason)

        if not station or not str(station).strip() or not reason or not str(reason).strip():
            continue
        try:
            outage_mw = float(major_mw or 0) + float(minor_mw or 0)
        except (TypeError, ValueError):
            continue
        if outage_mw <= 0:
            continue  # planned-only or zero-MW row, not a forced outage

        records.append(
            {
                "station": str(station).strip(),
                "unit": str(unit).strip() if unit else "",
                "capacity_mw": None,  # not reported in this CEA report
                "mw_lost": outage_mw,
                "date_out": parse_dgr_datetime(date_out),
                "expected_return": parse_dgr_datetime(expected_return),
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
        # MW × 1000 = kW; kW × hours = kWh; kWh × ₹/kWh = ₹; ÷ 1e7 = ₹ crore
        revenue_lost_est_cr = (record["mw_lost"] * 1000 * outage_hours * REVENUE_RATE_PER_KWH) / 10000000

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
