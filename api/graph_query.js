/**
 * api/graph_query.js — read-only, parameterized Cypher endpoint over the
 * ThermIQ knowledge graph (Neo4j Aura).
 *
 * This mirrors the exact traversal scripts/hero_traversal.py already proves
 * in a terminal, but as a fixed set of NAMED queries the browser can call.
 * There is intentionally NO arbitrary Cypher passthrough — `type` is a
 * whitelisted enum and the only user-supplied value (`failure_mode_id`) is
 * always passed as a bound Cypher parameter, never string-interpolated.
 *
 * Query params:
 *   ?type=overview                        → full graph (nodes + edges) for initial render
 *   ?type=gaps                             → every FailureMode that is a documented gap
 *   ?type=traversal&failure_mode_id=<id>   → equipment → failure mode → procedure(s) →
 *                                            real ₹ outages → mandating regulation(s)
 */

const neo4j = require('neo4j-driver');
const setCors = require('./_cors');

const NEO4J_URI      = process.env.NEO4J_URI;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

// Reused across warm Vercel invocations (module scope), same pattern as the
// firebase-admin singleton in the other api/*.js files.
let driver;
function getDriver() {
  if (!driver) {
    if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
      throw new Error('NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD missing from environment');
    }
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
  }
  return driver;
}

// ─── Fixed, named Cypher queries (no passthrough) ────────────────────────────

const QUERY_OVERVIEW_NODES = `
  MATCH (n)
  RETURN n.id AS id, labels(n) AS labels, properties(n) AS props
  LIMIT 500
`;

const QUERY_OVERVIEW_EDGES = `
  MATCH (a)-[r]->(b)
  RETURN a.id AS source, b.id AS target, type(r) AS rel_type, properties(r) AS props
  LIMIT 1000
`;

// Every FailureMode reached via a Procedure that is flagged as a gap
// (is_gap = true — status ABSENT or PARTIAL), plus any FailureMode with
// literally no ADDRESSED_BY edge at all.
const QUERY_GAPS = `
  MATCH (equip:Equipment)-[:HAS_FAILURE_MODE]->(fm:FailureMode)-[ab:ADDRESSED_BY]->(proc:Procedure)
  WHERE proc.is_gap = true
  RETURN
    equip.id        AS equipment_id,
    equip.label     AS equipment,
    fm.id           AS failure_mode_id,
    fm.label        AS failure_mode,
    proc.label      AS procedure,
    proc.status     AS status,
    proc.criticality AS criticality,
    proc.gap_id     AS gap_id,
    'partial_or_absent_procedure' AS gap_type
  UNION
  MATCH (equip:Equipment)-[:HAS_FAILURE_MODE]->(fm:FailureMode)
  WHERE NOT (fm)-[:ADDRESSED_BY]->()
  RETURN
    equip.id        AS equipment_id,
    equip.label     AS equipment,
    fm.id           AS failure_mode_id,
    fm.label        AS failure_mode,
    null            AS procedure,
    'ABSENT'        AS status,
    null            AS criticality,
    null            AS gap_id,
    'no_procedure_linked' AS gap_type
  ORDER BY criticality DESC
`;

// Step 1-4 of hero_traversal, generalized to any failure_mode_id.
const QUERY_TRAVERSAL_GAP = `
  MATCH (equip:Equipment)-[:HAS_FAILURE_MODE]->(fm:FailureMode {id: $fmId})
  OPTIONAL MATCH (fm)-[ab:ADDRESSED_BY]->(proc:Procedure)
  RETURN
    equip.label      AS equipment,
    fm.label         AS failure_mode,
    fm.id            AS failure_mode_id,
    proc.label       AS procedure,
    proc.status      AS status,
    proc.is_gap      AS is_gap,
    proc.criticality AS criticality,
    proc.gap_id      AS gap_id,
    ab.status        AS edge_status
`;

// Step 5, generalized: hero_traversal.py hardcodes a jump from the specific
// failure mode (e.g. waterwall_tube_thinning) to the coarser failure mode
// that OutageEvents actually attach to (e.g. boiler_tube_failure). We derive
// that same jump from graph structure instead of a hardcoded ID: any other
// FailureMode that shares at least one Procedure (ADDRESSED_BY) with the
// requested one is a "sibling" whose real outages belong to this traversal
// too. The requested id is always included, so a failure mode with its own
// direct INSTANCE_OF outages still works even with no procedure at all.
const QUERY_TRAVERSAL_OUTAGES = `
  MATCH (fm:FailureMode {id: $fmId})
  OPTIONAL MATCH (fm)-[:ADDRESSED_BY]->(:Procedure)<-[:ADDRESSED_BY]-(sibling:FailureMode)
  WITH collect(DISTINCT sibling.id) + [$fmId] AS fmIds
  MATCH (ev:OutageEvent)-[:INSTANCE_OF]->(fm2:FailureMode)
  WHERE fm2.id IN fmIds
  RETURN
    ev.station             AS station,
    ev.unit                AS unit,
    ev.mw_lost             AS mw_lost,
    ev.date_out            AS date_out,
    ev.revenue_lost_est_cr AS revenue_cr,
    ev.failure_reason_raw  AS reason
  ORDER BY ev.revenue_lost_est_cr DESC
  LIMIT 100
`;

// Step 6, generalized: regulations mandating whichever Procedure(s) address
// the requested failure mode.
const QUERY_TRAVERSAL_REGULATIONS = `
  MATCH (fm:FailureMode {id: $fmId})-[:ADDRESSED_BY]->(proc:Procedure)-[:REQUIRED_BY]->(reg:Regulation)
  RETURN DISTINCT reg.id AS id, reg.label AS label
`;

async function runQuery(session, query, params = {}) {
  const result = await session.run(query, params);
  return result.records.map((record) => {
    const obj = {};
    record.keys.forEach((key) => {
      let val = record.get(key);
      // neo4j Integer -> plain number (safe for these dataset sizes)
      if (val && typeof val === 'object' && typeof val.toNumber === 'function') {
        val = val.toNumber();
      }
      obj[key] = val;
    });
    return obj;
  });
}

function normalizeOverviewNode(row) {
  const props = { ...row.props };
  // neo4j Integer props -> plain numbers
  Object.keys(props).forEach((k) => {
    const v = props[k];
    if (v && typeof v === 'object' && typeof v.toNumber === 'function') {
      props[k] = v.toNumber();
    }
  });
  return {
    id: row.id,
    node_type: (row.labels || [])[0] || 'Unknown',
    ...props,
  };
}

const ALLOWED_TYPES = new Set(['overview', 'gaps', 'traversal']);

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Tolerate runtimes that don't pre-parse req.query.
  let params = req.query || {};
  if ((!params.type || Object.keys(params).length === 0) && req.url) {
    try {
      params = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    } catch (_) { /* ignore */ }
  }

  const type = (params.type || 'overview').toString().trim().toLowerCase();

  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: `Unknown type "${type}". Allowed: overview, gaps, traversal.` });
  }

  let session;
  try {
    session = getDriver().session({ database: NEO4J_DATABASE });

    if (type === 'overview') {
      const [nodeRows, edgeRows] = await Promise.all([
        runQuery(session, QUERY_OVERVIEW_NODES),
        runQuery(session, QUERY_OVERVIEW_EDGES),
      ]);
      const nodes = nodeRows.map(normalizeOverviewNode);
      const edges = edgeRows.map((r) => ({
        source: r.source,
        target: r.target,
        rel_type: r.rel_type,
        ...r.props,
      }));
      return res.status(200).json({ nodes, edges, node_count: nodes.length, edge_count: edges.length });
    }

    if (type === 'gaps') {
      const rows = await runQuery(session, QUERY_GAPS);
      return res.status(200).json({ gaps: rows, gap_count: rows.length });
    }

    // type === 'traversal'
    const fmId = (params.failure_mode_id || '').toString().trim();
    if (!fmId) {
      return res.status(400).json({ error: 'failure_mode_id is required for type=traversal' });
    }

    const [gapRows, outageRows, regRows] = await Promise.all([
      runQuery(session, QUERY_TRAVERSAL_GAP, { fmId }),
      runQuery(session, QUERY_TRAVERSAL_OUTAGES, { fmId }),
      runQuery(session, QUERY_TRAVERSAL_REGULATIONS, { fmId }),
    ]);

    if (gapRows.length === 0) {
      return res.status(404).json({ error: `No FailureMode found with id "${fmId}"` });
    }

    const totalRevenueCr = outageRows.reduce((sum, ev) => sum + (ev.revenue_cr || 0), 0);

    return res.status(200).json({
      failure_mode_id: fmId,
      gap: gapRows[0],
      outages: outageRows,
      outage_count: outageRows.length,
      total_revenue_cr: Math.round(totalRevenueCr * 100) / 100,
      regulations: regRows,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    if (session) await session.close();
  }
};
