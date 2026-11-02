// Single-page app: picks a view from the URL and renders it from data/model.json.
// Pitches themselves come from the shared component in pitch.js.
import { SITE, counterHTML, esc, getPeople, loadModel, money, mountPitches, pageLink } from "./pitch.js";
import { mountTimeline } from "./timeline.js";

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
// Per-person prices follow the shared people counter (pitch.js), not the guest count Airbnb quoted
const split = (s) => s.total / getPeople();
const minTotal = (id) => Math.min(...priced.filter((d) => stays[d.key][id]).map((d) => stays[d.key][id].total));
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
  const allPP = priced.flatMap((d) => Object.values(stays[d.key]).map(split));

  const stats = [
    [ids.length, "houses"], [priced.length, "date options"], [Object.keys(areas).length, "areas"],
    [allPP.length ? `${money(Math.min(...allPP))}–${money(Math.max(...allPP))}` : "–", "per person"],
  ].map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");

  const best = Object.fromEntries(priced.map((d) => [d.key, Math.min(...Object.values(stays[d.key]).map((s) => s.total))]));
  const rows = ids
    .sort((a, b) => listings[a].area.localeCompare(listings[b].area) || minTotal(a) - minTotal(b))
    .map((id) => {
      const l = listings[id];
      const cells = priced.map((d) => {
        const s = stays[d.key][id];
        if (!s) return `<td class="na">—</td>`;
        return `<td${s.total === best[d.key] ? ' class="best"' : ""}><a href="${pageLink({ dates: d.key, id })}">${money(split(s))}</a></td>`;
      }).join("");
      // The house name opens its block on the cheapest date it's available
      const cheapest = priced.filter((d) => stays[d.key][id])
        .sort((a, b) => stays[a.key][id].total - stays[b.key][id].total)[0];
      return `<tr><th scope="row"><a class="house-link" href="${pageLink({ dates: cheapest.key, id })}">
        <span class="house">${esc(l.name)}</span>
        <span class="sub">${esc(l.area)} · ${l.bedrooms} bd · ${l.baths} ba · ★ ${l.rating ?? "–"}${l.note ? ` · “${esc(l.note)}”` : ""}</span>
      </a></th>${cells}</tr>`;
    }).join("");

  document.title = trip.title;
  app.innerHTML = `
<header class="hero-head">
  <p class="eyebrow">Trip plan</p>
  <h1>${esc(trip.title)}</h1>
  <p class="split-line">Per-person prices split between ${counterHTML()} people</p>
  <div class="stats">${stats}</div>
</header>
<main class="overview">
  <section>
    <h2>Weekend plan</h2>
    <div id="timeline"></div>
  </section>
  <section>
    <h2>Houses &amp; prices</h2>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>House</th>${priced.map((d) => `<th><a href="${pageLink({ dates: d.key })}">${esc(d.label)}</a></th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>
  <p class="muted foot">Prices checked ${esc((trip.updated || "").replace("T", " ").slice(0, 16))}.</p>
</main>`;
  mountTimeline(document.getElementById("timeline"));
}

// ---------- date page: one scrollable block per house ----------

function datePage(key) {
  const d = dateOf(key);
  const here = Object.entries(stays[key] || {});
  if (!d || !here.length) return notFound();

  const slots = here.map(([id, s]) => `<div class="slot" data-total="${s.total}">
      <div class="slot-bar"><a href="${pageLink({ dates: key, id })}">Full page ↗</a></div>
      <div class="scroll"><div data-pitch="${id}" data-dates="${key}"></div></div>
    </div>`).join("");

  document.title = `${d.label} · ${trip.title}`;
  app.innerHTML = `${topbar([esc(d.label)])}
<header class="date-head">
  <h1 class="date-tiles" aria-label="${esc(d.long_label)}">
    ${dateTile(d.check_in, "Check-in")}
    <span class="tile-arrow" aria-hidden="true">→</span>
    ${dateTile(d.check_out, "Check-out")}
  </h1>
</header>
<div class="toolbar">
  <b class="option-count">${plural(here.length, "option")}</b>
  <label class="sort">Sort
    <select id="sort">
      <option value="asc">Price: low to high</option>
      <option value="desc">Price: high to low</option>
    </select>
  </label>
</div>
<main class="board">${slots}</main>`;
  setupSort(key);
}

// Calendar-style tile: label, weekday, big day number, month
function dateTile(iso, label) {
  const day = new Date(`${iso}T12:00:00`);
  const part = (opt) => day.toLocaleDateString("en-US", opt);
  return `<span class="tile" aria-hidden="true">
    <span class="tile-label">${label}</span>
    <span class="tile-dow">${part({ weekday: "short" })}</span>
    <span class="tile-day">${day.getDate()}</span>
    <span class="tile-mon">${part({ month: "short" })}</span>
  </span>`;
}

// Sort order lives in the URL (?dates=…&sort=desc) so a shared link keeps it
function setupSort(key) {
  const board = app.querySelector(".board");
  const slots = [...board.querySelectorAll(".slot")];
  const select = document.getElementById("sort");
  select.value = query.get("sort") === "desc" ? "desc" : "asc";

  function render() {
    const dir = select.value === "desc" ? -1 : 1;
    slots.sort((a, b) => dir * (a.dataset.total - b.dataset.total)).forEach((s) => board.appendChild(s));
    const p = new URLSearchParams({ dates: key });
    if (select.value === "desc") p.set("sort", "desc");
    history.replaceState(null, "", "?" + p);
  }

  select.addEventListener("change", render);
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
else {
  overview();
  document.addEventListener("people-change", overview);
}
await mountPitches(app);
