/**
 * ThermIQ Google Sheets Add-on — C2+C3: themed live sync
 *
 * GUARDRAIL (carried over from api/sheet_sync.js, non-negotiable):
 * This project is a ONE-WAY MIRROR. Every network call in this file is a
 * GET against api/sheet_sync.js. Nothing here reads a cell value and sends
 * it anywhere, and nothing here ever calls a write/PUT/POST endpoint.
 * If a future change reads a cell and forwards it to ThermIQ's API, that is
 * out of scope for this project — stop and re-scope instead.
 *
 * What this file does:
 *   1. Adds a "ThermIQ" menu with Sync Now / auto-refresh / protection controls.
 *   2. syncNow() pulls CSV from api/sheet_sync.js via UrlFetchApp (GET only),
 *      writes it into a dedicated "ThermIQ Sync" sheet, and applies full
 *      ThermIQ theming (dark header band, color-coded coverage status,
 *      ₹ Cr number formats, frozen header, banding).
 *   3. First successful interactive sync offers to enable auto-refresh
 *      (time-based triggers do NOT copy with a spreadsheet — each copier
 *      must enable them once; this prompt handles that).
 *   4. protectSyncedRange() locks the mirrored range so collaborators
 *      cannot type over synced data.
 */

const CONFIG = {
  BASE_URL: 'https://therm-iq.vercel.app/api/sheet_sync',
  SHEET_NAME: 'ThermIQ Sync',

  // Row 1 = title band, Row 2 = status line, Row 3 = column headers (from CSV),
  // data starts row 4.
  DATA_START_ROW: 3,
  DATA_START_COL: 1,

  DEFAULT_CLIENT: 'ntpc',

  // Apps Script time-based triggers only accept 1/5/10/15/30 min.
  // 10 min ≈ 144 calls/day — fine, since gap scores only change when
  // detect_gaps.py re-runs or documents are re-ingested.
  TRIGGER_INTERVAL_MINUTES: 10,
  TRIGGER_FUNCTION: 'syncNow',

  PROTECTION_DESCRIPTION: 'ThermIQ live sync (read-only mirror) — do not edit directly',
};

// --- ThermIQ palette (matches the web app's instrument-panel theme) ---
const THEME = {
  NAVY_DARK:   '#0d1321',  // title band
  NAVY:        '#141b2e',  // header row
  TEAL:        '#14b8a6',  // accent / title text
  AMBER:       '#f59e0b',  // partial
  RED:         '#ef4444',  // gap
  GREEN:       '#22c55e',  // covered
  RED_TINT:    '#fdecec',
  AMBER_TINT:  '#fef5e7',
  GREEN_TINT:  '#eafaf0',
  TEXT_LIGHT:  '#ffffff',
  TEXT_MUTED:  '#6b7280',
  GRID_BORDER: '#d7dbe3',
  FONT: 'Inter',
};

// Pretty labels for the CSV header row (keys = api/sheet_sync.js CSV_COLUMNS).
const HEADER_LABELS = {
  gap_id: 'Gap ID',
  topic: 'Topic',
  equipment_tag: 'Equipment',
  coverage_status: 'Coverage',
  criticality_score: 'Criticality (/5)',
  consequence_cr: 'Consequence (Rs Cr)',
  risk_score_cr: 'Risk (Rs Cr)',
  client_score: 'Doc Coverage',
  description: 'Description',
};

// Column indexes (1-based) in the CSV layout, used for formats/widths.
const COL = {
  GAP_ID: 1, TOPIC: 2, EQUIPMENT: 3, STATUS: 4,
  CRITICALITY: 5, CONSEQUENCE: 6, RISK: 7, CLIENT_SCORE: 8, DESCRIPTION: 9,
};

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ThermIQ')
    .addItem('Sync Now', 'syncNow')
    .addSeparator()
    .addItem('Enable Auto-Refresh (every ' + CONFIG.TRIGGER_INTERVAL_MINUTES + ' min)', 'enableAutoRefresh')
    .addItem('Disable Auto-Refresh', 'disableAutoRefresh')
    .addSeparator()
    .addItem('Set Client / Plant Name…', 'promptSetClientName')
    .addItem('Re-apply Protection', 'protectSyncedRangeManual')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function syncNow() {
  const client = getClientName();
  const sheet = getOrCreateSyncSheet_();

  try {
    const url = CONFIG.BASE_URL
      + '?client_name=' + encodeURIComponent(client)
      + '&format=csv';

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error('sheet_sync returned HTTP ' + code + ': ' + resp.getContentText());
    }

    const csv = resp.getContentText();
    const rows = Utilities.parseCsv(csv);
    writeSyncedRows_(sheet, rows, client);
    applyTheme_(sheet, rows);
    cleanupDefaultSheet_();
    setStatus_(sheet, 'Plant: ' + client.toUpperCase()
      + '   |   Last synced: ' + new Date().toLocaleString()
      + '   |   ' + Math.max(rows.length - 1, 0) + ' rows   |   ✓ OK');
    maybeOfferAutoRefresh_();
  } catch (err) {
    setStatus_(sheet, 'Plant: ' + client.toUpperCase()
      + '   |   Last attempt: ' + new Date().toLocaleString()
      + '   |   ✗ ERROR: ' + err.message);
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('ThermIQ sync failed: ' + err.message, 'ThermIQ', 10);
    } catch (_) { /* no UI context (trigger run) */ }
    console.error('ThermIQ syncNow failed: ' + err.message);
  }
}

function getOrCreateSyncSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  sheet.getRange(1, 1).setValue('THERMIQ — LIVE KNOWLEDGE-GAP SYNC  (read-only mirror)');
  return sheet;
}

function setStatus_(sheet, text) {
  sheet.getRange(2, 1).setValue(text);
}

function writeSyncedRows_(sheet, rows, client) {
  const startRow = CONFIG.DATA_START_ROW;
  const startCol = CONFIG.DATA_START_COL;
  const numRows = rows.length || 1;
  const numCols = (rows[0] && rows[0].length) || 1;

  // Clear whatever the previous sync wrote.
  const lastRow = sheet.getLastRow();
  if (lastRow >= startRow) {
    const clearRows = Math.max(lastRow - startRow + 1, numRows);
    const clearCols = Math.max(sheet.getLastColumn(), numCols);
    const block = sheet.getRange(startRow, startCol, clearRows, clearCols);
    block.clearContent();
    block.setBackground(null).setFontColor(null).setFontWeight(null);
  }

  if (rows.length) {
    // Prettify the CSV header row before writing.
    const pretty = rows.slice();
    pretty[0] = rows[0].map(function (h) { return HEADER_LABELS[h] || h; });
    sheet.getRange(startRow, startCol, numRows, numCols).setValues(pretty);
  }

  protectSyncedRange_(sheet, numRows, numCols);
}

// ---------------------------------------------------------------------------
// Theming — applied on every sync so formatting always tracks the data block
// ---------------------------------------------------------------------------

function applyTheme_(sheet, rows) {
  const nCols = (rows[0] && rows[0].length) || 9;
  const headerRow = CONFIG.DATA_START_ROW;           // row 3
  const firstDataRow = headerRow + 1;                // row 4
  const nDataRows = Math.max(rows.length - 1, 0);

  sheet.setHiddenGridlines(true);

  // Title band (row 1)
  sheet.getRange(1, 1, 1, nCols).merge().setBackground(THEME.NAVY_DARK)
    .setFontColor(THEME.TEAL).setFontFamily(THEME.FONT)
    .setFontSize(13).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);

  // Status line (row 2)
  sheet.getRange(2, 1, 1, nCols).merge().setBackground('#f4f6fa')
    .setFontColor(THEME.TEXT_MUTED).setFontFamily(THEME.FONT)
    .setFontSize(9).setFontStyle('italic');
  sheet.setRowHeight(2, 24);

  // Header row (row 3)
  sheet.getRange(headerRow, 1, 1, nCols).setBackground(THEME.NAVY)
    .setFontColor(THEME.TEXT_LIGHT).setFontFamily(THEME.FONT)
    .setFontSize(10).setFontWeight('bold').setWrap(false);
  sheet.setRowHeight(headerRow, 30);
  sheet.setFrozenRows(headerRow);

  if (nDataRows > 0) {
    const dataRange = sheet.getRange(firstDataRow, 1, nDataRows, nCols);
    dataRange.setFontFamily(THEME.FONT).setFontSize(10).setVerticalAlignment('middle');
    dataRange.setBorder(true, true, true, true, true, true, THEME.GRID_BORDER, SpreadsheetApp.BorderStyle.SOLID);

    // Number formats
    sheet.getRange(firstDataRow, COL.CRITICALITY, nDataRows, 1).setNumberFormat('0"/5"').setHorizontalAlignment('center');
    sheet.getRange(firstDataRow, COL.CONSEQUENCE, nDataRows, 1).setNumberFormat('"₹"#,##0.0" Cr"');
    sheet.getRange(firstDataRow, COL.RISK, nDataRows, 1).setNumberFormat('"₹"#,##0.0" Cr"').setFontWeight('bold');
    sheet.getRange(firstDataRow, COL.CLIENT_SCORE, nDataRows, 1).setNumberFormat('0%').setHorizontalAlignment('center');

    // Coverage-status color coding (chip cell + soft row tint)
    const statusVals = sheet.getRange(firstDataRow, COL.STATUS, nDataRows, 1).getValues();
    for (let i = 0; i < nDataRows; i++) {
      const status = String(statusVals[i][0] || '').toLowerCase();
      const r = firstDataRow + i;
      let chip = null, tint = null;
      if (status === 'gap')          { chip = THEME.RED;   tint = THEME.RED_TINT; }
      else if (status === 'partial') { chip = THEME.AMBER; tint = THEME.AMBER_TINT; }
      else if (status === 'covered') { chip = THEME.GREEN; tint = THEME.GREEN_TINT; }
      if (chip) {
        sheet.getRange(r, 1, 1, nCols).setBackground(tint);
        sheet.getRange(r, COL.STATUS).setBackground(chip)
          .setFontColor(THEME.TEXT_LIGHT).setFontWeight('bold')
          .setHorizontalAlignment('center');
      }
    }
  }

  // Column widths
  const widths = [150, 220, 110, 95, 105, 130, 130, 105, 420];
  for (let c = 1; c <= Math.min(nCols, widths.length); c++) {
    sheet.setColumnWidth(c, widths[c - 1]);
  }
  sheet.getRange(firstDataRow, COL.DESCRIPTION, Math.max(nDataRows, 1), 1).setWrap(true);
}

// Remove Google's empty default "Sheet1" from fresh copies so the sync tab
// is front and center. Only deletes if it's truly empty and not the only
// other sheet.
function cleanupDefaultSheet_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s1 = ss.getSheetByName('Sheet1');
    if (s1 && ss.getSheets().length > 1
        && s1.getLastRow() === 0 && s1.getLastColumn() === 0) {
      ss.deleteSheet(s1);
    }
  } catch (_) { /* non-fatal */ }
}

// After the first successful interactive sync, offer to enable auto-refresh —
// triggers do NOT copy with a spreadsheet, so every copier must opt in once.
function maybeOfferAutoRefresh_() {
  try {
    const props = PropertiesService.getDocumentProperties();
    if (props.getProperty('THERMIQ_AUTOREFRESH_OFFERED')) return;
    const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === CONFIG.TRIGGER_FUNCTION;
    });
    if (hasTrigger) { props.setProperty('THERMIQ_AUTOREFRESH_OFFERED', '1'); return; }

    const ui = SpreadsheetApp.getUi();
    const resp = ui.alert('ThermIQ',
      'Sync complete. Enable auto-refresh so this sheet re-syncs every '
      + CONFIG.TRIGGER_INTERVAL_MINUTES + ' minutes automatically?',
      ui.ButtonSet.YES_NO);
    props.setProperty('THERMIQ_AUTOREFRESH_OFFERED', '1');
    if (resp === ui.Button.YES) enableAutoRefresh();
  } catch (_) { /* no UI context (trigger run) — never block a sync on this */ }
}

// ---------------------------------------------------------------------------
// Protection — the actual enforcement mechanism, not cosmetic
// ---------------------------------------------------------------------------

function protectSyncedRange_(sheet, dataRows, dataCols) {
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(function (p) { return p.getDescription() === CONFIG.PROTECTION_DESCRIPTION; })
    .forEach(function (p) { p.remove(); });

  const lastRow = Math.max(CONFIG.DATA_START_ROW + dataRows - 1, 2);
  const lastCol = Math.max(dataCols, 1);
  const range = sheet.getRange(1, 1, lastRow, lastCol);

  const protection = range.protect().setDescription(CONFIG.PROTECTION_DESCRIPTION);

  const me = Session.getEffectiveUser();
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  if (me && me.getEmail()) protection.addEditor(me);
}

function protectSyncedRangeManual() {
  const sheet = getOrCreateSyncSheet_();
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const dataRows = Math.max(lastRow - CONFIG.DATA_START_ROW + 1, 1);
  protectSyncedRange_(sheet, dataRows, lastCol);
  SpreadsheetApp.getUi().alert('ThermIQ', 'Protected range re-applied through row ' + lastRow + '.', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// Auto-refresh trigger
// ---------------------------------------------------------------------------

function enableAutoRefresh() {
  disableAutoRefresh(); // avoid stacking duplicate triggers
  ScriptApp.newTrigger(CONFIG.TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(CONFIG.TRIGGER_INTERVAL_MINUTES)
    .create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Auto-refresh enabled: syncing every ' + CONFIG.TRIGGER_INTERVAL_MINUTES + ' minutes.',
    'ThermIQ', 6
  );
}

function disableAutoRefresh() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === CONFIG.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      removed ? 'Auto-refresh disabled.' : 'Auto-refresh was not running.', 'ThermIQ', 6
    );
  } catch (_) { /* no UI context */ }
}

// ---------------------------------------------------------------------------
// Client / plant name (Document Properties, no code edits needed to switch)
// ---------------------------------------------------------------------------

function getClientName() {
  const stored = PropertiesService.getDocumentProperties().getProperty('THERMIQ_CLIENT');
  return (stored || CONFIG.DEFAULT_CLIENT).trim().toLowerCase();
}

function promptSetClientName() {
  const ui = SpreadsheetApp.getUi();
  const current = getClientName();
  const resp = ui.prompt(
    'ThermIQ — Set Client / Plant Name',
    'Current: ' + current + '\n\nEnter the client_name to sync (matches the plant profile in ThermIQ):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const value = resp.getResponseText().trim().toLowerCase();
  if (!value) return;
  PropertiesService.getDocumentProperties().setProperty('THERMIQ_CLIENT', value);
  ui.alert('ThermIQ', 'Client set to "' + value + '". Run Sync Now to pull its data.', ui.ButtonSet.OK);
}
