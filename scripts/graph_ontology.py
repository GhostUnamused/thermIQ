"""
ThermIQ Knowledge Graph — Ontology for Boiler Vertical Slice
=============================================================

This file defines:
  - What node types exist (Equipment, FailureMode, Procedure, etc.)
  - What edge types exist (what connects to what)
  - Canonical IDs for each node (the "true" name that everything collapses to)
  - Alias lists (every way a document might refer to the same thing)

WHY CANONICALIZATION MATTERS
-----------------------------
A CEA report might say "TUBE LEAKAGE". A conference paper says "BTF".
A tender spec says "boiler tube burst". All three mean the same failure mode.
Without these alias lists, you get three separate nodes that only look like
a graph in a screenshot — they're actually disconnected mentions.

The alias lists here are the single most important thing to get right.
If you see a failure mode being called something different in the actual
documents, edit the alias list here BEFORE running the extraction.

SCOPE
-----
Phase 1 slice: BOILER family (BOILER_* dicts).
Phase 2 slice: TURBINE family (TURBINE_* dicts).
Other equipment families (Generator, BFP, etc.) will be added in later phases.
"""

# ─── NODE TYPES ───────────────────────────────────────────────────────────────
# Equipment  — a physical machine or sub-component at a plant
# FailureMode — a way that equipment can fail
# Procedure  — a documented SOP, inspection spec, or maintenance procedure
# Regulation — a CEA/CERC rule that mandates a procedure exists
# OutageEvent — a real forced outage event (from CEA daily reports)
# Role       — who is responsible for a procedure (future use)

NODE_TYPES = ["Equipment", "FailureMode", "Procedure", "Regulation", "OutageEvent", "Role"]

# ─── EDGE TYPES ───────────────────────────────────────────────────────────────
# Read these as: FROM --[EDGE_TYPE]--> TO
#
#   Equipment     --HAS_FAILURE_MODE-->  FailureMode
#   FailureMode   --ADDRESSED_BY-->      Procedure     ← ABSENCE of this edge = the gap
#   Procedure     --REQUIRED_BY-->       Regulation    ← regulation mandates this procedure
#   OutageEvent   --INSTANCE_OF-->       FailureMode   ← real event proves failure mode exists
#   OutageEvent   --OCCURRED_AT-->       Equipment
#   Equipment     --HAS_SUB_COMPONENT--> Equipment     ← Boiler contains Waterwall
#
# The gap is always: FailureMode --ADDRESSED_BY--> [ABSENT] Procedure
# When the ADDRESSED_BY edge exists but status="ABSENT", that IS the documented gap.

EDGE_TYPES = {
    "HAS_FAILURE_MODE":   ("Equipment",   "FailureMode"),
    "ADDRESSED_BY":       ("FailureMode", "Procedure"),
    "REQUIRED_BY":        ("Procedure",   "Regulation"),
    "INSTANCE_OF":        ("OutageEvent", "FailureMode"),
    "OCCURRED_AT":        ("OutageEvent", "Equipment"),
    "HAS_SUB_COMPONENT":  ("Equipment",   "Equipment"),
    "OWNED_BY":           ("Procedure",   "Role"),
}


# ─── BOILER EQUIPMENT NODES ───────────────────────────────────────────────────
# The "boiler" at a 500MW Indian coal plant is one physical unit.
# Its sub-components (waterwall, superheater, etc.) are separate Equipment nodes
# connected by HAS_SUB_COMPONENT edges.
#
# IMPORTANT: We do NOT put the plant name (NTPC, DVC, etc.) in the equipment ID.
# Equipment is what the machine IS. Who owns it goes on OutageEvent nodes.
# "boiler_subcritical_500mw" is the generic boiler type — same ID whether
# it's at NTPC Farakka or NTPC Singrauli.

BOILER_EQUIPMENT = {
    "boiler_subcritical_500mw": {
        "label": "Boiler (subcritical, 500MW class)",
        "node_type": "Equipment",
        "sub_components": [
            "waterwall",
            "superheater_reheater",
            "air_preheater",
            "economizer",
            "steam_drum",
        ],
        # Every string below in any document = this node ID
        "aliases": [
            "boiler", "furnace", "steam generator", "main boiler",
            "BOILER", "FURNACE", "STEAM GENERATOR",
            "pressure parts", "pressure part",
            "boiler unit", "steam boiler",
        ],
    },

    "waterwall": {
        "label": "Waterwall (furnace membrane tubes)",
        "node_type": "Equipment",
        "aliases": [
            "waterwall", "water wall", "water walls",
            "furnace wall", "furnace walls",
            "membrane wall", "membrane walls",
            "furnace membrane", "furnace panels",
            "waterwall tube", "waterwall tubes",
            "furnace tube", "furnace panel",
            "WATERWALL", "WATER WALL", "FURNACE WALL",
            # RFET-specific language from BMD-32
            "waterwall panel", "wall panel", "furnace tube panel",
        ],
    },

    "superheater_reheater": {
        "label": "Superheater / Reheater",
        "node_type": "Equipment",
        "aliases": [
            "superheater", "super heater", "super-heater",
            "reheater", "re-heater", "re heater",
            "SH", "RH",
            "LTSH", "HTSH", "FSH", "PSH",    # low-temp / high-temp / final / platen SH
            "platen superheater", "final superheater",
            "primary superheater", "pendant superheater",
            "SUPERHEATER", "REHEATER",
            "SH coil", "RH coil", "SH tube", "RH tube",
        ],
    },

    "air_preheater": {
        "label": "Air Pre-Heater (APH)",
        "node_type": "Equipment",
        "aliases": [
            "air preheater", "air pre-heater", "air pre heater",
            "APH", "Ljungstrom", "ljungstrom",
            "rotary air heater", "air heater",
            "trisector APH", "bisector APH",
            "AIR PREHEATER", "AIR PRE HEATER",
        ],
    },

    "economizer": {
        "label": "Economizer",
        "node_type": "Equipment",
        "aliases": [
            "economizer", "economiser",
            "ECO", "eco",
            "ECONOMISER", "ECONOMIZER",
            "economizer coil", "economizer tube",
        ],
    },

    "steam_drum": {
        "label": "Steam Drum",
        "node_type": "Equipment",
        "aliases": [
            "steam drum", "boiler drum", "drum",
            "BD", "S.D.",
            "STEAM DRUM", "BOILER DRUM",
        ],
    },
}


# ─── BOILER FAILURE MODES ─────────────────────────────────────────────────────
# Each failure mode must link to an Equipment node (the "equipment" field).
# cea_failure_categories links it to Firestore outage records so real ₹ data
# flows into the graph.

BOILER_FAILURE_MODES = {
    "boiler_tube_failure": {
        "label": "Boiler Tube Failure / Leakage",
        "node_type": "FailureMode",
        "equipment": "boiler_subcritical_500mw",   # parent: the whole boiler
        # CEA outage record failure_category values that map to this node
        "cea_failure_categories": ["tube_failure"],
        "aliases": [
            "tube leakage", "tube leak", "tube burst", "tube failure",
            "BTF", "boiler tube failure", "boiler tube leakage",
            "pressure part failure", "pressure part leak",
            "tube puncture", "tube rupture", "tube blowout",
            "TUBE LEAKAGE", "TUBE FAILURE", "TUBE LEAK", "TUBE BURST",
            "steam leak", "steam leakage",            # sometimes used for the same event
        ],
    },

    "waterwall_tube_thinning": {
        "label": "Waterwall Tube Wall Thinning",
        "node_type": "FailureMode",
        "equipment": "waterwall",                   # sub-component of boiler
        "cea_failure_categories": ["tube_failure"],  # subset — thinning precedes tube burst
        # Plain English: the metal tubes that line the inside of the boiler furnace
        # slowly get eaten away by heat, ash, and steam chemistry. When they get
        # thin enough, they burst. This failure mode is about detecting the thinning
        # BEFORE the burst. That's what the RFET inspection in BMD-32 is for.
        "aliases": [
            "wall thinning", "tube thinning", "wall thickness loss",
            "thinning", "metal loss", "tube metal loss",
            "erosion", "corrosion", "erosion corrosion",
            "under deposit corrosion", "oxide scale",
            "wastage", "wall wastage", "tube wastage",
            "remaining wall thickness", "minimum wall thickness",
            "condemning thickness", "retire thickness",
            # RFET / inspection-specific language
            "wall thickness measurement", "thickness gauging", "UT thickness",
            "RFET", "remote field electromagnetic", "ultrasonic testing",
            "remaining life", "remnant life", "RLA",
        ],
    },

    "flame_failure": {
        "label": "Flame Failure / Master Fuel Trip (MFT)",
        "node_type": "FailureMode",
        "equipment": "boiler_subcritical_500mw",
        "cea_failure_categories": [],  # flame failures rarely appear in CEA text as "FLAME FAILURE"
        # Plain English: the fire in the boiler goes out unexpectedly.
        # This triggers an automatic safety shutdown (the "Master Fuel Trip").
        # Without a documented restart procedure, operators take much longer to
        # bring the unit back online safely.
        "aliases": [
            "flame failure", "flame out", "flameout",
            "fire out", "loss of flame", "flame loss",
            "MFT", "master fuel trip", "fuel trip",
            "furnace trip", "furnace explosion protection",
            "burner trip", "burner failure", "coal burner failure",
            "FLAME FAILURE", "MFT TRIP", "FURNACE TRIP",
        ],
    },

    "superheater_tube_failure": {
        "label": "Superheater / Reheater Tube Failure",
        "node_type": "FailureMode",
        "equipment": "superheater_reheater",
        "cea_failure_categories": ["tube_failure"],
        "aliases": [
            "SH tube failure", "SH tube leak", "SH tube burst",
            "superheater tube", "superheater failure", "superheater tube failure",
            "superheater tube leakage", "superheater tube leakage",
            "reheater failure", "RH tube", "RH tube burst", "RH tube leak",
            "SUPER HEATER TUBE", "REHEATER TUBE",
            "creep damage", "creep failure", "overheating", "overheat failure",
            "steam temperature excursion", "high steam temperature",
            "P91", "P22",                             # material grades often cited in failure context
        ],
    },
}


# ─── BOILER PROCEDURE NODES ───────────────────────────────────────────────────
# Each procedure SHOULD address one (or more) failure modes.
# The extraction script will check whether this procedure actually EXISTS
# in the document corpus, or whether it's ABSENT (= the gap).
#
# gap_id matches the IDs in detect_gaps.py EXPECTED_KNOWLEDGE — this is the link
# between the graph and the existing risk-score engine.
#
# qdrant_query is the search string used to find relevant chunks in Qdrant.

BOILER_PROCEDURES = {
    "boiler_tube_failure_sop": {
        "label": "Emergency Response SOP: Boiler Tube Failure",
        "node_type": "Procedure",
        "addresses_failure_modes": ["boiler_tube_failure"],
        "gap_id": "boiler_tube_failure_sop",
        "criticality": 5,
        "qdrant_query": (
            "boiler tube leakage failure emergency response procedure "
            "shutdown isolation tube replacement steps decision"
        ),
    },

    "waterwall_inspection_procedure": {
        "label": "Waterwall Inspection Procedure (NDT / RFET / UT Thickness)",
        "node_type": "Procedure",
        "addresses_failure_modes": ["waterwall_tube_thinning", "boiler_tube_failure"],
        "gap_id": "boiler_waterwall_inspection",
        "criticality": 5,
        "qdrant_query": (
            "waterwall tube inspection NDT thickness measurement "
            "condemning limits schedule criteria RFET ultrasonic"
        ),
    },

    "flame_failure_sop": {
        "label": "Emergency Response SOP: Flame Failure / MFT",
        "node_type": "Procedure",
        "addresses_failure_modes": ["flame_failure"],
        "gap_id": "flame_failure_response_sop",
        "criticality": 5,
        "qdrant_query": (
            "flame failure MFT master fuel trip boiler response procedure "
            "purge restart igniter isolation mill sequence"
        ),
    },

    "superheater_maintenance_sop": {
        "label": "Superheater / Reheater Tube Maintenance Procedure",
        "node_type": "Procedure",
        "addresses_failure_modes": ["superheater_tube_failure"],
        "gap_id": "superheater_maintenance",
        "criticality": 4,
        "qdrant_query": (
            "superheater reheater tube maintenance replacement material "
            "specification welding procedure P91 P22 post weld heat treatment"
        ),
    },

    "boiler_startup_procedure": {
        "label": "Boiler Cold / Hot / Warm Startup Procedure",
        "node_type": "Procedure",
        # Startup procedure indirectly addresses tube failure by preventing
        # thermal fatigue damage from bad ramp rates
        "addresses_failure_modes": ["boiler_tube_failure", "flame_failure"],
        "gap_id": "boiler_startup_procedure",
        "criticality": 4,
        "qdrant_query": (
            "boiler startup procedure cold hot warm firing rate "
            "temperature ramp safety interlocks sequence thermal stress"
        ),
    },
}


# ─── REGULATION NODES ─────────────────────────────────────────────────────────
# These are the government/regulatory documents that MANDATE a procedure exists.
# The "requires_procedures" list creates REQUIRED_BY edges in the graph.

BOILER_REGULATIONS = {
    "cea_sts_500mw": {
        "label": "CEA Standard Technical Specification 500MW — Boiler Sections",
        "node_type": "Regulation",
        "requires_procedures": [
            "waterwall_inspection_procedure",
            "boiler_tube_failure_sop",
            "boiler_startup_procedure",
        ],
    },

    "cea_om_practices": {
        "label": "CEA Review of O&M Practices for Thermal Power Plants",
        "node_type": "Regulation",
        "requires_procedures": [
            "boiler_tube_failure_sop",
            "flame_failure_sop",
            "superheater_maintenance_sop",
        ],
    },

    "ibr_pressure_vessels": {
        "label": "Indian Boiler Regulations (IBR) — Pressure Parts",
        "node_type": "Regulation",
        "requires_procedures": [
            "superheater_maintenance_sop",
            "waterwall_inspection_procedure",
        ],
    },
}


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — TURBINE FAMILY
# ══════════════════════════════════════════════════════════════════════════════
# Same node/edge types as the Boiler slice. The steam turbine is the machine that
# the boiler's steam actually spins to make electricity. After the boiler, it's the
# single biggest forced-outage category in Indian thermal plants (Vasudha/CEA 2022).
#
# gap_id values below MUST match the Turbine entries in scripts/detect_gaps.py so
# the graph links to the same risk_scores the dashboard already shows:
#   turbine_vibration_response (crit 5), turbine_blade_inspection (crit 4),
#   turbine_governor_valve_maintenance (crit 3), turbine_oil_system (crit 3).

# ─── TURBINE EQUIPMENT NODES ──────────────────────────────────────────────────
TURBINE_EQUIPMENT = {
    "steam_turbine_500mw": {
        "label": "Steam Turbine (500MW class, HP-IP-LP)",
        "node_type": "Equipment",
        "sub_components": [
            "hp_turbine",
            "ip_lp_turbine",
            "turbine_blades",
            "turbine_bearings",
            "governing_system",
            "lube_oil_system",
        ],
        "aliases": [
            "turbine", "steam turbine", "turbine generator", "TG", "TG set",
            "turbo generator", "turbo-generator", "turbine-generator",
            "TURBINE", "STEAM TURBINE", "main turbine", "turbine unit",
        ],
    },

    "hp_turbine": {
        "label": "HP Turbine (high-pressure cylinder)",
        "node_type": "Equipment",
        "aliases": [
            "HP turbine", "high pressure turbine", "high-pressure turbine",
            "HP cylinder", "HP rotor", "HPT",
            "HP TURBINE", "HIGH PRESSURE TURBINE",
        ],
    },

    "ip_lp_turbine": {
        "label": "IP / LP Turbine (intermediate & low-pressure cylinders)",
        "node_type": "Equipment",
        "aliases": [
            "IP turbine", "LP turbine", "intermediate pressure turbine",
            "low pressure turbine", "low-pressure turbine",
            "IP cylinder", "LP cylinder", "IP rotor", "LP rotor",
            "IPT", "LPT", "IP-LP", "IP/LP",
            "IP TURBINE", "LP TURBINE", "LOW PRESSURE TURBINE",
            "last stage blade", "LSB",   # LP last-stage blades — common failure site
        ],
    },

    "turbine_blades": {
        "label": "Turbine Blades (moving & fixed)",
        "node_type": "Equipment",
        "aliases": [
            "blade", "blades", "turbine blade", "turbine blades",
            "moving blade", "fixed blade", "stationary blade",
            "blading", "buckets", "nozzle", "diaphragm",
            "blade root", "blade tip", "shroud",
            "BLADE", "BLADES", "TURBINE BLADE",
        ],
    },

    "turbine_bearings": {
        "label": "Turbine Bearings (journal & thrust)",
        "node_type": "Equipment",
        "aliases": [
            "bearing", "bearings", "journal bearing", "thrust bearing",
            "turbine bearing", "babbitt", "white metal",
            "bearing pedestal", "bearing housing",
            "BEARING", "JOURNAL BEARING", "THRUST BEARING",
            "shaft vibration", "rotor vibration",   # vibration is read at the bearings
        ],
    },

    "governing_system": {
        "label": "Governing / Control Valve System",
        "node_type": "Equipment",
        "aliases": [
            "governor", "governing system", "governor valve", "control valve",
            "GV", "CV", "ESV", "emergency stop valve",
            "EHC", "electro-hydraulic control", "speed governor",
            "main stop valve", "MSV", "interceptor valve", "IV",
            "GOVERNOR", "CONTROL VALVE", "GOVERNING SYSTEM",
        ],
    },

    "lube_oil_system": {
        "label": "Turbine Lubricating Oil System",
        "node_type": "Equipment",
        "aliases": [
            "lube oil", "lubricating oil", "lube oil system", "LO system",
            "oil system", "turbine oil", "MOT", "main oil tank",
            "oil pump", "AOP", "auxiliary oil pump", "JOP", "jacking oil pump",
            "oil cooler", "oil purifier", "centrifuge",
            "LUBE OIL", "LUBRICATING OIL", "TURBINE OIL",
        ],
    },
}


# ─── TURBINE FAILURE MODES ────────────────────────────────────────────────────
TURBINE_FAILURE_MODES = {
    "turbine_high_vibration": {
        "label": "Turbine High Vibration",
        "node_type": "FailureMode",
        "equipment": "turbine_bearings",     # vibration is measured at the bearings
        "cea_failure_categories": ["vibration"],
        # Plain English: the rotating shaft starts shaking beyond safe limits
        # (imbalance, misalignment, bearing wear, or a cracked/loose blade).
        # Past the trip threshold the whole unit auto-trips — a full shutdown.
        "aliases": [
            "vibration", "high vibration", "vibrations high", "excessive vibration",
            "shaft vibration", "rotor vibration", "bearing vibration",
            "imbalance", "unbalance", "misalignment", "rotor bow", "shaft bow",
            "VIBRATION", "HIGH VIBRATION", "VIBRATIONS HIGH",
            "ISO 7919", "ISO 10816",   # the standards that set the limits
        ],
    },

    "turbine_blade_damage": {
        "label": "Turbine Blade Damage / Failure",
        "node_type": "FailureMode",
        "equipment": "turbine_blades",
        "cea_failure_categories": ["blade_damage"],
        # Plain English: a blade erodes, cracks, or gets struck by debris (FOD).
        # A failed LP last-stage blade can wreck the whole turbine — months of outage.
        "aliases": [
            "blade failure", "blade damage", "blade crack", "blade erosion",
            "blade fatigue", "blade liberation", "last stage blade failure",
            "FOD", "foreign object damage", "water induction", "solid particle erosion",
            "BLADE FAILURE", "BLADE DAMAGE", "BLADE CRACK",
        ],
    },

    "governor_valve_failure": {
        "label": "Governor / Control Valve Failure",
        "node_type": "FailureMode",
        "equipment": "governing_system",
        "cea_failure_categories": [],   # rarely appears as a distinct CEA category
        # Plain English: the valves that control how much steam reaches the turbine
        # stick, leak, or mis-calibrate — causing load-control loss or, worst case,
        # preventing a controlled shutdown.
        "aliases": [
            "governor failure", "governor valve", "control valve failure",
            "valve sticking", "stuck valve", "servo failure", "EHC fault",
            "load control loss", "runback", "overspeed",
            "GOVERNOR FAILURE", "CONTROL VALVE", "VALVE STICKING",
        ],
    },

    "lube_oil_degradation": {
        "label": "Lube Oil System Degradation / Low Oil Pressure",
        "node_type": "FailureMode",
        "equipment": "lube_oil_system",
        "cea_failure_categories": [],
        # Plain English: turbine oil gets contaminated (water, particles) or loses
        # pressure. Starved bearings overheat and can seize — a bearing wipe.
        "aliases": [
            "low oil pressure", "lube oil failure", "oil contamination",
            "water ingress", "oil degradation", "bearing oil",
            "viscosity drift", "oil quality", "TAN", "acidity",
            "LOW OIL PRESSURE", "LUBE OIL", "OIL CONTAMINATION",
        ],
    },
}


# ─── TURBINE PROCEDURE NODES ──────────────────────────────────────────────────
# gap_id + criticality MUST match scripts/detect_gaps.py Turbine entries.
TURBINE_PROCEDURES = {
    "turbine_vibration_response_sop": {
        "label": "Turbine High-Vibration Emergency Response SOP",
        "node_type": "Procedure",
        "addresses_failure_modes": ["turbine_high_vibration"],
        "gap_id": "turbine_vibration_response",
        "criticality": 5,
        "qdrant_query": (
            "turbine vibration high response trip threshold diagnostic "
            "bearing inspection procedure alarm ISO 7919 load reduction"
        ),
    },

    "turbine_blade_inspection_procedure": {
        "label": "HP/IP/LP Turbine Blade Inspection Procedure",
        "node_type": "Procedure",
        "addresses_failure_modes": ["turbine_blade_damage"],
        "gap_id": "turbine_blade_inspection",
        "criticality": 4,
        "qdrant_query": (
            "turbine blade inspection HP LP IP erosion damage condemning "
            "criteria FOD foreign object NDT PT RT blade root"
        ),
    },

    "turbine_governor_valve_maintenance_sop": {
        "label": "Governor / Control Valve Maintenance & Testing Procedure",
        "node_type": "Procedure",
        "addresses_failure_modes": ["governor_valve_failure"],
        "gap_id": "turbine_governor_valve_maintenance",
        "criticality": 3,
        "qdrant_query": (
            "turbine governor valve control valve maintenance testing "
            "calibration procedure servo EHC seat disc leak-off test"
        ),
    },

    "turbine_oil_system_sop": {
        "label": "Turbine Lube Oil System Maintenance Procedure",
        "node_type": "Procedure",
        "addresses_failure_modes": ["lube_oil_degradation"],
        "gap_id": "turbine_oil_system",
        "criticality": 3,
        "qdrant_query": (
            "turbine lubricating oil system maintenance quality testing "
            "purification bearing oil supply ISO cleanliness TAN viscosity"
        ),
    },
}


# ─── TURBINE REGULATION NODES ─────────────────────────────────────────────────
# NOTE: "cea_om_practices" reuses the SAME node id as the Boiler slice on purpose —
# it's one real document. When both slices load into Neo4j the MERGE collapses them
# into a single Regulation node, so the graph shows one regulation governing
# procedures across BOTH equipment families. That cross-family link is intentional.
TURBINE_REGULATIONS = {
    "cea_sts_500mw_turbine": {
        "label": "CEA Standard Technical Specification 500MW — Turbine-Generator Sections",
        "node_type": "Regulation",
        "requires_procedures": [
            "turbine_vibration_response_sop",
            "turbine_blade_inspection_procedure",
            "turbine_governor_valve_maintenance_sop",
        ],
    },

    "cea_om_practices": {   # same id as Boiler slice — intentional shared node
        "label": "CEA Review of O&M Practices for Thermal Power Plants",
        "node_type": "Regulation",
        "requires_procedures": [
            "turbine_vibration_response_sop",
            "turbine_blade_inspection_procedure",
            "turbine_governor_valve_maintenance_sop",
            "turbine_oil_system_sop",
        ],
    },

    "iso_vibration_standards": {
        "label": "ISO 7919 / ISO 10816 — Rotating Machinery Vibration Limits",
        "node_type": "Regulation",
        "requires_procedures": [
            "turbine_vibration_response_sop",
        ],
    },
}
