# ThermIQ — Boiler Slice Spot-Check
_Generated 2026-06-29_

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

## Jargon Glossary

A few abbreviations show up below. Quick definitions before you hit them:

- **SOP** = Standard Operating Procedure (written step-by-step instructions)
- **MFT** = Master Fuel Trip (an automatic safety cutoff of all fuel to the boiler)
- **RFET** = Remote Field Electromagnetic Testing (a tube-inspection method)

---

## Gap Summary

_Each item below separates the **failure mode** (a real physical risk the equipment
faces) from the **procedure status** (whether a written SOP for handling it actually
exists in our documents). A 🔴/⚠️ status describes the missing or incomplete
*procedure* — it does NOT mean the failure mode itself is rare or absent._

_🔴 = No procedure found anywhere in the document corpus (confirmed gap)_
_⚠️ = Topic mentioned in documents but no actual SOP steps found (partial gap)_
_✅ = Full procedure found_

### 🔴 Failure mode: Boiler Tube Failure / Leakage
**Procedure checked:** Emergency Response SOP: Boiler Tube Failure
**Criticality:** 5/5 · **Procedure status:** NOT DOCUMENTED (ABSENT) · **THIS IS A GAP**

_Not found in any document in the corpus._

### ⚠️ Failure mode: Waterwall Tube Wall Thinning / Boiler Tube Failure / Leakage
**Procedure checked:** Waterwall Inspection Procedure (NDT / RFET / UT Thickness)
**Criticality:** 5/5 · **Procedure status:** PARTIALLY DOCUMENTED · **THIS IS A GAP**

**Found in:** NTPC BMD-32 Waterwall RFET Inspection Spec
> *"Calibration of instruments shall be as per ASME Section V, Article 17. Calibration of the equipment to be done on the calibration block..."*
**Specific details extracted:** Calibration per ASME Section V, Article 17 · Calibration block with notches inside and holes outside · Sensitivity calibration using new/used tube or reference block · RFET defect indication to be confirmed by UT for nature and size
**What's missing from these documents:** Specific acceptance/rejection criteria for defects; detailed RFET scanning parameters; comprehensive procedure for UT thickness measurement beyond defect sizing.

### ⚠️ Failure mode: Flame Failure / Master Fuel Trip (MFT)
**Procedure checked:** Emergency Response SOP: Flame Failure / MFT
**Criticality:** 5/5 · **Procedure status:** PARTIALLY DOCUMENTED · **THIS IS A GAP**

**Found in:** CEA Standard Technical Specification 500MW, NTPC IPS2025 O&M Conference Compendium
> *"e) Provide flame monitoring when fuel-firing equipment is in service and effect a burner trip or master fuel trip upon warranted firing conditions."*
> *"e) Provide flame monitoring when fuel-firing equipment is in service and effect a burner trip or master fuel trip upon warranted firing conditions. f) Continually monitor boiler conditions and actuate a master fuel trip (MFT) during adverse operating conditions which could be hazardous to equipment and personnel."*
**What's missing from these documents:** The passage describes the system's (BMS/MFT) automated response to flame failure and adverse conditions (actuating MFT/burner trip), but it does not provide any specific, actionable steps or procedures for an operator or technician to follow during or after such an event.

### 🔴 Failure mode: Superheater / Reheater Tube Failure
**Procedure checked:** Superheater / Reheater Tube Maintenance Procedure
**Criticality:** 4/5 · **Procedure status:** NOT DOCUMENTED (ABSENT) · **THIS IS A GAP**

_Not found in any document in the corpus._

### ⚠️ Failure mode: Boiler Tube Failure / Leakage / Flame Failure / Master Fuel Trip (MFT)
**Procedure checked:** Boiler Cold / Hot / Warm Startup Procedure
**Criticality:** 4/5 · **Procedure status:** PARTIALLY DOCUMENTED · **THIS IS A GAP**

**Found in:** CEA Standard Technical Specification 500MW
> *"the steam generator shall also be capable of start up without HP-LP bypass system in service, except in case of hot start-up."*
> *"The unit shall be suitably designed and pr ovided with necessary instrumentation for rapid starting, loading and unloading wit hout causing undue vibration..."*
**Specific details extracted:** Capability for start-up without HP-LP bypass (except hot start-up) is required · HP-LP bypass system provided for smooth start-up · Design considerations for thermal shock during HP-LP bypass operation (e.g., 140 deg C feedwater) · Sequences are used for startup and shutdown, moving from 'OFF' to 'ON'
**What's missing from these documents:** The actual step-by-step procedure for cold, hot, or warm startup, including specific operator actions, setpoints for various stages (e.g., purging, light-off, ramping steam pressure/temperature, synchronization steps).

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