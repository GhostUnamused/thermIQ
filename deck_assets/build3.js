const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.333, height: 7.5 });
p.layout = "W";
const D = "/sessions/fervent-compassionate-franklin/mnt/ET AI Hackathon/deck_assets/";

const NAVY="0E1E33", INK="16283F", SLATE="55657A", AMBER="D97A2B", AMBERL="F2A65A",
      MIST="EEF2F7", TINT="FBF1E7", LINE="D5DEE8", WHITE="FFFFFF", GREEN="3F7A4A", RED="B0553A";
const HEAD="Cambria", BODY="Calibri";
const IMG = {
  hub:{path:D+"05a_hub_operations_console.jpg",ar:2.005},
  cop:{path:D+"05b_query_copilot_cited_answer.jpg",ar:2.005},
  dash:{path:D+"05c_risk_dashboard_gap_table.jpg",ar:1.856},
  graph:{path:D+"08_knowledge_graph_traversal.jpg",ar:2.005},
  arch:{path:D+"06_architecture_diagram.png",ar:1.623},
};
const sh=()=>({type:"outer",color:"9AA9BC",blur:8,offset:3,angle:90,opacity:0.4});

function title(s,kick,ttl){
  s.addShape(p.ShapeType.rect,{x:0.55,y:0.46,w:0.13,h:0.66,fill:{color:AMBER}});
  s.addText(kick.toUpperCase(),{x:0.8,y:0.44,w:11.9,h:0.26,fontFace:BODY,fontSize:11.5,bold:true,color:AMBER,charSpacing:2});
  s.addText(ttl,{x:0.78,y:0.68,w:12.0,h:0.6,fontFace:HEAD,fontSize:27,bold:true,color:INK});
  s.addShape(p.ShapeType.line,{x:0.55,y:1.42,w:12.23,h:0,line:{color:LINE,width:1}});
}
function pg(s,n){s.addText(String(n).padStart(2,"0")+"  ThermIQ  ·  Problem 8",{x:9.0,y:7.08,w:3.78,h:0.3,align:"right",fontFace:BODY,fontSize:9,color:SLATE});}
function pic(s,im,x,y,w){const h=w/im.ar;s.addShape(p.ShapeType.rect,{x:x-0.035,y:y-0.035,w:w+0.07,h:h+0.07,fill:{color:WHITE},line:{color:LINE,width:1},shadow:sh()});s.addImage({path:im.path,x,y,w,h});return h;}
// feature row: amber tick + bold lead + desc (wraps)
function feat(s,x,y,w,lead,desc,fs){
  fs=fs||13;
  s.addShape(p.ShapeType.rect,{x:x,y:y+0.055,w:0.10,h:0.10,fill:{color:AMBER}});
  s.addText([{text:lead+"  ",options:{bold:true,color:INK}},{text:desc,options:{color:SLATE}}],
    {x:x+0.24,y:y-0.05,w:w-0.24,h:0.72,fontFace:BODY,fontSize:fs,valign:"top",lineSpacingMultiple:0.98});
}
function underhood(s,x,y,w,txt){
  s.addShape(p.ShapeType.roundRect,{x,y,w,h:0.62,rectRadius:0.05,fill:{color:MIST},line:{color:LINE,width:1}});
  s.addText([{text:"UNDER THE HOOD   ",options:{bold:true,color:AMBER,fontSize:10}},{text:txt,options:{color:INK,fontSize:11}}],
    {x:x+0.18,y,w:w-0.36,h:0.62,valign:"middle",fontFace:BODY,lineSpacingMultiple:0.95});
}

/* ---------- 1 COVER ---------- */
let s=p.addSlide(); s.background={color:NAVY};
s.addShape(p.ShapeType.rect,{x:0.9,y:1.25,w:0.92,h:0.92,fill:{color:AMBER}});
s.addText("TQ",{x:0.9,y:1.25,w:0.92,h:0.92,align:"center",valign:"middle",fontFace:HEAD,fontSize:30,bold:true,color:NAVY});
s.addText("ThermIQ",{x:1.98,y:1.19,w:9,h:1.05,fontFace:HEAD,fontSize:54,bold:true,color:WHITE});
s.addText("Industrial Knowledge Intelligence for Thermal Power Plants",{x:0.92,y:2.42,w:11.5,h:0.5,fontFace:BODY,fontSize:19,color:"C9D6E8"});
s.addText([
  {text:"A unified asset & operations brain that makes a plant’s scattered documents queryable — ",options:{color:WHITE}},
  {text:"and quantifies undocumented knowledge as financial risk.",options:{color:AMBERL,bold:true}},
],{x:0.92,y:3.08,w:11.3,h:0.95,fontFace:HEAD,fontSize:21,italic:true,lineSpacingMultiple:1.06});
s.addShape(p.ShapeType.line,{x:0.92,y:5.5,w:11.5,h:0,line:{color:"2C405B",width:1}});
s.addText([
  {text:"ET AI Hackathon 2026  ·  Problem 8",options:{bold:true,color:WHITE,breakLine:true}},
  {text:"AI for Industrial Knowledge Intelligence — Unified Asset & Operations Brain",options:{color:"9FB1C9",fontSize:12.5}},
],{x:0.92,y:5.72,w:7.5,h:0.9,fontFace:BODY,fontSize:14.5});
s.addText([
  {text:"Yaminichandra K J",options:{color:WHITE,bold:true,breakLine:true}},
  {text:"IIM Amritsar (IPM)  ·  therm-iq.vercel.app",options:{color:AMBERL,fontSize:12.5}},
],{x:8.5,y:5.72,w:3.92,h:0.9,align:"right",fontFace:BODY,fontSize:14.5});

/* ---------- 2 PROBLEM CONTEXT ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Problem Context","The Industrial Knowledge Gap");
// left narrative
s.addText([
  {text:"Asset-intensive plants run on knowledge scattered across P&IDs, maintenance logs, operating procedures, inspection reports and regulatory filings — typically 7–12 disconnected systems per plant. Much of the critical operating judgement is never written down at all; it lives in the heads of senior engineers.",options:{breakLine:true,paraSpaceAfter:10}},
  {text:"The cost is threefold: hours lost re-finding or recreating information, unplanned downtime from decisions made without full equipment history, and a looming knowledge cliff as experienced staff retire and take undocumented expertise with them.",options:{breakLine:true,paraSpaceAfter:10}},
],{x:0.55,y:1.62,w:6.55,h:3.1,fontFace:BODY,fontSize:14,color:INK,valign:"top",lineSpacingMultiple:1.04});
s.addShape(p.ShapeType.roundRect,{x:0.55,y:4.62,w:6.55,h:1.35,rectRadius:0.07,fill:{color:TINT},line:{color:AMBER,width:1}});
s.addText([
  {text:"This is not a document-management problem. ",options:{bold:true,color:INK}},
  {text:"It is a safety, quality and operational-efficiency problem — and it compounds every year it is left unsolved, across India’s 200+ GW coal fleet.",options:{color:INK}},
],{x:0.78,y:4.62,w:6.1,h:1.35,valign:"middle",fontFace:HEAD,fontSize:15,italic:true,lineSpacingMultiple:1.05});
// right stat grid 2x2
const st=[["35%","of working hours spent searching for or recreating documents that already exist","McKinsey, 2024"],
["7–12","disconnected document systems in the average large plant","NASSCOM–EY"],
["18–22%","of unplanned downtime events linked to knowledge fragmentation","BIS Research"],
["~25%","of experienced engineers retiring within the next decade","Sector estimate"]];
let gx=7.4,gw=2.62,gg=0.18,gy=1.62,gh=2.12;
st.forEach((c,i)=>{const x=gx+(i%2)*(gw+gg),y=gy+Math.floor(i/2)*(gh+0.18);
  s.addShape(p.ShapeType.roundRect,{x,y,w:gw,h:gh,rectRadius:0.07,fill:{color:MIST},line:{color:LINE,width:1}});
  s.addText(c[0],{x:x+0.05,y:y+0.14,w:gw-0.1,h:0.7,align:"center",fontFace:HEAD,fontSize:30,bold:true,color:AMBER});
  s.addText(c[1],{x:x+0.18,y:y+0.88,w:gw-0.36,h:0.9,fontFace:BODY,fontSize:11.5,color:INK,valign:"top",lineSpacingMultiple:0.98});
  s.addText(c[2],{x:x+0.18,y:y+gh-0.34,w:gw-0.36,h:0.28,fontFace:BODY,fontSize:9.5,italic:true,color:SLATE});
});
pg(s,2);

/* ---------- 3 SOLUTION OVERVIEW ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Solution Overview","A Unified Asset & Operations Brain");
s.addText([
  {text:"ThermIQ ingests a plant’s heterogeneous documents — text and scanned PDFs (via OCR), spreadsheets, and Google Drive folders — into one searchable knowledge base, then layers four capabilities on top. Its defining move: it does not only retrieve what is documented, ",options:{color:INK}},
  {text:"it detects and prices what is missing.",options:{color:AMBER,bold:true}},
],{x:0.55,y:1.6,w:12.23,h:0.85,fontFace:BODY,fontSize:14,valign:"top",lineSpacingMultiple:1.02});
const mods=[["1","Query Copilot","Ask questions in plain English; get direct, cited answers drawn from the plant’s own documents and the benchmark standards."],
["2","Knowledge-Gap Detection","Scores each plant’s corpus against a benchmark of what should be documented, flagging what is absent or only partial."],
["3","Risk Quantification Dashboard","Converts every gap into rupee-crore operational risk, ranked, with a suggested closure order and a one-click Excel export."],
["4","Knowledge Graph","Links failure modes to real historical outage cost and the regulations that mandate the missing procedure."]];
let my=2.62,mw=5.95,mh=1.28,mg=0.33;
mods.forEach((m,i)=>{const x=0.55+(i%2)*(mw+mg),y=my+Math.floor(i/2)*(mh+0.2);
  s.addShape(p.ShapeType.roundRect,{x,y,w:mw,h:mh,rectRadius:0.07,fill:{color:MIST},line:{color:LINE,width:1}});
  s.addShape(p.ShapeType.roundRect,{x:x+0.18,y:y+0.2,w:0.6,h:0.6,rectRadius:0.06,fill:{color:NAVY}});
  s.addText(m[0],{x:x+0.18,y:y+0.2,w:0.6,h:0.6,align:"center",valign:"middle",fontFace:HEAD,fontSize:20,bold:true,color:AMBERL});
  s.addText(m[1],{x:x+0.95,y:y+0.17,w:mw-1.1,h:0.35,fontFace:BODY,fontSize:15.5,bold:true,color:INK});
  s.addText(m[2],{x:x+0.95,y:y+0.53,w:mw-1.1,h:0.68,fontFace:BODY,fontSize:12,color:SLATE,valign:"top",lineSpacingMultiple:0.98});
});
s.addShape(p.ShapeType.roundRect,{x:0.55,y:5.78,w:12.23,h:0.72,rectRadius:0.06,fill:{color:TINT},line:{color:AMBER,width:1}});
s.addText([{text:"One ingestion pipeline, one live backend, one risk model.  ",options:{bold:true,color:INK}},
  {text:"The four modules are views on the same data — not four separate demos.",options:{color:INK}}],
  {x:0.78,y:5.78,w:11.8,h:0.72,valign:"middle",fontFace:HEAD,fontSize:14,italic:true});
pg(s,3);

/* ---------- 4 FEATURE: QUERY COPILOT ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Feature Deep-Dive · 1","Conversational Knowledge Retrieval");
let ih=pic(s,IMG.cop,0.55,1.62,7.0);
underhood(s,0.55,1.62+ih+0.16,7.0,"Jina AI embeddings · Qdrant vector search · Gemini 2.5 Flash · agentic tool-calling");
s.addText("Example — an NTPC plant profile: the assistant returns the top gaps with ₹ exposure and the regulation mandating each.",{x:0.55,y:1.62+ih+0.92,w:7.0,h:0.5,fontFace:BODY,fontSize:10.5,italic:true,color:SLATE,lineSpacingMultiple:0.95});
const cf=[
 ["Ask in plain English.","Any procedure, spec or failure mode — a direct, cited answer in seconds, no keyword hunting."],
 ["Understands meaning, not words.","Semantic search matches intent even when the wording differs (Jina AI + Qdrant)."],
 ["Answers you can trust.","Every response separates benchmark standards from the plant’s own documents, with source citations and a confidence signal."],
 ["Decides what to look up.","Agentic tool-use picks between document search, the live risk register, real outage records, or the web."],
 ["Always available.","A four-model fallback chain (Gemini → NVIDIA NIM → OpenRouter) keeps it answering under free-tier limits."],
 ["Guides the next step.","Multi-turn memory, one-click follow-up suggestions, and a jump straight into the knowledge graph."]];
let fy=1.62,fx=7.85,fw=4.93;
cf.forEach((c,i)=>feat(s,fx,fy+i*0.9,fw,c[0],c[1],12.5));
pg(s,4);

/* ---------- 5 FEATURE: RISK QUANTIFICATION ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Feature Deep-Dive · 2","Quantifying Knowledge Gaps as Financial Risk");
// formula band full width
s.addShape(p.ShapeType.roundRect,{x:0.55,y:1.6,w:12.23,h:0.62,rectRadius:0.06,fill:{color:NAVY}});
s.addText([
 {text:"Risk",options:{color:AMBERL,bold:true}},
 {text:"  =  Criticality ",options:{color:WHITE}},{text:"(how severe, 1–5)",options:{color:"9FB1C9"}},
 {text:"   ×   Consequence ",options:{color:WHITE}},{text:"(₹ Cr lost per outage)",options:{color:"9FB1C9"}},
 {text:"   ×   Exposure ",options:{color:WHITE}},{text:"(how undocumented, 0–1)",options:{color:"9FB1C9"}},
],{x:0.55,y:1.6,w:12.23,h:0.62,align:"center",valign:"middle",fontFace:BODY,fontSize:15,bold:true});
// left: three factors explained
const fac=[["Criticality","Graded from CEA forced-outage frequency and CERC regulations — evidence, not opinion. (e.g. boiler failures lead forced outages; Vasudha 2022, 735 units.)"],
["Consequence","The real revenue lost when this fails, computed from CEA daily outage records at ₹5/kWh (LBNL/Ember, 2024)."],
["Exposure","How poorly the plant documents this topic — the gap between the question and the plant’s own documents (Jina AI similarity)."]];
let ry=2.5;
fac.forEach((f,i)=>{const y=ry+i*0.92;
  s.addText(f[0],{x:0.55,y,w:1.95,h:0.4,fontFace:BODY,fontSize:14.5,bold:true,color:AMBER});
  s.addText(f[1],{x:2.5,y:y-0.02,w:4.85,h:0.9,fontFace:BODY,fontSize:12,color:INK,valign:"top",lineSpacingMultiple:0.98});
});
const rf=[["19-item expert checklist.","What a well-run plant should document — scored automatically against each plant’s corpus."],
["Ranked by rupee impact.","Every gap ordered by ₹ exposure, with coverage status and a recommended closure sequence."],
["Board-ready output.","One-click themed Excel export of the full risk register, per plant."]];
rf.forEach((c,i)=>feat(s,0.55,5.35+i*0.62,7.0,c[0],c[1],11.5));
// right: dashboard shot + example box
let dh=pic(s,IMG.dash,7.85,2.5,4.93);
s.addShape(p.ShapeType.roundRect,{x:7.85,y:2.5+dh+0.14,w:4.93,h:1.15,rectRadius:0.06,fill:{color:TINT},line:{color:AMBER,width:1}});
s.addText([{text:"Worked example (NTPC profile).  ",options:{bold:true,color:AMBER}},
 {text:"The engine surfaces 19 gaps totalling ₹416.4 Cr of exposure — every figure traceable to its CEA / CERC source. The same engine runs unchanged on any plant’s documents.",options:{color:INK}}],
 {x:8.05,y:2.5+dh+0.14,w:4.55,h:1.15,valign:"middle",fontFace:BODY,fontSize:11,lineSpacingMultiple:0.97});
pg(s,5);

/* ---------- 6 FEATURE: KNOWLEDGE GRAPH ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Feature Deep-Dive · 3","Failure-Mode-to-Regulation Traceability");
let gh2=pic(s,IMG.graph,0.55,1.62,7.0);
underhood(s,0.55,1.62+gh2+0.16,7.0,"Neo4j knowledge graph · equipment → failure mode → outage event → regulation");
const gf=[
 ["A map, not a list.","A knowledge graph (Neo4j) connects equipment, failure modes, real outage events and the regulations that govern them."],
 ["Click to trace.","Select any flagged failure mode to see how severe it is, how much it has already cost across the fleet, and which rule mandates documenting it."],
 ["Turns a number into evidence.","A single ₹ figure becomes an auditable chain a plant or auditor can defend."]];
let gfy=1.62;
gf.forEach((c,i)=>feat(s,7.85,gfy+i*1.0,4.93,c[0],c[1],12.5));
// example chain panel
s.addShape(p.ShapeType.roundRect,{x:7.85,y:4.75,w:4.93,h:2.0,rectRadius:0.06,fill:{color:MIST},line:{color:LINE,width:1}});
s.addText("EXAMPLE TRACE  ·  NTPC",{x:8.05,y:4.9,w:4.6,h:0.3,fontFace:BODY,fontSize:10.5,bold:true,color:AMBER,charSpacing:1});
const chain=[["Waterwall tube thinning","flagged PARTIAL · criticality 5/5"],
["18 real CEA outage records","= ₹211.85 Cr already lost across the fleet"],
["Mandated by","CEA STS 500 MW + Indian Boiler Regulations"]];
chain.forEach((c,i)=>{const y=5.28+i*0.46;
  s.addText([{text:c[0]+"  ",options:{bold:true,color:INK}},{text:c[1],options:{color:SLATE}}],
    {x:8.05,y,w:4.55,h:0.42,fontFace:BODY,fontSize:11.5,valign:"middle"});
});
pg(s,6);

/* ---------- 7 ARCHITECTURE ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"System Architecture","Technology & Data Flow");
pic(s,IMG.arch,4.35,1.62,8.45);
const stk=[["Frontend","Single-page web app (GitHub Pages + Vercel); works on desktop and field mobile."],
["Backend","Lightweight serverless functions on Vercel."],
["Understanding docs","Jina AI turns text into vectors; Qdrant searches them by meaning."],
["Answers","Google Gemini 2.5 Flash, with NVIDIA NIM + OpenRouter as automatic backups."],
["Records & structure","Firebase Firestore (risk register, outage data) · Neo4j (knowledge graph)."],
["Ingestion","Python pipelines chunk & embed PDFs, run OCR on scans, and score gaps."],
["Automation","GitHub Actions refresh CEA outage data and re-scan gaps on a schedule."]];
let sy=1.66;
stk.forEach((r,i)=>{const y=sy+i*0.76;
  s.addText(r[0],{x:0.55,y,w:3.6,h:0.28,fontFace:BODY,fontSize:12.5,bold:true,color:AMBER});
  s.addText(r[1],{x:0.55,y:y+0.26,w:3.72,h:0.5,fontFace:BODY,fontSize:10.5,color:SLATE,valign:"top",lineSpacingMultiple:0.95});
});
s.addText("Public CEA standards & outage reports form the fixed benchmark; each plant’s own uploaded documents form the client corpus measured against it.",
  {x:4.35,y:6.55,w:8.45,h:0.5,fontFace:BODY,fontSize:11,italic:true,color:SLATE,align:"center"});
pg(s,7);

/* ---------- 8 DIFFERENTIATION ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Differentiation","What Sets ThermIQ Apart");
const dif=[["Prices the absence of knowledge","Most tools retrieve what is written down. ThermIQ scores what is missing and puts a rupee value on it — reframing documentation from a compliance chore into a capital-allocation decision."],
["Grounded in real data, end to end","Every rupee figure traces to actual CEA outage records and CERC regulation — no invented benchmarks or fabricated accuracy claims."],
["Benchmark-vs-client architecture","Public CEA standards are the fixed yardstick; each plant’s own SOPs are measured against it — so onboarding a new plant needs zero re-engineering."],
["Multi-plant by design","Each plant is an isolated profile with its own corpus and scores (namespacing) — demonstrated across separate NTPC and Saraighat profiles."],
["Resilient by construction","A four-model answer-generation fallback chain keeps the copilot live under free-tier limits; the graph auto-recovers via a scheduled keep-alive."],
["Auditable by default","Every score and answer carries its source, so a plant manager can defend it — for instance, in a CERC tariff petition."]];
let dy=1.62,dw=5.95,dh2=1.6,dg=0.33;
dif.forEach((d,i)=>{const x=0.55+(i%2)*(dw+dg),y=dy+Math.floor(i/2)*(dh2+0.18);
  s.addShape(p.ShapeType.roundRect,{x,y,w:dw,h:dh2,rectRadius:0.07,fill:{color:i%2?WHITE:MIST},line:{color:i%2?AMBER:LINE,width:i%2?1:1}});
  s.addText(d[0],{x:x+0.22,y:y+0.16,w:dw-0.44,h:0.34,fontFace:BODY,fontSize:14.5,bold:true,color:INK});
  s.addText(d[1],{x:x+0.22,y:y+0.55,w:dw-0.44,h:0.95,fontFace:BODY,fontSize:11.5,color:SLATE,valign:"top",lineSpacingMultiple:0.98});
});
pg(s,8);

/* ---------- 9 STATUS / LIMITATIONS / ROADMAP ---------- */
s=p.addSlide(); s.background={color:WHITE};
title(s,"Delivery Status","Live Today · Limitations · Roadmap");
const cols=[
 {hd:"Live today",c:GREEN,mk:"●",items:[
   "Single-page app with five working views",
   "RAG copilot with source citations",
   "19-item gap-scoring engine (v3)",
   "Rupee risk register, ranked & exportable",
   "Neo4j graph with click-through traversal",
   "Per-plant profiles (NTPC, Saraighat)",
   "Automated CEA-ingest & gap-scan pipelines"]},
 {hd:"Known limitations",c:RED,mk:"▲",items:[
   "One source spec (BMD-01) unreachable from the build network",
   "No computer-vision P&ID parsing yet — text + OCR only",
   "Free-tier hosting caps backend functions",
   "A finer v4 scoring engine is built but held back pending human review of two outliers",
   "Accuracy not yet scored against a formal expert benchmark"]},
 {hd:"Roadmap",c:AMBER,mk:"→",items:[
   "Computer-vision parsing of P&IDs and engineering drawings",
   "More plants onboarded at full document depth",
   "Mobile-first field-technician view",
   "Validated v4 evidence-graded scoring engine",
   "Expert-benchmarked answer & extraction accuracy"]}];
let cx2=0.55,cw2=3.95,cg2=0.19,cy2=1.58,ch2=4.55;
cols.forEach((col,ci)=>{const x=cx2+ci*(cw2+cg2);
  s.addShape(p.ShapeType.roundRect,{x,y:cy2,w:cw2,h:ch2,rectRadius:0.07,fill:{color:ci===1?WHITE:MIST},line:{color:ci===1?AMBER:LINE,width:ci===1?1.3:1}});
  s.addText([{text:col.mk+"  ",options:{color:col.c}},{text:col.hd,options:{bold:true,color:INK}}],
    {x:x+0.24,y:cy2+0.2,w:cw2-0.48,h:0.4,fontFace:BODY,fontSize:16.5});
  s.addShape(p.ShapeType.line,{x:x+0.24,y:cy2+0.72,w:cw2-0.48,h:0,line:{color:LINE,width:1}});
  const items=col.items.map((t)=>({text:t,options:{bullet:{indent:14},breakLine:true,paraSpaceAfter:11,color:INK}}));
  s.addText(items,{x:x+0.32,y:cy2+0.9,w:cw2-0.56,h:ch2-1.08,fontFace:BODY,fontSize:12.8,valign:"top",lineSpacingMultiple:1.0});
});
// summary strip
s.addShape(p.ShapeType.roundRect,{x:0.55,y:6.32,w:12.23,h:0.76,rectRadius:0.06,fill:{color:TINT},line:{color:AMBER,width:1}});
s.addText([{text:"Shipped and honest:  ",options:{bold:true,color:AMBER}},
  {text:"v3 is the validated scoring engine running live today. The finer v4 engine and computer-vision drawing parsing are the immediate next milestones — deliberately not overstated as done.",options:{color:INK}}],
  {x:0.78,y:6.32,w:11.8,h:0.76,valign:"middle",fontFace:BODY,fontSize:12.5});
pg(s,9);

/* ---------- 10 CONCLUSION ---------- */
s=p.addSlide(); s.background={color:NAVY};
s.addShape(p.ShapeType.rect,{x:0.9,y:0.95,w:0.13,h:0.66,fill:{color:AMBER}});
s.addText("CONCLUSION",{x:1.15,y:0.93,w:8,h:0.28,fontFace:BODY,fontSize:12,bold:true,color:AMBER,charSpacing:2});
s.addText("An intelligence layer for industrial knowledge — buildable today",{x:1.13,y:1.2,w:11.3,h:0.9,fontFace:HEAD,fontSize:26,bold:true,color:WHITE});
s.addText([
 {text:"ThermIQ answers Problem 8 directly: it ingests heterogeneous industrial documents, makes their collective knowledge queryable with citations, and — uniquely — quantifies what remains undocumented as financial risk, every figure traceable to real regulatory and outage data.",options:{breakLine:true,paraSpaceAfter:10,color:"D7E1EF"}},
 {text:"The result: a plant can see, in rupees, what its knowledge gaps are worth, and close the highest-value ones first.",options:{color:AMBERL,italic:true}},
],{x:0.92,y:2.25,w:11.4,h:1.9,fontFace:HEAD,fontSize:16.5,italic:true,valign:"top",lineSpacingMultiple:1.08});
// three takeaway tiles
const tk=[["Retrieve","Cited answers across the full document corpus, for engineers and O&M teams."],
["Quantify","Every knowledge gap priced as ₹-crore operational risk, ranked and sourced."],
["Trace","Failure mode → real outage cost → governing regulation, end to end."]];
let tx=0.92,tw=3.68,tgp=0.2,tyy=4.35;
tk.forEach((t,i)=>{const x=tx+i*(tw+tgp);
  s.addShape(p.ShapeType.roundRect,{x,y:tyy,w:tw,h:1.35,rectRadius:0.07,fill:{color:"16294A"},line:{color:"2C405B",width:1}});
  s.addText(t[0],{x:x+0.22,y:tyy+0.16,w:tw-0.44,h:0.36,fontFace:HEAD,fontSize:17,bold:true,color:AMBERL});
  s.addText(t[1],{x:x+0.22,y:tyy+0.56,w:tw-0.44,h:0.72,fontFace:BODY,fontSize:11.5,color:"C9D6E8",valign:"top",lineSpacingMultiple:0.98});
});
s.addShape(p.ShapeType.line,{x:0.92,y:6.15,w:11.5,h:0,line:{color:"2C405B",width:1}});
s.addText([
 {text:"Live application  ",options:{color:"9FB1C9"}},{text:"therm-iq.vercel.app",options:{color:WHITE,bold:true}},
 {text:"      Source  ",options:{color:"9FB1C9"}},{text:"github.com/GhostUnamused/thermIQ",options:{color:WHITE,bold:true}},
],{x:0.92,y:6.32,w:11.5,h:0.4,fontFace:BODY,fontSize:13});
s.addText("Yaminichandra K J  ·  IIM Amritsar (IPM)  ·  a research-preview prototype built with AI as a development partner",
  {x:0.92,y:6.74,w:11.5,h:0.35,fontFace:BODY,fontSize:11.5,italic:true,color:AMBERL});

p.writeFile({fileName:"/sessions/fervent-compassionate-franklin/mnt/ET AI Hackathon/ThermIQ_Deck_Final.pptx"}).then(f=>console.log("WROTE",f));
