/**
 * Shared lists for the WeekendsWithoutRedWizards site (采购 shopping list for now).
 *
 * Paste this into Extensions → Apps Script of a Google Sheet, then
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Put the web app URL in LISTS_URL in build_site.py and rebuild.
 * After editing this file: Deploy → Manage deployments → Edit → Version: New version (same URL).
 *
 * GET  ?list=采购                                      → all items as JSON
 * POST {"list","action":"add","items":[…]}            → add items
 * POST {"list","action":"update","id","fields":{…}}   → change some fields of one item
 * POST {"list","action":"delete","id"}                → remove one item
 * Every POST answers with the full, updated list.
 *
 * Columns are matched by their header name (row 1), so they can be reordered in the sheet,
 * and extra columns you add by hand are left alone. Missing ones are added on the right.
 */

const LISTS = ["采购", "分工"];
const COLUMNS = ["id", "name", "qty", "category", "own", "price", "bought", "updated"];

function doGet(e) {
  return json(readItems(listName(e && e.parameter && e.parameter.list)));
}

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  const name = listName(req.list);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet(name);
    const header = headerOf(sh);
    if (req.action === "add") {
      (req.items || []).forEach((item) => sh.appendRow(toRow(header, item)));
    } else if (req.action === "update" || req.action === "delete") {
      const r = findRow(sh, header, req.id);
      if (r && req.action === "delete") sh.deleteRow(r);
      if (r && req.action === "update") {
        const range = sh.getRange(r, 1, 1, header.length);
        const current = range.getValues()[0];
        const item = Object.assign(toItem(header, current), req.fields || {}, { id: req.id });
        range.setValues([toRow(header, item, current)]);
      }
    }
    return json(readItems(name));
  } finally {
    lock.releaseLock();
  }
}

function listName(name) {
  return LISTS.indexOf(name) >= 0 ? name : LISTS[0];
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Header names from row 1; any of COLUMNS that are missing get added at the end
function headerOf(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  const missing = COLUMNS.filter((c) => header.indexOf(c) < 0);
  if (missing.length) {
    const start = header.filter((h) => h !== "").length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
    return header.filter((h) => h !== "").concat(missing);
  }
  return header;
}

function readItems(name) {
  const sh = sheet(name);
  const header = headerOf(sh);
  const idCol = header.indexOf("id");
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues()
    .filter((row) => row[idCol] !== "")
    .map((row) => toItem(header, row));
}

// Item → row in header order; columns that aren't ours keep their current value
function toRow(header, item, current) {
  return header.map((h, i) => {
    if (h === "updated") return new Date().toISOString();
    if (COLUMNS.indexOf(h) >= 0) return item[h] === undefined ? "" : item[h];
    return current ? current[i] : "";
  });
}

function toItem(header, row) {
  const item = {};
  COLUMNS.forEach((c) => {
    const i = header.indexOf(c);
    const v = i >= 0 ? row[i] : "";
    item[c] = v instanceof Date ? v.toISOString() : v;
  });
  item.id = String(item.id);
  item.qty = String(item.qty);
  item.bought = item.bought === true || item.bought === "TRUE";
  item.own = item.own === true || item.own === "TRUE";
  return item;
}

function findRow(sh, header, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = sh.getRange(2, header.indexOf("id") + 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
