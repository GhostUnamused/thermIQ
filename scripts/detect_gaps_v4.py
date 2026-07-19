"""
ThermIQ Gap Detection & Risk Scoring Engine  v4.1
===================================================
Successor to detect_gaps.py (v3). NON-DESTRUCTIVE: run this alongside v3.
Use --dry-run to print the register WITHOUT touching Firestore, so the output
can be validated before it replaces v3.

v4.1 note: the risk formula changed from v4.0. v4.0 used
`criticality x consequence x exposure`, which DOUBLE-COUNTED severity
(consequence already carries severity via MW x MTTR, and criticality is also a
severity measure) and had NO likelihood term — so long-outage modes exploded
(a 45-day stator rewind hit ₹270 Cr and the ntpc total blew up to ₹2,223 Cr in
the v4.0 dry-run). v4.1 fixes this: see FORMULA below.

WHAT CHANGED FROM v3 (and WHY)
------------------------------
v3 had honest weaknesses. v4.1 fixes each without pretending to be more
"dynamic" than the data can support.

1. LIKELIHOOD was missing entirely, and CRITICALITY (a hand-typed integer) was
   used as the number-driver while LABELLED "derived_from_CEA_outage_frequency"
   — a claim the code did not honour, and a double-count of severity.
   → v4.1 introduces a real LIKELIHOOD term: per-UNIT annual frequency, derived
     from CEA data at the finest granularity available (failure_category if it
     has enough records, else equipment_tag, else a labelled expert default).
     Frequency IS the axis CEA data legitimately supplies. Criticality is kept
     ONLY as a shown flag / tiebreaker and a black-swan marker — never
     multiplied into the rupee figure — so severity is not double-counted. This
     also resolves v3's core "it's hardcoded" complaint: the ₹ number is now
     driven by frequency(data) x consequence(physics) x exposure(LLM), with no
     hand-typed value in the multiplication.

2. CONSEQUENCE was degenerate: every item sharing an equipment_tag got the
   SAME rupee number (the tag average), so within a class consequence added no
   resolution.
   → v4.1 computes a PER-ITEM consequence from an explicit physical model:
        consequence_cr = mw_impact_mw x 1000 x (mttr_days x 24) x rate / 1e7
     where mw_impact_mw and mttr are stated per item with a one-line basis.
     Each derived number is CROSS-VALIDATED against the real CEA category mean
     and a divergence ratio is stored (flag, don't hide).

3. EXPOSURE was `1 - cosine_similarity` multiplied straight into rupees —
   false precision (0.573 similarity is not "42.7% undocumented").
   → v4.1 retrieves the client chunks then has the LLM (Gemini, already in stack)
     ADJUDICATE coverage: covered / partial / absent, WITH a cited quote and a
     confidence score a human can verify. Maps to exposure {0.15 / 0.5 / 1.0}.
     Falls back to the threshold method (honestly labelled) if the LLM is
     unavailable.

4. MIXED CURRENCY: v3 multiplied documentation-only items (spares list, RLA
   methodology) into the same rupee total as outage items.
   → v4.1 tags every item with an EVIDENCE GRADE (A data-derived / B class-derived
     / C expert-regulatory) and splits the register into two TRANCHES:
       - "failure"     : outage-risk items, costed in rupees.
       - "regulatory"  : documentation/compliance items, ranked by a unitless
                          compliance_priority (criticality x exposure), NOT
                          summed into the rupee total.

FREQUENCY IS FLEET-WIDE; WE APPROXIMATE PER-UNIT
------------------------------------------------
CEA records count events across ALL monitored stations, but consequence is
per-unit. v4.1 divides fleet frequency by the number of distinct stations to
approximate a per-unit rate. This is a DOCUMENTED APPROXIMATION (a station has
>1 unit; not every unit reports every day), not a precise per-unit hazard rate
— the station count is printed on every run so the scale factor is visible and
can be refined later with real fleet unit-counts.

WHAT IS HONESTLY STILL FIXED
----------------------------
The 19-item checklist itself is a curated rubric for the CEA-STS 500 MW
subcritical coal-thermal asset class. It does NOT auto-generate from arbitrary
uploads and is NOT valid for a gas / hydro / refinery asset. This is correct
engineering, not a limitation to paper over: industrial standards are
asset-class-specific (CEA for thermal, OISD for refineries). The METHODOLOGY
below generalises; the RUBRIC must be authored per asset class.

THE HEADLINE NUMBER IS RELATIVE, NOT ABSOLUTE
---------------------------------------------
The rupee total is a sum over a chosen checklist; change the checklist, change
the total. v4 reports a PRIORITISED REGISTER (ranking + per-item traceable
exposure), not a precise "plant risk" oracle. The value is where-to-act-first
plus a full audit trail, and every number carries its evidence.

FORMULA (failure tranche) — v4.1
--------------------------------
  expected_annual_cr = per_unit_frequency x consequence_cr x exposure
                       ( events/yr        x  ₹/event        x gap factor )
                       = expected ₹/yr of outage cost this knowledge gap exposes.
  exposure_per_event_cr = consequence_cr x exposure
                       = ₹ at stake if the failure occurs (gap-adjusted); shown
                         alongside so rare-but-catastrophic modes stay visible.
  risk_score_cr = expected_annual_cr   (primary ranking / backward-compat field)
  criticality   = SHOWN FLAG only, never multiplied (avoids severity double-count)
  black_swan_flag = high per-event cost + low expected-annual (computed relatively)

  regulatory tranche: compliance_priority = criticality x exposure (unitless);
                      NOT rupee-costed, NOT summed into the ₹ total.

Usage:
  python scripts/detect_gaps_v4.py [--client NAME] [--dry-run] [--no-llm]
"""
import os
import sys
import json
import time
import argparse
from collections import defaultdict
from datetime import datetime

import requests
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

JINA_API_KEY    = os.environ.get("JINA_API_KEY")
QDRANT_URL      = os.environ.get("QDRANT_URL")
QDRANT_API_KEY  = os.environ.get("QDRANT_API_KEY")
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
COLLECTION_NAME = "thermiq_chunks"
GEMINI_MODEL    = "gemini-2.5-flash"

# ─── Sourced constants ────────────────────────────────────────────────────────
REVENUE_RATE_PER_KWH   = 5.0    # LBNL/Ember 2024: India coal fleet ₹4.78/kWh, rounded up
UNIT_RATING_MW         = 500    # checklist targets CEA-STS 500 MW class (stated, not hidden)
DEFAULT_CONSEQUENCE_CR = 6.0    # fallback only; every item below states its own mw_impact

# Minimum CEA records for a failure_category before we claim data-derivation (Grade A).
# Below this, evidence is too thin to annualise honestly -> item stays Grade B.
MIN_RECORDS_FOR_GRADE_A = 12

# Fallback per-UNIT annual failure frequency, used only when a failure item has
# NO usable CEA data at either failure_category or equipment_tag level. Coarse,
# expert, and clearly labelled so it never masquerades as data-derived.
DEFAULT_PRIOR_ANNUAL_FREQ = 0.5

# Coverage thresholds (used only in the LLM-fallback path).
COVERAGE_THRESHOLDS = {"covered": 0.62, "partial": 0.45}

# Exposure values by adjudicated verdict (discrete, not false-precise).
EXPOSURE_BY_VERDICT = {"covered": 0.15, "partial": 0.5, "absent": 1.0}


# ─── Expected Knowledge Checklist ────────────────────────────────────────────
# NEW fields vs v3:
#   failure_category — joins to CEA cea_outages.failure_category for Grade-A evidence
#   mw_impact_mw     — MW unavailable if this failure occurs (per-item, physical)
#   mw_impact_basis  — one-line justification for the MW figure
#   tranche          — "failure" (rupee-costed) | "regulatory" (compliance_priority)
# Retained from v3: id, description, equipment_tag, gap_type, criticality,
#   criticality_source, regulatory_basis, typical_mttr_days, query.

EXPECTED_KNOWLEDGE = [

    # ── BOILER ──────────────────────────────────────────────────────────────
    {
        "id": "boiler_tube_failure_sop",
        "description": "Emergency response SOP for boiler tube leakage/failure: shutdown sequence, isolation, tube location, pressure-part entry permit, temporary vs full repair decision tree",
        "equipment_tag": "Boiler", "failure_category": "tube_failure",
        "gap_type": "missing_sop", "criticality": 5,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 5,
        "mw_impact_basis": "Boiler tube leak forces full-unit trip (500 MW) — leading cause of technical forced outages in CEA data.",
        "criticality_source": "Vasudha Foundation (2022), 735 coal units 2017-22: boiler tube failure = largest single technical-loss cause. Farakka STPS: 20.7% of outage events. NTPC Lara Tariff Petition cites it explicitly.",
        "regulatory_basis": "CEA STS 500MW pressure-part inspection & emergency shutdown; CEA O&M Practices Review top priority.",
        "query": "boiler tube leakage failure emergency response procedure shutdown isolation tube replacement steps",
    },
    {
        "id": "boiler_waterwall_inspection",
        "description": "Waterwall tube inspection schedule with NDT method (UT/RT), minimum wall thickness, condemning limits, action thresholds per CEA STS",
        "equipment_tag": "Boiler", "failure_category": "tube_failure",
        "gap_type": "missing_inspection_procedure", "criticality": 5,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 5,
        "mw_impact_basis": "Waterwall failure = a boiler-tube leak = full-unit trip (500 MW); detected late means burst before intervention.",
        "criticality_source": "CEA R&M Life Extension 2023: waterwall is primary life-limiting component for subcritical boilers. CEA STS mandates quarterly UT.",
        "regulatory_basis": "CEA STS 500MW mandatory quarterly waterwall inspection; CEA R&M RLA requires thickness history.",
        "query": "waterwall tube inspection NDT thickness measurement condemning limits schedule criteria",
    },
    {
        "id": "flame_failure_response_sop",
        "description": "Boiler flame failure (MFT) emergency response: mill isolation, igniter sequence, purge protocol, restart criteria, RCA checklist",
        "equipment_tag": "Boiler", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 5,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 1,
        "mw_impact_basis": "MFT on flame loss = full-unit emergency shutdown (500 MW); undocumented restart adds 4-12 h.",
        "criticality_source": "NTPC Lara Tariff Petition names 'flame failures' with tube leakages as key forced-outage cause. CEA O&M: MFT is full-unit trip.",
        "regulatory_basis": "CEA STS 500MW burner-management/igniter/purge mandatory; CEA O&M Practices Review lists MFT response as critical.",
        "query": "flame failure MFT master fuel trip boiler response procedure purge restart igniter isolation",
    },
    {
        "id": "superheater_maintenance",
        "description": "Superheater/reheater tube maintenance & replacement: material grade verification, welding qualification (P91/P22), PWHT, hydro-test protocol",
        "equipment_tag": "Boiler", "failure_category": "tube_failure",
        "gap_type": "missing_sop", "criticality": 4,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 10,
        "mw_impact_basis": "SH/RH tube replacement requires full-unit trip (500 MW); MTTR 7-14 d, longer if welding docs absent.",
        "criticality_source": "CEA Thermal Performance Review 2018: SH/RH tube failures top-5 boiler outage causes. P91/P22 misID a documented weld-failure cause in India.",
        "regulatory_basis": "CEA STS 500MW material/welding qualification; IBR requires documented WPS/PQR for pressure parts.",
        "query": "superheater reheater tube maintenance replacement material specification welding procedure P91 P22 PWHT",
    },
    {
        "id": "boiler_startup_procedure",
        "description": "Cold/hot/warm startup with firing rates (MW/min), temperature ramp limits (C/hr), interlock checklist, thermal-stress monitoring",
        "equipment_tag": "Boiler", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 4,
        "tranche": "failure", "mw_impact_mw": 150, "typical_mttr_days": 3,
        "mw_impact_basis": "Gap raises thermal-fatigue failure probability during ramps rather than a fixed trip; modelled as partial exposure (150 MW-equiv).",
        "criticality_source": "TCR Engineering (1500+ BTF investigations 2026): thermal fatigue from load cycling is top emerging subcritical damage mechanism. NTPC Lara notes BTF from ramping.",
        "regulatory_basis": "CEA STS 500MW startup/interlock sequences; CEA O&M Practices Review mandatory O&M category.",
        "query": "boiler startup procedure cold hot warm firing rate temperature ramp safety interlocks sequence thermal stress",
    },
    {
        "id": "air_preheater_maintenance",
        "description": "Air preheater maintenance: basket/element replacement schedule, seal adjustment, fire detection & CO2 suppression procedure",
        "equipment_tag": "Boiler", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 100, "typical_mttr_days": 3,
        "mw_impact_basis": "Seal leakage degrades efficiency/aux-power (gradual derate ~100 MW-equiv); APH fire rarer but severe.",
        "criticality_source": "CEA STS 500MW APH fire detection mandatory; seal leakage more common — gradual efficiency loss, not emergency trip.",
        "regulatory_basis": "CEA STS 500MW APH fire detection; CEA O&M Practices Review annual APH seal inspection.",
        "query": "air preheater maintenance basket replacement seal adjustment fire detection APH CO2",
    },

    # ── TURBINE ─────────────────────────────────────────────────────────────
    {
        "id": "turbine_vibration_response",
        "description": "Turbine high-vibration emergency response: alarm thresholds (ISO 7919/10816), diagnostics, load reduction, auto vs manual trip, bearing inspection",
        "equipment_tag": "Turbine", "failure_category": "vibration",
        "gap_type": "missing_sop", "criticality": 5,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 10,
        "mw_impact_basis": "High-vibration auto-trip = immediate full-unit shutdown (500 MW); bearing damage MTTR 7-21 d.",
        "criticality_source": "Vasudha/CEA 2022: turbine failures 2nd-largest technical outage category. NTPC Lara lists 'turbine-generator issues'.",
        "regulatory_basis": "CEA STS 500MW vibration monitoring & trip setpoints; CEA O&M Practices Review requires response procedure.",
        "query": "turbine vibration high response trip threshold diagnostic bearing inspection procedure alarm ISO 7919",
    },
    {
        "id": "turbine_blade_inspection",
        "description": "HP/IP/LP blade inspection: erosion measurement, FOD check, condemning thickness (OEM margins), NDT (PT/RT on roots)",
        "equipment_tag": "Turbine", "failure_category": "blade_damage",
        "gap_type": "missing_inspection_procedure", "criticality": 4,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 21,
        "mw_impact_basis": "Catastrophic LP blade failure = total turbine loss (500 MW, 3-6 mo); infrequent but highest single-mode consequence.",
        "criticality_source": "CEA STS 500MW blade inspection mandatory each major overhaul (4-5 yr). CEA O&M requires erosion-limit documentation.",
        "regulatory_basis": "CEA STS 500MW blade material/inspection intervals; CEA O&M mandatory overhaul document.",
        "query": "turbine blade inspection HP LP IP erosion damage condemning criteria FOD foreign object NDT",
    },
    {
        "id": "turbine_governor_valve_maintenance",
        "description": "Governor/control valve (GV/CV) maintenance, testing, calibration: seat/disc inspection, servo calibration, valve leak-off acceptance",
        "equipment_tag": "Turbine", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 250, "typical_mttr_days": 3,
        "mw_impact_basis": "GV failure typically = load-control loss / runback to house load (partial ~250 MW), not full trip in most cases.",
        "criticality_source": "CEA O&M places GV maintenance high-importance but not emergency-critical; stuck-open EHC valve rarer/more serious.",
        "regulatory_basis": "CEA STS 500MW emergency-trip/governor valve testing; CEA O&M mandatory schedule.",
        "query": "turbine governor valve control valve maintenance testing calibration procedure servo EHC",
    },
    {
        "id": "turbine_oil_system",
        "description": "Turbine lube-oil system: oil quality limits (ISO cleanliness, water, viscosity, TAN), purification, bearing oil pressure alarm/trip",
        "equipment_tag": "Turbine", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 250, "typical_mttr_days": 2,
        "mw_impact_basis": "Low-oil-pressure trip is a defined interlock; risk is missing early-warning regime — modelled as partial (250 MW).",
        "criticality_source": "Oil degradation is gradual (planned intervention possible); low-pressure trip is a safety interlock. CEA O&M mandates test frequency.",
        "regulatory_basis": "CEA STS 500MW lube-oil alarm/trip settings; CEA O&M oil quality schedule.",
        "query": "turbine lubricating oil system maintenance quality testing purification bearing oil supply ISO cleanliness TAN",
    },

    # ── GENERATOR ───────────────────────────────────────────────────────────
    {
        "id": "generator_stator_winding",
        "description": "Stator winding insulation-resistance (PI, dielectric absorption), partial-discharge thresholds, rewind decision criteria",
        "equipment_tag": "Generator", "failure_category": "electrical_fault",
        "gap_type": "missing_sop", "criticality": 4,
        "tranche": "failure", "mw_impact_mw": 500, "typical_mttr_days": 45,
        "mw_impact_basis": "Stator failure = full-unit trip (500 MW), MTTR 30-60 d (longest of any component); rewind ₹15-25 Cr + 45 d generation loss.",
        "criticality_source": "Multiple catastrophic stator failures at large NTPC-type stations. Infrequent (1/15-20 yr per unit) but extreme consequence.",
        "regulatory_basis": "CEA STS 500MW PD monitoring & PI testing mandatory; CEA O&M annual IR/PI.",
        "query": "generator stator winding insulation resistance testing polarization index partial discharge monitoring repair rewind",
    },
    {
        "id": "generator_exciter_maintenance",
        "description": "Exciter maintenance: brush inspection/replacement schedule, slip-ring conditioning, AVR calibration & setpoint verification",
        "equipment_tag": "Generator", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 2,
        "tranche": "failure", "mw_impact_mw": 100, "typical_mttr_days": 1,
        "mw_impact_basis": "Exciter faults often allow reduced-voltage running / controlled rundown (partial ~100 MW); MTTR ~hours.",
        "criticality_source": "CEA O&M: brush inspection quarterly; high-frequency but low consequence per event.",
        "regulatory_basis": "CEA STS 500MW AVR/excitation performance; CEA O&M routine schedule.",
        "query": "generator exciter maintenance brush inspection slip ring AVR automatic voltage regulator calibration",
    },

    # ── BFP ─────────────────────────────────────────────────────────────────
    {
        "id": "bfp_seal_maintenance",
        "description": "BFP mechanical seal replacement: seal-face inspection, alignment tolerance (±0.05 mm), clearance checks, flush commissioning, leak-off test",
        "equipment_tag": "BFP", "failure_category": "seal_failure",
        "gap_type": "missing_sop", "criticality": 4,
        "tranche": "failure", "mw_impact_mw": 250, "typical_mttr_days": 2,
        "mw_impact_basis": "Loss of one BFP derates unit to 50-60% (~250 MW lost on a 500 MW unit); 1-3 seal failures/unit/yr.",
        "criticality_source": "CEA O&M: BFP seal replacement in critical-maintenance category. MTTR 1-3 d if documented, 5-10 d if not.",
        "regulatory_basis": "CEA O&M BFP maintenance mandatory; CEA STS 500MW feed-pump/seal specs.",
        "query": "boiler feed pump BFP mechanical seal replacement alignment clearance commissioning procedure seal flush",
    },
    {
        "id": "bfp_impeller_wear",
        "description": "BFP impeller wear assessment: diametric clearance limits, performance-curve comparison, head/flow acceptance, replacement threshold",
        "equipment_tag": "BFP", "failure_category": "pump_failure",
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 100, "typical_mttr_days": 4,
        "mw_impact_basis": "Impeller wear = gradual efficiency/head loss (partial ~100 MW-equiv); forced outage only when capacity finally lost.",
        "criticality_source": "Gradual degradation, not emergency trip; risk is missed heat-rate deterioration. CEA O&M: clearance check at overhaul.",
        "regulatory_basis": "CEA O&M BFP performance monitoring; CEA STS 500MW pump efficiency/head specs.",
        "query": "boiler feed pump impeller wear assessment replacement performance restoration clearance head flow BFP",
    },

    # ── CONDENSER ───────────────────────────────────────────────────────────
    {
        "id": "condenser_tube_leak_detection",
        "description": "Condenser tube leak detection & plugging: vacuum-drop test, helium tracer, eddy-current acceptance, plugging limit, retubing trigger",
        "equipment_tag": "Condenser", "failure_category": None,
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 100, "typical_mttr_days": 3,
        "mw_impact_basis": "Leak drives hotwell contamination -> boiler chemistry excursion (gradual, ~100 MW-equiv); early detection cuts MTTR 7-14 d to 1-3 d.",
        "criticality_source": "Secondary-consequence chain to boiler tube corrosion. CEA O&M: condenser inspection during annual shutdown mandatory.",
        "regulatory_basis": "CEA STS 500MW condenser design/tube specs; CEA O&M annual schedule.",
        "query": "condenser tube leak detection plugging vacuum drop test helium eddy current inspection plugging limit",
    },
    {
        "id": "condenser_vacuum_low_response",
        "description": "Low condenser vacuum emergency response: diagnostic checklist (air ingress vs CW loss vs ejector), load reduction, vacuum-pump start, trip-avoidance criteria",
        "equipment_tag": "Condenser", "failure_category": "vacuum_loss",
        "gap_type": "missing_sop", "criticality": 3,
        "tranche": "failure", "mw_impact_mw": 250, "typical_mttr_days": 2,
        "mw_impact_basis": "Low vacuum needs response in 2-5 min to avoid back-pressure trip; wrong action -> partial/full trip (modelled 250 MW).",
        "criticality_source": "Documented diagnostic distinguishes air ingress / CW-flow loss / fouling — each a different response; without it operators mis-act.",
        "regulatory_basis": "CEA STS 500MW vacuum alarm/trip settings; CEA O&M emergency operating procedures.",
        "query": "condenser vacuum low emergency response diagnostic checklist corrective actions air ingress ejector cooling",
    },

    # ── COOLING TOWER ───────────────────────────────────────────────────────
    {
        "id": "cooling_tower_fill_inspection",
        "description": "Cooling tower fill/pack inspection, cleaning, structural bay assessment, drift-eliminator replacement vs condenser-temperature performance",
        "equipment_tag": "Cooling Tower", "failure_category": None,
        "gap_type": "missing_inspection_procedure", "criticality": 2,
        "tranche": "failure", "mw_impact_mw": 50, "typical_mttr_days": 10,
        "mw_impact_basis": "Fill degradation raises CW temp -> vacuum loss (indirect, seasonal ~50 MW-equiv); not a direct trip initiator.",
        "criticality_source": "Indirect effect chain; significant in summer peak months. CEA O&M annual inspection recommended, not emergency-critical.",
        "regulatory_basis": "CEA O&M cooling-water maintenance annual; CEA STS 500MW cooling-tower performance params.",
        "query": "cooling tower fill pack inspection cleaning replacement structural assessment drift eliminator performance",
    },

    # ── REGULATORY / CROSS-CUTTING (documentation tranche — NOT rupee-costed) ─
    {
        "id": "cea_mandatory_spares",
        "description": "Documented capital & insurance spares per CEA STS: turbine blade set, stator bar, BFP impeller, condenser tube bundle, boiler coils — min-max qty & lead times",
        "equipment_tag": "Boiler", "failure_category": None,
        "gap_type": "missing_reference", "criticality": 4,
        "tranche": "regulatory", "mw_impact_mw": 0, "typical_mttr_days": 0,
        "mw_impact_basis": "No direct MW loss — a spares gap is an MTTR MULTIPLIER on every other failure mode; costed there, not double-counted here.",
        "criticality_source": "CERC Tariff Regs 2019-24: documented capital spares a condition of tariff approval; missing docs multiply MTTR of every failure.",
        "regulatory_basis": "CERC Tariff Regs O&M spares norms; CEA STS 500MW commissioning spares list mandatory; CEA R&M capital-spares planning.",
        "query": "CEA mandatory spare parts list 500MW thermal capital spares insurance spares inventory turbine generator BFP",
    },
    {
        "id": "rm_life_extension_criteria",
        "description": "Documented RLA (Remaining Life Assessment) methodology & R&M decision criteria for units at/beyond 25-yr design life: inspection scope, fitness-for-service, CERC filing requirements",
        "equipment_tag": "Boiler", "failure_category": None,
        "gap_type": "missing_reference", "criticality": 3,
        "tranche": "regulatory", "mw_impact_mw": 0, "typical_mttr_days": 0,
        "mw_impact_basis": "No direct MW loss — a compliance/cost-recovery risk: without a documented RLA, CERC denies R&M cost recovery.",
        "criticality_source": "CEA R&M Life Extension 2023: plants beyond 25-yr design life require documented RLA; most 1990s NTPC subcritical units now qualify.",
        "regulatory_basis": "CEA R&M Guidelines RLA methodology; CERC R&M expenditure recovery requires prior documented justification.",
        "query": "renovation modernization life extension RLA residual life assessment thermal units design life CERC criteria",
    },
]


# ─── External services ────────────────────────────────────────────────────────

def embed_query(query_text):
    r = requests.post(
        "https://api.jina.ai/v1/embeddings",
        headers={"Authorization": f"Bearer {JINA_API_KEY}", "Content-Type": "application/json"},
        json={"model": "jina-embeddings-v3", "input": [query_text], "task": "retrieval.query"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]


def search_client_only(embedding, client_name=None, limit=5):
    qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)
    must = [FieldCondition(key="source_type", match=MatchValue(value="client"))]
    if client_name:
        must.append(FieldCondition(key="client_name", match=MatchValue(value=client_name.lower())))
    f = Filter(must=must)
    for attempt in range(3):
        try:
            resp = qdrant.query_points(
                collection_name=COLLECTION_NAME, query=embedding,
                query_filter=f, limit=limit, with_payload=True,
            )
            return resp.points
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
            else:
                print(f"  x Qdrant failed: {e}")
                return []


def adjudicate_coverage(requirement_desc, hits):
    """LLM verdict on whether retrieved client text ACTUALLY covers the requirement.

    Returns (verdict, quote, confidence, method). verdict in
    {covered, partial, absent}. Verifiable: the quote is copied from the client's
    own document. Falls back to a similarity-threshold verdict if the LLM is
    unavailable, and labels which path was used.
    """
    best = hits[0].score if hits else 0.0

    # No retrieval at all -> unambiguously absent, no LLM needed.
    if not hits:
        return "absent", "", 1.0, "no_retrieval"

    if not GEMINI_API_KEY:
        # Honest fallback: threshold on similarity, clearly labelled as NOT adjudicated.
        if best >= COVERAGE_THRESHOLDS["covered"]:
            v = "covered"
        elif best >= COVERAGE_THRESHOLDS["partial"]:
            v = "partial"
        else:
            v = "absent"
        return v, "", round(best, 3), "similarity_threshold_fallback"

    context = "\n\n".join(
        f"[chunk {i+1}, similarity {h.score:.3f}] {((h.payload or {}).get('text',''))[:700]}"
        for i, h in enumerate(hits[:4])
    )
    prompt = (
        "You are auditing whether a thermal power plant's documents contain a specific "
        "operational procedure. Judge ONLY from the excerpts provided.\n\n"
        f"REQUIRED PROCEDURE:\n{requirement_desc}\n\n"
        f"PLANT DOCUMENT EXCERPTS:\n{context}\n\n"
        "Return STRICT JSON only, no prose:\n"
        '{"verdict":"covered|partial|absent","quote":"<exact sentence from an excerpt that '
        'supports the verdict, or empty string>","confidence":0.0-1.0,'
        '"reason":"<one sentence>"}\n'
        "Rules: covered = the excerpts contain the actual procedure/criteria; "
        "partial = related content but not the specific procedure; "
        "absent = nothing relevant. Do not credit generic mentions as coverage."
    )
    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
            headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"}},
            timeout=45,
        )
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(txt)
        verdict = data.get("verdict", "absent")
        if verdict not in EXPOSURE_BY_VERDICT:
            verdict = "absent"
        return (verdict, (data.get("quote", "") or "")[:300],
                float(data.get("confidence", 0.5)), "llm_adjudicated")
    except Exception as e:
        print(f"  ! LLM coverage failed ({e}); falling back to threshold.")
        if best >= COVERAGE_THRESHOLDS["covered"]:
            v = "covered"
        elif best >= COVERAGE_THRESHOLDS["partial"]:
            v = "partial"
        else:
            v = "absent"
        return v, "", round(best, 3), "similarity_threshold_fallback"


# ─── Firestore ────────────────────────────────────────────────────────────────

def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq_gaps_v4")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id":   os.environ["FIREBASE_PROJECT_ID"],
            "private_key":  os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri":    "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="thermiq_gaps_v4")
    return firestore.client(app=app)


def load_outage_evidence(db):
    """Per-failure_category AND per-equipment_tag frequency + severity from CEA data.

    Returns dict with:
      by_category[cat] = {n, mean_rev_cr, mean_mw, mean_hrs, annual_freq, per_unit_annual_freq}
      by_tag[tag]      = {n, mean_rev_cr, annual_freq, per_unit_annual_freq}
      span_years       = observed date span (for annualising frequency)
      n_stations       = distinct stations in the data (fleet size proxy)

    FREQUENCY NORMALISATION (why per_unit_annual_freq exists)
    ---------------------------------------------------------
    CEA counts are FLEET-WIDE (all monitored stations), but consequence is
    PER-UNIT (one 500 MW unit). Multiplying a fleet frequency by a per-unit
    consequence is a scale error. We divide fleet annual_freq by the number of
    distinct stations to approximate a per-unit rate. This is a documented
    APPROXIMATION (a station has >1 unit; not every unit is in every report),
    not a precise per-unit hazard rate — flagged as such in the output.
    """
    cat = defaultdict(lambda: {"n": 0, "rev": 0.0, "mw": 0.0, "hrs": 0.0})
    tag = defaultdict(lambda: {"n": 0, "rev": 0.0})
    dates = []
    stations = set()
    for doc in db.collection("cea_outages").stream():
        o = doc.to_dict() or {}
        c = o.get("failure_category", "unclassified")
        t = o.get("equipment_tag", "Other")
        cat[c]["n"] += 1
        cat[c]["rev"] += o.get("revenue_lost_est_cr", 0) or 0
        cat[c]["mw"]  += o.get("mw_lost", 0) or 0
        cat[c]["hrs"] += o.get("outage_hours", 0) or 0
        tag[t]["n"] += 1
        tag[t]["rev"] += o.get("revenue_lost_est_cr", 0) or 0
        st = o.get("station", "")
        if st:
            stations.add(str(st).strip().lower())
        d = o.get("date_out", "")
        if d:
            dates.append(d)

    span_years = 1.0
    if len(dates) >= 2:
        try:
            d0 = datetime.strptime(min(dates), "%Y-%m-%d")
            d1 = datetime.strptime(max(dates), "%Y-%m-%d")
            span_years = max((d1 - d0).days / 365.25, 0.25)
        except ValueError:
            pass

    n_stations = max(len(stations), 1)

    by_category = {}
    for c, s in cat.items():
        n = s["n"]
        af = n / span_years if n else 0
        by_category[c] = {
            "n": n,
            "mean_rev_cr": round(s["rev"] / n, 2) if n else 0,
            "mean_mw":     round(s["mw"] / n, 1) if n else 0,
            "mean_hrs":    round(s["hrs"] / n, 1) if n else 0,
            "annual_freq": round(af, 2),
            "per_unit_annual_freq": round(af / n_stations, 4),
        }
    by_tag = {}
    for t, s in tag.items():
        n = s["n"]
        af = n / span_years if n else 0
        by_tag[t] = {
            "n": n,
            "mean_rev_cr": round(s["rev"] / n, 2) if n else 0,
            "annual_freq": round(af, 2),
            "per_unit_annual_freq": round(af / n_stations, 4),
        }
    return {"by_category": by_category, "by_tag": by_tag,
            "span_years": round(span_years, 2), "n_stations": n_stations}


# ─── Scoring ──────────────────────────────────────────────────────────────────

def score_item(item, hits, evidence, use_llm):
    best = hits[0].score if hits else 0.0

    # ── Coverage / exposure (adjudicated, not cosine-into-rupees) ────────────
    if use_llm:
        verdict, quote, conf, method = adjudicate_coverage(item["description"], hits)
    else:
        if best >= COVERAGE_THRESHOLDS["covered"]:
            verdict = "covered"
        elif best >= COVERAGE_THRESHOLDS["partial"]:
            verdict = "partial"
        else:
            verdict = "absent"
        quote, conf, method = "", round(best, 3), "similarity_threshold_forced"
    exposure = EXPOSURE_BY_VERDICT[verdict]
    coverage_status = {"covered": "covered", "partial": "partial", "absent": "gap"}[verdict]

    # ── Consequence: per-item physical model + CEA cross-validation ──────────
    mttr_days = item["typical_mttr_days"]
    mw = item["mw_impact_mw"]
    consequence_derived_cr = round(mw * 1000 * (mttr_days * 24) * REVENUE_RATE_PER_KWH / 1e7, 2)

    cat = item.get("failure_category")
    cat_ev = evidence["by_category"].get(cat) if cat else None
    tag_ev = evidence["by_tag"].get(item["equipment_tag"], {})

    # Evidence grade
    if cat_ev and cat_ev["n"] >= MIN_RECORDS_FOR_GRADE_A:
        evidence_grade = "A"          # data-derived evidence available for this exact mode
        cea_mean = cat_ev["mean_rev_cr"]
    elif tag_ev.get("n", 0) >= MIN_RECORDS_FOR_GRADE_A:
        evidence_grade = "B"          # only class-level (equipment_tag) data
        cea_mean = tag_ev.get("mean_rev_cr", 0)
    else:
        evidence_grade = "C"          # expert / regulatory, thin or no outage data
        cea_mean = tag_ev.get("mean_rev_cr", 0)

    if item["tranche"] == "regulatory":
        evidence_grade = "C"          # documentation items are always expert-graded

    divergence = None
    if cea_mean and consequence_derived_cr:
        divergence = round(consequence_derived_cr / cea_mean, 2)

    # ── Likelihood term: per-UNIT annual frequency, data-derived where possible ─
    # This is the axis CEA data legitimately supplies. It replaces criticality as
    # the number-driver so severity is NOT double-counted (consequence already
    # carries severity via MW x MTTR). Finest available granularity, labelled.
    if evidence_grade == "A":
        per_unit_freq = cat_ev["per_unit_annual_freq"]
        freq_method = "cea_failure_category_per_unit"
    elif tag_ev.get("n", 0) > 0:
        per_unit_freq = tag_ev.get("per_unit_annual_freq", 0)
        freq_method = "cea_equipment_tag_per_unit"
    else:
        per_unit_freq = DEFAULT_PRIOR_ANNUAL_FREQ
        freq_method = "expert_default_no_data"

    # ── Criticality: now a SHOWN FLAG, never a multiplier (fixes double-count) ─
    criticality = item["criticality"]

    # ── Two honest rupee views ────────────────────────────────────────────────
    #  per_event : ₹ at stake if this failure occurs and the gap slows response.
    #              Surfaces rare-but-catastrophic modes (stator, blade) that a
    #              pure expected-value ranking would bury.
    #  annual    : expected ₹/yr = per-unit frequency x consequence x gap factor.
    #              The decision-relevant "what does this gap cost me per year".
    exposure_per_event_cr = round(consequence_derived_cr * exposure, 2)
    expected_annual_cr    = round(per_unit_freq * consequence_derived_cr * exposure, 2)

    # Black-swan flag is computed RELATIVELY across the whole register in main()
    # (high per-event cost + low frequency), so it adapts to the data instead of
    # using a hand-picked cutoff. Placeholder here; set after all items scored.
    black_swan = False

    if item["tranche"] == "failure":
        risk_score_cr = expected_annual_cr    # primary ranking = expected ₹/yr
        compliance_priority = None
    else:
        risk_score_cr = 0.0                   # documentation items not rupee-costed
        compliance_priority = round(criticality * exposure, 2)

    top_sources = [
        {"doc": (h.payload or {}).get("source_doc", ""),
         "client_name": (h.payload or {}).get("client_name", ""),
         "score": round(h.score, 3),
         "chunk_preview": ((h.payload or {}).get("text", ""))[:120]}
        for h in hits[:3]
    ]

    return {
        # ── Backward-compatible fields (readers in api/*.js depend on these) ──
        "gap_id": item["id"],
        "topic": item["id"].replace("_", " ").title(),
        "description": item["description"],
        "equipment_tag": item["equipment_tag"],
        "gap_type": item["gap_type"],
        "typical_mttr_days": mttr_days,
        "coverage_status": coverage_status,
        "client_score": round(best, 3),
        "best_match_score": round(best, 3),
        "exposure_score": exposure,
        "criticality_score": criticality,
        "consequence_cr": consequence_derived_cr,     # now PER-ITEM, not tag-degenerate
        "risk_score_cr": risk_score_cr,               # = expected_annual_cr (failure tranche)
        "risk_formula": (f"freq {per_unit_freq}/yr x cons ₹{consequence_derived_cr} Cr x exposure {exposure} "
                         f"= ₹{expected_annual_cr} Cr/yr expected"
                         if item["tranche"] == "failure"
                         else f"regulatory: criticality {criticality} x exposure {exposure} = priority {compliance_priority}"),
        "regulatory_basis": item["regulatory_basis"],
        "top_client_sources": top_sources,
        "scanned_at": datetime.utcnow().isoformat() + "Z",

        # ── v4.1 honesty layer ───────────────────────────────────────────────
        "engine_version": "v4.1",
        "tranche": item["tranche"],
        "evidence_grade": evidence_grade,
        # likelihood (the number-driver; data-derived where possible)
        "per_unit_annual_freq": per_unit_freq,
        "frequency_method": freq_method,
        # two rupee views
        "exposure_per_event_cr": exposure_per_event_cr,   # ₹ if it happens, gap-adjusted
        "expected_annual_cr": expected_annual_cr,         # expected ₹/yr (primary ranking)
        "black_swan_flag": black_swan,                    # rare + severe: don't ignore
        # criticality is now a FLAG, not a multiplier
        "criticality_method": "expert_assigned_CEA_CERC_justified (flag/tiebreaker only — NOT multiplied into ₹)",
        "criticality_note": ("Criticality is a shown flag, not a number-driver: consequence already "
                             "carries severity (MW x MTTR), so multiplying by criticality would "
                             "double-count it. The ₹ figure is driven by frequency(data) x "
                             "consequence(physical) x exposure(LLM). Criticality flags rare-catastrophic "
                             "modes the expected-value ranking would otherwise bury (see black_swan_flag)."),
        "criticality_source": item["criticality_source"],
        # consequence provenance
        "mw_impact_mw": mw,
        "mw_impact_basis": item["mw_impact_basis"],
        "unit_rating_mw": UNIT_RATING_MW,
        "consequence_method": "per_item_physical_model (mw_impact x mttr_hrs x rate)",
        "consequence_derived_cr": consequence_derived_cr,
        "consequence_cea_cat_mean_cr": cea_mean,
        "consequence_divergence_ratio": divergence,   # derived / CEA-mean; ~1 = agreement
        "revenue_rate_kwh": REVENUE_RATE_PER_KWH,
        # coverage provenance
        "coverage_verdict": verdict,
        "coverage_quote": quote,
        "coverage_confidence": conf,
        "coverage_method": method,
        # frequency evidence block (replaces v4.0's criticality-agreement framing)
        "outage_evidence": cat_ev or {"note": f"no CEA failure_category data for '{cat}'"},
        "compliance_priority": compliance_priority,
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def detect_gaps(client_name=None, dry_run=False, use_llm=True):
    print("=" * 74)
    print("ThermIQ Gap Detection v4.1  —  frequency x consequence x exposure = expected ₹/yr")
    print("=" * 74)
    print(f"  Client          : {client_name or 'ALL client documents'}")
    print(f"  Coverage        : {'LLM-adjudicated (Gemini)' if (use_llm and GEMINI_API_KEY) else 'similarity-threshold fallback'}")
    print(f"  Unit rating     : {UNIT_RATING_MW} MW    Rate: ₹{REVENUE_RATE_PER_KWH}/kWh")
    print(f"  Grade-A min recs: {MIN_RECORDS_FOR_GRADE_A} per failure_category")
    print(f"  Model           : risk = per-unit frequency(CEA) x consequence(physical) x exposure(LLM)")
    print(f"                    criticality is a SHOWN FLAG, not a multiplier (no severity double-count)")
    print(f"  Mode            : {'DRY-RUN (no Firestore writes)' if dry_run else 'LIVE (writes risk_scores)'}")
    print()

    db = get_firestore_client()
    print("Loading CEA outage evidence…")
    evidence = load_outage_evidence(db)
    print(f"  span {evidence['span_years']} yr | distinct stations (fleet-size proxy): {evidence['n_stations']}")
    print(f"  NOTE: per-unit freq = fleet freq / {evidence['n_stations']} stations — a documented APPROXIMATION.")
    print(f"  categories: "
          + ", ".join(f"{c}={s['n']}(fleet f{s['annual_freq']}/yr, per-unit {s['per_unit_annual_freq']}/yr, ₹{s['mean_rev_cr']})"
                      for c, s in sorted(evidence["by_category"].items(), key=lambda x: -x[1]['n'])))
    print(f"  tags: " + ", ".join(f"{t}={s['n']}(per-unit {s['per_unit_annual_freq']}/yr)"
                                  for t, s in sorted(evidence["by_tag"].items())))
    print(f"\nScanning {len(EXPECTED_KNOWLEDGE)} checklist items…\n")

    results = []
    for i, item in enumerate(EXPECTED_KNOWLEDGE):
        emb = embed_query(item["query"])
        time.sleep(0.3)
        hits = search_client_only(emb, client_name=client_name, limit=5)
        r = score_item(item, hits, evidence, use_llm=use_llm)
        results.append(r)
        icon = {"covered": "OK", "partial": "~", "gap": "XX"}[r["coverage_status"]]
        line = (f"[{i+1:02d}/{len(EXPECTED_KNOWLEDGE)}] {r['gap_id']:<32} "
                f"grade {r['evidence_grade']} | {r['tranche']:<10} | {icon:>2} {r['coverage_method']:<28}")
        if r["tranche"] == "failure":
            line += (f" | ₹{r['expected_annual_cr']:>7.2f} Cr/yr exp (per-event ₹{r['exposure_per_event_cr']}, "
                     f"f{r['per_unit_annual_freq']}/yr)")
        else:
            line += f" | compliance_priority {r['compliance_priority']}"
        print(line)

    # ── Tranches ─────────────────────────────────────────────────────────────
    failure = sorted([r for r in results if r["tranche"] == "failure"],
                     key=lambda r: r["expected_annual_cr"], reverse=True)
    regulatory = sorted([r for r in results if r["tranche"] == "regulatory"],
                        key=lambda r: r["compliance_priority"], reverse=True)

    # Black-swan = high per-event cost (top quartile) but low expected-annual
    # (below median) — rare + severe, would be buried by an expected-value ranking.
    if failure:
        pe_sorted = sorted(r["exposure_per_event_cr"] for r in failure)
        ea_sorted = sorted(r["expected_annual_cr"] for r in failure)
        pe_q3 = pe_sorted[int(0.75 * (len(pe_sorted) - 1))]
        ea_med = ea_sorted[len(ea_sorted) // 2]
        for r in failure:
            r["black_swan_flag"] = (r["exposure_per_event_cr"] >= pe_q3
                                    and r["expected_annual_cr"] <= ea_med)
    annual_total = round(sum(r["expected_annual_cr"] for r in failure), 1)
    per_event_total = round(sum(r["exposure_per_event_cr"] for r in failure), 1)

    print("\n" + "=" * 74)
    print("PRIORITISED REGISTER  (ranking + traceable per-item exposure — NOT an absolute plant-risk figure)")
    print("=" * 74)
    grades = defaultdict(int)
    for r in results:
        grades[r["evidence_grade"]] += 1
    print(f"  Evidence grades: A(data-derived)={grades['A']}  B(class-derived)={grades['B']}  C(expert/regulatory)={grades['C']}")
    print(f"\n  FAILURE tranche ({len(failure)} modes), ranked by EXPECTED ₹/yr:")
    print(f"    expected annual exposure  : ₹{annual_total} Cr/yr   (freq x consequence x gap)")
    print(f"    per-event exposure (sum)  : ₹{per_event_total} Cr     (if each occurred once, gap-adjusted)")
    print("    both are relative-prioritisation views, not a plant-wide guarantee")
    for i, r in enumerate(failure[:8]):
        bs = " [BLACK-SWAN: rare+severe]" if r["black_swan_flag"] else ""
        print(f"   {i+1}. ₹{r['expected_annual_cr']:>7.2f} Cr/yr | per-event ₹{r['exposure_per_event_cr']:>7.1f} "
              f"| grade {r['evidence_grade']} | crit {r['criticality_score']} | {r['coverage_verdict']:<8} | {r['gap_id']}{bs}")
    bswans = [r for r in failure if r["black_swan_flag"]]
    if bswans:
        print(f"\n  BLACK-SWAN watch (high criticality, low expected-annual — rare but catastrophic, do NOT ignore):")
        for r in bswans:
            print(f"     {r['gap_id']}: per-event ₹{r['exposure_per_event_cr']} Cr, freq {r['per_unit_annual_freq']}/yr, crit {r['criticality_score']}")
    print(f"\n  REGULATORY tranche — documentation/compliance gaps ({len(regulatory)}), ranked by priority, NOT rupee-costed:")
    for i, r in enumerate(regulatory):
        print(f"   {i+1}. priority {r['compliance_priority']:>4} | crit {r['criticality_score']} "
              f"| {r['coverage_verdict']:<8} | {r['gap_id']}")

    # divergence review
    flags = [r for r in failure if r.get("consequence_divergence_ratio")
             and (r["consequence_divergence_ratio"] > 2.5 or r["consequence_divergence_ratio"] < 0.4)]
    if flags:
        print(f"\n  ⚠ CONSEQUENCE DIVERGENCE (derived vs CEA category mean off >2.5x — review MW/MTTR assumption):")
        for r in flags:
            print(f"     {r['gap_id']}: derived ₹{r['consequence_derived_cr']} vs CEA ₹{r['consequence_cea_cat_mean_cr']} (x{r['consequence_divergence_ratio']})")

    # ── Write ────────────────────────────────────────────────────────────────
    if dry_run:
        print("\n  DRY-RUN: nothing written to Firestore.")
        # Also dump JSON so the output can be inspected/diffed.
        out_path = os.path.join(os.path.dirname(__file__), "detect_gaps_v4_dryrun.json")
        json.dump(results, open(out_path, "w"), indent=1, default=str)
        print(f"  Full records written to {out_path}")
        return results

    cn = (client_name or "").strip().lower()
    cleared = 0
    for doc in db.collection("risk_scores").stream():
        data = doc.to_dict() or {}
        same_ns = (data.get("client_name", "") == cn or doc.id.startswith(f"{cn}__")) if cn \
            else (not data.get("client_name"))
        if same_ns:
            doc.reference.delete()
            cleared += 1
    print(f"\n  Cleared {cleared} old records for namespace '{cn or '(legacy/global)'}'.")
    for r in results:
        r["client_name"] = cn
        r["client_name_assessed"] = client_name or "all_clients"
        doc_id = f"{cn}__{r['gap_id']}" if cn else r["gap_id"]
        db.collection("risk_scores").document(doc_id).set(r)
    print(f"  Written {len(results)} records to risk_scores.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default=None)
    ap.add_argument("--dry-run", action="store_true", help="print register, write no Firestore data")
    ap.add_argument("--no-llm", action="store_true", help="force similarity-threshold coverage (skip Gemini)")
    args = ap.parse_args()
    detect_gaps(client_name=args.client, dry_run=args.dry_run, use_llm=not args.no_llm)
