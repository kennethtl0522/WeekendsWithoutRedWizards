// 采购清单: the group's shared shopping list on the overview page.
// Items live in a Google Sheet behind an Apps Script web app (apps-script/Code.gs).
// Without an endpoint configured, the list still works but only in this browser.
// Two tabs over the same items: 需购买 (to buy: has a price, counts toward the total and
// per-person share) and 自带 (brought from home: no price at all). The `own` field says which.
// Anyone can add items to the open tab, edit them in place, tick them off (bought / packed),
// move them between tabs, or delete them.

const LIST = "采购";
const CATEGORIES = ["肉类", "蔬果", "主食", "饮料酒水", "零食", "调料", "日用品", "其他"];
const REFRESH_MS = 30_000;

// Suggested starting point for 8 people over 2 nights; loaded on demand when the list is empty
const STARTER = [
  ["牛小排 / 肋眼", "3–4 lb", "肉类"], ["鸡翅", "3 lb", "肉类"],
  ["香肠", "2 包", "肉类"], ["五花肉", "2 lb", "肉类"],
  ["玉米", "8 根", "蔬果"], ["洋葱 / 彩椒 / 蘑菇", "各 1 份", "蔬果"],
  ["生菜", "2 颗", "蔬果"], ["水果（西瓜 / 葡萄）", "1–2 份", "蔬果"],
  ["米或面", "1 包", "主食"], ["面包 / 汉堡胚", "1 包", "主食"],
  ["鸡蛋", "1 盒", "主食"], ["吐司 / 贝果", "1 包", "主食"],
  ["啤酒", "2 箱", "饮料酒水"], ["红酒 / 烈酒", "按口味", "饮料酒水"],
  ["气泡水", "1 箱", "饮料酒水"], ["冰块", "2 袋", "饮料酒水"],
  ["薯片", "1 大包", "零食"], ["坚果", "1 罐", "零食"], ["泡面", "1 箱", "零食"],
  ["烧烤酱", "1 瓶", "调料"], ["盐 / 黑胡椒", "各 1", "调料"],
  ["腌料", "1–2 瓶", "调料"], ["食用油", "1 瓶", "调料"],
  ["锡纸", "1 卷", "日用品"], ["垃圾袋", "1 盒", "日用品"],
  ["纸盘 / 纸杯", "1 包", "日用品"], ["厨房纸", "1 包", "日用品"],
  ["一次性手套", "1 盒", "日用品"], ["保鲜袋", "1 盒", "日用品"],
  ["炭 / 点火器（如无燃气烤炉）", "按需", "日用品"],
];

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- storage ----------

// Same request format as the Apps Script, applied to a local array
function applyLocal(items, req) {
  if (req.action === "add") return [...items, ...req.items];
  if (req.action === "delete") return items.filter((x) => x.id !== req.id);
  if (req.action === "update") return items.map((x) => (x.id === req.id ? { ...x, ...req.fields } : x));
  return items;
}

function localBackend() {
  const key = `airbnb-pitch:list:${LIST}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  return {
    shared: false,
    list: async () => read(),
    send: async (req) => {
      const items = applyLocal(read(), req);
      try { localStorage.setItem(key, JSON.stringify(items)); } catch {}
      return items;
    },
  };
}

function remoteBackend(url) {
  const ok = (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  return {
    shared: true,
    list: () => fetch(`${url}?list=${encodeURIComponent(LIST)}`, { cache: "no-store" }).then(ok),
    // A plain-text body keeps this a "simple" request, which Apps Script accepts cross-origin
    send: (req) => fetch(url, { method: "POST", body: JSON.stringify({ ...req, list: LIST }) }).then(ok),
  };
}

// ---------- view ----------

const TABS = {
  buy: { label: "需购买", add: "添加要买的，如 牛小排", done: "已买", todo: "未买" },
  own: { label: "自带", add: "添加自带的，如 盐、烤炉", done: "已带", todo: "未带" },
};

export function mountShopping(root, { endpoint, getPeople, cents, esc }) {
  const backend = endpoint ? remoteBackend(endpoint) : localBackend();
  let items = [];
  let tab = "buy"; // buy | own
  let filter = "all"; // all | todo
  let syncedAt = null;
  let error = null;
  let busy = 0;
  try { tab = localStorage.getItem("airbnb-pitch:list-tab") === "own" ? "own" : "buy"; } catch {}

  const opts = (values, selected) => values.map((v) => `<option${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  root.innerHTML = `<div class="shop">
  <div class="shop-head">
    <div class="shop-tabs" role="tablist"></div>
    <span class="shop-sync muted"></span>
    <button type="button" class="tl-btn" data-act="refresh">刷新</button>
  </div>
  <form class="shop-add">
    <input name="name" required autocomplete="off">
    <input name="qty" placeholder="数量" autocomplete="off">
    <select name="category">${opts(CATEGORIES, "肉类")}</select>
    <input name="price" type="number" min="0" step="0.01" placeholder="$ 预估">
    <button type="submit" class="btn">添加</button>
  </form>
  <div class="shop-toolbar">
    <div class="seg shop-filter"></div>
    <div class="shop-summary"></div>
  </div>
  <div class="shop-groups"></div>
</div>`;

  const shopEl = root.querySelector(".shop");
  const form = root.querySelector(".shop-add");
  const tabsEl = root.querySelector(".shop-tabs");
  const groupsEl = root.querySelector(".shop-groups");
  const summaryEl = root.querySelector(".shop-summary");
  const filterEl = root.querySelector(".shop-filter");
  const syncEl = root.querySelector(".shop-sync");

  const isOwn = (x) => Boolean(x.own);
  const inTab = (x) => isOwn(x) === (tab === "own");
  const price = (x) => (isOwn(x) ? 0 : Number(x.price) || 0);

  function rowHTML(x) {
    // Same columns as the add form above: name | qty | category | [price] | actions
    const other = tab === "own" ? "购买" : "自带";
    return `<li class="shop-item${x.bought ? " bought" : ""}" data-id="${esc(x.id)}">
      <span class="si-main">
        <input type="checkbox" data-f="bought" aria-label="${TABS[tab].done}"${x.bought ? " checked" : ""}>
        <input class="si-name" data-f="name" value="${esc(x.name)}" aria-label="物品">
      </span>
      <input class="si-qty" data-f="qty" value="${esc(x.qty || "")}" placeholder="数量" aria-label="数量">
      <select class="si-cat" data-f="category" aria-label="分类">${opts(CATEGORIES, CATEGORIES.includes(x.category) ? x.category : "其他")}</select>
      ${tab === "buy" ? `<input class="si-price" data-f="price" type="number" min="0" step="0.01" value="${x.price === "" || x.price == null ? "" : esc(x.price)}" placeholder="$" aria-label="价格">` : ""}
      <span class="si-actions">
        <button type="button" class="si-move" title="移到${other}">→ ${other}</button>
        <button type="button" class="si-del" aria-label="删除 ${esc(x.name)}">×</button>
      </span>
    </li>`;
  }

  function render() {
    const t = TABS[tab];
    shopEl.dataset.mode = tab;
    const count = (own) => items.filter((x) => isOwn(x) === own).length;
    tabsEl.innerHTML = Object.entries(TABS).map(([key, v]) => `<button type="button" role="tab" data-tab="${key}"
      aria-selected="${tab === key}">${v.label} <span>${count(key === "own")}</span></button>`).join("");
    form.name.placeholder = t.add;
    filterEl.innerHTML = [["all", "全部"], ["todo", t.todo]]
      .map(([v, label]) => `<button type="button" data-filter="${esc(v)}" aria-pressed="${filter === v}">${esc(label)}</button>`).join("");

    const mine = items.filter(inTab);
    const done = mine.filter((x) => x.bought).length;
    if (tab === "buy") {
      const total = mine.reduce((sum, x) => sum + price(x), 0);
      summaryEl.innerHTML = mine.length
        ? `<b>${done}/${mine.length}</b> ${t.done} · 预计 <b>${cents(total)}</b> · 每人 <b>${cents(total / getPeople())}</b>
           <span class="muted">${getPeople()} 人平摊${mine.some((x) => !price(x)) ? "，未填价格的不计" : ""}</span>`
        : "";
    } else {
      summaryEl.innerHTML = mine.length ? `<b>${done}/${mine.length}</b> ${t.done}` : "";
    }

    if (!items.length) {
      groupsEl.innerHTML = `<div class="shop-empty">
        <p>清单还是空的。</p>
        <button type="button" class="btn" data-act="seed">载入建议清单（${STARTER.length} 项）</button>
      </div>`;
    } else if (!mine.length) {
      groupsEl.innerHTML = `<p class="muted shop-none">${tab === "own" ? "还没有自带的物品。在上面添加，或在「需购买」里点「→ 自带」。" : "没有要买的物品。"}</p>`;
    } else {
      const shown = mine.filter((x) => filter === "all" || !x.bought);
      const byCat = CATEGORIES.map((cat) => [cat, shown.filter((x) => (CATEGORIES.includes(x.category) ? x.category : "其他") === cat)])
        .filter(([, list]) => list.length);
      groupsEl.innerHTML = byCat.map(([cat, list]) => {
        const sorted = [...list].sort((a, b) => a.bought - b.bought);
        return `<section class="shop-group">
          <h4>${esc(cat)} <span class="muted">${list.filter((x) => x.bought).length}/${list.length}</span></h4>
          <ul>${sorted.map(rowHTML).join("")}</ul>
        </section>`;
      }).join("") || `<p class="muted shop-none">没有符合筛选的物品。</p>`;
    }

    const when = syncedAt ? syncedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    syncEl.textContent = error
      ? `同步失败：${error}`
      : busy ? "保存中…"
      : backend.shared ? (when ? `已同步 · ${when}` : "加载中…") : "未连接 Google Sheet，仅保存在本浏览器";
    syncEl.classList.toggle("err", Boolean(error));
  }

  async function run(promise) {
    busy++;
    render();
    try {
      items = await promise;
      syncedAt = new Date();
      error = null;
    } catch (err) {
      error = err.message;
    } finally {
      busy--;
      render();
    }
  }

  // Apply locally right away, then save; the server's answer replaces the local copy
  function send(req) {
    items = applyLocal(items, req);
    return run(backend.send(req));
  }

  const refresh = () => { if (!busy && !root.contains(document.activeElement)) run(backend.list()); };

  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    filter = "all";
    try { localStorage.setItem("airbnb-pitch:list-tab", tab); } catch {}
    render();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const item = {
      id: newId(), name: f.name.trim(), qty: f.qty.trim(), category: f.category, own: tab === "own",
      price: tab === "own" || f.price === "" ? "" : Number(f.price), bought: false,
    };
    if (!item.name) return;
    form.name.value = form.qty.value = form.price.value = "";
    form.name.focus();
    send({ action: "add", items: [item] });
  });

  groupsEl.addEventListener("change", (e) => {
    const field = e.target.dataset.f;
    const row = e.target.closest(".shop-item");
    if (!field || !row) return;
    let value = e.target.type === "checkbox" ? e.target.checked : e.target.value.trim();
    if (field === "price") value = value === "" ? "" : Number(value);
    if (field === "name" && !value) return render();
    send({ action: "update", id: row.dataset.id, fields: { [field]: value } });
  });

  groupsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".shop-item");
    if (e.target.closest(".si-move") && row) {
      // Moving to 自带 drops the price (it no longer costs anything); ticks reset for the new list
      const toOwn = tab === "buy";
      send({ action: "update", id: row.dataset.id, fields: { own: toOwn, bought: false, ...(toOwn && { price: "" }) } });
      return;
    }
    if (e.target.closest(".si-del") && row) {
      const name = row.querySelector(".si-name").value;
      if (confirm(`删除「${name}」？`)) send({ action: "delete", id: row.dataset.id });
      return;
    }
    if (e.target.closest('[data-act="seed"]')) {
      const starter = STARTER.map(([name, qty, category]) => ({ id: newId(), name, qty, category, own: false, price: "", bought: false }));
      send({ action: "add", items: starter });
    }
  });

  filterEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (b) { filter = b.dataset.filter; render(); }
  });
  root.querySelector('[data-act="refresh"]').addEventListener("click", () => run(backend.list()));
  document.addEventListener("people-change", render);

  // Keep up with other people's edits while the page is open
  if (backend.shared) {
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  }

  run(backend.list());
}
