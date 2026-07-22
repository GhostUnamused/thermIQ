# ThermIQ — Turbine Slice Spot-Check (MCQ)

_For YC. No technical knowledge needed. Pick the option that matches your judgment. The **answer key** at the bottom says which pick certifies the slice and which flags a problem._

**Slice under review:** 23 nodes · 32 edges · 5 real turbine outages · ₹81.0 Cr at stake · 2 confirmed gaps (merged into the existing Boiler graph)

---

### Q1. Outage station names
The slice pulled these as real Indian plants with turbine outages: **YADADRI TPS, MUTHIARA TPP, RAGHUNATHPUR TPP, JSW Energy Utkal, SIMHAPURI TPS**. Do these read like genuine Indian power stations?

- A) Yes — all look real
- B) Most do, but one or two look invented
- C) No — these look made up

_(Some are less famous than the boiler-slice names — worth a quick online check, like you did last time.)_

---

### Q2. Failure mode names
The graph lists these turbine failure modes: **High Vibration, Blade Damage/Failure, Governor/Control Valve Failure, Lube Oil Degradation**. Do these sound like real problems a steam turbine would have?

- A) Yes — all are believable turbine failures
- B) Some are real, some sound off
- C) No — these don't sound like real failures

---

### Q3. The "TURBINE MISC." problem (important)
4 of the 5 outages have the raw reason **"TURBINE MISC. PROBLEM"** — only one explicitly says "TURBINE VIBRATIONS HIGH". The slice still attached the vague ones to the turbine and (by default) to the High-Vibration failure mode. Is that a fair call?

- A) Fair — they're clearly turbine outages; defaulting vague ones to the most common cause (vibration) is reasonable for sizing risk, as long as we're honest it's an estimate
- B) Not fair — outages without a specific cause shouldn't be attached to a specific failure mode
- C) Can't tell

---

### Q4. The vibration gap (the hero story)
"Turbine High-Vibration Response SOP" is ⚠️ **PARTIAL, criticality 5**. The CEA spec describes vibration *monitoring* hardware in detail, but the extractor found **"no thresholds for vibration alarms or trips, no decision points or actions in case of high vibration."** Does "they can monitor it but have no written response procedure" sound like a real, compelling gap?

- A) Yes — monitoring without a documented response is a believable, strong gap
- B) Plausible but I'm unsure
- C) No — sounds invented

---

### Q5. Blade inspection
"HP/IP/LP Turbine Blade Inspection Procedure" is 🔴 **ABSENT, criticality 4** — not found in any document. Given a failed blade can wreck a whole turbine, does flagging a missing blade-inspection procedure as a gap make sense?

- A) Yes — a missing inspection procedure for a catastrophic failure is a real gap
- B) No — absence of the document doesn't mean a gap
- C) Can't tell

---

### Q6. Why only 2 "confirmed gaps" out of 4 weak procedures
All 4 turbine procedures are incomplete, but only **2 are counted as "confirmed gaps"** (vibration + blade). The other two (Governor valve, Lube oil — both PARTIAL, criticality 3) are shown but NOT counted. The rule: a PARTIAL only counts as a confirmed gap if criticality is 4 or 5. Does that rule make sense?

- A) Yes — partially-documented low-criticality items are worth noting but shouldn't be flagged as urgent gaps; reserve "gap" for high-severity items
- B) No — any incomplete procedure should count as a gap regardless of criticality
- C) No — it should be stricter (only fully-ABSENT items should count)

---

### Q7. Revenue exposure
The 5 turbine outages total **₹81.0 Cr** — smaller than the boiler slice's ₹211.8 Cr. Boiler-tube failures genuinely dominate Indian forced outages, so a thinner turbine number is expected. Does it bother you that the turbine ₹ figure is lower?

- A) No — it's lower because turbine outages are genuinely less frequent than boiler-tube failures; the number being real matters more than it being big
- B) Yes — a smaller number weakens the story and I'd want to widen the data window
- C) Can't tell

---

### Q8. The hero query
The demo scenario: _"An operator sees turbine shaft vibration climbing toward the trip limit on Unit 3 — what's the documented response and trip threshold, has high vibration caused outages elsewhere, what's the exposure?"_ Does this feel like a realistic question a plant engineer would ask?

- A) Yes — believable and useful
- B) Somewhat, but artificial
- C) No — unrealistic

---

### Q9. Anything obviously broken?
Scanning the whole slice (parts list, failure modes, outage table, gap summary), does anything look plainly wrong, garbled, or contradictory?

- A) No — everything is internally consistent
- B) Yes — one or two things look off (note them)
- C) Yes — multiple things look wrong

---

### Q10. Cross-family link
The Turbine slice was **added to** the existing Boiler graph (not replacing it), and both now share one "CEA O&M Practices" regulation node — so the graph shows one regulation governing procedures across two equipment families. Is that the behavior you'd want for a knowledge graph that's meant to grow?

- A) Yes — families sharing common regulations is exactly the point of a graph; keep building this way
- B) No — I'd rather each family stay separate
- C) Unsure

---

## Answer key — what each pick means

| Q | Certify (slice is good) | Flag to Cowork |
|---|---|---|
| Q1 | **A** | B or C → name the station that looks fake |
| Q2 | **A** | B or C → name the failure mode that looks wrong |
| Q3 | **A** | B → we should only link outages with an explicit cause (changes the ₹ math) |
| Q4 | **A** | B or C → the headline vibration gap is weak |
| Q5 | **A** | B → challenges the gap-detection premise |
| Q6 | **A** | B or C → the gap-counting threshold needs changing |
| Q7 | **A** | B → widen the CEA outage window to strengthen the ₹ number |
| Q8 | **A** | B or C → demo scenario needs rework |
| Q9 | **A** | B or C → list what looks broken |
| Q10 | **A** | B → change the graph to keep families isolated |

**To pass the Phase 2 gate:** ideally all **A**. Any B/C isn't a failure — it's a specific item to fix. The two most consequential are **Q3** (whether vague "TURBINE MISC." outages should count toward the vibration risk) and **Q7** (whether to widen the outage window). Reply with your letters (e.g. "1A 2A 3A...") and any notes.
