/**
 * ThermIQ Google Sheets Add-on — C2: Apps Script sync skeleton
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
 *   2. syncNow() pulls CSV from api/sheet_sync.js via UrlFetchApp (GET only)
 *      and writes it into a dedicated "ThermIQ Sync" sheet.
 *   3. A time-based trigger calls syncNow() on an interval (default 10 min —
 *      see the tradeoff note above TRIGGER_INTERVAL_MINUTES below).
 *   4. protectSyncedRange() locks the mirrored range with Range.protect() so
 *      collaborators cannot type over it directly in the UI. This is the
 *      actual mechanism enforcing "operators can't make direct edits" — the
 *      one-way guarantee is cosmetic without it.
 */

const CONFIG = {
  // Live Vercel endpoint from Phase C1 (api/sheet_sync.js). Update here if
  // the deployment domain ever changes.
  BASE_URL: 'https://therm-iq.vercel.app/api/sheet_sync',

  // Dedicated sheet this add-on owns. Do not point this at a sheet the user
  // already edits by hand — the whole point is that this tab is machine-only.
  SHEET_NAME: 'ThermIQ Sync',

  // Row 1 = title, Row 2 = status/last-synced line, data starts row 3.
  DATA_START_ROW: 3,
  DATA_START_COL: 1,

  // Which plant/client to pull. Overridable per-sheet via the menu
  // ("Set Client Name…") without editing code, stored in Document Properties.
  DEFAULT_CLIENT: 'ntpc',

  // --- Auto-refresh interval ---
  // Apps Script time-based triggers only accept 1, 5, 10, 15, or 30 minutes
  // via .everyMinutes(). Picking within the 5-15 min band requested:
  //   5 min  -> freshest data, but ~288 syncNow() calls/day per sheet, each
  //             one hop away from a Vercel serverless invocation
  //             (Sheet -> api/sheet_sync.js -> internal fetch -> api/gap_analysis.js
  //             -> Firestore). Fine for one sheet; adds up fast if this add-on
  //             is installed in many sheets on a shared Vercel/Firestore plan.
  //   15 min -> ~96 calls/day, kinder to invocation quotas and Firestore read
  //             quotas, but risk numbers can lag a fresh detect_gaps.py run
  //             by up to 15 min.
  //   10 min (chosen default) -> ~144 calls/day; a reasonable midpoint given
  //             gap scores only change when someone re-runs detect_gaps.py
  //             or re-ingests documents, not continuously. Change the
  //             constant below (must stay one of 1/5/10/15/30) if usage
  //             patterns argue for tighter or looser polling.
  TRIGGER_INTERVAL_MINUTES: 10,
  TRIGGER_FUNCTION: 'syncNow',

  PROTECTION_DESCRIPTION: 'ThermIQ live sync (read-only mirror) — do not edit directly',
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
    setStatus_(sheet, 'Client: ' + client + '  |  Last synced: ' + new Date().toLocaleString() + '  |  OK');
  } catch (err) {
    setStatus_(sheet, 'Client: ' + client + '  |  Last attempt: ' + new Date().toLocaleString() + '  |  ERROR: ' + err.message);
    // Also surface a toast when run interactively (silent no-op if run from a trigger).
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
    sheet.getRange(1, 1).setValue('ThermIQ — Live Gap Sync (read-only mirror, do not edit)');
  }
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

  // Clear whatever the previous sync wrote (block can shrink/grow between
  // syncs as gaps are resolved or new ones appear).
  const lastRow = sheet.getLastRow();
  if (lastRow >= startRow) {
    const clearRows = Math.max(lastRow - startRow + 1, numRows);
    const clearCols = Math.max(sheet.getLastColumn(), numCols);
    sheet.getRange(startRow, startCol, clearRows, clearCols).clearContent();
  }

  if (rows.length) {
    sheet.getRange(startRow, startCol, numRows, numCols).setValues(rows);
  }

  protectSyncedRange_(sheet, numRows, numCols);
}

// ---------------------------------------------------------------------------
// Protection — the actual enforcement mechanism, not cosmetic
// ---------------------------------------------------------------------------

function protectSyncedRange_(sheet, dataRows, dataCols) {
  // Remove any protection this add-on previously created before re-adding,
  // so the locked range tracks the data block's current size instead of
  // leaving stale/orphaned protections behind as row counts change.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(function (p) { return p.getDescription() === CONFIG.PROTECTION_DESCRIPTION; })
    .forEach(function (p) { p.remove(); });

  const lastRow = Math.max(CONFIG.DATA_START_ROW + dataRows - 1, 2);
  const lastCol = Math.max(dataCols, 1);
  const range = sheet.getRange(1, 1, lastRow, lastCol);

  const protection = range.protect().setDescription(CONFIG.PROTECTION_DESCRIPTION);

  // Lock the range down to just the person who set the protection (the sheet
  // owner / whoever last ran Sync Now or Re-apply Protection). Time-based
  // triggers execute as their creator, so scripted writes still succeed;
  // manual edits by anyone else in the sheet's UI are rejected.
  const me = Session.getEffectiveUser();
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  if (me && me.getEmail()) protection.addEditor(me);
}

// Menu-driven manual (re)lock, usable even before the first sync (locks just
// the title/status rows) or to fix a protection that was somehow removed.
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
  disableAutoRefresh(); // avoid stacking duplicate triggers on repeated clicks
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
