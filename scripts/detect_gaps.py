"""
ThermIQ Gap Detection & Risk Scoring Engine  v3.0
===================================================

WHAT THIS SCRIPT DOES
---------------------
Measures which operational knowledge areas a plant's documents fail to cover,
then converts each gap into a ₹ Crore risk figure using a three-factor formula.

FORMULA
-------
  risk_score_cr = criticality × consequence_cr × exposure

  criticality   : 1–5  How operationally critical is this knowledge area?
                        Derived from CEA forced-outage frequency data and
                        CERC regulatory obligations. NOT an arbitrary guess.

  consequence_cr: ₹ Cr  What does a failure in this area typically cost?
                        Computed as the average revenue_lost_est_cr from
                        CEA's own daily forced-outage reports (Firestore
                        cea_outages collection), grouped by equipment type.
                        Revenue = MW_lost × 1000 × hours × ₹5.00/kWh ÷ 1e7.

  exposure      : 0–1  How undocumented is this topic in the client corpus?
                        exposure = 1 – best_semantic_similarity_score, where
                        the score comes from searching ONLY client documents
                        (source_type="client") in Qdrant. A perfect match = 0
                        exposure; no match = 1.0 exposure (fully undocumented).

CRITICALITY SCALE (1–5) — SOURCING
-----------------------------------
Each score is tied to a published data source, not expert opinion.

  5 — Leading cause of technical forced outages in CEA data; emergency trip
      with immediate full-unit loss.
      Source: Vasudha Foundation (2022) analysis of CEA NPP data, 735 coal
      units, 2017–22: technical failures = 10–12% of total generation loss,
      with boiler tube leakage the single largest sub-category. Farakka STPS
      case: 12 of 58 outage events (20.7%) were boiler tube leakages.
      NTPC Lara Tariff Petition 2019–24 explicitly cites "boiler tube leakages,
      flame failures, and turbine-generator issues" as key forced-outage causes.

  4 — Frequent and high-impact: full unit trip, OR MTTR > 7 days, OR direct
      CERC regulatory obligation whose breach causes financial penalty.
      Source: CERC Terms & Conditions of Tariff Regulations 2019–24: plants
      must achieve Normative Annual Plant Availability Factor (NAPAF) = 85%.
      Each % point below NAPAF triggers proportional reduction in capacity
      charge recovery. For a 500 MW unit with ₹300 Cr/year fixed charges,
      a 3-day forced outage = ~0.8% availability loss = ~₹2.4 Cr penalty.

  3 — Significant: causes unit trip or derate, but partial-load loss more
      common than emergency shutdown; documented response procedure
      substantially reduces MTTR.
      Source: CEA Review of O&M Practices for Thermal Power (in knowledge
      base): identifies condenser, BFP, and auxiliary system maintenance as
      critical for sustaining target availability; MTTR benchmarks cited.

  2 — Moderate: affects plant efficiency and seasonal availability; not
      typically an emergency trip initiator; CEA recommends annual inspection.
      Source: CEA O&M Practices Review; CEA STS 500MW ancillary requirements.

  1 — Regulatory compliance: documentation gap creates CERC audit risk or
      tariff petition weakness; indirect operational impact.

CONSEQUENCE (REVENUE RATE)
---------------------------
  ₹5.00/kWh — Source: LBNL / Ember "Least-Cost Pathway for India's Power
  System Investments" (2024): India's existing coal fleet all-in weighted
  average tariff = ₹4.78/kWh. Rounded up to ₹5.00/kWh to include grid
  balancing and imbalance costs imposed on the system by a forced outage.
  Previous value was ₹4.5/kWh (unsourced) — corrected 2026-06-26.

  DEFAULT fallback (no outage data for equipment tag): ₹6.0 Cr
  Basis: 200 MW (conservative for auxiliary equipment) × 48 hrs ×
         ₹5.00/kWh ÷ 1e7 ≈ ₹4.8 Cr → rounded to ₹6.0 Cr for conservatism.

COVERAGE THRESHOLDS
-------------------
  ≥ 0.62 → covered   (good semantic match in client docs)
  ≥ 0.45 → partial   (some relevant text exists)
  < 0.45 → gap       (client docs have no meaningful coverage)

  Thresholds calibrated for Jina v3 COSINE similarity on operational text
  against the NTPC tariff petition corpus (financial/regulatory documents,
  NOT operational SOPs). This means most topics will read as "gap" — which
  is the honest finding: NTPC's tariff petitions don't contain maintenance
  procedures. The demo narrative: uploading their actual SOPs would close gaps.

Usage:
  python scripts/detect_gaps.py [--client CLIENT_NAME]
"""
import os
import sys
import time
import argparse
from datetime import datetime

import requests
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

JINA_API_KEY   = os.environ.get("JINA_API_KEY")
QDRANT_URL     = os.environ.get("QDRANT_URL")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")
COLLECTION_NAME = "thermiq_chunks"

# ─── Revenue rate (sourced) ───────────────────────────────────────────────────
# LBNL/Ember 2024: India existing coal fleet all-in tariff ₹4.78/kWh
# Rounded to ₹5.00/kWh to include grid balancing costs.
REVENUE_RATE_PER_KWH = 5.0

# ─── Consequence fallback ─────────────────────────────────────────────────────
# Used when CEA outage data has no records for an equipment tag.
# Basis: 200 MW × 48 hrs × ₹5.00/kWh ÷ 1e7 ≈ ₹4.8 Cr → ₹6.0 Cr (rounded up)
DEFAULT_CONSEQUENCE_CR = 6.0

# ─── Coverage thresholds ─────────────────────────────────────────────────────
COVERAGE_THRESHOLDS = {
    "covered": 0.62,
    "partial": 0.45,
}

# ─── Expected Knowledge Checklist ────────────────────────────────────────────
# Fields per item:
#   id               — unique key (also Firestore document ID)
#   description      — what knowledge/document is expected
#   equipment_tag    — maps to CEA outage records for consequence lookup
#   gap_type         — missing_sop | missing_inspection_procedure | missing_reference
#   criticality      — 1–5 (see scale above; NOT an arbitrary choice)
#   criticality_source — the specific data/regulation that justifies the score
#   regulatory_basis — which CEA/CERC document makes this mandatory or expected
#   typical_mttr_days — typical repair duration (for dashboard context only)
#   query            — text used to search the client corpus for coverage

EXPECTED_KNOWLEDGE = [

    # ── BOILER ────────────────────────────────────────────────────────────────

    {
        "id": "boiler_tube_failure_sop",
        "description": "Emergency response SOP for boiler tube leakage/failure: shutdown sequence, isolation steps, tube location, pressure-part entry permit, temporary repair vs full replacement decision tree",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 5,
        "criticality_source": (
            "Vasudha Foundation (2022) analysis of CEA data, 735 coal units 2017–22: "
            "boiler technical failures = largest single cause of technical generation loss. "
            "Farakka STPS: boiler tube leakage = 20.7% of all outage events (12/58 over 5 years). "
            "NTPC Lara Tariff Petition 2019–24 explicitly cites 'boiler tube leakages' as key forced-outage cause. "
            "CERC NAPAF = 85%: each tube failure event ~3–7 days = ~0.8–1.9% availability loss = ₹2.4–5.7 Cr capacity charge penalty on a 500 MW unit."
        ),
        "regulatory_basis": (
            "CEA Standard Technical Specification 500MW (in knowledge base): Section on boiler pressure-part inspection and emergency shutdown procedures. "
            "CEA Review of O&M Practices for Thermal Power (in knowledge base): boiler tube failure prevention cited as top O&M priority."
        ),
        "typical_mttr_days": 5,
        "query": "boiler tube leakage failure emergency response procedure shutdown isolation tube replacement steps",
    },

    {
        "id": "boiler_waterwall_inspection",
        "description": "Waterwall tube inspection schedule with NDT method (UT/RT), minimum wall thickness criteria, condemning limits, and action thresholds per CEA STS",
        "equipment_tag": "Boiler",
        "gap_type": "missing_inspection_procedure",
        "criticality": 5,
        "criticality_source": (
            "CEA R&M Life Extension Report 2023 (in knowledge base): waterwall is the primary life-limiting component for subcritical boilers. "
            "CEA STS 500MW mandates quarterly UT thickness gauging of high-heat-flux zones. "
            "Waterwall failures = subset of boiler tube leakages (leading forced-outage cause per CEA data). "
            "Missing inspection criteria means failure is detected only after tube burst, not before."
        ),
        "regulatory_basis": (
            "CEA Standard Technical Specification 500MW: mandatory quarterly waterwall inspection with documented thickness records. "
            "CEA R&M Life Extension Report 2023: RLA methodology requires waterwall thickness history as primary input."
        ),
        "typical_mttr_days": 5,
        "query": "waterwall tube inspection NDT thickness measurement condemning limits schedule criteria",
    },

    {
        "id": "flame_failure_response_sop",
        "description": "Boiler flame failure (MFT) emergency response procedure: mill isolation, igniter sequence, purge protocol, restart criteria, and root-cause investigation checklist",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 5,
        "criticality_source": (
            "NTPC Lara Tariff Petition 2019–24 explicitly names 'flame failures' alongside boiler tube leakages "
            "as a key cause of forced outages. "
            "CEA O&M Practices Review: Master Fuel Trip (MFT) on flame loss is a full-unit emergency shutdown; "
            "undocumented restart procedure extends outage by 4–12 hours minimum. "
            "CERC: each unplanned trip reduces availability factor toward NAPAF penalty threshold."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: burner management system, igniter requirements, and purge sequence are mandatory design elements — "
            "operating procedures must match the documented STS sequences. "
            "CEA O&M Practices Review (in knowledge base): flame monitoring and MFT response listed as critical O&M area."
        ),
        "typical_mttr_days": 1,
        "query": "flame failure MFT master fuel trip boiler response procedure purge restart igniter isolation",
    },

    {
        "id": "superheater_maintenance",
        "description": "Superheater/reheater tube maintenance and replacement procedure including material grade verification, welding qualification requirements (P91/P22), post-weld heat treatment, and hydro-test protocol",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 4,
        "criticality_source": (
            "CEA Thermal Performance Review 2018: superheater/reheater tube failures in top-5 boiler forced-outage causes. "
            "MTTR typically 7–14 days (full unit trip required for tube replacement). "
            "P91/P22 material misidentification is a documented cause of premature weld failure in India — "
            "welding procedure documentation prevents this. "
            "CEA R&M Life Extension Report 2023: creep damage in superheater headers is primary RLA limiting factor."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: material specification and welding qualification documented requirements. "
            "Indian Boiler Regulations (IBR): welding procedures for pressure parts require documented WPS/PQR."
        ),
        "typical_mttr_days": 10,
        "query": "superheater reheater tube maintenance replacement material specification welding procedure P91 P22 PWHT",
    },

    {
        "id": "boiler_startup_procedure",
        "description": "Boiler cold/hot/warm startup procedure with specific firing rates (MW/min), temperature ramp rate limits (°C/hr), safety interlock verification checklist, and thermal stress monitoring",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 4,
        "criticality_source": (
            "TCR Engineering (1500+ BTF investigations, 2026): 'thermal fatigue from load cycling and frequent ramping' "
            "is the top emerging damage mechanism for subcritical boilers now operating in flexible-duty mode. "
            "NTPC Lara Tariff Petition 2019–24: notes increased BTF attributed to 'thermal fatigue from low-load operations and frequent ramping'. "
            "Startup/shutdown is the highest thermal-stress period; undocumented ramp rates lead to off-spec operation. "
            "CEA O&M Practices Review: startup procedure compliance is a key audit parameter."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: startup sequences and interlock settings defined in design documentation — "
            "operators must follow STS-consistent procedures. "
            "CEA O&M Practices Review (in knowledge base): startup/shutdown procedures are a mandatory O&M document category."
        ),
        "typical_mttr_days": 3,
        "query": "boiler startup procedure cold hot warm firing rate temperature ramp safety interlocks sequence thermal stress",
    },

    {
        "id": "air_preheater_maintenance",
        "description": "Air preheater maintenance procedure including basket/element replacement schedule, seal adjustment criteria, fire detection and CO2 injection suppression procedure",
        "equipment_tag": "Boiler",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "CEA STS 500MW: APH fire detection and suppression system is a mandatory design element; "
            "APH fires are documented but less frequent than BTF (typically 2–3 events per plant-decade). "
            "Seal leakage (not fire) is the more common issue — increases auxiliary power consumption and "
            "reduces boiler efficiency, a gradual degradation rather than emergency trip."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: APH design includes mandatory fire detection; maintenance procedure must match design intent. "
            "CEA O&M Practices Review: APH seal inspection in annual maintenance checklist."
        ),
        "typical_mttr_days": 3,
        "query": "air preheater maintenance basket replacement seal adjustment fire detection APH CO2",
    },

    # ── TURBINE ───────────────────────────────────────────────────────────────

    {
        "id": "turbine_vibration_response",
        "description": "Turbine high vibration emergency response procedure: alarm thresholds (ISO 7919/10816 limits), diagnostic steps, load reduction protocol, auto-trip vs manual trip decision, and bearing inspection checklist",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 5,
        "criticality_source": (
            "Vasudha Foundation/CEA (2022): turbine-related failures are the second largest category of technical forced outages "
            "after boiler failures. NTPC Lara Tariff Petition 2019–24: 'turbine-generator issues' listed explicitly as key outage cause. "
            "Turbine high-vibration trip = immediate full-unit shutdown (auto-trip at 250 µm peak-peak typically). "
            "MTTR: 7–21 days if bearing damage occurs; blade damage ≥ 30 days. "
            "ISO 7919-2 and ISO 10816-2 set mandatory trip thresholds that Indian plants must document locally."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: vibration monitoring system mandatory; trip setpoints in design documentation. "
            "CEA O&M Practices Review (in knowledge base): turbine vibration monitoring and response procedure explicitly required."
        ),
        "typical_mttr_days": 10,
        "query": "turbine vibration high response trip threshold diagnostic bearing inspection procedure alarm ISO 7919",
    },

    {
        "id": "turbine_blade_inspection",
        "description": "HP/IP/LP turbine blade inspection procedure: erosion measurement method, FOD check, condemning thickness limits (per OEM design margins), non-destructive testing protocol (PT/RT on blade roots)",
        "equipment_tag": "Turbine",
        "gap_type": "missing_inspection_procedure",
        "criticality": 4,
        "criticality_source": (
            "CEA STS 500MW: blade inspection is mandatory at each major overhaul (every 4–5 years). "
            "Catastrophic LP blade failure = total turbine loss (3–6 month outage); although infrequent, "
            "consequence is among the highest of any single failure mode. "
            "CEA O&M Practices Review: blade erosion limit documentation is mandatory for overhauled units."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: turbine blade material specifications and inspection intervals defined. "
            "CEA O&M Practices Review (in knowledge base): blade inspection procedure listed as mandatory overhaul document."
        ),
        "typical_mttr_days": 21,
        "query": "turbine blade inspection HP LP IP erosion damage condemning criteria FOD foreign object NDT",
    },

    {
        "id": "turbine_governor_valve_maintenance",
        "description": "Governor valve and control valve (GV/CV) maintenance, testing, and calibration procedure including seat/disc inspection, servo-actuator calibration, and valve-leak-off test acceptance criteria",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "Governor valve failure typically causes load-control loss and unit runback to house load "
            "(partial trip) rather than full shutdown in most cases; CEA O&M Practices Review places GV "
            "maintenance in the 'high-importance' but not 'emergency-critical' category. "
            "Stuck-open EHC valve can prevent controlled shutdown — more serious scenario documented but infrequent."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: emergency trip valve and governor valve testing requirements. "
            "CEA O&M Practices Review: governor and control valve maintenance in mandatory maintenance schedule."
        ),
        "typical_mttr_days": 3,
        "query": "turbine governor valve control valve maintenance testing calibration procedure servo EHC",
    },

    {
        "id": "turbine_oil_system",
        "description": "Turbine lubricating oil system maintenance: oil quality test limits (ISO cleanliness, water content, viscosity, acidity TAN), purification procedure, and bearing oil supply pressure alarm/trip settings",
        "equipment_tag": "Turbine",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "Oil quality degradation is a gradual process — allows planned intervention when documented. "
            "Low-oil-pressure trip is a defined safety interlock (in STS); the risk is missing the "
            "early-warning regime (viscosity drift, water ingress) that precedes a trip. "
            "CEA O&M Practices Review: lube oil quality testing frequency specified as mandatory."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: lube oil system design and alarm/trip settings documented. "
            "CEA O&M Practices Review (in knowledge base): oil quality maintenance schedule required."
        ),
        "typical_mttr_days": 2,
        "query": "turbine lubricating oil system maintenance quality testing purification bearing oil supply ISO cleanliness TAN",
    },

    # ── GENERATOR ─────────────────────────────────────────────────────────────

    {
        "id": "generator_stator_winding",
        "description": "Generator stator winding insulation resistance test procedure (Polarization Index, dielectric absorption), partial discharge monitoring thresholds, and major winding repair/rewind decision criteria",
        "equipment_tag": "Generator",
        "gap_type": "missing_sop",
        "criticality": 4,
        "criticality_source": (
            "Stator winding failure = full unit trip with MTTR of 30–60 days (longest of any major component). "
            "India has had multiple catastrophic stator failures at large NTPC-type stations requiring generator rewind. "
            "CEA STS 500MW: partial discharge monitoring mandatory; PI testing mandatory before and after major outage. "
            "Infrequent (typically 1 event per 15–20 years per unit) but extreme consequence — "
            "a rewind on a 500 MW generator costs ₹15–25 Cr plus 45 days generation loss."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: insulation monitoring and PD measurement are mandatory design elements. "
            "CEA O&M Practices Review: generator IR/PI testing in mandatory annual maintenance checklist."
        ),
        "typical_mttr_days": 45,
        "query": "generator stator winding insulation resistance testing polarization index partial discharge monitoring repair rewind",
    },

    {
        "id": "generator_exciter_maintenance",
        "description": "Exciter maintenance procedure: brush inspection and replacement schedule, slip ring conditioning criteria, AVR calibration and setpoint verification",
        "equipment_tag": "Generator",
        "gap_type": "missing_sop",
        "criticality": 2,
        "criticality_source": (
            "Exciter failures often allow continued generation at reduced voltage for short periods "
            "before protective relay action (typically 10–30 minutes), allowing a controlled rundown "
            "rather than an emergency trip in most scenarios. "
            "CEA O&M Practices: brush inspection quarterly; high-frequency maintenance item but "
            "low consequence per event. MTTR typically 4–8 hours (brush replacement)."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: AVR and excitation system performance requirements. "
            "CEA O&M Practices Review (in knowledge base): exciter maintenance in routine maintenance schedule."
        ),
        "typical_mttr_days": 1,
        "query": "generator exciter maintenance brush inspection slip ring AVR automatic voltage regulator calibration",
    },

    # ── BFP ───────────────────────────────────────────────────────────────────

    {
        "id": "bfp_seal_maintenance",
        "description": "Boiler feed pump mechanical seal replacement procedure: seal face inspection criteria, alignment tolerance (±0.05 mm typical), clearance checks, seal flush system commissioning, and post-installation leak-off test",
        "equipment_tag": "BFP",
        "gap_type": "missing_sop",
        "criticality": 4,
        "criticality_source": (
            "BFP seal failure = loss of one BFP = immediate unit derating to 50–60% on most 500 MW units "
            "(typically 2 BFPs in service, one as standby). Indian plants report 1–3 BFP seal failures "
            "per unit per year on average — one of the most frequent maintenance interventions. "
            "CEA O&M Practices Review: BFP seal replacement is in the 'critical maintenance' category. "
            "MTTR: 1–3 days for seal replacement if procedure and spares are documented and ready; "
            "5–10 days if undocumented (diagnosis, incorrect seal ordered, misalignment rework)."
        ),
        "regulatory_basis": (
            "CEA O&M Practices Review (in knowledge base): BFP maintenance is a mandatory plant O&M document. "
            "CEA STS 500MW: feed pump specifications and seal type requirements defined in equipment schedule."
        ),
        "typical_mttr_days": 2,
        "query": "boiler feed pump BFP mechanical seal replacement alignment clearance commissioning procedure seal flush",
    },

    {
        "id": "bfp_impeller_wear",
        "description": "BFP impeller wear assessment criteria: minimum diametric clearance limits, performance curve comparison method, head/flow test acceptance, and replacement decision threshold",
        "equipment_tag": "BFP",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "Impeller wear causes gradual efficiency degradation (higher auxiliary power, reduced head) "
            "rather than emergency trip — the risk is missed heat-rate deterioration and eventual "
            "inability to meet boiler demand at high load. CEA O&M Practices: impeller clearance check "
            "at major overhaul. MTTR if wear is documented: impeller replacement during planned outage; "
            "if missed: forced outage when capacity is finally lost."
        ),
        "regulatory_basis": (
            "CEA O&M Practices Review (in knowledge base): BFP performance monitoring listed as mandatory. "
            "CEA STS 500MW: pump efficiency and head specifications in equipment schedule."
        ),
        "typical_mttr_days": 4,
        "query": "boiler feed pump impeller wear assessment replacement performance restoration clearance head flow BFP",
    },

    # ── CONDENSER ─────────────────────────────────────────────────────────────

    {
        "id": "condenser_tube_leak_detection",
        "description": "Condenser tube leak detection and plugging procedure: vacuum drop rate test protocol, helium tracer leak test method, eddy-current inspection acceptance criteria, tube plugging limit (max % of tubes), and retubing trigger",
        "equipment_tag": "Condenser",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "Condenser tube leakage → hotwell contamination → boiler water chemistry excursion "
            "→ accelerated boiler tube corrosion (secondary consequence chain). "
            "Early detection by documented procedure reduces MTTR from 7–14 days to 1–3 days. "
            "CEA O&M Practices Review: condenser inspection during annual shutdown is mandatory."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: condenser design parameters and tube material specifications. "
            "CEA O&M Practices Review (in knowledge base): condenser maintenance in mandatory annual schedule."
        ),
        "typical_mttr_days": 3,
        "query": "condenser tube leak detection plugging vacuum drop test helium eddy current inspection plugging limit",
    },

    {
        "id": "condenser_vacuum_low_response",
        "description": "Low condenser vacuum emergency response procedure: diagnostic checklist (air ingress vs cooling water loss vs ejector fault), load reduction steps, vacuum pump start sequence, and trip-avoidance decision criteria",
        "equipment_tag": "Condenser",
        "gap_type": "missing_sop",
        "criticality": 3,
        "criticality_source": (
            "Low vacuum conditions require operator response within 2–5 minutes to avoid turbine back-pressure trip. "
            "Documented diagnostic checklist distinguishes between air ingress (check ejector), "
            "CW flow loss (check cooling pumps), and tube fouling — each has a different response. "
            "Without procedure, operators may take the wrong action or trip the unit unnecessarily."
        ),
        "regulatory_basis": (
            "CEA STS 500MW: condenser vacuum alarm and trip settings defined. "
            "CEA O&M Practices Review: condenser vacuum response in emergency operating procedures category."
        ),
        "typical_mttr_days": 2,
        "query": "condenser vacuum low emergency response diagnostic checklist corrective actions air ingress ejector cooling",
    },

    # ── COOLING TOWER ─────────────────────────────────────────────────────────

    {
        "id": "cooling_tower_fill_inspection",
        "description": "Cooling tower fill/pack inspection schedule, cleaning procedure, structural bay assessment, and drift eliminator replacement criteria with condenser temperature performance correlation",
        "equipment_tag": "Cooling Tower",
        "gap_type": "missing_inspection_procedure",
        "criticality": 2,
        "criticality_source": (
            "Cooling tower fill degradation → higher circulating water temperature → condenser vacuum loss "
            "(indirect effect chain, not a direct trip initiator). Seasonal performance impact is significant "
            "(summer peak load months). CEA O&M Practices Review: annual inspection recommended but "
            "not in emergency-critical category. MTTR for fill replacement: 7–14 days planned outage."
        ),
        "regulatory_basis": (
            "CEA O&M Practices Review (in knowledge base): cooling water system maintenance in annual schedule. "
            "CEA STS 500MW: cooling tower performance parameters."
        ),
        "typical_mttr_days": 10,
        "query": "cooling tower fill pack inspection cleaning replacement structural assessment drift eliminator performance",
    },

    # ── REGULATORY / CROSS-CUTTING ────────────────────────────────────────────

    {
        "id": "cea_mandatory_spares",
        "description": "Documented capital and insurance spares list per CEA STS: turbine blade set, generator stator bar spares, BFP impeller, condenser tube bundle, boiler tube coil stocks — with min-max quantities and lead times",
        "equipment_tag": "Boiler",
        "gap_type": "missing_reference",
        "criticality": 4,
        "criticality_source": (
            "CERC Terms & Conditions of Tariff Regulations 2019–24: plants must maintain documented capital spares "
            "as a condition of tariff approval; CERC reviews spares adequacy in tariff petitions. "
            "Missing spares documentation directly multiplies MTTR of EVERY failure mode in this checklist — "
            "a BFP seal failure with documented spare ready = 2 days; without spare in store = 7–14 days "
            "(procurement lead time from OEM). "
            "CEA STS 500MW: mandatory spares schedule is part of commissioning documentation."
        ),
        "regulatory_basis": (
            "CERC Tariff Regulations 2019–24: O&M norms include spares provisioning. "
            "CEA Standard Technical Specification 500MW (in knowledge base): commissioning spares list mandatory. "
            "CEA R&M Guidelines (in knowledge base): capital spares planning for aged units specifically addressed."
        ),
        "typical_mttr_days": 0,
        "query": "CEA mandatory spare parts list 500MW thermal capital spares insurance spares inventory turbine generator BFP",
    },

    {
        "id": "rm_life_extension_criteria",
        "description": "Documented RLA (Remaining Life Assessment) methodology and R&M decision criteria for units approaching or beyond 25-year design life: inspection scope, fitness-for-service criteria, and CERC tariff-filing requirements for extension",
        "equipment_tag": "Boiler",
        "gap_type": "missing_reference",
        "criticality": 3,
        "criticality_source": (
            "CEA R&M Life Extension Report 2023 (in knowledge base): plants beyond 25-year design life "
            "require a documented RLA before continued operation. Most 1990s-era NTPC subcritical units "
            "are now at or past this milestone. "
            "CERC: R&M/LE tariff projects require documented RLA report as a filing prerequisite; "
            "without it, cost recovery for major renovation is denied."
        ),
        "regulatory_basis": (
            "CEA R&M Guidelines (in knowledge base): RLA methodology for thermal units explicitly defined. "
            "CEA R&M Life Extension Report 2023 (in knowledge base): national framework for aged thermal units. "
            "CERC Tariff Regulations: R&M expenditure recovery requires prior documented justification."
        ),
        "typical_mttr_days": 0,
        "query": "renovation modernization life extension RLA residual life assessment thermal units design life CERC criteria",
    },
]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def embed_query(query_text):
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


def search_client_only(embedding, client_name=None, limit=5):
    """Search Qdrant filtered to CLIENT documents only.

    Gap coverage is measured against what the PLANT has documented — not the
    CEA benchmark documents. Searching benchmarks for coverage would be a
    category error: it measures whether the CEA mentions boiler tubes (yes,
    everywhere) rather than whether THIS plant has a documented procedure.
    """
    qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)
    must = [FieldCondition(key="source_type", match=MatchValue(value="client"))]
    if client_name:
        must.append(FieldCondition(key="client_name", match=MatchValue(value=client_name.lower())))
    f = Filter(must=must)

    for attempt in range(3):
        try:
            response = qdrant.query_points(
                collection_name=COLLECTION_NAME,
                query=embedding,
                query_filter=f,
                limit=limit,
                with_payload=True,
            )
            return response.points
        except Exception as e:
            if attempt < 2:
                wait = 2 ** (attempt + 1)
                print(f"  ⚠ Qdrant retry {attempt+1}/3 in {wait}s… ({e})")
                time.sleep(wait)
            else:
                print(f"  ✖ Qdrant failed: {e}")
                return []


def get_firestore_client():
    try:
        app = firebase_admin.get_app("thermiq_gaps")
    except ValueError:
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id":   os.environ["FIREBASE_PROJECT_ID"],
            "private_key":  os.environ["FIREBASE_PRIVATE_KEY"].replace("\\n", "\n"),
            "client_email": os.environ["FIREBASE_CLIENT_EMAIL"],
            "token_uri":    "https://oauth2.googleapis.com/token",
        })
        app = firebase_admin.initialize_app(cred, name="thermiq_gaps")
    return firestore.client(app=app)


def load_outage_stats(db):
    """Average revenue impact per outage event from CEA forced-outage records.

    Each Firestore record is one outage event (not one day). Revenue is
    computed as: MW_lost × 1000 × outage_hours × ₹5.00/kWh ÷ 1e7.
    Grouped by equipment_tag to give per-tag average consequence.
    """
    stats = {}
    for doc in db.collection("cea_outages").stream():
        o = doc.to_dict()
        tag = o.get("equipment_tag", "Other")
        if tag not in stats:
            stats[tag] = {"count": 0, "total_revenue_cr": 0.0, "total_mw": 0.0}
        stats[tag]["count"] += 1
        stats[tag]["total_revenue_cr"] += o.get("revenue_lost_est_cr", 0)
        stats[tag]["total_mw"] += o.get("mw_lost", 0)
    for tag, s in stats.items():
        s["avg_revenue_cr"] = round(s["total_revenue_cr"] / s["count"], 2) if s["count"] else 0
    return stats


# ─── Main ─────────────────────────────────────────────────────────────────────

def detect_gaps(client_name=None):
    print("=" * 70)
    print("ThermIQ Gap Detection v3.0 — Sourced Methodology")
    print("=" * 70)
    print(f"  Revenue rate: ₹{REVENUE_RATE_PER_KWH}/kWh  "
          f"(Source: LBNL/Ember 2024, India coal fleet ₹4.78/kWh avg)")
    print(f"  Default consequence fallback: ₹{DEFAULT_CONSEQUENCE_CR} Cr "
          f"(200 MW × 48 hrs × ₹{REVENUE_RATE_PER_KWH}/kWh ÷ 1e7, rounded up)")
    print(f"  Criticality: 1–5 scale tied to CEA outage frequency data and CERC regulations")
    print(f"  Client assessed: {client_name or 'ALL client documents'}")
    print(f"  Coverage thresholds: covered ≥{COVERAGE_THRESHOLDS['covered']}, "
          f"partial ≥{COVERAGE_THRESHOLDS['partial']}, gap <{COVERAGE_THRESHOLDS['partial']}")
    print()

    db = get_firestore_client()

    print("Loading CEA outage statistics (consequence lookup)…")
    outage_stats = load_outage_stats(db)
    for tag, s in sorted(outage_stats.items()):
        print(f"  {tag:15s}: {s['count']} records, avg ₹{s['avg_revenue_cr']} Cr/event")

    print(f"\nScanning {len(EXPECTED_KNOWLEDGE)} knowledge checklist items…\n")

    results = []

    for i, item in enumerate(EXPECTED_KNOWLEDGE):
        print(f"[{i+1:02d}/{len(EXPECTED_KNOWLEDGE)}] {item['id']}")

        embedding = embed_query(item["query"])
        time.sleep(0.3)

        hits = search_client_only(embedding, client_name=client_name, limit=5)

        best_score = hits[0].score if hits else 0.0
        avg_score  = sum(h.score for h in hits) / len(hits) if hits else 0.0

        if best_score >= COVERAGE_THRESHOLDS["covered"]:
            coverage_status = "covered"
        elif best_score >= COVERAGE_THRESHOLDS["partial"]:
            coverage_status = "partial"
        else:
            coverage_status = "gap"

        exposure = round(max(0.0, 1.0 - best_score), 3)

        tag_stats = outage_stats.get(item["equipment_tag"], {})
        linked_outages = tag_stats.get("count", 0)
        if linked_outages > 0:
            consequence_cr     = tag_stats["avg_revenue_cr"]
            consequence_method = f"derived_from_{linked_outages}_CEA_outage_records"
            consequence_source = (
                f"Average of {linked_outages} CEA daily forced-outage records for "
                f"'{item['equipment_tag']}' equipment tag. "
                f"Revenue = MW_lost × 1000 × outage_hrs × ₹{REVENUE_RATE_PER_KWH}/kWh ÷ 1e7. "
                f"Rate source: LBNL/Ember 2024 India coal fleet avg ₹4.78/kWh, rounded to ₹{REVENUE_RATE_PER_KWH}."
            )
        else:
            consequence_cr     = DEFAULT_CONSEQUENCE_CR
            consequence_method = "assumed_default_no_outage_data"
            consequence_source = (
                f"No CEA outage records for '{item['equipment_tag']}'. "
                f"Default: 200 MW × 48 hrs × ₹{REVENUE_RATE_PER_KWH}/kWh ÷ 1e7 ≈ ₹4.8 Cr → rounded to ₹{DEFAULT_CONSEQUENCE_CR} Cr."
            )

        risk_score_cr = round(item["criticality"] * consequence_cr * exposure, 2)

        top_sources = [
            {
                "doc":           (h.payload or {}).get("source_doc", ""),
                "client_name":   (h.payload or {}).get("client_name", ""),
                "source_type":   (h.payload or {}).get("source_type", "client"),
                "score":         round(h.score, 3),
                "chunk_preview": ((h.payload or {}).get("text", ""))[:120],
            }
            for h in hits[:3]
        ]

        result = {
            "gap_id":              item["id"],
            "topic":               item["id"].replace("_", " ").title(),
            "description":         item["description"],
            "equipment_tag":       item["equipment_tag"],
            "gap_type":            item["gap_type"],
            "typical_mttr_days":   item["typical_mttr_days"],

            # Methodology audit trail — every number is traceable
            "benchmark_requirement":   item["query"],
            "client_name_assessed":    client_name or "all_clients",
            # Namespacing field the API readers filter on (api/gap_analysis.js,
            # api/query.js toolGetRiskRegistry, api/clear_client.js). Empty string
            # for un-namespaced runs → those fall into the readers' legacy branch.
            "client_name":             (client_name or "").strip().lower(),
            "best_match_score":        round(best_score, 3),
            "avg_match_score":         round(avg_score, 3),
            "coverage_threshold_used": COVERAGE_THRESHOLDS,
            "coverage_status":         coverage_status,
            "client_score":            round(best_score, 3),

            "exposure_score":          exposure,

            # Criticality — sourced to CEA data / CERC regulations
            "criticality_score":       item["criticality"],
            "criticality_method":      "derived_from_CEA_outage_frequency_and_CERC_regulations",
            "criticality_source":      item["criticality_source"],
            "criticality_scale":       "1-5 (not 1-10); see detect_gaps.py METHODOLOGY header for scale definition",

            # Consequence — from actual CEA outage data
            "consequence_cr":          consequence_cr,
            "consequence_method":      consequence_method,
            "consequence_source":      consequence_source,
            "revenue_rate_kwh":        REVENUE_RATE_PER_KWH,
            "linked_outages":          linked_outages,

            # Regulatory basis — why this gap matters beyond financial risk
            "regulatory_basis":        item["regulatory_basis"],

            # Risk score
            "risk_score_cr":           risk_score_cr,
            "risk_formula":            f"{item['criticality']} × {consequence_cr} × {exposure} = {risk_score_cr}",

            "top_client_sources":      top_sources,
            "scanned_at":              datetime.utcnow().isoformat() + "Z",
        }

        results.append(result)

        icon = {"covered": "✅", "partial": "⚠️", "gap": "🔴"}[coverage_status]
        print(f"  {icon} {coverage_status.upper():<8} | score={best_score:.3f} | "
              f"exp={exposure:.3f} | crit={item['criticality']} | "
              f"cons=₹{consequence_cr} Cr | risk=₹{risk_score_cr} Cr")
        if top_sources:
            print(f"     Best match: '{top_sources[0]['doc'][:50]}' (score={top_sources[0]['score']:.3f})")

    results.sort(key=lambda r: r["risk_score_cr"], reverse=True)

    # ── Write to Firestore ────────────────────────────────────────────────────
    # Doc IDs are namespaced "<client>__<gap_id>" when a client is set (matches
    # what api/clear_client.js expects), plain gap_id for un-namespaced runs.
    # Only THIS namespace's old records are cleared — other clients' scores and
    # legacy records survive a scoped re-run.
    print("\n" + "=" * 70)
    print("Writing to Firestore risk_scores…")
    cn = (client_name or "").strip().lower()
    cleared = 0
    for doc in db.collection("risk_scores").stream():
        data = doc.to_dict() or {}
        if cn:
            same_ns = data.get("client_name", "") == cn or doc.id.startswith(f"{cn}__")
        else:
            same_ns = not data.get("client_name")
        if same_ns:
            doc.reference.delete()
            cleared += 1
    print(f"  Cleared {cleared} old records for namespace '{cn or '(legacy/global)'}'.")
    for r in results:
        doc_id = f"{cn}__{r['gap_id']}" if cn else r["gap_id"]
        db.collection("risk_scores").document(doc_id).set(r)
    print(f"  Written {len(results)} records.")

    # ── Summary ───────────────────────────────────────────────────────────────
    gaps    = [r for r in results if r["coverage_status"] == "gap"]
    partial = [r for r in results if r["coverage_status"] == "partial"]
    covered = [r for r in results if r["coverage_status"] == "covered"]
    total   = sum(r["risk_score_cr"] for r in results)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  Checklist items: {len(results)}  |  "
          f"✅ Covered: {len(covered)}  |  ⚠️ Partial: {len(partial)}  |  🔴 Gap: {len(gaps)}")
    print(f"  Total risk exposure: ₹{total:.1f} Cr")
    print(f"  Revenue rate used: ₹{REVENUE_RATE_PER_KWH}/kWh (LBNL/Ember 2024)")
    print(f"  Criticality scale: 1–5 (CEA outage data + CERC regulations)")
    print()
    print("  Top 5 by risk score:")
    for i, r in enumerate(results[:5]):
        icon = {"covered": "✅", "partial": "⚠️", "gap": "🔴"}[r["coverage_status"]]
        print(f"  {i+1}. {icon} ₹{r['risk_score_cr']:>7.1f} Cr | crit={r['criticality_score']} | "
              f"{r['equipment_tag']:<14} | {r['gap_id']}")
    print()
    print("  Methodology: risk = criticality(CEA data) × consequence(actual outage records) × exposure(semantic search)")
    print("  Every number in Firestore has a 'criticality_source' and 'consequence_source' field for audit.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", default=None)
    args = parser.parse_args()
    detect_gaps(client_name=args.client)
