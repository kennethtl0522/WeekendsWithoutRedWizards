/**
 * Shared lists for the trip site: 采购 (shopping) and 拼车 (carpool).
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
 * Add v=2 (as ?v=2 on GET, or "v":2 in a POST body) to get {"v":2,"items":[…]} instead of a bare
 * array. Newer pages use that to tell this version apart from an older deployment.
 *
 * Each list has its own sheet (tab) and its own columns. Columns are matched by their header name
 * (row 1), so they can be reordered in the sheet, and extra columns you add by hand are left alone.
 * Missing ones are added on the right.
 */

const LISTS = {
  "采购": ["id", "name", "qty", "category", "own", "price", "bought", "updated"],
  // driver=TRUE rows are cars (vehicle = car type); other rows ride in the car whose id is in `car`
  "拼车": ["id", "name", "driver", "vehicle", "car", "note", "updated"],
};
const BOOLEANS = ["own", "bought", "driver"];
const DEFAULT_LIST = "采购";

function doGet(e) {
  const p = (e && e.parameter) || {};
  const name = listName(p.list);
  return reply(readItems(name), p.v == 2);
}

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  const name = listName(req.list);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet(name);
    const header = headerOf(sh, name);
    const cols = LISTS[name];
    if (req.action === "add") {
      (req.items || []).forEach((item) => sh.appendRow(toRow(header, cols, item)));
    } else if (req.action === "update" || req.action === "delete") {
      const r = findRow(sh, header, req.id);
      if (r && req.action === "delete") sh.deleteRow(r);
      if (r && req.action === "update") {
        const range = sh.getRange(r, 1, 1, header.length);
        const current = range.getValues()[0];
        const item = Object.assign(toItem(header, cols, current), req.fields || {}, { id: req.id });
        range.setValues([toRow(header, cols, item, current)]);
      }
    }
    return reply(readItems(name), req.v == 2);
  } finally {
    lock.releaseLock();
  }
}

// No list named → 采购 (older pages never sent one). An unknown name is an error, so a page that
// expects a list this script doesn't have can never write into 采购 by mistake.
function listName(name) {
  if (name === undefined || name === null || name === "") return DEFAULT_LIST;
  if (Object.prototype.hasOwnProperty.call(LISTS, name)) return name;
  throw new Error("Unknown list: " + name);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(LISTS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Header names from row 1; any of this list's columns that are missing get added at the end
function headerOf(sh, name) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  const missing = LISTS[name].filter((c) => header.indexOf(c) < 0);
  if (missing.length) {
    const start = header.filter((h) => h !== "").length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
    return header.filter((h) => h !== "").concat(missing);
  }
  return header;
}

function readItems(name) {
  const sh = sheet(name);
  const header = headerOf(sh, name);
  const idCol = header.indexOf("id");
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues()
    .filter((row) => row[idCol] !== "")
    .map((row) => toItem(header, LISTS[name], row));
}

// Item → row in header order; columns that aren't ours keep their current value
function toRow(header, cols, item, current) {
  return header.map((h, i) => {
    if (h === "updated") return new Date().toISOString();
    if (cols.indexOf(h) >= 0) return item[h] === undefined ? "" : item[h];
    return current ? current[i] : "";
  });
}

function toItem(header, cols, row) {
  const item = {};
  cols.forEach((c) => {
    const i = header.indexOf(c);
    const v = i >= 0 ? row[i] : "";
    item[c] = v instanceof Date ? v.toISOString() : v;
  });
  item.id = String(item.id);
  if ("qty" in item) item.qty = String(item.qty);
  BOOLEANS.forEach((b) => { if (b in item) item[b] = item[b] === true || item[b] === "TRUE"; });
  return item;
}

function findRow(sh, header, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = sh.getRange(2, header.indexOf("id") + 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function reply(items, v2) {
  const body = v2 ? { v: 2, items: items } : items;
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
