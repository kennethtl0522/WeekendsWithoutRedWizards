// 拼车 as party rosters, editable like 采购 and stored in the "拼车" tab of the same Google Sheet
// (apps-script/Code.gs). A row with driver=TRUE is a car (its vehicle is the car type); every other
// row rides in the car whose id is in `car`, or is still 待定 when that's empty.
//
// The page only writes to the sheet after the script answers in its v2 shape ({v:2, items}).
// An older deployment would hand back the shopping list instead, so until it's updated the roster
// shows the confirmed cars from reservation.json, read-only, and says what's missing.

const LIST = "拼车";
const REFRESH_MS = 30_000;
const PARTY_MAX = 4; // people per car, driver included
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function applyLocal(items, req) {
  if (req.action === "add") return [...items, ...req.items];
  if (req.action === "delete") return items.filter((x) => x.id !== req.id);
  if (req.action === "update") return items.map((x) => (x.id === req.id ? { ...x, ...req.fields } : x));
  return items;
}

function sheetBackend(url) {
  const unwrap = (d) => (d && d.v === 2 && Array.isArray(d.items) ? d.items : null);
  return {
    list: async () => {
      const r = await fetch(`${url}?list=${encodeURIComponent(LIST)}&v=2`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return unwrap(await r.json());
    },
    send: async (req) => {
      const r = await fetch(url, { method: "POST", body: JSON.stringify({ ...req, list: LIST, v: 2 }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const items = unwrap(await r.json());
      // An old script version answered: the write may have gone to the wrong tab, so stop and say so
      if (!items) throw new Error("脚本版本不对，请检查 Apps Script 部署");
      return items;
    },
  };
}

// reservation.json's carpool.cars → sheet rows (also the first rows written to an empty sheet)
function seedRows(cars = []) {
  return cars.flatMap((k) => {
    const id = newId();
    return [
      { id, name: k.driver, driver: true, vehicle: k.car || "", car: "", note: "" },
      ...(k.riders || []).map((r) => ({ id: newId(), name: r, driver: false, vehicle: "", car: id, note: "" })),
    ];
  });
}

export function mountCarpool(root, { endpoint, seed, esc }) {
  const backend = endpoint ? sheetBackend(endpoint) : null;
  let items = seedRows(seed);
  let live = false; // true once the sheet has answered in the v2 shape
  let note = backend ? "加载中…" : "未连接 Google Sheet";
  let error = null;
  let busy = 0;
  let adding = null;
  let editing = null; // { id, field } while a name or car type is being renamed in place

  const initial = (n) => esc([...String(n)][0] || "?").toUpperCase();
  const cars = () => items.filter((x) => x.driver && x.name);
  const ridersOf = (id) => items.filter((x) => !x.driver && x.name && x.car === id);
  const waiting = () => items.filter((x) => !x.driver && x.name && !cars().some((d) => d.id === x.car));

  // Double-click to rename: shows an input in place; Enter or leaving the field saves, Esc cancels
  const editable = (p, field, cls, fallback = "") => editing && editing.id === p.id && editing.field === field
    ? `<input class="pm-rename" data-rename="${esc(p.id)}" data-field="${field}" value="${esc(p[field] || "")}" aria-label="改名">`
    : `<span class="${cls}"${live ? ` data-edit="${esc(p.id)}" data-field="${field}" title="双击改名"` : ""}>${esc(p[field] || fallback)}</span>`;
  const member = (p, role, lead = false) => `<li class="pm${lead ? " lead" : ""}">
      <i aria-hidden="true">${initial(p.name)}</i>${editable(p, "name", "pm-name")}<span class="pm-role">${role}</span>
      ${live ? `<button type="button" class="pm-del" data-del="${esc(p.id)}" aria-label="移除 ${esc(p.name)}">×</button>` : ""}
    </li>`;

  // `adding` says which inline form is open: "party" (new car), a car id (new member), or "" for 待定
  const memberForm = (target) => `<li class="pm pm-form"><form data-add-member="${esc(target)}">
      <i aria-hidden="true">+</i><input name="name" required autocomplete="off" placeholder="成员名字">
      <span class="pm-acts"><button type="submit" class="tl-btn">加入</button><button type="button" class="tl-btn" data-act="cancel">取消</button></span>
    </form></li>`;
  const addMemberBtn = (target, label) => live
    ? `<li><button type="button" class="pm-add" data-open="${esc(target)}" aria-label="${esc(label)}">+ 成员</button></li>` : "";

  function render() {
    const list = cars();
    const parties = list.map((d, n) => {
      const riders = ridersOf(d.id);
      return `<article class="party">
        <header class="party-head">
          <span class="party-no">PARTY ${String(n + 1).padStart(2, "0")}</span>
          <b>${esc(d.name)} 的 ${editable(d, "vehicle", "party-vehicle", "车")}</b>
          ${(() => {
            const n = riders.length + 1;
            return `<span class="party-count${n >= PARTY_MAX ? " full" : ""}${n > PARTY_MAX ? " over" : ""}">${n} / ${PARTY_MAX} 人${n === PARTY_MAX ? " · 满员" : n > PARTY_MAX ? " · 超员" : ""}</span>`;
          })()}
        </header>
        <ol class="party-list">${member(d, "队长 · 司机", true)}${riders.map((r) => member(r, "队员")).join("")}
          ${riders.length + 1 >= PARTY_MAX ? "" : adding === d.id ? memberForm(d.id) : addMemberBtn(d.id, `给 ${d.name} 的车加成员`)}</ol>
      </article>`;
    });
    const wait = waiting();
    if (wait.length || adding === "") {
      parties.push(`<article class="party pending">
        <header class="party-head"><span class="party-no">待定</span><b>还没分车</b><span class="party-count">${wait.length} 人</span></header>
        <ol class="party-list">${wait.map((r) => member(r, "待定")).join("")}
          ${adding === "" ? memberForm("") : addMemberBtn("", "加一个还没分车的人")}</ol>
      </article>`);
    }
    root.innerHTML = `${parties.length ? `<div class="parties">${parties.join("")}</div>` : ""}
      ${adding === "party" ? `<form class="party-form" data-add-party>
          <input name="name" required autocomplete="off" placeholder="司机名字">
          <input name="vehicle" autocomplete="off" placeholder="车型，如 SUV">
          <button type="submit" class="btn">新建小队</button>
          <button type="button" class="tl-btn" data-act="cancel">取消</button>
        </form>`
      : `<button type="button" class="party-add" data-open="party"${live ? "" : " disabled"} title="${live ? "新建小队（新开一辆车）" : "更新 Apps Script 后可以在这里新建"}">+ 新小队</button>`}
      <p class="party-sync${error || !live ? " err" : ""}">${esc(error ? `同步失败：${error}` : note)}</p>`;
    root.querySelector("form input[name=name]")?.focus();
  }

  async function run(req) {
    busy += 1;
    items = applyLocal(items, req);
    render();
    try { items = await backend.send(req); error = null; stamp(); } catch (e) { error = e.message; }
    busy -= 1;
    render();
  }

  const stamp = () => { note = `已同步 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`; };

  async function refresh() {
    if (!backend || busy || adding !== null || editing) return;
    try {
      const got = await backend.list();
      if (!got) {
        live = false;
        note = "Google Sheet 的脚本还是旧版本，这里先显示已确定的车。更新 Apps Script 后就能在网页上加入。";
      } else if (!got.length && !live && seed?.length) {
        // First time on the new script: put the confirmed cars into the sheet once
        live = true;
        await run({ action: "add", items: seedRows(seed) });
        return;
      } else {
        live = true; items = got; stamp();
      }
      error = null;
    } catch (e) { error = e.message; }
    render();
  }

  root.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open && live) { adding = open.dataset.open; return render(); }
    if (e.target.closest("[data-act=cancel]")) { adding = null; return render(); }
    const del = e.target.closest("[data-del]");
    if (!del) return;
    const who = items.find((x) => x.id === del.dataset.del);
    if (!who || !confirm(`移除 ${who.name}？${who.driver ? "车上的人会回到「待定」。" : ""}`)) return;
    run({ action: "delete", id: who.id });
  });

  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const name = String(f.get("name") || "").trim();
    if (!name) return;
    const row = form.hasAttribute("data-add-party")
      ? { id: newId(), name, driver: true, vehicle: String(f.get("vehicle") || "").trim(), car: "", note: "" }
      : { id: newId(), name, driver: false, vehicle: "", car: form.dataset.addMember || "", note: "" };
    if (row.car && ridersOf(row.car).length + 1 >= PARTY_MAX) { adding = null; return render(); }
    adding = null;
    run({ action: "add", items: [row] });
  });

  root.addEventListener("dblclick", (e) => {
    const el = e.target.closest("[data-edit]");
    if (!el || !live) return;
    editing = { id: el.dataset.edit, field: el.dataset.field };
    render();
    const input = root.querySelector(".pm-rename");
    input?.focus();
    input?.select();
  });

  const finishRename = (input, save) => {
    if (!editing || !input) return;
    const { id, field } = editing;
    editing = null;
    const before = items.find((x) => x.id === id)?.[field] ?? "";
    const value = input.value.trim();
    if (save && value !== String(before) && (value || field !== "name")) run({ action: "update", id, fields: { [field]: value } });
    else render();
  };
  root.addEventListener("keydown", (e) => {
    const input = e.target.closest(".pm-rename");
    if (!input) return;
    if (e.key === "Enter") { e.preventDefault(); finishRename(input, true); }
    if (e.key === "Escape") { e.preventDefault(); finishRename(input, false); }
  });
  root.addEventListener("focusout", (e) => {
    const input = e.target.closest(".pm-rename");
    if (input) finishRename(input, true);
  });

  render();
  refresh();
  setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
