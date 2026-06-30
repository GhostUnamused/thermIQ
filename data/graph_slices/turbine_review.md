# ThermIQ — Turbine Slice Spot-Check
_Generated 2026-06-30_

> **How to use this:** Read through the Gap Summary section.
> For each 🔴 or ⚠️ item, ask yourself: does it make sense that this document
> wouldn't exist at a power plant? If something looks obviously wrong, let Cowork know.
> You don't need to know what the procedure actually says — just whether the logic holds.

---

**Graph size:** 23 nodes · 32 edges
**Real outage events:** 5 (from CEA daily report, npp.gov.in)
**Total ₹ at stake:** ₹81.0 Cr (across all Turbine outages in the data)
**Confirmed gaps:** 2

---

## The Equipment Family

We are looking at one type of equipment: **the Steam Turbine**, and its parts.
The turbine is the giant spinning machine that the boiler's steam pushes to
turn the generator and make electricity. Its parts are separate nodes in the
graph, connected by 'contains' edges.

| Node | What it is in plain English |
|------|----------------------------|
| Steam Turbine (500MW class) | The big multi-stage machine steam spins to make power |
| HP Turbine | The high-pressure section where the hottest steam enters first |
| IP / LP Turbine | The intermediate & low-pressure sections steam expands through next |
| Turbine Blades | The angled metal blades the steam pushes against to spin the shaft |
| Turbine Bearings | The oil-cushioned supports the spinning shaft rests on |
| Governing / Control Valves | The valves that control how much steam reaches the turbine |
| Lube Oil System | The oil that lubricates and cools the bearings |

---

## Jargon Glossary

A few abbreviations show up below. Quick definitions before you hit them:

- **SOP** = Standard Operating Procedure (written step-by-step instructions)
- **HP / IP / LP** = High / Intermediate / Low Pressure turbine sections
- **FOD** = Foreign Object Damage (debris striking and damaging a blade)
- **NDT / PT / RT** = Non-Destructive Testing methods (inspecting metal without cutting it)
- **EHC** = Electro-Hydraulic Control (the system that drives the governor valves)
- **TAN** = Total Acid Number (a lube-oil quality/ageing measurement)
- **ISO 7919 / 10816** = the international standards that set turbine vibration limits

---

## Gap Summary

_Each item below separates the **failure mode** (a real physical risk the equipment
faces) from the **procedure status** (whether a written SOP for handling it actually
exists in our documents). A 🔴/⚠️ status describes the missing or incomplete
*procedure* — it does NOT mean the failure mode itself is rare or absent._

_🔴 = No procedure found anywhere in the document corpus (confirmed gap)_
_⚠️ = Topic mentioned in documents but no actual SOP steps found (partial gap)_
_✅ = Full procedure found_

### ⚠️ Failure mode: Turbine High Vibration
**Procedure checked:** Turbine High-Vibration Emergency Response SOP
**Criticality:** 5/5 · **Procedure status:** PARTIALLY DOCUMENTED · **THIS IS A GAP**

**Found in:** CEA Standard Technical Specification 500MW
> *"Necessary pick-ups and accessories for remote monitoring of vibrations (horizontal and vertical)."*
> *"For all vibration measurements indicated under (ii) above, a Microprocessor/computer based system shall also be provided to achieve the following functions... identification of the exact nature of failure resulting in increase in bearing vibration and direct message on the TFT indicating the exact nature of fault"*
**Specific details extracted:** Shaft eccentricity, absolute/relative shaft vibration, differential expansion, overall expansion, stator winding vibration, axial shift, turbine speed, emergency stop and control valve position, temperatures are measured · Microprocessor/computer based system for on-line spectrum/harmonic analysis, identification of failure nature (e.g., misalignment, shaft crack, bearing looseness), storage, comparative analysis, plot generation · Vibration and supervisory parameters fed to turbine control system (TCS)
**What's missing from these documents:** no specific steps for emergency response, no thresholds for vibration alarms or trips, no decision points or actions to be taken in case of high vibration.

### 🔴 Failure mode: Turbine Blade Damage / Failure
**Procedure checked:** HP/IP/LP Turbine Blade Inspection Procedure
**Criticality:** 4/5 · **Procedure status:** NOT DOCUMENTED (ABSENT) · **THIS IS A GAP**

_Not found in any document in the corpus._

### ⚠️ Failure mode: Governor / Control Valve Failure
**Procedure checked:** Governor / Control Valve Maintenance & Testing Procedure
**Criticality:** 3/5 · **Procedure status:** PARTIALLY DOCUMENTED

**Found in:** CEA Standard Technical Specification 500MW
> *"Actuator operated valves shall be checked for seat leakage by closing the valves with actuator. Seat leakage test shall be carried out in both directions."*
> *"Performance testing shall be carried out on valve operators and actuators to check functional requirements like trip closing and opening time, valve lift and hysterisis."*
**Specific details extracted:** seat leakage test for actuator-operated valves · closing valves with actuator · test in both directions · Performance testing required for valve operators and actuators
**What's missing from these documents:** no mention of 'Governor' procedures; no complete maintenance or testing procedure for control valves; no acceptance criteria or specific thresholds for seat leakage; no numbered steps or full sequence for a maintenance/testing SOP.

### ⚠️ Failure mode: Lube Oil System Degradation / Low Oil Pressure
**Procedure checked:** Turbine Lube Oil System Maintenance Procedure
**Criticality:** 3/5 · **Procedure status:** PARTIALLY DOCUMENTED

**Found in:** CEA Standard Technical Specification 500MW
> *"• One no. oil conditioning system of centrifuge type as specified for main turbine • One no. portable type oil purifier per unit"*
**Specific details extracted:** Oil conditioning system (centrifuge type) · Portable type oil purifier per unit
**What's missing from these documents:** The passage describes components related to oil conditioning/purification but does not provide actual procedural steps, frequencies, thresholds, or criteria for performing maintenance on the lube oil system.

---

## Real Turbine Outage Events (from CEA data)

These are actual forced outages from India's national power portal.
Each one is a real event that cost real money.
Total Turbine events in our dataset: **5**

| Station | Unit | MW Lost | Date | ₹ Est. | Raw Reason |
|---------|------|---------|------|--------|------------|
| YADADRI TPS | 3 | 800 MW | 2026-06-07 | ₹25.9 Cr | TURBINE MISC. |
| MUTHIARA TPP | 1 | 600 MW | 2026-06-20 | ₹19.4 Cr | TURBINE MISC. PROBLEM |
| RAGHUNATHPUR TPP | 2 | 600 MW | 2026-04-14 | ₹19.4 Cr | TURBINE VIBRATIONS HIGH |
| JSW Energy Utkal Limited | 1 | 350 MW | 2026-06-24 | ₹11.3 Cr | TURBINE MISC. PROBLEM |
| SIMHAPURI TPS | 2 | 150 MW | 2026-06-20 | ₹4.9 Cr | TURBINE MISC. PROBLEM |

---

## The Demo Query (Hero Traversal)

This is the question ThermIQ should answer end-to-end once the graph is in Neo4j:

> *An operator sees turbine shaft vibration climbing toward the trip limit on Unit 3.*
> *What is the documented response procedure and trip threshold? Has high vibration*
> *caused forced outages at other Indian plants? What's the revenue exposure?*

**What the graph traversal does:**
1. Equipment: Turbine Bearings → FailureMode: Turbine High Vibration
2. Any real outage events linked to this failure? (INSTANCE_OF edges)
3. Does a Procedure exist that addresses it? (ADDRESSED_BY edge)
4. Is that procedure ABSENT/PARTIAL? → confirmed gap → link to risk score
5. Which regulation requires this procedure? (REQUIRED_BY → ISO 7919/10816, CEA STS)
6. What is the ₹ exposure? (consequence from outage events × criticality × exposure)

---

## Your Review Checklist

You just need to answer these questions — no technical knowledge required:

- [ ] Do the **outage station names** look like real Indian plant names?
- [ ] Do the **failure mode names** (High Vibration, Blade Damage, etc.) sound like real turbine problems?
- [ ] Does the **gap logic** make sense? (if a plant has no documented vibration-response SOP, that's a gap)
- [ ] Is there anything that looks **obviously wrong or weird**?
- [ ] Does the **hero query** (rising vibration on Unit 3) feel like a realistic plant scenario?

Reply to Cowork with your answers and we proceed to Neo4j loading.