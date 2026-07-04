/**
 * api/sheet_sync.js — Phase C1: read-only sync endpoint for the future
 * Google Sheets add-on.
 *
 * GUARDRAIL (per hackathon handoff): this is a ONE-WAY MIRROR. Nothing in
 * this file, or anywhere in this phase, accepts writes from Sheets. Risk
 * scores trace back to real Neo4j/Firestore provenance — a hand-edited
 * Sheets cell must never be able to overwrite that, even accidentally.
 * Only GET is supported; there is no POST/PUT handler at all.
 *
 * This is a thin wrapper, not a second scoring engine: it does not touch
 * Firestore or detect_gaps.py's scoring logic directly. It re-fetches the
 * exact JSON api/gap_analysis.js already serves (same Firestore read, same
 * client_name namespacing, same sort/cap) and reshapes that into a flat
 * CSV (default) or JSON, since Google Apps Script's UrlFetchApp parses CSV
 * more easily than nested JSON.
 *
 * Query params:
 *   ?client_name=<name>   → passed straight through to api/gap_analysis.js
 *   ?format=csv|json       → default csv
 */

const setCors = require('./_cors');

const CSV_COLUMNS = [
  'gap_id', 'topic', 'equipment_tag', 'coverage_status',
  'criticality_score', 'consequence_cr', 'risk_score_cr',
  'client_score', 'description',
];

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(gaps) {
  const header = CSV_COLUMNS.join(',');
  const rows = gaps.map((g) => CSV_COLUMNS.map((col) => csvEscape(g[col])).join(','));
  return [header, ...rows].join('\n');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'sheet_sync is read-only; only GET is supported.' });
  }

  // Tolerate runtimes that don't pre-parse req.query.
  let params = req.query || {};
  if ((!params.client_name && !params.format) && req.url) {
    try {
      params = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    } catch (_) { /* ignore */ }
  }

  const format = (params.format || 'csv').toString().trim().toLowerCase();
  const clientName = (params.client_name || '').toString().trim();

  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host  = req.headers.host;
    const qs    = clientName ? `?client_name=${encodeURIComponent(clientName)}` : '';
    const gapRes = await fetch(`${proto}://${host}/api/gap_analysis${qs}`);
    const gapData = await gapRes.json();
    if (!gapRes.ok) throw new Error(gapData.error || `gap_analysis returned ${gapRes.status}`);

    const gaps = gapData.gaps || [];

    if (format === 'json') {
      return res.status(200).json({
        client_name: gapData.client_name,
        total_risk_cr: gapData.total_risk_cr,
        gap_count: gapData.gap_count,
        gaps: gaps.map((g) => Object.fromEntries(CSV_COLUMNS.map((c) => [c, g[c] ?? null]))),
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(toCsv(gaps));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
