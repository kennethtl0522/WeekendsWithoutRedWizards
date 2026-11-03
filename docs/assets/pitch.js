// Pitch component: one house on one date range, rendered from data/model.json.
//
// Drop it into any page:
//   <div data-pitch="1040827055809906305" data-dates="2026-11-14_2026-11-16"></div>
//   <script type="module" src="assets/pitch.js"></script>
//
// Rows: 1 gallery · 2 name, dates, split price · 3 the space | highlights ·
// 4 summary · 5 other dates + Airbnb link.
// The block adapts to its container width (CSS container queries), so the same
// markup works full-page or as a scrollable block on the date page.

export const SITE = new URL("../", import.meta.url);

let modelPromise;
export function loadModel() {
  // "no-cache" revalidates with the server each load, so new prices/photos show right after a push
  modelPromise ??= fetch(new URL("data/model.json", SITE), { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`data/model.json: HTTP ${r.status}`);
    return r.json();
  });
  return modelPromise;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
// Exact amounts (what was actually paid / owed), e.g. $2,481.75
export const cents = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pageLink = (params) => `${SITE}?${new URLSearchParams(params)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- people counter (shared by every block on the page, remembered per browser) ----------

const PEOPLE_KEY = "airbnb-pitch:people";
const DEFAULT_PEOPLE = 8;
let people = DEFAULT_PEOPLE;
try { people = parseInt(localStorage.getItem(PEOPLE_KEY), 10) || DEFAULT_PEOPLE; } catch {}

export const getPeople = () => people;

export function setPeople(n) {
  people = Math.min(30, Math.max(1, n));
  try { localStorage.setItem(PEOPLE_KEY, String(people)); } catch {}
  refreshPeople();
  document.dispatchEvent(new CustomEvent("people-change", { detail: people }));
}

export const counterHTML = () => `<span class="counter">
  <button type="button" data-people="-1" aria-label="Fewer people">−</button>
  <output class="people-n">${people}</output>
  <button type="button" data-people="1" aria-label="More people">+</button>
</span>`;

function airbnbURL(link, checkIn, checkOut) {
  return `${link}?${new URLSearchParams({ check_in: checkIn, check_out: checkOut, adults: people })}`;
}

// Update everything that depends on the head count without re-rendering the blocks
function refreshPeople(root = document) {
  root.querySelectorAll(".people-n").forEach((el) => { el.textContent = people; });
  root.querySelectorAll("[data-split]").forEach((el) => {
    el.textContent = ("cents" in el.dataset ? cents : money)(el.dataset.split / people);
  });
  root.querySelectorAll("[data-cap]").forEach((el) => { el.hidden = people <= Number(el.dataset.cap); });
  root.querySelectorAll("a[data-airbnb]").forEach((a) => {
    const [link, ci, co] = a.dataset.airbnb.split("|");
    a.href = airbnbURL(link, ci, co);
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-people]");
  if (btn) setPeople(people + Number(btn.dataset.people));
});

// ---------- block ----------

function photo(l, i, label, cls = "") {
  const f = l.photos[i];
  const src = f && (/^https?:/.test(f) ? f : `${SITE}images/${l.id}/${encodeURIComponent(f)}`);
  return `<div class="ph ${cls}"><span>${label}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ""}</div>`;
}

const fact = (label, value) => `<div class="fact"><span>${label}</span><b>${value}</b></div>`;

export function pitchHTML(model, id, key) {
  const l = model.listings[id];
  const s = model.stays[key]?.[id];
  const d = model.dates.find((x) => x.key === key);
  if (!l || !s || !d) return `<p class="callout">No price for this house on these dates.</p>`;

  const tags = [
    l.note && `<li class="tag-note">“${esc(l.note)}”</li>`,
    l.guest_favorite && `<li class="tag-gold">Guest favorite</li>`,
    l.superhost && `<li>Superhost</li>`,
    ...l.highlights.map((h) => `<li>${esc(h)}</li>`),
  ].filter(Boolean).join("");

  const sleeping = l.sleeping.length
    ? l.sleeping.map((r) => `<li><b>${esc(r.title)}</b> ${esc(r.beds)}</li>`).join("")
    : `<li class="muted">Bed details not listed by host</li>`;

  const desc = l.description;
  const short = desc.length > 320 ? desc.slice(0, 320).replace(/\s+\S*$/, "") + "…" : desc;
  const summary = desc.length > 320
    ? `<details><summary>${esc(short)}</summary><p>${esc(desc)}</p></details>`
    : `<p>${esc(desc)}</p>`;

  const others = model.dates
    .filter((x) => x.key !== key && model.stays[x.key]?.[id])
    .map((x) => {
      const o = model.stays[x.key][id];
      return `<a href="${pageLink({ dates: x.key, id })}">${esc(x.long_label)} · <span data-split="${o.total}">${money(o.total / people)}</span>/person</a>`;
    });

  const gallery = [photo(l, 0, "Photo 1", "hero"), ...[1, 2, 3, 4].map((i) => photo(l, i, `Photo ${i + 1}`))].join("");

  return `<article class="pitch">
  <div class="gallery">${gallery}</div>
  <div class="pitch-body">
    <header class="pitch-top">
      <div class="pitch-title">
        <p class="where">${esc(l.location || l.city)}${l.area !== l.city ? ` <span>· ${esc(l.area)}</span>` : ""}</p>
        <h2>${esc(l.name)}</h2>
        <p class="when">${esc(d.long_label)}</p>
      </div>
      <div class="price">
        <div class="split">
          <span class="pp" data-split="${s.total}">${money(s.total / people)}</span>
          <span class="per">/ person</span>
        </div>
        <div class="split-by">Split between ${counterHTML()} people</div>
        <p class="cap-warn" data-cap="${l.capacity ?? 99}"${people <= (l.capacity ?? 99) ? " hidden" : ""}>Fits ${l.capacity} max</p>
        <div class="total">${s.was ? `<s>${money(s.was)}</s> ` : ""}<b>${money(s.total)}</b> total · ${money(s.per_night)} / night</div>
      </div>
    </header>

    <div class="pitch-cols">
      <section>
        <h3>The space</h3>
        <div class="facts">
          ${fact("Beds", l.beds ?? "?")}${fact("Bedrooms", l.bedrooms ?? "?")}${fact("Baths", l.baths ?? "?")}
        </div>
        <ul class="plain beds">${sleeping}</ul>
      </section>
      <section>
        <h3>Highlights</h3>
        <p class="rating"><b>★ ${l.rating ?? "–"}</b> <span class="muted">${plural(l.reviews, "review")}</span></p>
        <ul class="chips">${tags}</ul>
        <div class="facts two">
          ${fact("Check-in", esc(l.check_in_time ?? "–"))}${fact("Check-out", esc(l.check_out_time ?? "–"))}
        </div>
      </section>
    </div>

    <section>
      <h3>Summary</h3>
      ${summary}
    </section>

    <footer class="pitch-foot">
      <div class="other-dates">
        <span class="muted">Other dates</span>
        ${others.join("") || `<span class="muted">none available</span>`}
      </div>
      <a class="btn" data-airbnb="${esc(`${l.link}|${d.check_in}|${d.check_out}`)}"
         href="${esc(airbnbURL(l.link, d.check_in, d.check_out))}" target="_blank" rel="noopener">View on Airbnb ↗</a>
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
