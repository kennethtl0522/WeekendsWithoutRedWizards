// Pitch component: one house on one date range, rendered from data/model.json.
//
// Drop it into any page:
//   <div data-pitch="1040827055809906305" data-dates="2026-11-14_2026-11-16"></div>
//   <script type="module" src="assets/pitch.js"></script>
//
// The block adapts to its container width (CSS container queries), so the same
// markup works full-page, as a scrollable list card, or as a compare column.

export const SITE = new URL("../", import.meta.url);

let modelPromise;
export function loadModel() {
  modelPromise ??= fetch(new URL("data/model.json", SITE)).then((r) => {
    if (!r.ok) throw new Error(`data/model.json: HTTP ${r.status}`);
    return r.json();
  });
  return modelPromise;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
export const pageLink = (params) => `${SITE}?${new URLSearchParams(params)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function photo(l, i, label, cls = "") {
  const f = l.photos[i];
  const src = f && (/^https?:/.test(f) ? f : `${SITE}images/${l.id}/${encodeURIComponent(f)}`);
  return `<div class="ph ${cls}"><span>${label}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ""}</div>`;
}

const list = (items, empty, cls = "plain") =>
  `<ul class="${cls}">${items.length ? items.map((x) => `<li>${x}</li>`).join("") : `<li class="muted">${empty}</li>`}</ul>`;

export function pitchHTML(model, id, key) {
  const l = model.listings[id];
  const s = model.stays[key]?.[id];
  const d = model.dates.find((x) => x.key === key);
  if (!l || !s || !d) return `<p class="callout">No price for this house on these dates.</p>`;

  const badges = [`<span class="badge">${esc(l.area)}</span>`];
  if (l.guest_favorite) badges.push(`<span class="badge gold">Guest favorite</span>`);
  if (l.superhost) badges.push(`<span class="badge">Superhost</span>`);

  const facts = [
    ["Guests", `${d.guests} <small>of ${l.capacity ?? "?"}</small>`],
    ["Bedrooms", l.bedrooms ?? "?"],
    ["Beds", l.beds ?? "?"],
    ["Baths", l.baths ?? "?"],
    ["Rating", `★ ${l.rating ?? "–"} <small>(${l.reviews})</small>`],
    ["Check-in / out", `${esc(l.check_in_time ?? "–")}<br><small>out ${esc(l.check_out_time ?? "–")}</small>`],
  ].map(([k, v]) => `<div class="fact"><span>${k}</span><b>${v}</b></div>`).join("");

  const sleeping = l.sleeping.map((r) => `<b>${esc(r.title)}</b> ${esc(r.beds)}`);
  const desc = l.description;
  const short = desc.length > 260 ? desc.slice(0, 260).replace(/\s+\S*$/, "") + "…" : desc;
  const about = desc.length > 260
    ? `<details><summary>${esc(short)}</summary><p>${esc(desc)}</p></details>`
    : `<p>${esc(desc)}</p>`;

  const others = model.dates
    .filter((x) => x.key !== key && model.stays[x.key]?.[id])
    .map((x) => `<a href="${pageLink({ dates: x.key, id })}">${esc(x.label)} · ${money(model.stays[x.key][id].per_person)}/person</a>`);

  const gallery = [1, 2, 3, 4].map((i) => photo(l, i, `Photo ${i + 1}`)).join("");
  const airbnb = `${l.link}?${new URLSearchParams({ check_in: d.check_in, check_out: d.check_out, adults: d.guests })}`;

  return `<article class="pitch">
  <div class="pitch-hero">${photo(l, 0, "Hero photo", "hero")}
    <div class="badges">${badges.join("")}</div>
  </div>
  <div class="pitch-body">
    <header class="pitch-top">
      <div>
        <p class="eyebrow">${esc(l.city)} · ${esc(l.property_type)}</p>
        <h2>${esc(l.name)}</h2>
        ${l.note ? `<p class="note">“${esc(l.note)}”</p>` : ""}
      </div>
      <div class="price">
        <span><span class="pp">${money(s.per_person)}</span><span class="per">/ person</span></span>
        <span class="total">${s.was ? `<s>${money(s.was)}</s> ` : ""}${money(s.total)} total · ${money(s.per_night)}/night</span>
        <span class="when">${esc(d.long_label)} · ${plural(d.nights, "night")}</span>
      </div>
    </header>
    <div class="facts">${facts}</div>
    <div class="pitch-cols">
      <section><h3>Why this one</h3>${list(l.highlights.map(esc), "Nothing special listed", "chips")}</section>
      <section><h3>Sleeping</h3>${list(sleeping, `Not listed by host: ${l.beds ?? "?"} beds in total`)}</section>
    </div>
    <div class="gallery">${gallery}</div>
    <div class="pitch-cols">
      <section><h3>House rules</h3>${list(l.rules.map(esc), "None listed")}</section>
      <section class="watch"><h3>Watch out</h3>${list(l.watch.map(esc), "Nothing flagged")}</section>
    </div>
    <section><h3>About</h3>${about}</section>
    <section><h3>Other dates</h3><div class="other-dates">${others.join("") || `<span class="muted">No other requested dates available</span>`}</div></section>
    <footer class="pitch-foot">
      <a class="btn" href="${esc(airbnb)}" target="_blank" rel="noopener">View on Airbnb ↗</a>
      <span class="muted">Price before taxes &amp; service fees</span>
    </footer>
  </div>
</article>`;
}

// Fill every <div data-pitch data-dates> under root that isn't rendered yet.
export async function mountPitches(root = document) {
  const els = [...root.querySelectorAll("[data-pitch]:not([data-mounted])")];
  if (!els.length) return;
  try {
    const model = await loadModel();
    for (const el of els) {
      el.innerHTML = pitchHTML(model, el.dataset.pitch, el.dataset.dates);
      el.dataset.mounted = "";
    }
  } catch (err) {
    for (const el of els) el.innerHTML = `<p class="callout">Couldn't load house data (${esc(err.message)}).</p>`;
  }
}

mountPitches();
