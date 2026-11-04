// Single-page app: picks a view from the URL and renders it from data/model.json.
// Pitches themselves come from the shared component in pitch.js.
import { SITE, cents, counterHTML, esc, skinSwitchHTML, ttl, getPeople, loadModel, money, mountPitches, pageLink } from "./pitch.js?v=3cbc17d8";
import { mountShopping } from "./lists.js?v=3cbc17d8";
import { mountPlans } from "./timeline.js?v=3cbc17d8";
import { mountCarpool } from "./carpool.js?v=3cbc17d8";
import { mountWeather } from "./weather.js?v=3cbc17d8";

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

// Every sub-page gets a single way back to the overview
function topbar() {
  return `<nav class="topbar"><a class="back" href="${SITE}">← Back to main page</a>${skinSwitchHTML()}</nav>`;
}

// ---------- overview ----------

// The trip name as a cut-out "calling card": every letter gets one of five looks (fixed pattern, so it
// never reshuffles); the highlight word is all signature color. The tagline sits under it.
function heroTitle() {
  const words = trip.title.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
  const hl = (trip.highlight || "").toLowerCase();
  let n = 0;
  const h1 = `<h1 class="hero-title" aria-label="${esc(trip.title)}">${words.map((w) => {
    const on = w.toLowerCase() === hl;
    return `<span class="w${on ? " hl" : ""}" aria-hidden="true">${[...w].map((ch) => {
      n += 1;
      return `<span class="l s${on ? "r" : (n * 3 + (n >> 2)) % 5}">${esc(ch)}</span>`;
    }).join("")}</span>`;
  }).join("")}</h1>`;
  return h1 + (trip.tagline ? `<p class="tagline"><span>${esc(trip.tagline)}</span></p>` : "");
}

// Countdown to check-in (days are counted in the trip's own calendar dates)
function countdown(d) {
  const today = new Date();
  const day = (iso) => Date.UTC(...iso.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const left = Math.round((day(d.check_in) - now) / 864e5);
  if (left > 1) return `${left} days remaining`;
  if (left === 1) return "1 day remaining";
  if (left === 0) return "Check-in today";
  return now < day(d.check_out) ? "On the trip" : now === day(d.check_out) ? "Check-out today" : "Trip complete";
}

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
const appleMapsURL = (address) => `https://maps.apple.com/?q=${encodeURIComponent(address)}`;

// Address with a copy button; map buttons open Apple Maps or Google Maps (the app on phones, the web otherwise)
const ARROW_ICON = `<svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>`;
const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const copyBtn = (text) => `<button type="button" class="copy-btn" data-copy="${esc(text)}" title="复制地址" aria-label="复制地址">${COPY_ICON}</button>`;
const mapButtons = (address) => `<div class="map-btns">
    <a class="btn ghost" href="${esc(appleMapsURL(address))}" target="_blank" rel="noopener">Apple 地图${ARROW_ICON}</a>
    <a class="btn ghost" href="${esc(mapsURL(address))}" target="_blank" rel="noopener">Google 地图${ARROW_ICON}</a>
  </div>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const text = b.dataset.copy;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  b.innerHTML = CHECK_ICON; b.classList.add("done"); b.title = "已复制";
  setTimeout(() => { b.innerHTML = COPY_ICON; b.classList.remove("done"); b.title = "复制地址"; }, 1500);
});

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
      <p class="where">${esc(c.address || l.location || l.city)}${c.address ? ` ${copyBtn(c.address)}` : ""}</p>
      <h2><a href="${details}">${esc(l.name)}</a></h2>
      <div class="io-row">
        ${inOut("Check-in", c.check_in, { day: d.long_label.split(" – ")[0], time: l.check_in_time ?? "" })}
        <span class="io-arrow" aria-hidden="true">→</span>
        ${inOut("Checkout", c.check_out, { day: d.long_label.split(" – ")[1], time: l.check_out_time ?? "" })}
      </div>
      <div class="paid">
        <div class="paid-head">
          <span class="paid-badge">✓ Paid in full</span>
          ${c.guests ? `<span class="paid-guests">${c.guests} guests</span>` : ""}
        </div>
        <div class="paid-total">${cents(paid)}</div>
        <div class="paid-split">
          <span><b data-split="${paid}" data-cents>${cents(paid / getPeople())}</b> / person</span>
          <span class="split-by">split between ${counterHTML()} people</span>
        </div>
      </div>
      <div class="booking-actions">
        <a class="btn" href="${details}">House details</a>
        ${c.receipt_url ? `<a class="btn ghost" href="${esc(c.receipt_url)}" target="_blank" rel="noopener">Receipt${ARROW_ICON}</a>` : ""}
      </div>
      ${c.address ? mapButtons(c.address) : ""}
    </div>
  </section>`;
}

const dur = (min) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
};

// Typical drive times (Google Maps typical traffic for the given departure); average = middle of the range.
// Shown as one card per trip (stops joined by legs, both LA starting points side by side),
// with the full table of ranges and Maps links folded underneath.
function driveTimes(c) {
  const routes = c.drive_times?.routes || [];
  if (!routes.length) return "";
  const find = (from, to) => routes.find((r) => r.from === from && r.to === to);
  const avg = (r) => (r.min + r.max) / 2;
  const origins = [...new Set(routes.filter((r) => r.to === "住宿" && r.from !== "Solvang").map((r) => r.from))];
  const short = (o) => (o === "Downtown LA" ? "DTLA" : o.replace(" Heights", ""));
  const mapsURL = (r) => `https://www.google.com/maps/dir/?${new URLSearchParams({ api: 1, origin: r.from_query, destination: r.to_query, travelmode: "driving" })}`;

  const stop = (name, cls = "") => `<div class="stop${cls ? ` ${cls}` : ""}"><b>${esc(name)}</b></div>`;
  // One leg. "LA" stands for every starting point (Rowland, DTLA), so legs to or from LA list one time each.
  const leg = (from, to) => {
    const legs = from === "LA" ? origins.map((o) => find(o, to))
      : to === "LA" ? origins.map((o) => find(from, o))
      : [find(from, to)];
    const shown = legs.filter(Boolean);
    if (!shown.length) return "";
    const many = from === "LA" || to === "LA";
    return `<div class="leg">
      <div class="leg-times">${shown.map((r) => `<span title="通常 ${dur(r.min)} – ${dur(r.max)} · ${r.miles} mi">
        ${many ? `<em>${esc(short(from === "LA" ? r.from : r.to))}</em>` : ""}<b>${dur(avg(r))}</b></span>`).join("")}</div>
      <div class="leg-line" aria-hidden="true"></div>
      <div class="leg-mi">${shown.map((r) => `${r.miles} mi`).join(" / ")}</div>
    </div>`;
  };
  const HOME = "住宿";
  const label = (s) => (s === HOME ? "海边小屋" : s);
  // A full loop: LA → … → LA, every stop and the drive between each pair
  const loop = (stops) => `<article class="trip-card">
      <h3>${stops.map((s) => esc(label(s))).join(" → ")}</h3>
      <div class="trip">${stops.map((s, k) => (k ? leg(stops[k - 1], s) : "") + stop(label(s), s === HOME ? "home" : "")).join("")}</div>
    </article>`;
  const cards = [loop(["LA", "Solvang", HOME, "LA"]), loop(["LA", HOME, "Solvang", "LA"])];

  const rows = routes.map((r) => `<tr>
      <th scope="row">${esc(label(r.from))} <span class="arrow">→</span> ${esc(label(r.to))}</th>
      <td class="muted">${esc(r.depart)}</td>
      <td class="avg">${dur(avg(r))}</td>
      <td class="muted">${dur(r.min)} – ${dur(r.max)}</td>
      <td class="muted">${r.miles} mi</td>
      <td><a href="${esc(mapsURL(r))}" target="_blank" rel="noopener">Maps${ARROW_ICON}</a></td>
    </tr>`).join("");

  return `<section>
    ${ttl("车程", "Drive")}
    <div class="trip-grid">${cards.join("")}</div>
    <details class="drive-all">
      <summary>全部路线明细</summary>
      <div class="table-wrap"><table class="drive">
        <thead><tr><th>路线</th><th>出发</th><th>平均</th><th>通常</th><th>里程</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>
  </section>`;
}

// Straight-line miles between two points
function miles(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

// Places by kind, shortest drive first. Each row: name (+ host pick), rating · kind · city, and on the
// right the average drive time · road miles from the house. Long lists show the closest few and fold the rest.
const SHOW = 6;
function placeCards(groups, home) {
  const mins = (p) => (p.walk ? 0 : p.drive ? (p.drive.min + p.drive.max) / 2 : 999);
  const row = (p) => {
    const maps = `https://www.google.com/maps/search/?${new URLSearchParams({ api: 1, query: `${p.name}, ${p.address ? `${p.address}, ` : ""}${p.city}, CA` })}`;
    const dist = p.walk ? `<span class="near-time walk">步行可到</span>`
      : p.drive ? `<span class="near-time">${Math.round(mins(p))} min <span>· ${p.drive.miles} mi</span></span>`
      : `<span class="near-time"><span>≈ ${miles(home.lat, home.lng, p.lat, p.lng).toFixed(1)} mi</span></span>`;
    const meta = [
      p.rating ? `<span class="near-star">★ ${Number(p.rating).toFixed(1)}</span> <span class="muted">(${p.reviews.toLocaleString("en-US")})</span>` : "",
      p.tag ? `<span class="muted">${esc(p.tag)}</span>` : "",
      `<span class="muted">${esc(p.city)}</span>`,
    ].filter(Boolean).join(" · ") + (p.rain ? ` <span class="pick rain">雨天可去</span>` : "") + (p.host ? ` <span class="pick">房东推荐</span>` : "");
    return `<li>
      <div class="near-top"><a href="${esc(maps)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b></a>${dist}</div>
      <div class="near-meta">${meta}</div>
    </li>`;
  };
  return groups.map((g) => {
    const items = [...g.items].sort((a, b) => mins(a) - mins(b));
    const more = items.slice(SHOW);
    return `<article class="near-card">
      <h3>${esc(g.title)} <span class="muted">${items.length}</span></h3>
      <ul>${items.slice(0, SHOW).map(row).join("")}</ul>
      ${more.length ? `<ul class="near-extra" hidden>${more.map(row).join("")}</ul>
      <button type="button" class="near-toggle" data-count="${more.length}" aria-expanded="false">再显示 ${more.length} 个</button>` : ""}
    </article>`;
  }).join("");
}

// The fold button stays at the bottom of its card: 再显示 N 个 ↔ 收起
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".near-toggle");
  if (!btn) return;
  const extra = btn.previousElementSibling;
  const open = extra.hidden;
  extra.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = open ? "收起" : `再显示 ${btn.dataset.count} 个`;
  if (!open) btn.closest(".near-card").scrollIntoView({ block: "nearest" });
});

// 拼车: overall status plus the cars that are already settled, each with who rides along
function carpool(c) {
  const cp = c.carpool;
  if (!cp) return "";
  return `<section id="carpool">
    <div class="ttl-row">${ttl("拼车", "Carpool")}${cp.status ? `<span class="pool-status">${esc(cp.status)}</span>` : ""}</div>
    <div id="pool"></div>
  </section>`;
}

// Section nav follows the scroll: the link for the section under the sticky nav gets .active,
// and on phones the nav scrolls sideways to keep that link in view
function followNav() {
  const nav = document.querySelector(".secnav");
  if (!nav) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const targets = links.map((a) => document.getElementById(a.getAttribute("href").slice(1)));
  let current = null;
  const update = () => {
    const line = nav.getBoundingClientRect().bottom + 24;
    let k = -1;
    targets.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= line) k = i; });
    // At the very bottom, the last section counts even if its top never reached the line
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) k = targets.length - 1;
    const link = links[k] || null;
    if (link === current) return;
    current?.classList.remove("active"); current?.removeAttribute("aria-current");
    current = link;
    if (!link) return;
    link.classList.add("active"); link.setAttribute("aria-current", "true");
    const l = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft, r = l + link.offsetWidth;
    if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: l - 16, behavior: "smooth" });
  };
  let queued = false;
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }, { passive: true });
  window.addEventListener("resize", update);
  update();
}

function nearby(c, key, zh, en) {
  const groups = c.nearby?.[key] || [];
  const home = listings[c.id];
  if (!groups.length || !home?.lat) return "";
  return `<section id="${key === "shops" ? "where" : "around"}">
    ${ttl(zh, en)}
    <div class="near-grid">${placeCards(groups, home)}</div>
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
      <h3>到达</h3>
      <div class="addr"><b>${esc(c.address)} ${copyBtn(c.address)}</b>${mapButtons(c.address)}</div>
      ${[c.parking, c.ev_charging].filter(Boolean).map((x) => `<div class="extra"><b>${esc(x.title)}</b>${x.facts.map((f) => `<span>${esc(f)}</span>`).join("")}
        <em>${x.contact ? `${esc(x.note)}：打电话或短信 ${esc(x.contact.name)} <a href="tel:${esc(x.contact.phone.replace(/\D/g, ""))}">${esc(x.contact.phone)}</a>` : esc(x.note)}</em></div>`).join("")}
      ${routes ? `<details class="directions">
        <summary>For the senior who still doesn't trust GPS</summary>
        <div class="routes">${routes}</div>
        ${c.directions_note ? `<p class="muted small">${esc(c.directions_note)}</p>` : ""}
      </details>` : ""}
    </article>`);
  }
  if (c.check_in_method) {
    const io = (label, x) => x ? `<div class="ci-time"><span>${label}</span><b>${esc(x.day)}</b><em>${esc(x.time)}</em></div>` : "";
    cards.push(`<article class="info-card">
      <h3>入住</h3>
      <div class="ci-times">${io("Check-in", c.check_in)}${io("Checkout", c.check_out)}</div>
      <p>${esc(c.check_in_method)}</p>
      ${c.confirmation_code ? `<p class="code">Confirmation code <b>${esc(c.confirmation_code)}</b></p>` : ""}
      ${c.host_note ? `<p class="host-note">${esc(c.host_note.note)}${c.host_note.guidebook_url ? ` · <a href="${esc(c.host_note.guidebook_url)}" target="_blank" rel="noopener">房东的周边指南 ↗</a>` : ""}</p>` : ""}
    </article>`);
  }
  if (c.contacts?.length) {
    cards.push(`<article class="info-card">
      <h3>联系人</h3>
      <ul class="contacts">${c.contacts.map((p) => `<li>
        <div><b>${esc(p.role)}</b>${p.name ? ` <span>${esc(p.name)}</span>` : ""}${p.note ? `<em>${esc(p.note)}</em>` : ""}</div>
        <a class="tel" href="tel:${esc(p.phone.replace(/\D/g, ""))}">${esc(p.phone)}</a>
      </li>`).join("")}</ul>
    </article>`);
  }
  if (c.house_rules?.length) {
    cards.push(`<article class="info-card">
      <h3>房屋规则</h3>
      <ul class="rules">${c.house_rules.map((r) => `<li${/quiet hours/i.test(r) ? ' class="hl"' : ""}>${esc(r)}</li>`).join("")}</ul>
    </article>`);
  }
  if (c.checkout_steps?.length) {
    cards.push(`<article class="info-card">
      <h3>退房 <span class="muted">${c.check_out ? `${esc(c.check_out.day)} ${esc(c.check_out.time)}` : ""}</span></h3>
      <ol class="steps">${c.checkout_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </article>`);
  }
  if (c.cancellation?.length) {
    cards.push(`<article class="info-card">
      <h3>取消政策</h3>
      <ol class="cancel">${c.cancellation.map((x) => `<li>
        <span class="when">${esc(x.when)}</span><b>${esc(x.result)}</b><span class="muted">${esc(x.detail)}</span>
      </li>`).join("")}</ol>
      ${c.cancellation_note ? `<p class="muted small">${esc(c.cancellation_note)}</p>` : ""}
    </article>`);
  }
  return cards.length ? `<section id="stay">${ttl("入住须知", "Stay")}<div class="info-grid">${cards.join("")}</div></section>` : "";
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
  document.title = trip.title;

  if (c) {
    app.innerHTML = `
<header class="hero-head">
  ${skinSwitchHTML()}
  <p class="eyebrow">Trip plan</p>
  ${heroTitle()}
  <div class="status">
    <span class="status-ok">✓ ${esc(c.status || "Booked")}</span>
    <span class="status-code">${esc(countdown(dateOf(c.dates)))}</span>
  </div>
</header>
<nav class="secnav" aria-label="Sections">
  <a href="#weather-sec">天气</a><a href="#plan">行程</a><a href="#carpool">拼车</a><a href="#stay">入住须知</a><a href="#shop">采购</a><a href="#around">周边</a>
</nav>
<main class="overview">
  ${bookingCard(c)}
  <section id="weather-sec">
    ${ttl("天气预报", "Weather")}
    <div id="weather"></div>
  </section>
  <section id="plan">
    ${ttl("确认行程", "Plan")}
    <div id="plans"></div>
  </section>
  ${driveTimes(c)}
  ${carpool(c)}
  ${reservationDetails(c)}
  <section id="shop">
    ${ttl("采购清单", "Shopping")}
    <div id="shopping"></div>
  </section>
  ${nearby(c, "groups", "海边小屋周边", "Around")}
</main>`;
    const home = listings[c.id], stay = dateOf(c.dates);
    mountWeather(document.getElementById("weather"), { lat: home.lat, lng: home.lng, start: stay.check_in, end: stay.check_out, esc });
    if (c.carpool) mountCarpool(document.getElementById("pool"), { endpoint: trip.lists_url, seed: c.carpool.cars, esc });
    followNav();
    mountPlans(document.getElementById("plans"), { dayNames: weekdaysFrom(dateOf(c.dates).check_in), quiet: c.quiet_hours });
    mountShopping(document.getElementById("shopping"), { endpoint: trip.lists_url, getPeople, cents, esc });
    return;
  }

  app.innerHTML = `
<header class="hero-head">
  ${skinSwitchHTML()}
  <p class="eyebrow">Trip plan</p>
  ${heroTitle()}
  <p class="split-line">Per-person prices split between ${counterHTML()} people</p>
</header>
<main class="overview">
  <section>
    ${ttl("周末行程", "Plan")}
    <div id="plans"></div>
  </section>
  <section>
    ${ttl("房子与价格", "Houses")}
    ${priceTable(trip.recommended, "Recommended")}
  </section>
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
<main class="single"><div data-pitch="${id}" data-dates="${key}" data-full></div></main>`;
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
