// Single-page app: picks a view from the URL and renders it from data/model.json.
// Pitches themselves come from the shared component in pitch.js.
import { SITE, esc, loadModel, money, mountPitches, pageLink } from "./pitch.js";

const app = document.getElementById("app");
const query = new URLSearchParams(location.search);

let model;
try {
  model = await loadModel();
} catch (err) {
  app.innerHTML = `<p class="callout">Couldn't load data/model.json (${esc(err.message)}).
    Open the site over http (GitHub Pages or a local server), not as a file.</p>`;
  throw err;
}

const { trip, listings, stays } = model;
const priced = model.dates.filter((d) => Object.keys(stays[d.key] || {}).length);
const dateOf = (key) => model.dates.find((d) => d.key === key);
const minPP = (id) => Math.min(...priced.filter((d) => stays[d.key][id]).map((d) => stays[d.key][id].per_person));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function topbar(crumbs = []) {
  const parts = [`<a href="${SITE}">${esc(trip.title)}</a>`, ...crumbs];
  return `<nav class="topbar">${parts.join(" <span>/</span> ")}</nav>`;
}

// ---------- overview ----------

function overview() {
  const ids = Object.keys(listings);
  const areas = {};
  for (const id of ids) (areas[listings[id].area] ??= []).push(id);
  const allPP = priced.flatMap((d) => Object.values(stays[d.key]).map((s) => s.per_person));

  const stats = [
    [ids.length, "houses"], [priced.length, "date options"], [Object.keys(areas).length, "areas"],
    [allPP.length ? `${money(Math.min(...allPP))}–${money(Math.max(...allPP))}` : "–", "per person"],
  ].map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");

  const picks = ids.filter((id) => listings[id].note).map((id) => {
    const l = listings[id];
    const best = priced.filter((d) => stays[d.key][id])
      .sort((a, b) => stays[a.key][id].per_person - stays[b.key][id].per_person)[0];
    return `<a class="pick-card" href="${pageLink({ dates: best.key, id })}">
      <span class="note">“${esc(l.note)}”</span>
      <b>${esc(l.name)}</b>
      <span class="muted">${esc(l.area)} · from ${money(stays[best.key][id].per_person)}/person (${esc(best.label)})</span>
    </a>`;
  }).join("");

  const dateCards = priced.map((d) => {
    const here = Object.entries(stays[d.key]);
    const [cheapId, cheap] = here.sort((a, b) => a[1].per_person - b[1].per_person)[0];
    const byArea = {};
    for (const [id] of here) byArea[listings[id].area] = (byArea[listings[id].area] || 0) + 1;
    return `<a class="date-card" href="${pageLink({ dates: d.key })}">
      <span class="eyebrow">${plural(d.nights, "night")}</span>
      <h3>${esc(d.long_label)}</h3>
      <p><b>${here.length}</b> of ${ids.length} houses available</p>
      <p>From <b>${money(cheap.per_person)}</b>/person · ${esc(listings[cheapId].name.slice(0, 34))}</p>
      <p class="muted">${Object.entries(byArea).sort().map(([a, n]) => `${esc(a)} ${n}`).join(" · ")}</p>
      <span class="go">View houses →</span>
    </a>`;
  }).join("");

  const empty = model.dates.filter((d) => !priced.includes(d));
  const emptyNote = empty.length
    ? `<p class="callout">No houses available for ${empty.map((d) => `${esc(d.long_label)} (${plural(d.nights, "night")})`).join(", ")}. Most likely a 2-night minimum.</p>`
    : "";

  const best = Object.fromEntries(priced.map((d) => [d.key, Math.min(...Object.values(stays[d.key]).map((s) => s.per_person))]));
  const rows = ids
    .sort((a, b) => listings[a].area.localeCompare(listings[b].area) || minPP(a) - minPP(b))
    .map((id) => {
      const l = listings[id];
      const cells = priced.map((d) => {
        const s = stays[d.key][id];
        if (!s) return `<td class="na">—</td>`;
        return `<td${s.per_person === best[d.key] ? ' class="best"' : ""}><a href="${pageLink({ dates: d.key, id })}">${money(s.per_person)}</a></td>`;
      }).join("");
      return `<tr><th scope="row"><span class="house">${esc(l.name)}</span>
        <span class="sub">${esc(l.area)} · ${l.bedrooms} bd · ${l.baths} ba · ★ ${l.rating ?? "–"}${l.note ? ` · “${esc(l.note)}”` : ""}</span></th>${cells}</tr>`;
    }).join("");

  const areaList = Object.entries(areas).sort((a, b) => b[1].length - a[1].length)
    .map(([a, list]) => `<li><b>${esc(a)}</b> ${list.length} houses: ${esc([...new Set(list.map((id) => listings[id].city))].sort().join(", "))}</li>`)
    .join("");

  document.title = trip.title;
  app.innerHTML = `
<header class="hero-head">
  <p class="eyebrow">Trip plan · ${trip.guests} guests</p>
  <h1>${esc(trip.title)}</h1>
  <div class="stats">${stats}</div>
</header>
<main class="overview">
  <section>
    <h2>How we decide</h2>
    <ol class="steps">
      <li><b>Pick the area.</b> The houses are in ${Object.keys(areas).length} different areas, up to two hours apart.</li>
      <li><b>Pick the weekend.</b> Each date option shows what's still open.</li>
      <li><b>Shortlist.</b> Open a date, tick "Compare" on 2–4 houses, switch to side by side.</li>
      <li><b>Book</b> once everyone agrees. Prices move, so check the live price on Airbnb.</li>
    </ol>
  </section>
  ${picks ? `<section><h2>Team picks</h2><div class="picks">${picks}</div></section>` : ""}
  <section>
    <h2>Date options</h2>
    <div class="date-grid">${dateCards}</div>
    ${emptyNote}
  </section>
  <section>
    <h2>Price per person, every option</h2>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>House</th>${priced.map((d) => `<th><a href="${pageLink({ dates: d.key })}">${esc(d.label)}</a></th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="muted">Highlighted = cheapest for that date. Prices before taxes &amp; service fees.</p>
  </section>
  <section>
    <h2>Areas</h2>
    <ul class="plain areas">${areaList}</ul>
  </section>
  <p class="muted foot">Prices checked ${esc((trip.updated || "").replace("T", " ").slice(0, 16))}.</p>
</main>`;
}

// ---------- date page: list / side by side ----------

function datePage(key) {
  const d = dateOf(key);
  const here = Object.entries(stays[key] || {}).sort((a, b) => a[1].per_person - b[1].per_person);
  if (!d || !here.length) return notFound();
  const areas = [...new Set(here.map(([id]) => listings[id].area))].sort();

  const slots = here.map(([id, s]) => {
    const l = listings[id];
    return `<div class="slot" data-id="${id}" data-pp="${s.per_person}" data-rating="${l.rating ?? 0}"
      data-baths="${l.baths ?? 0}" data-beds="${l.beds ?? 0}" data-area="${esc(l.area)}">
      <div class="slot-bar">
        <label><input type="checkbox" class="pick"> Compare</label>
        <a href="${pageLink({ dates: key, id })}">Full page ↗</a>
      </div>
      <div class="scroll"><div data-pitch="${id}" data-dates="${key}"></div></div>
    </div>`;
  }).join("");

  document.title = `${d.label} · ${trip.title}`;
  app.innerHTML = `${topbar([esc(d.label)])}
<header class="date-head">
  <h1>${esc(d.long_label)}</h1>
  <p>${plural(d.nights, "night")} · ${d.guests} guests · ${here.length} houses available · prices before taxes &amp; fees</p>
</header>
<div class="toolbar">
  <div class="seg" role="group" aria-label="View">
    <button data-view="list" aria-pressed="true">List</button>
    <button data-view="compare" aria-pressed="false">Side by side</button>
  </div>
  <label>Sort <select id="sort">
    <option value="pp">Price per person</option><option value="rating">Rating</option>
    <option value="baths">Most baths</option><option value="beds">Most beds</option>
  </select></label>
  <label>Area <select id="area"><option value="">All areas</option>${areas.map((a) => `<option>${esc(a)}</option>`).join("")}</select></label>
  <span id="sel-count" class="muted"></span>
  <button id="clear" class="link">Clear selection</button>
</div>
<main class="board list">${slots}</main>`;
  setupBoard(key);
}

// Selection is kept per date in localStorage and mirrored in the URL
// (?dates=…&view=compare&ids=…) so a shortlist can be shared as a link.
function setupBoard(key) {
  const board = app.querySelector(".board");
  const storeKey = "airbnb-pitch:" + key;
  const slots = [...board.querySelectorAll(".slot")];
  const sortSel = document.getElementById("sort");
  const areaSel = document.getElementById("area");
  const count = document.getElementById("sel-count");

  const state = { view: "list", ids: [], sort: "pp", area: "" };
  try { Object.assign(state, JSON.parse(localStorage.getItem(storeKey) || "{}")); } catch {}
  if (query.has("view")) state.view = query.get("view");
  if (query.has("ids")) state.ids = query.get("ids").split(",").filter(Boolean);

  const num = (el, k) => parseFloat(el.dataset[k]) || 0;
  const sorters = {
    pp: (a, b) => num(a, "pp") - num(b, "pp"),
    rating: (a, b) => num(b, "rating") - num(a, "rating"),
    baths: (a, b) => num(b, "baths") - num(a, "baths"),
    beds: (a, b) => num(b, "beds") - num(a, "beds"),
  };

  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
    const p = new URLSearchParams({ dates: key });
    if (state.view !== "list") p.set("view", state.view);
    if (state.ids.length) p.set("ids", state.ids.join(","));
    history.replaceState(null, "", "?" + p);
  }

  function render() {
    const compare = state.view === "compare";
    board.classList.toggle("compare", compare);
    board.classList.toggle("list", !compare);
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));

    slots.sort(sorters[state.sort] || sorters.pp).forEach((s) => board.appendChild(s));

    const picked = new Set(state.ids);
    for (const s of slots) {
      const on = picked.has(s.dataset.id);
      s.querySelector(".pick").checked = on;
      s.classList.toggle("picked", on);
      const inArea = !state.area || s.dataset.area === state.area;
      s.hidden = !inArea || (compare && picked.size > 0 && !on);
    }
    count.textContent = picked.size ? `${picked.size} selected` : "Tick “Compare” to shortlist";
    sortSel.value = state.sort;
    areaSel.value = state.area;
    save();
  }

  document.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; render(); }));
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; render(); });
  areaSel.addEventListener("change", () => { state.area = areaSel.value; render(); });
  document.getElementById("clear").addEventListener("click", () => { state.ids = []; render(); });
  board.addEventListener("change", (e) => {
    if (!e.target.classList.contains("pick")) return;
    const id = e.target.closest(".slot").dataset.id;
    state.ids = e.target.checked ? [...new Set([...state.ids, id])] : state.ids.filter((x) => x !== id);
    render();
  });

  render();
}

// ---------- single pitch ----------

function pitchPage(key, id) {
  const d = dateOf(key);
  const l = listings[id];
  if (!d || !l) return notFound();
  document.title = `${l.name} · ${d.label}`;
  app.innerHTML = `${topbar([`<a href="${pageLink({ dates: key })}">${esc(d.label)}</a>`, esc(l.name)])}
<main class="single"><div data-pitch="${id}" data-dates="${key}"></div></main>`;
}

function notFound() {
  app.innerHTML = `${topbar()}<main class="single"><p class="callout">Nothing here for that link.
    <a href="${SITE}">Back to the overview</a></p></main>`;
}

const key = query.get("dates");
const id = query.get("id");
if (key && id) pitchPage(key, id);
else if (key) datePage(key);
else overview();
await mountPitches(app);
