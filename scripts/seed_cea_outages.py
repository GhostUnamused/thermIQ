"""
One-time seed: writes realistic CEA-style forced outage records to Firestore.
Use when npp.gov.in is unreachable (sandbox/CI) or for demo purposes.
Run: python scripts/seed_cea_outages.py
"""
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

SAMPLE_OUTAGES = [
    # (station, unit, capacity_mw, mw_lost, days_ago, outage_hours, reason)
    ("NTPC RAMAGUNDAM", "U-5", 500, 500, 2, 96,  "BOILER TUBE LEAKAGE IN REAR WATERWALL"),
    ("NTPC RAMAGUNDAM", "U-7", 500, 500, 5, 144, "TURBINE ROTOR HIGH VIBRATION"),
    ("NTPC SINGRAULI",  "U-2", 200, 200, 1, 72,  "BOILER FURNACE TUBE BURST NEAR SUPERHEATER"),
    ("NTPC SINGRAULI",  "U-6", 500, 250, 3, 48,  "GENERATOR STATOR WINDING INSULATION FAILURE"),
    ("NTPC KORBA",      "U-4", 500, 500, 7, 168, "BOILER ECONOMISER TUBE LEAKAGE"),
    ("NTPC RIHAND",     "U-1", 500, 500, 4, 120, "TURBINE BLADE DAMAGE HP STAGE"),
    ("NTPC FARAKKA",    "U-3", 210, 210, 6, 96,  "CONDENSER VACUUM LOW DUE TO AIR INGRESS"),
    ("NTPC VINDHYACHAL","U-5", 500, 500, 9, 192, "BOILER TUBE FAILURE PLATEN SUPERHEATER"),
    ("NTPC TALCHER",    "U-2", 500, 500, 2, 84,  "FEED PUMP BFP SEAL FAILURE"),
    ("NTPC DADRI",      "U-1", 490, 490, 11, 72, "TURBINE GOVERNOR VALVE SEIZURE"),
    ("NTPC KAHALGAON",  "U-3", 210, 210, 8, 96,  "BOILER AIR PREHEATER BEARING FAILURE"),
    ("ADANI MUNDRA",    "U-2", 660, 660, 3, 144, "BOILER TUBE LEAKAGE REAR PASS"),
    ("ADANI MUNDRA",    "U-4", 660, 330, 13, 48, "GENERATOR EXCITER FLASHOVER"),
    ("ADANI TIRODA",    "U-1", 660, 660, 1, 72,  "TURBINE LP BLADE DAMAGE"),
    ("TATA MUNDRA",     "U-3", 800, 800, 6, 168, "CONDENSER TUBE LEAKAGE SEAWATER INGRESS"),
    ("MAHAGENCO KORADI","U-9", 660, 660, 4, 96,  "BOILER FURNACE TUBE BURST"),
    ("MAHAGENCO NASHIK","U-3", 210, 210, 10, 120,"TURBINE ROTOR VIBRATION HIGH"),
    ("UPRVUNL ANPARA",  "U-4", 500, 500, 7, 144, "BOILER SUPERHEATER TUBE FAILURE"),
    ("UPRVUNL PANKI",   "U-2", 210, 210, 3, 96,  "COOLING TOWER FILL COLLAPSE"),
    ("WBPDCL MEJIA",    "U-5", 250, 250, 5, 72,  "FEED PUMP BFP IMPELLER WEAR"),
    ("WBPDCL MEJIA",    "U-7", 500, 500, 12, 192,"BOILER TUBE LEAKAGE WATERWALL"),
    ("TNEB METTUR",     "U-4", 210, 210, 8, 96,  "GENERATOR WINDING FAULT TO EARTH"),
    ("HPGCL PANIPAT",   "U-6", 250, 125, 2, 48,  "CONDENSER VACUUM LOW"),
    ("RRVUNL KOTA",     "U-7", 195, 195, 9, 120, "TURBINE ROTOR HIGH VIBRATION TRIP"),
    ("CESC BUDGE BUDGE","U-3", 250, 250, 6, 96,  "BOILER TUBE LEAKAGE ECONOMISER"),
]

EQUIPMENT_RULES = [
    (["BOILER","FURNACE","SUPER HEATER","SUPERHEATER","ECONOMISER","AIR PREHEATER","WATERWALL"], "Boiler"),
    (["TURBINE","BLADE","ROTOR","GOVERNOR"], "Turbine"),
    (["GENERATOR","STATOR","WINDING","EXCITER"], "Generator"),
    (["CONDENSER","VACUUM","HOTWELL"], "Condenser"),
    (["FEED PUMP","BFP","BOILER FEED"], "BFP"),
    (["COOLING TOWER"], "Cooling Tower"),
]
FAILURE_CATEGORY_RULES = [
    (["TUBE LEAKAGE","TUBE BURST","TUBE FAILURE"], "tube_failure"),
    (["VIBRATION","VIBRATIONS HIGH"], "vibration"),
    (["VACUUM"], "vacuum_loss"),
    (["SEAL"], "seal_failure"),
    (["BLADE"], "blade_damage"),
    (["WINDING","INSULATION","FLASHOVER","FAULT TO EARTH"], "electrical_fault"),
    (["FEED PUMP","BFP","IMPELLER"], "pump_failure"),
    (["COLLAPSE"], "structural_failure"),
]

REVENUE_RATE = 4.5

def map_equipment(reason):
    ru = reason.upper()
    for kws, tag in EQUIPMENT_RULES:
        if any(k in ru for k in kws):
            return tag
    return "Other"

def map_failure(reason):
    ru = reason.upper()
    for kws, cat in FAILURE_CATEGORY_RULES:
        if any(k in ru for k in kws):
            return cat
    return "unclassified"

def main():
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.environ["FIREBASE_PROJECT_ID"],
        "private_key": os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
        "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    app = firebase_admin.initialize_app(cred, name="thermiq")
    db = firestore.client(app=app)

    now = datetime.utcnow()
    written = 0

    for station, unit, capacity_mw, mw_lost, days_ago, outage_hours, reason in SAMPLE_OUTAGES:
        date_out = now - timedelta(days=days_ago)
        expected_return = date_out + timedelta(hours=outage_hours)
        # MW × 1000 = kW; kW × hours = kWh; kWh × ₹/kWh = ₹; ÷ 1e7 = ₹ crore
        revenue_lost = round((mw_lost * 1000 * outage_hours * REVENUE_RATE) / 10_000_000, 2)

        date_out_str = date_out.strftime("%Y-%m-%d")
        doc_id = f"{station}_{unit}_{date_out_str}".replace(" ", "_").replace("/", "-")

        doc = {
            "station": station,
            "unit": unit,
            "capacity_mw": capacity_mw,
            "mw_lost": mw_lost,
            "outage_type": "forced",
            "date_out": date_out_str,
            "expected_return": expected_return.strftime("%Y-%m-%d"),
            "failure_reason_raw": reason,
            "equipment_tag": map_equipment(reason),
            "failure_category": map_failure(reason),
            "outage_hours": outage_hours,
            "revenue_lost_est_cr": revenue_lost,
            "fetched_at": now.isoformat() + "Z",
            "source": "sample_seed",
        }
        db.collection("cea_outages").document(doc_id).set(doc, merge=True)
        print(f"  ✓ {station} {unit} — {reason[:50]} → ₹{revenue_lost} Cr")
        written += 1

    total_mw = sum(r[3] for r in SAMPLE_OUTAGES)
    total_rev = sum(
        round((r[3] * 1000 * r[5] * REVENUE_RATE) / 10_000_000, 2)
        for r in SAMPLE_OUTAGES
    )
    print(f"\nSeeded {written} records | Total MW lost: {total_mw} | Total revenue impact: ₹{total_rev:.2f} Cr")

if __name__ == "__main__":
    main()
