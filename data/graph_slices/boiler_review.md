# ThermIQ — Boiler Slice Spot-Check
_Generated 2026-06-28_

> **How to use this:** Read through the Gap Summary section.
> For each 🔴 or ⚠️ item, ask yourself: does it make sense that this document
> wouldn't exist at a power plant? If something looks obviously wrong, let Cowork know.
> You don't need to know what the procedure actually says — just whether the logic holds.

---

**Graph size:** 36 nodes · 60 edges
**Real outage events:** 18 (from CEA daily report, npp.gov.in)
**Total ₹ at stake:** ₹211.8 Cr (across all Boiler outages in the data)
**Confirmed gaps:** 5

---

## The Equipment Family

We are looking at one type of equipment: **the Boiler**, and its internal parts.
Think of the Boiler as the main furnace where coal is burned to make steam.
Its parts (waterwall, superheater, etc.) are separate nodes in the graph,
connected by 'contains' edges.

| Node | What it is in plain English |
|------|----------------------------|
| Boiler (subcritical, 500MW class) | The main coal-burning furnace |
| Waterwall | The metal tubes lining the inside of the furnace, carrying water |
| Superheater / Reheater | Tubes that heat steam to very high temperature |
| Air Pre-Heater (APH) | Recovers heat from exhaust gases to preheat incoming air |
| Economizer | Uses exhaust heat to preheat the boiler feed water |
| Steam Drum | The vessel where water and steam separate |

---

## Gap Summary

_🔴 = No procedure found anywhere in the document corpus (confirmed gap)_
_⚠️ = Topic mentioned in documents but no actual SOP steps found (partial gap)_
_✅ = Full procedure found_

### 🔴 Emergency Response SOP: Boiler Tube Failure
**Criticality:** 5/5 · **Status:** ABSENT · **THIS IS A GAP**

_Not found in any document in the corpus._

### ⚠️ Waterwall Inspection Procedure (NDT / RFET / UT Thickness)
**Criticality:** 5/5 · **Status:** PARTIAL · **THIS IS A GAP**

**Found in:** unknown
> *"1. RFET (Remote Field Electromagnetic Testing) Technique to be used in boilers for the following type of defects: a. Cracks in tubes (external as well as internal) b. Inside pitting c. Manufacturing defects d. Any irregularities inside the tubes"*
> *"steel ball test and for cleanliness by sponge passage"*
**Specific details extracted:** RFET technique for cracks, pitting, and manufacturing defects in water wall tubes · UT confirmation of defects · 100% UT prior to fabrication · longitudinal calibration notch of depth 5% of wall thickness
**What's missing from these documents:** No numbered inspection steps, acceptance criteria, defect thresholds, or decision points provided

### ⚠️ Emergency Response SOP: Flame Failure / MFT
**Criticality:** 5/5 · **Status:** PARTIAL · **THIS IS A GAP**

**Found in:** unknown
> *"effect a burner trip or master fuel trip"*
> *"e) Provide flame monitoring"*
**Specific details extracted:** Prevent any fuel firing unless a satisfactory purge sequence has first been completed · Provide flame monitoring when fuel-firing equipment is in service · flame monitoring when fuel-firing equipment is in service · effect a burner trip or master fuel trip upon warranted firing conditions
**What's missing from these documents:** no specific steps for emergency response to flame failure or MFT

### ⚠️ Superheater / Reheater Tube Maintenance Procedure
**Criticality:** 4/5 · **Status:** PARTIAL · **THIS IS A GAP**

**Found in:** unknown
> *"2.2.2.6...adequate number of chromel-alumel thermocouples for measurement of tube metal temperatures outside the gas path shall also be provided."*
**Specific details extracted:** minimum number of thermocouples specified · placement requirements for thermocouples
**What's missing from these documents:** Actual maintenance steps (e.g., inspection frequency, corrective actions, thresholds for action)

### 🔴 Boiler Cold / Hot / Warm Startup Procedure
**Criticality:** 4/5 · **Status:** ABSENT · **THIS IS A GAP**

_Not found in any document in the corpus._

---

## Real Boiler Outage Events (from CEA data)

These are actual forced outages from India's national power portal.
Each one is a real event that cost real money.
Total Boiler events in our dataset: **18**

| Station | Unit | MW Lost | Date | ₹ Est. | Raw Reason |
|---------|------|---------|------|--------|------------|
| MUNDRA UMTPP | 2 | 800 MW | 2026-06-24 | ₹25.9 Cr | WATER WALL TUBE LEAKAGE |
| BARH STPS | 1 | 660 MW | 2026-06-23 | ₹21.4 Cr | TUBE LKG. AT LOW TEMP. SUPERHEATER ZONE |
| JAWAHARPUR STPP | 2 | 660 MW | 2026-06-20 | ₹21.4 Cr | WATER WALL TUBE LEAKAGE |
| SHREE SINGAJI TPP | 4 | 660 MW | 2026-06-22 | ₹21.4 Cr | BOILER MISC. PROBLEM |
| BELLARY TPS | 1 | 500 MW | 2026-06-23 | ₹16.2 Cr | WATER WALL TUBE LEAKAGE |
| KODARMA TPP | 1 | 500 MW | 2026-06-23 | ₹16.2 Cr | TUBE LKG. AT LOW TEMP. SUPERHEATER ZONE |
| NEYVELI NEW TPP | 2 | 500 MW | 2026-06-22 | ₹16.2 Cr | BOILER MISC. PROBLEM |
| RAMAGUNDEM STPS | 5 | 500 MW | 2026-06-24 | ₹16.2 Cr | WATER WALL TUBE LEAKAGE |
| MEENAKSHI ENERGY LTD | 3 | 350 MW | 2026-06-24 | ₹11.3 Cr | FURNACE FIRE OUT /FLAME FAILURE |
| RAICHUR TPS | 8 | 250 MW | 2026-05-26 | ₹8.1 Cr | WATER WALL TUBE LEAKAGE |
| Dr. N.TATA RAO TPS | 5 | 210 MW | 2026-06-23 | ₹6.8 Cr | WATER WALL TUBE LEAKAGE |
| RAICHUR TPS | 6 | 210 MW | 2026-06-24 | ₹6.8 Cr | WATER WALL TUBE LEAKAGE |
| ROPAR TPS | 3 | 210 MW | 2026-06-23 | ₹6.8 Cr | BOILER MISC. PROBLEM |
| SANJAY GANDHI TPS | 1 | 210 MW | 2026-06-20 | ₹6.8 Cr | WATER WALL TUBE LEAKAGE |
| SABARMATI (D-F STATIONS) | 2 | 121 MW | 2026-06-23 | ₹3.9 Cr | TUBE LKG. AT LOW TEMP. SUPERHEATER ZONE |

---

## The Demo Query (Hero Traversal)

This is the question ThermIQ should answer end-to-end once the graph is in Neo4j:

> *An operator flags that waterwall tube thickness readings are below normal on Unit 2.*
> *What inspection protocol applies? Has this failure mode caused outages at other NTPC plants?*
> *What's the revenue exposure? Do we have a documented condemning limit?*

**What the graph traversal does:**
1. Equipment: Waterwall → FailureMode: Waterwall Tube Thinning
2. Any real outage events linked to this failure? (INSTANCE_OF edges)
3. Does a Procedure exist that addresses it? (ADDRESSED_BY edge)
4. Is that procedure ABSENT? → confirmed gap → link to risk score
5. Which regulation requires this procedure? (REQUIRED_BY edge)
6. What is the ₹ exposure? (consequence from outage events × criticality × exposure)

---

## Your Review Checklist

You just need to answer these questions — no technical knowledge required:

- [ ] Do the **outage station names** look like real NTPC/Indian plant names?
- [ ] Do the **failure mode names** (Boiler Tube Failure, Flame Failure, etc.) sound like real problems at a power plant?
- [ ] Does the **gap logic** make sense? (if a plant doesn't have a documented emergency procedure, that's a gap)
- [ ] Is there anything that looks **obviously wrong or weird**?
- [ ] Does the **hero query** (waterwall thickness flagging) feel like a realistic plant scenario?

Reply to Cowork with your answers and we proceed to Neo4j loading.