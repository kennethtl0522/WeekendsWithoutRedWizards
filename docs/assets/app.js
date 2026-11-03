// Single-page app: picks a view from the URL and renders it from data/model.json.
// Pitches themselves come from the shared component in pitch.js.
import { SITE, cents, counterHTML, esc, getPeople, loadModel, money, mountPitches, pageLink } from "./pitch.js?v=7e3ad667";
import { mountShopping } from "./lists.js?v=7e3ad667";
import { mountPlans } from "./timeline.js?v=7e3ad667";

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

// Weekday names from a date onward, e.g. ["Sat", "Sun", "Mon", "Tue"]
function weekdaysFrom(iso) {
  const start = new Date(`${iso}T12:00:00`);
  return [0, 1, 2, 3].map((i) => new Date(start.getTime() + i * 864e5).toLocaleDateString("en-US", { weekday: "short" }));
}

const photoURL = (l, i = 0) => {
  const f = l.photos[i];
  return f && (/^https?:/.test(f) ? f : `${SITE}images/${l.id}/${encodeURIComponent(f)}`);
};

const mapsURL = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

// The booked house: photo, check-in/out, amount paid split per person, links
function bookingCard(c) {
  const l = listings[c.id];
  const d = dateOf(c.dates);
  const s = stays[c.dates]?.[c.id];
  if (!l || !d || !s) return "";
  const details = pageLink({ dates: d.key, id: l.id });
  const photo = photoURL(l);
  const paid = Number(c.amount_paid) || s.total;
  const inOut = (label, x, fallback) => `<div class="io"><span>${label}</span>
    <b>${esc(x?.day ?? fallback.day)}</b><em>${esc(x?.time ?? fallback.time)}</em></div>`;
  return `<section class="booking">
    <a class="booking-photo ph" href="${details}">${photo ? `<img src="${esc(photo)}" alt="">` : "<span>Photo</span>"}</a>
    <div class="booking-body">
      <p class="where">${esc(c.address || l.location || l.city)}</p>
      <h2><a href="${details}">${esc(l.name)}</a></h2>
      <div class="io-row">
        ${inOut("Check-in", c.check_in, { day: d.long_label.split(" – ")[0], time: l.check_in_time ?? "" })}
        <span class="io-arrow" aria-hidden="true">→</span>
        ${inOut("Checkout", c.check_out, { day: d.long_label.split(" – ")[1], time: l.check_out_time ?? "" })}
      </div>
      <div class="booking-price">
        <span class="pp" data-split="${paid}" data-cents>${cents(paid / getPeople())}</span><span class="per">/ person</span>
        <span class="split-by">Split between ${counterHTML()} people</span>
      </div>
      <p class="booking-total">Amount paid <b>${cents(paid)}</b>${c.guests ? ` · ${c.guests} guests` : ""}</p>
      <div class="booking-actions">
        <a class="btn" href="${details}">House details</a>
        ${c.receipt_url ? `<a class="btn ghost" href="${esc(c.receipt_url)}" target="_blank" rel="noopener">Receipt ↗</a>` : ""}
        ${c.address ? `<a class="btn ghost" href="${esc(mapsURL(c.address))}" target="_blank" rel="noopener">Open in Maps ↗</a>` : ""}
      </div>
    </div>
  </section>`;
}

// Getting there, checking in, house rules, cancellation policy
function reservationDetails(c) {
  const cards = [];
  if (c.address) {
    const routes = (c.directions || []).map((r) => `<div class="route">
      <h4>${esc(r.from)}</h4>
      <ol>${r.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
    </div>`).join("");
    cards.push(`<article class="info-card wide">
      <h3>Getting there</h3>
      <p class="addr"><b>${esc(c.address)}</b> <a href="${esc(mapsURL(c.address))}" target="_blank" rel="noopener">Open in Maps ↗</a></p>
      ${routes ? `<details class="directions">
        <summary>Directions <span class="muted">${esc((c.directions || []).map((r) => r.from.toLowerCase()).join(" / "))}</span></summary>
        <div class="routes">${routes}</div>
        ${c.directions_note ? `<p class="muted small">${esc(c.directions_note)}</p>` : ""}
      </details>` : ""}
    </article>`);
  }
  if (c.check_in_method) {
    cards.push(`<article class="info-card">
      <h3>Checking in</h3>
      <p>${esc(c.check_in_method)}</p>
      ${c.confirmation_code ? `<p class="code">Confirmation code <b>${esc(c.confirmation_code)}</b></p>` : ""}
    </article>`);
  }
  if (c.house_rules?.length) {
    cards.push(`<article class="info-card">
      <h3>House rules</h3>
      <ul class="rules">${c.house_rules.map((r) => `<li${/quiet hours/i.test(r) ? ' class="hl"' : ""}>${esc(r)}</li>`).join("")}</ul>
    </article>`);
  }
  if (c.cancellation?.length) {
    cards.push(`<article class="info-card">
      <h3>Cancellation policy</h3>
      <ol class="cancel">${c.cancellation.map((x) => `<li>
        <span class="when">${esc(x.when)}</span><b>${esc(x.result)}</b><span class="muted">${esc(x.detail)}</span>
      </li>`).join("")}</ol>
      ${c.cancellation_note ? `<p class="muted small">${esc(c.cancellation_note)}</p>` : ""}
    </article>`);
  }
  return cards.length ? `<section><h2>Reservation details</h2><div class="info-grid">${cards.join("")}</div></section>` : "";
}

function priceTable(markKey, markLabel) {
  const ids = Object.keys(listings);
  const confirmedId = trip.confirmed?.id;
  const best = Object.fromEntries(priced.map((d) => [d.key, Math.min(...Object.values(stays[d.key]).map((s) => s.total))]));
  const rows = ids
    .sort((a, b) => listings[a].area.localeCompare(listings[b].area) || minTotal(a) - minTotal(b))
    .map((id) => {
      const l = listings[id];
      const cells = priced.map((d) => {
        const s = stays[d.key][id];
        const cls = [d.key === markKey && "rec", s && s.total === best[d.key] && "best"].filter(Boolean).join(" ");
        if (!s) return `<td class="na${cls ? ` ${cls}` : ""}">—</td>`;
        return `<td${cls ? ` class="${cls}"` : ""}><a href="${pageLink({ dates: d.key, id })}"><span data-split="${s.total}">${money(split(s))}</span></a></td>`;
      }).join("");
      // The house name opens its block on the cheapest date it's available
      const cheapest = priced.filter((d) => stays[d.key][id])
        .sort((a, b) => stays[a.key][id].total - stays[b.key][id].total)[0];
      return `<tr${id === confirmedId ? ' class="picked"' : ""}><th scope="row"><a class="house-link" href="${pageLink({ dates: cheapest.key, id })}">
        <span class="house">${esc(l.name)}</span>
        <span class="sub">${esc(l.area)} · ${l.bedrooms} bd · ${l.baths} ba · ★ ${l.rating ?? "–"}${l.note ? ` · “${esc(l.note)}”` : ""}</span>
      </a></th>${cells}</tr>`;
    }).join("");
  return `<div class="table-wrap"><table class="matrix">
      <thead><tr><th>House</th>${priced.map((d) => d.key === markKey
        ? `<th class="rec"><span class="rec-badge">${markLabel}</span><a class="date-btn" href="${pageLink({ dates: d.key })}">${esc(d.label)}</a></th>`
        : `<th><a class="date-btn" href="${pageLink({ dates: d.key })}">${esc(d.label)}</a></th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function overview() {
  const c = trip.confirmed && listings[trip.confirmed.id] && stays[trip.confirmed.dates]?.[trip.confirmed.id] ? trip.confirmed : null;
  const checkedAt = `<p class="muted foot">Prices checked ${esc((trip.updated || "").replace("T", " ").slice(0, 16))}.</p>`;
  document.title = trip.title;

  if (c) {
    app.innerHTML = `
<header class="hero-head">
  <p class="eyebrow">Trip plan</p>
  <h1>${esc(trip.title)}</h1>
  <div class="status">
    <span class="status-ok">✓ ${esc(c.status || "Booked")}</span>
    ${c.confirmation_code ? `<span class="status-code">Confirmation ${esc(c.confirmation_code)}</span>` : ""}
  </div>
</header>
<main class="overview">
  ${bookingCard(c)}
  ${reservationDetails(c)}
  <section>
    <h2>Confirm our plan</h2>
    <div id="plans"></div>
  </section>
  <section>
    <h2>采购清单</h2>
    <div id="shopping"></div>
  </section>
  <details class="compared">
    <summary>All houses we compared</summary>
    ${priceTable(c.dates, c.status || "Booked")}
  </details>
  ${checkedAt}
</main>`;
    mountPlans(document.getElementById("plans"), { dayNames: weekdaysFrom(dateOf(c.dates).check_in), quiet: c.quiet_hours });
    mountShopping(document.getElementById("shopping"), { endpoint: trip.lists_url, getPeople, cents, esc });
    return;
  }

  app.innerHTML = `
<header class="hero-head">
  <p class="eyebrow">Trip plan</p>
  <h1>${esc(trip.title)}</h1>
  <p class="split-line">Per-person prices split between ${counterHTML()} people</p>
</header>
<main class="overview">
  <section>
    <h2>Weekend plan</h2>
    <div id="plans"></div>
  </section>
  <section>
    <h2>Houses &amp; prices</h2>
    ${priceTable(trip.recommended, "Recommended")}
  </section>
  ${checkedAt}
</main>`;
  mountPlans(document.getElementById("plans"), { dayNames: ["Fri", "Sat", "Sun", "Mon"] });
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
else overview();
await mountPitches(app);
