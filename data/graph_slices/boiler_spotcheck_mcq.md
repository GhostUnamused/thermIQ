# ThermIQ — Boiler Slice Spot-Check (MCQ)

_For YC. No technical knowledge needed. For each question, pick the option that matches your judgment. The **answer key** at the bottom says which pick certifies the slice and which pick means "flag to Cowork."_

**Slice under review:** 36 nodes · 60 edges · 5 confirmed gaps · 18 real outage events · ₹211.8 Cr at stake

---

### Q1. Outage station names
The slice pulled these as real Indian plants that had boiler outages: **MUNDRA UMTPP, BARH STPS, JAWAHARPUR STPP, BELLARY TPS, RAMAGUNDEM STPS, ROPAR TPS**. Do these read like genuine Indian thermal power stations?

- A) Yes — all sound like real Indian plants
- B) Most do, but one or two look invented
- C) No — these look made up

---

### Q2. Failure mode names
The graph lists these failure modes: **Boiler Tube Failure, Flame Failure / MFT, Waterwall Tube Wall Thinning, Superheater Tube failure**. Do these sound like real problems a coal power plant would face?

- A) Yes — all are believable plant failures
- B) Some are real, some sound off
- C) No — these don't sound like real failures

---

### Q3. The core gap logic
"**Emergency Response SOP: Boiler Tube Failure**" was marked 🔴 **ABSENT** — no such procedure found in any plant document. The tool calls this a gap. Is that reasoning sound?

- A) Yes — if a plant has no documented emergency procedure for a known failure, that's a real knowledge gap
- B) No — absence of a document doesn't necessarily mean a gap
- C) Can't tell

---

### Q4. The PARTIAL vs ABSENT distinction
"**Waterwall Inspection Procedure**" was marked ⚠️ **PARTIAL** (not ABSENT). The documents mention the RFET inspection technique but contain "no numbered inspection steps, acceptance criteria, or defect thresholds." Does PARTIAL feel like the right label here (vs. calling it fully present or fully absent)?

- A) Yes — "topic is mentioned but the actual how-to steps are missing" is correctly a partial gap
- B) No — if the technique is mentioned it should count as present (✅)
- C) No — if the steps are missing it should count as fully absent (🔴)

---

### Q5. Criticality scoring
The two ABSENT gaps are scored: **Boiler Tube Failure emergency SOP = 5/5**, **Cold/Hot/Warm Startup procedure = 4/5**. Does it make sense that the tube-failure emergency response is rated as severe or more severe than the startup procedure?

- A) Yes — an emergency-response gap being top severity is reasonable
- B) No — these severities look backwards or arbitrary
- C) Can't tell

---

### Q6. The revenue-exposure link
The slice connects the waterwall gap to **18 real boiler-tube outages costing ₹211.8 Cr nationally** as the financial stake. Does it make sense to use real outages of the *same failure type* to estimate what this gap could cost?

- A) Yes — linking a documentation gap to real outages of that failure type is a fair way to size the risk
- B) No — these outages happened at other plants, so they shouldn't be attached to this gap
- C) Can't tell

---

### Q7. The hero demo query
The demo scenario: _"An operator flags waterwall tube thickness is below normal on Unit 2 — what inspection applies, has this caused outages elsewhere, what's the ₹ exposure, do we have a documented condemning limit?"_ Does this feel like a realistic question a real plant engineer would ask?

- A) Yes — this is a believable, useful plant scenario
- B) Somewhat, but it feels artificial
- C) No — no engineer would ask this

---

### Q8. The demo answer's punchline
The traversal concludes: RFET technique is documented, but **no condemning thickness limit exists — operators rely on an informal "25% rule of thumb."** Does "the technique is written down but the actual go/no-go number isn't" sound like a plausible real-world gap?

- A) Yes — that's a believable and compelling gap
- B) It's plausible but I'm not sure
- C) No — sounds invented

---

### Q9. Anything obviously broken?
Scanning the whole slice (node list, outage table, gap summary), do you see anything that looks plainly wrong, garbled, or contradictory?

- A) No — everything is internally consistent
- B) Yes — one or two things look off (note them)
- C) Yes — multiple things look wrong

---

### Q10. Known issue — citations
Three gaps currently show "**Found in: unknown**" instead of naming the source document. (Cowork already knows: the fix is in the code but the slice was not re-generated yet.) Knowing this is a stale-artifact issue and not a logic error, does it change your sign-off?

- A) No — it's a cosmetic re-run issue, the logic is fine; re-generate before the demo
- B) Yes — I want the citations fixed before I certify
- C) Unsure

---

## Answer key — what each pick means

| Q | Certify (slice is good) | Flag to Cowork |
|---|---|---|
| Q1 | **A** | B or C → name which station looks fake |
| Q2 | **A** | B or C → name which failure mode looks wrong |
| Q3 | **A** | B → the whole gap-detection premise is being challenged |
| Q4 | **A** | B or C → the PARTIAL/ABSENT thresholds need tuning |
| Q5 | **A** | B → criticality scores need review |
| Q6 | **A** | B → the risk-sizing method needs rethinking (this is the core thesis) |
| Q7 | **A** | B or C → the demo scenario needs reworking |
| Q8 | **A** | B or C → the headline gap story is weak |
| Q9 | **A** | B or C → list what looks broken |
| Q10 | **A** | B → blocks demo until extraction is re-run |

**To pass the Phase 1 gate:** ideally all **A**. Any B/C is not a failure — it's a specific item for Cowork to fix before the demo. Reply with just your letters (e.g. "1A 2A 3A...") and any notes.
