// 采购清单: the group's shared shopping list on the overview page.
// Items live in a Google Sheet behind an Apps Script web app (apps-script/Code.gs).
// Without an endpoint configured, the list still works but only in this browser.
// Each item: name, quantity, category, 自带 (someone brings it from home, so it costs nothing),
// estimated price, bought. Anyone can add items, edit
// them in place, tick them off, and see the estimated total and per-person share.

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

export function mountShopping(root, { endpoint, getPeople, cents, esc }) {
  const backend = endpoint ? remoteBackend(endpoint) : localBackend();
  let items = [];
  let filter = "all"; // all | todo
  let syncedAt = null;
  let error = null;
  let busy = 0;

  const opts = (values, selected) => values.map((v) => `<option${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");

  root.innerHTML = `<div class="shop">
  <form class="shop-add">
    <input name="name" placeholder="添加物品，如 牛小排" required autocomplete="off">
    <input name="qty" placeholder="数量" autocomplete="off">
    <select name="category">${opts(CATEGORIES, "肉类")}</select>
    <label class="own"><input type="checkbox" name="own"> 自带</label>
    <input name="price" type="number" min="0" step="0.01" placeholder="$ 预估">
    <button type="submit" class="btn">添加</button>
  </form>
  <div class="shop-toolbar">
    <div class="seg shop-filter"></div>
    <span class="shop-sync muted"></span>
    <button type="button" class="tl-btn" data-act="refresh">刷新</button>
  </div>
  <div class="shop-summary"></div>
  <div class="shop-groups"></div>
</div>`;

  const form = root.querySelector(".shop-add");
  const groupsEl = root.querySelector(".shop-groups");
  const summaryEl = root.querySelector(".shop-summary");
  const filterEl = root.querySelector(".shop-filter");
  const syncEl = root.querySelector(".shop-sync");

  const price = (x) => (x.own ? 0 : Number(x.price) || 0);

  function rowHTML(x) {
    // Same columns as the add form above: name | qty | category | 自带 | price | ×
    return `<li class="shop-item${x.bought ? " bought" : ""}${x.own ? " own" : ""}" data-id="${esc(x.id)}">
      <span class="si-main">
        <input type="checkbox" data-f="bought" aria-label="已买"${x.bought ? " checked" : ""}>
        <input class="si-name" data-f="name" value="${esc(x.name)}" aria-label="物品">
      </span>
      <input class="si-qty" data-f="qty" value="${esc(x.qty || "")}" placeholder="数量" aria-label="数量">
      <select class="si-cat" data-f="category" aria-label="分类">${opts(CATEGORIES, CATEGORIES.includes(x.category) ? x.category : "其他")}</select>
      <label class="own"><input type="checkbox" data-f="own"${x.own ? " checked" : ""}> 自带</label>
      <input class="si-price" data-f="price" type="number" min="0" step="0.01" value="${x.price === "" || x.price == null ? "" : esc(x.price)}" placeholder="${x.own ? "—" : "$"}" aria-label="价格"${x.own ? " disabled" : ""}>
      <button type="button" class="si-del" aria-label="删除 ${esc(x.name)}">×</button>
    </li>`;
  }

  function render() {
    filterEl.innerHTML = [["all", "全部"], ["todo", "未买"]]
      .map(([v, label]) => `<button type="button" data-filter="${esc(v)}" aria-pressed="${filter === v}">${esc(label)}</button>`).join("");

    const shown = items.filter((x) => filter === "all" || !x.bought);
    const total = items.reduce((sum, x) => sum + price(x), 0);
    const done = items.filter((x) => x.bought).length;
    const own = items.filter((x) => x.own).length;
    summaryEl.innerHTML = items.length
      ? `<b>${done}/${items.length}</b> 已买${own ? ` · 自带 <b>${own}</b>` : ""} · 预计 <b>${cents(total)}</b> · 每人 <b>${cents(total / getPeople())}</b>
         <span class="muted">（${getPeople()} 人平摊${items.some((x) => !x.own && !price(x)) ? "，未填价格的不计" : ""}）</span>`
      : "";

    if (!items.length) {
      groupsEl.innerHTML = `<div class="shop-empty">
        <p>清单还是空的。</p>
        <button type="button" class="btn" data-act="seed">载入建议清单（${STARTER.length} 项）</button>
      </div>`;
    } else {
      const byCat = CATEGORIES.map((cat) => [cat, shown.filter((x) => (CATEGORIES.includes(x.category) ? x.category : "其他") === cat)])
        .filter(([, list]) => list.length);
      groupsEl.innerHTML = byCat.map(([cat, list]) => {
        const sorted = [...list].sort((a, b) => a.bought - b.bought);
        return `<section class="shop-group">
          <h4>${esc(cat)} <span class="muted">${list.filter((x) => x.bought).length}/${list.length}</span></h4>
          <ul>${sorted.map(rowHTML).join("")}</ul>
        </section>`;
      }).join("") || `<p class="muted">没有符合筛选的物品。</p>`;
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const item = {
      id: newId(), name: f.name.trim(), qty: f.qty.trim(), category: f.category, own: f.own === "on",
      price: f.price === "" ? "" : Number(f.price), bought: false,
    };
    if (!item.name) return;
    form.name.value = form.qty.value = form.price.value = "";
    form.own.checked = false;
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
    const del = e.target.closest(".si-del");
    if (del) {
      const row = del.closest(".shop-item");
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
