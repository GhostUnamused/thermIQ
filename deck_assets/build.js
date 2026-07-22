const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.333, height: 7.5 });
p.layout = "W";

const IMGDIR = "/sessions/fervent-compassionate-franklin/mnt/ET AI Hackathon/deck_assets/";

const NAVY = "0E1E33", INK = "16283F", SLATE = "5C6B7E", AMBER = "E4843A", AMBERL = "F2A65A";
const MIST = "EEF2F7", LINE = "D5DEE8", WHITE = "FFFFFF", GREEN = "4E7A52";
const HEAD = "Cambria", BODY = "Calibri", MONO = "Consolas";

const IMG = {
  hub:  { path: IMGDIR + "05a_hub_operations_console.jpg", ar: 2.005 },
  cop:  { path: IMGDIR + "05b_query_copilot_cited_answer.jpg", ar: 2.005 },
  dash: { path: IMGDIR + "05c_risk_dashboard_gap_table.jpg", ar: 1.856 },
  graph:{ path: IMGDIR + "08_knowledge_graph_traversal.jpg", ar: 2.005 },
  arch: { path: IMGDIR + "06_architecture_diagram.png", ar: 1.623 },
};
function shadow() { return { type: "outer", color: "9AA9BC", blur: 9, offset: 3, angle: 90, opacity: 0.45 }; }
function titleBlock(s, kicker, title, tColor) {
  s.addShape(p.ShapeType.rect, { x: 0.62, y: 0.60, w: 0.14, h: 0.42, fill: { color: AMBER } });
  s.addText(kicker.toUpperCase(), { x: 0.88, y: 0.54, w: 11.6, h: 0.28, fontFace: BODY, fontSize: 12, bold: true, color: AMBER, charSpacing: 2 });
  s.addText(title, { x: 0.86, y: 0.80, w: 11.8, h: 0.72, fontFace: HEAD, fontSize: 30, bold: true, color: tColor || INK });
}
function pageNum(s, n) {
  s.addText(String(n).padStart(2,"0") + " · ThermIQ", { x: 10.9, y: 7.06, w: 2.0, h: 0.3, align: "right", fontFace: BODY, fontSize: 9, color: SLATE });
}
function imageBox(s, im, x, y, w) {
  const h = w / im.ar;
  s.addShape(p.ShapeType.rect, { x: x-0.04, y: y-0.04, w: w+0.08, h: h+0.08, fill: { color: WHITE }, line: { color: LINE, width: 1 }, shadow: shadow() });
  s.addImage({ path: im.path, x, y, w, h });
  return h;
}

// 1 TITLE
let s = p.addSlide();
s.background = { color: NAVY };
s.addShape(p.ShapeType.rect, { x: 0.9, y: 1.35, w: 0.9, h: 0.9, fill: { color: AMBER } });
s.addText("TQ", { x: 0.9, y: 1.35, w: 0.9, h: 0.9, align: "center", valign: "middle", fontFace: HEAD, fontSize: 30, bold: true, color: NAVY });
s.addText("ThermIQ", { x: 1.95, y: 1.30, w: 10, h: 1.05, fontFace: HEAD, fontSize: 56, bold: true, color: WHITE });
s.addText("Industrial Knowledge Intelligence for Thermal Power Plants", { x: 0.95, y: 2.55, w: 11.4, h: 0.5, fontFace: BODY, fontSize: 20, color: "C9D6E8" });
s.addText([
  { text: "Turn a plant’s scattered documents into a queryable operational brain —", options: { color: WHITE } },
  { text: " and price what it doesn’t know, in ₹ crore.", options: { color: AMBERL, bold: true } },
], { x: 0.95, y: 3.25, w: 11.0, h: 0.9, fontFace: HEAD, fontSize: 24, italic: true, lineSpacingMultiple: 1.05 });
s.addShape(p.ShapeType.line, { x: 0.95, y: 5.55, w: 11.45, h: 0, line: { color: "2C405B", width: 1 } });
s.addText([
  { text: "Problem 8 · ET AI Hackathon 2026", options: { bold: true, color: WHITE, breakLine: true } },
  { text: "AI for Industrial Knowledge Intelligence — Unified Asset & Operations Brain", options: { color: "9FB1C9", fontSize: 13 } },
], { x: 0.95, y: 5.75, w: 7.2, h: 0.9, fontFace: BODY, fontSize: 15 });
s.addText([
  { text: "YC · IIM Amritsar (IPM)", options: { color: WHITE, bold: true, breakLine: true } },
  { text: "therm-iq.vercel.app", options: { color: AMBERL, fontSize: 13 } },
], { x: 8.4, y: 5.75, w: 4.0, h: 0.9, align: "right", fontFace: BODY, fontSize: 15 });
s.addNotes("One-line pitch: ThermIQ turns a thermal plant's scattered documents into a queryable RAG copilot AND quantifies every knowledge gap as rupee-crore operational risk. Built solo for ET AI Hackathon 2026, Problem 8. Live at therm-iq.vercel.app. Differentiator to land verbally: most teams built a search tool; we price the ABSENCE of documentation.");

// 2 PROBLEM
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "The problem", "Knowledge is fragmented — and it’s walking out the door");
const stats = [
  { n: "35%", t: "of working hours spent searching for or recreating documents that already exist", src: "McKinsey, 2024" },
  { n: "7–12", t: "disconnected document systems in the average large Indian plant", src: "NASSCOM–EY" },
  { n: "18–22%", t: "of unplanned downtime events driven by this fragmentation", src: "BIS Research" },
  { n: "~25%", t: "of experienced engineers retire within a decade — undocumented knowledge leaves with them", src: "Sector estimate" },
];
let cx = 0.62, cw = 2.94, gap = 0.16, cy = 1.85, ch = 3.55;
stats.forEach((st, i) => {
  const x = cx + i * (cw + gap);
  s.addShape(p.ShapeType.roundRect, { x, y: cy, w: cw, h: ch, rectRadius: 0.08, fill: { color: MIST }, line: { color: LINE, width: 1 } });
  s.addText(st.n, { x: x+0.02, y: cy+0.28, w: cw-0.04, h: 0.95, align: "center", fontFace: HEAD, fontSize: 40, bold: true, color: AMBER });
  s.addText(st.t, { x: x+0.24, y: cy+1.35, w: cw-0.48, h: 1.55, valign: "top", fontFace: BODY, fontSize: 14, color: INK, lineSpacingMultiple: 1.02 });
  s.addText(st.src, { x: x+0.24, y: cy+ch-0.42, w: cw-0.48, h: 0.3, fontFace: BODY, fontSize: 10.5, italic: true, color: SLATE });
});
s.addText([
  { text: "Not a file-management problem. ", options: { bold: true, color: INK } },
  { text: "A safety, quality, and operational-efficiency problem that compounds every year it goes unsolved.", options: { color: SLATE } },
], { x: 0.62, y: 5.75, w: 12.1, h: 0.7, fontFace: HEAD, fontSize: 18, italic: true, align: "center" });
pageNum(s, 2);
s.addNotes("The brief's own framing, India-specific. The knowledge cliff is the emotional hook: once a 30-year operator retires undocumented, that judgment is gone. This is why the problem needs a platform, not a folder rename.");

// 3 THESIS
s = p.addSlide();
s.background = { color: NAVY };
s.addText("OUR INSIGHT", { x: 0.95, y: 1.15, w: 8, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: AMBER, charSpacing: 2 });
s.addText([
  { text: "Don’t just answer questions.\n", options: { color: WHITE } },
  { text: "Price what the plant ", options: { color: WHITE } },
  { text: "doesn’t know", options: { color: AMBERL, italic: true } },
  { text: " — in rupees.", options: { color: WHITE } },
], { x: 0.9, y: 1.7, w: 11.4, h: 2.3, fontFace: HEAD, fontSize: 40, bold: true, lineSpacingMultiple: 1.08 });
const thesis = [
  ["A RAG copilot answers what’s written down.", "Everyone will build that."],
  ["ThermIQ scores what ISN’T written down —", "every gap becomes a priced operational risk."],
  ["A knowledge gap stops being an audit footnote", "and becomes a capital-allocation decision."],
];
let ty = 4.35;
thesis.forEach((row, i) => {
  s.addShape(p.ShapeType.rect, { x: 0.95, y: ty + i*0.72, w: 0.10, h: 0.5, fill: { color: AMBER } });
  s.addText([
    { text: row[0] + "  ", options: { color: WHITE, bold: true } },
    { text: row[1], options: { color: "9FB1C9" } },
  ], { x: 1.2, y: ty + i*0.72 - 0.02, w: 11.0, h: 0.6, fontFace: BODY, fontSize: 16, valign: "middle" });
});
pageNum(s, 3);
s.addNotes("The whole pitch in one slide. The reframe from search problem to capital-risk problem maps onto the two heaviest criteria (Innovation 25% + Business Impact 25%). A plant manager can't act on 'you have documentation gaps'; they can act on 'flame-failure SOP gap = Rs 30 Cr exposure, mandated by CEA.'");

// 4 SOLUTION
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "Solution", "One operational brain, four working layers");
const layers = [
  ["Query Copilot", "RAG chat over plant + CEA docs. Cited answers, built for O&M engineers."],
  ["Knowledge-Gap Detection", "A 19-item expert checklist scored against each plant’s own corpus."],
  ["Risk Quantification Dashboard", "Every gap priced in ₹ crore, ranked, and explained — with its source."],
  ["Knowledge Graph", "Failure modes linked to real outage cost and the regulation that governs them."],
];
let ly = 1.95;
layers.forEach((l, i) => {
  const y = ly + i*1.06;
  s.addShape(p.ShapeType.roundRect, { x: 0.62, y, w: 0.62, h: 0.62, rectRadius: 0.06, fill: { color: NAVY } });
  s.addText(String(i+1), { x: 0.62, y, w: 0.62, h: 0.62, align: "center", valign: "middle", fontFace: HEAD, fontSize: 22, bold: true, color: AMBERL });
  s.addText(l[0], { x: 1.42, y: y-0.03, w: 5.9, h: 0.38, fontFace: BODY, fontSize: 17, bold: true, color: INK });
  s.addText(l[1], { x: 1.42, y: y+0.34, w: 5.9, h: 0.6, fontFace: BODY, fontSize: 13.5, color: SLATE, lineSpacingMultiple: 1.0 });
});
imageBox(s, IMG.hub, 7.75, 2.15, 5.0);
s.addText("Live console — therm-iq.vercel.app", { x: 7.75, y: 5.02, w: 5.0, h: 0.3, align: "center", fontFace: BODY, fontSize: 11, italic: true, color: SLATE });
s.addText("All four layers share one live backend and one risk model — nothing here is a standalone demo.", { x: 0.62, y: 6.5, w: 7.0, h: 0.7, fontFace: HEAD, fontSize: 14.5, italic: true, color: INK });
pageNum(s, 4);
s.addNotes("Walk the four layers, then stress: single backend, single risk model. The screenshot is the real Operations Console on NTPC (Rs 416.4 Cr, 19 gaps, 1,312 chunks).");

// 5 COPILOT
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "See it live · 1", "Query Copilot — cited answers in seconds");
imageBox(s, IMG.cop, 0.62, 1.75, 8.1);
const capC = [
  ["Real ₹ figures", "Top gaps returned with rupee-crore exposure, not vague advice."],
  ["Every claim cited", "Answers tied to CEA specs and the plant’s own documents."],
  ["Regulation-aware", "Names the CEA / ISO / tariff clause that mandates each item."],
  ["Graph hand-off", "One click jumps to the failure mode in the knowledge graph."],
];
let qy = 1.95;
capC.forEach((c, i) => {
  const y = qy + i*1.18;
  s.addText(c[0], { x: 9.05, y, w: 3.7, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: AMBER });
  s.addText(c[1], { x: 9.05, y: y+0.32, w: 3.7, h: 0.72, fontFace: BODY, fontSize: 12.5, color: INK, lineSpacingMultiple: 1.0 });
});
pageNum(s, 5);
s.addNotes("Live NTPC screenshot. 'Top 3 gaps by rupee risk + mandating regulation' returns Turbine Vibration Rs 42.4 Cr (ISO 7919/10816), Turbine Blade Inspection Rs 38.0 Cr (CEA STS 500MW), Flame Failure SOP Rs 30.1 Cr (NTPC Lara tariff + CEA O&M). Note the 'View in graph' chip.");

// 6 RISK MODEL
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "See it live · 2", "The risk model — every number is sourced");
s.addShape(p.ShapeType.roundRect, { x: 0.62, y: 1.78, w: 7.0, h: 0.72, rectRadius: 0.06, fill: { color: NAVY } });
s.addText([
  { text: "risk", options: { color: AMBERL, bold: true } },
  { text: "  =  criticality ", options: { color: WHITE } },
  { text: "(1–5)", options: { color: "9FB1C9" } },
  { text: "  ×  consequence ", options: { color: WHITE } },
  { text: "(₹ Cr)", options: { color: "9FB1C9" } },
  { text: "  ×  exposure ", options: { color: WHITE } },
  { text: "(0–1)", options: { color: "9FB1C9" } },
], { x: 0.62, y: 1.78, w: 7.0, h: 0.72, align: "center", valign: "middle", fontFace: MONO, fontSize: 14.5 });
const facs = [
  ["Criticality", "CEA outage frequency + CERC rules. Boiler failures lead forced outages (Vasudha 2022, 735 units)."],
  ["Consequence", "Avg revenue lost per real CEA forced-outage event, at ₹5/kWh (LBNL/Ember 2024)."],
  ["Exposure", "1 − best semantic match of the topic vs the plant’s own documents (Jina v3)."],
];
let fy = 2.72;
facs.forEach((f, i) => {
  const y = fy + i*0.86;
  s.addText(f[0], { x: 0.62, y, w: 2.0, h: 0.72, fontFace: BODY, fontSize: 15, bold: true, color: AMBER, valign: "top" });
  s.addText(f[1], { x: 2.55, y, w: 5.05, h: 0.8, fontFace: BODY, fontSize: 12.5, color: INK, lineSpacingMultiple: 1.0 });
});
s.addShape(p.ShapeType.roundRect, { x: 0.62, y: 5.45, w: 7.0, h: 1.15, rectRadius: 0.06, fill: { color: "FBEFE4" }, line: { color: AMBER, width: 1 } });
s.addText([
  { text: "₹416.4 Cr", options: { fontSize: 32, bold: true, color: AMBER } },
  { text: "  total quantified risk", options: { fontSize: 15, color: INK } },
], { x: 0.9, y: 5.55, w: 6.6, h: 0.55, valign: "middle", fontFace: HEAD });
s.addText("NTPC today — 19 scored gaps, every figure traceable to its CEA / CERC source.", { x: 0.9, y: 6.08, w: 6.5, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: SLATE });
imageBox(s, IMG.dash, 7.95, 1.95, 4.8);
s.addText("Live risk register — per-row math shown", { x: 7.95, y: 4.62, w: 4.8, h: 0.3, align: "center", fontFace: BODY, fontSize: 11, italic: true, color: SLATE });
pageNum(s, 6);
s.addNotes("Credibility slide. Each factor is grounded in a cited source. Dashboard shows the per-row audit trail 'crit 5 x Rs 11.8 Cr x 0.49 exp, derived from 18 CEA records.' If asked: ticker Rs 416.4 Cr is all 19 gaps; dashboard card Rs 367 Cr counts only CEA-outage-backed rows. Both real.");

// 7 GRAPH
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "See it live · 3", "Knowledge graph — failure mode to regulation");
imageBox(s, IMG.graph, 0.62, 1.75, 8.1);
s.addText("An auditable chain, not a dashboard number:", { x: 9.05, y: 1.95, w: 3.7, h: 0.5, fontFace: BODY, fontSize: 13.5, bold: true, color: INK });
const chain = ["Waterwall tube thinning", "flagged PARTIAL · criticality 5/5", "18 real CEA outage records", "= ₹211.85 Cr already lost", "mandated by CEA STS 500MW + IBR"];
let gy = 2.6;
chain.forEach((c, i) => {
  const y = gy + i*0.72;
  s.addShape(p.ShapeType.rect, { x: 9.05, y: y+0.05, w: 0.08, h: 0.42, fill: { color: i===3? AMBER : NAVY } });
  s.addText(c, { x: 9.28, y, w: 3.5, h: 0.6, valign: "middle", fontFace: BODY, fontSize: 13, bold: i===3, color: i===3? AMBER : INK });
});
pageNum(s, 7);
s.addNotes("Neo4j-backed. The Rs number isn't asserted, it's traceable: click a flagged failure node and the panel shows the equipment path, the real CEA outages that sum to the figure, and the regulation requiring the missing procedure. Answers the brief's 'knowledge graph linkage' criterion. Live, not a mockup.");

// 8 ARCHITECTURE
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "Architecture", "How it fits together");
imageBox(s, IMG.arch, 3.55, 1.7, 9.1);
const stack = [
  ["Frontend", "SPA · GitHub Pages + Vercel"],
  ["Backend", "Vercel serverless (api/*.js)"],
  ["Retrieval", "Jina v3 → Qdrant vectors"],
  ["Generation", "Gemini 2.5 Flash + fallbacks"],
  ["Structured", "Firestore · Neo4j graph"],
  ["Automation", "GitHub Actions pipelines"],
];
let ay = 1.95;
stack.forEach((r, i) => {
  const y = ay + i*0.82;
  s.addText(r[0], { x: 0.62, y, w: 2.7, h: 0.3, fontFace: BODY, fontSize: 13.5, bold: true, color: AMBER });
  s.addText(r[1], { x: 0.62, y: y+0.29, w: 2.8, h: 0.42, fontFace: BODY, fontSize: 11.5, color: SLATE });
});
pageNum(s, 8);
s.addNotes("All on free tiers: Jina embeddings, Qdrant vector DB, Gemini 2.5 Flash with NIM->OpenRouter fallback cascade so the copilot keeps answering under quota, Firestore for the registry, Neo4j for the graph, GitHub Actions for daily CEA ingest and gap scans. Diagram is the real ThermIQ_Architecture.svg.");

// 9 WHY IT WINS
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "Why it stands out", "Mapped to how it’s judged");
const crit = [
  ["25%", "Innovation", "Prices the ABSENCE of documentation in ₹ — a capital-risk framing, not another RAG chatbot."],
  ["25%", "Business Impact", "A sourced number a manager can act on, or defend in a CERC tariff petition."],
  ["20%", "Technical Excellence", "4-stage LLM fallback cascade + agentic tool-calling over vectors, registry, and outage data."],
  ["15%", "Scalability", "Per-plant namespacing; CEA benchmark vs client corpus scales to any plant, zero re-engineering."],
  ["15%", "User Experience", "Cited answers, click-through graph, one-click themed Excel export."],
];
let wy = 1.9;
crit.forEach((c, i) => {
  const y = wy + i*1.0;
  s.addShape(p.ShapeType.roundRect, { x: 0.62, y, w: 1.15, h: 0.78, rectRadius: 0.06, fill: { color: NAVY } });
  s.addText(c[0], { x: 0.62, y, w: 1.15, h: 0.78, align: "center", valign: "middle", fontFace: HEAD, fontSize: 20, bold: true, color: AMBERL });
  s.addText(c[1], { x: 1.95, y: y+0.03, w: 3.2, h: 0.72, valign: "middle", fontFace: BODY, fontSize: 15.5, bold: true, color: INK });
  s.addText(c[2], { x: 5.3, y: y+0.03, w: 7.4, h: 0.74, valign: "middle", fontFace: BODY, fontSize: 13, color: SLATE, lineSpacingMultiple: 1.0 });
});
pageNum(s, 9);
s.addNotes("Judges score against this rubric, so show them the rubric being answered. Lead with the two 25% criteria where the rupee-quantification framing is strongest.");

// 10 STATUS + LIMITATIONS
s = p.addSlide();
s.background = { color: WHITE };
titleBlock(s, "Honest status", "What’s real today, and what isn’t");
s.addShape(p.ShapeType.roundRect, { x: 0.62, y: 1.85, w: 5.9, h: 4.9, rectRadius: 0.08, fill: { color: MIST }, line: { color: LINE, width: 1 } });
s.addText([{ text: "● ", options: { color: GREEN } }, { text: "Live today", options: { bold: true, color: INK } }], { x: 0.92, y: 2.05, w: 5.3, h: 0.4, fontFace: BODY, fontSize: 17 });
const real = ["SPA with 5 working views","RAG copilot with citations","19-item gap engine → ₹416.4 Cr on NTPC","Neo4j graph with click-through traversal","Per-plant document namespacing","Themed one-click Excel export","Automated CEA-ingest + gap-scan pipelines"];
s.addText(real.map((t)=>({ text: t, options: { bullet: { indent: 14 }, breakLine: true, paraSpaceAfter: 6 } })), { x: 0.98, y: 2.55, w: 5.2, h: 4.0, fontFace: BODY, fontSize: 13.5, color: INK });
s.addShape(p.ShapeType.roundRect, { x: 6.82, y: 1.85, w: 5.9, h: 4.9, rectRadius: 0.08, fill: { color: WHITE }, line: { color: AMBER, width: 1.2 } });
s.addText([{ text: "▲ ", options: { color: AMBER } }, { text: "Known limitations", options: { bold: true, color: INK } }], { x: 7.12, y: 2.05, w: 5.3, h: 0.4, fontFace: BODY, fontSize: 17 });
const lims = [
  ["BMD-01 spec not ingested", "vendor host unreachable from the build network"],
  ["No P&ID computer-vision yet", "ingestion is text + OCR only"],
  ["Vercel free tier caps 12 functions", "at the cap; new endpoints need a swap"],
  ["v4 scoring engine held back", "2 outliers need a human check before it ships"],
  ["No formal expert benchmark yet", "live-verified, not independently scored"],
];
let liy = 2.6;
lims.forEach((l,i)=>{
  const y = liy + i*0.83;
  s.addText(l[0], { x: 7.12, y, w: 5.35, h: 0.34, fontFace: BODY, fontSize: 13.5, bold: true, color: INK });
  s.addText(l[1], { x: 7.12, y: y+0.31, w: 5.35, h: 0.42, fontFace: BODY, fontSize: 11.5, italic: true, color: SLATE });
});
pageNum(s, 10);
s.addNotes("Leading with limitations builds credibility. Strongest point: v4 scoring engine (dry-run Rs 2,223 Cr) exists but we deliberately shipped the conservative validated v3 rather than a flashier unreviewed number. Research-preview prototype, built solo in under a month.");

// 11 CLOSING
s = p.addSlide();
s.background = { color: NAVY };
s.addText("Let’s talk", { x: 0.95, y: 1.35, w: 10, h: 1.0, fontFace: HEAD, fontSize: 46, bold: true, color: WHITE });
s.addText("A research-preview prototype — built solo, non-engineering background, in under a month, with AI as a development partner. Proof the intelligence layer this brief asks for can be built fast when the framing is right.", { x: 0.95, y: 2.55, w: 8.4, h: 1.5, fontFace: HEAD, fontSize: 18, italic: true, color: "C9D6E8", lineSpacingMultiple: 1.1 });
const links = [["Live app","therm-iq.vercel.app"],["GitHub","github.com/GhostUnamused/thermIQ"],["Built by","YC · IIM Amritsar (IPM)"]];
let cly = 4.5;
links.forEach((l,i)=>{
  const y = cly + i*0.7;
  s.addShape(p.ShapeType.rect, { x: 0.95, y: y+0.04, w: 0.1, h: 0.44, fill: { color: AMBER } });
  s.addText(l[0], { x: 1.2, y, w: 2.4, h: 0.55, valign: "middle", fontFace: BODY, fontSize: 15, bold: true, color: "9FB1C9" });
  s.addText(l[1], { x: 3.5, y, w: 8.0, h: 0.55, valign: "middle", fontFace: BODY, fontSize: 16, bold: true, color: WHITE });
});
s.addText("The ask: judges’ feedback, and an introduction to any plant team willing to pilot with their own documents.", { x: 0.95, y: 6.75, w: 11.4, h: 0.5, fontFace: BODY, fontSize: 13.5, italic: true, color: AMBERL });
s.addNotes("Close on the framing win: a non-engineer built a working, rupee-quantified industrial knowledge platform in under a month. Ask for feedback and a pilot intro.");

p.writeFile({ fileName: "/sessions/fervent-compassionate-franklin/mnt/ET AI Hackathon/ThermIQ_Pitch_Deck.pptx" }).then(f => console.log("WROTE", f));
