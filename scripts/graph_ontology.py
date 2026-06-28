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
This file covers the BOILER family only (Phase 1 slice).
Other equipment families (BFP, Turbine, etc.) will be added in later phases.
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
