"""
Build the static pitch site from raw API logs.

Reads every raw/run_*.json (newest wins per listing + dates), notes from
inputs.csv, and photos from docs/images/<listing_id>/, then writes:

    docs/index.html                          overview plan
    docs/<check_in>_<check_out>/index.html   list + side-by-side compare for those dates
    docs/<check_in>_<check_out>/<id>.html    one-page pitch per listing

docs/assets/ (CSS/JS) and docs/images/ are left untouched.

Run:
    uv run build_site.py
"""
import csv
import json
import re
import shutil
from datetime import date
from html import escape
from pathlib import Path

from main import house_rule_times, listing_id

TRIP_TITLE = "Beach House Weekend"
ROOT = Path(__file__).parent
RAW = ROOT / "raw"
DOCS = ROOT / "docs"
IMAGES = DOCS / "images"
PHOTO_SLOTS = 5  # 1 hero + 4 gallery
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}

# City -> broader area, so the group sees which houses are near each other
AREAS = {
    "Grover Beach": "Pismo / Five Cities", "Oceano": "Pismo / Five Cities",
    "Arroyo Grande": "Pismo / Five Cities", "Pismo Beach": "Pismo / Five Cities",
    "Shell Beach": "Pismo / Five Cities", "Nipomo": "Pismo / Five Cities",
    "Santa Barbara": "Santa Barbara", "Summerland": "Santa Barbara",
    "Montecito": "Santa Barbara", "Carpinteria": "Santa Barbara", "Goleta": "Santa Barbara",
    "Lompoc": "Lompoc",
}

HIGHLIGHT_KEYS = [
    "hot tub", "pool", "ocean view", "sea view", "beach view", "beach access", "waterfront",
    "game console", "pool table", "ping pong", "arcade", "foosball", "fire pit", "fireplace",
    "bbq grill", "air conditioning", "ev charger", "parking garage", "free parking on premises",
]
SKIP_RULES = {"during the stay", "before checkout"}
WATCH_KEYS = ("camera", "stairs", "without a gate", "shared", "body of water", "noise",
              "live on property", "weapon", "dangerous", "no carbon", "no smoke")

money = "${:,.0f}".format


# ---------- data ----------

def load_data():
    latest, requested = {}, {}
    for f in sorted(RAW.glob("run_*.json")):
        for e in json.loads(f.read_text()):
            p = e["params"]
            key = (p["checkin"], p["checkout"])
            requested[key] = int(p.get("adults") or 2)
            if isinstance(e.get("response"), dict) and e["response"].get("id"):
                latest[(str(p["query"]), *key)] = e
    stays, listings = {}, {}
    for (lid, ci, co), e in latest.items():
        d = e["response"]
        listings[lid] = d
        if d.get("price"):
            stays.setdefault((ci, co), []).append(e)
    return stays, listings, requested


def load_notes():
    notes = {}
    path = ROOT / "inputs.csv"
    if path.exists():
        for r in csv.DictReader(path.open(newline="")):
            if r.get("note", "").strip():
                notes[listing_id(r["listing"])] = r["note"].strip()
    return notes


def photos(lid):
    folder = IMAGES / lid
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def city(d):
    return ((d.get("location") or {}).get("name") or "").split(",")[0].strip()


def area(d):
    return AREAS.get(city(d), city(d) or "Other")


def amenities(d):
    return [i["title"] for g in d.get("amenities") or [] for i in g.get("items", [])
            if i.get("is_available")]


def highlights(d):
    out = []
    for key in HIGHLIGHT_KEYS:
        for a in amenities(d):
            low = a.lower()
            if key in low and a not in out and not (key == "pool" and "table" in low):
                out.append(a)
    return out[:10]


def rules(d):
    out = []
    for s in d.get("house_rules") or []:
        for item in s.get("items", []):
            text = item.replace(" ", " ")
            if text.lower() in SKIP_RULES or re.match(r"check[- ]?(in|out)\b.*\d", text, re.I):
                continue
            out.append(text)
    return out


def watch_outs(d, guests):
    out = [s for s in d.get("safety_and_property") or [] if any(k in s.lower() for k in WATCH_KEYS)]
    reviews = d.get("reviews_count") or 0
    if reviews < 10:
        out.append(f"Only {reviews} review{'s' * (reviews != 1)} so far")
    beds = d.get("beds") or 0
    if beds and beds < guests:
        out.append(f"{beds} beds for {guests} guests: some will share")
    baths = d.get("bathrooms") or 0
    if baths and guests / baths > 3:
        out.append(f"Only {baths:g} baths for {guests} guests")
    cap = d.get("person_capacity") or 0
    if cap and cap - guests <= 1:
        out.append(f"Fits {cap} max")
    t = house_rule_times(d.get("house_rules"))
    if re.match(r"(9|10)(:\d\d)?\s*AM", t.get("check_out_time", "")):
        out.append(f"Early check-out ({t['check_out_time']})")
    if m := re.search(r"(\d+)\s*(?:BR|bedroom)", d.get("name", ""), re.I):
        if d.get("bedrooms") and int(m.group(1)) != d["bedrooms"]:
            out.append(f"Title says {m.group(1)} bedrooms, listing shows {d['bedrooms']}")
    return out


def folder(ci, co):
    return f"{ci}_{co}"


def nights(ci, co):
    return (date.fromisoformat(co) - date.fromisoformat(ci)).days


def date_label(ci, co, long=False):
    a, b = date.fromisoformat(ci), date.fromisoformat(co)
    if long:
        return f"{a:%a %b} {a.day} – {b:%a %b} {b.day}"
    return f"{a:%b} {a.day}–{b.day}" if a.month == b.month else f"{a:%b} {a.day} – {b:%b} {b.day}"


# ---------- html pieces ----------

def page(title, body, depth, extra_head=""):
    up = "../" * depth
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title>
<link rel="stylesheet" href="{up}assets/style.css">
{extra_head}</head>
<body>
{body}
</body>
</html>
"""


def photo_slot(lid, files, i, label, cls=""):
    img = (f'<img src="../images/{lid}/{escape(files[i])}" alt="" loading="lazy">'
           if i < len(files) else "")
    return f'<div class="ph {cls}"><span>{label}</span>{img}</div>'


def pitch(entry, ctx):
    """One listing for one date range. Self-contained: works full-page, in a list, or a compare column."""
    d, p = entry["response"], entry["params"]
    lid, ci, co = d["id"], p["checkin"], p["checkout"]
    guests = int(p.get("adults") or 2)
    price = d["price"]
    n = nights(ci, co)
    files = photos(lid)
    times = house_rule_times(d.get("house_rules"))
    note = ctx["notes"].get(lid)

    badges = [f'<span class="badge">{escape(area(d))}</span>']
    if d.get("is_guest_favorite"):
        badges.append('<span class="badge gold">Guest favorite</span>')
    if (d.get("host") or {}).get("is_superhost"):
        badges.append('<span class="badge">Superhost</span>')

    # original_amount is unreliable on its own; only show a "was" price when the breakdown has a discount
    breakdown = price.get("breakdown") or []
    discounts = [b for b in breakdown if (b.get("amount") or 0) < 0]
    was = f'<s>{money(breakdown[0]["amount"])}</s> ' if discounts else ""

    facts = [
        ("Guests", f"{guests} <small>of {d.get('person_capacity', '?')}</small>"),
        ("Bedrooms", d.get("bedrooms", "?")),
        ("Beds", d.get("beds", "?")),
        ("Baths", f"{d.get('bathrooms', 0):g}"),
        ("Rating", f"★ {d.get('rating') or '–'} <small>({d.get('reviews_count') or 0})</small>"),
        ("Check-in / out", f"{escape(times.get('check_in_time', '–'))}<br><small>out {escape(times.get('check_out_time', '–'))}</small>"),
    ]
    facts_html = "".join(f'<div class="fact"><span>{k}</span><b>{v}</b></div>' for k, v in facts)

    sleep = d.get("sleeping_arrangement") or []
    sleep_html = ("".join(f"<li><b>{escape(s['title'])}</b> {escape(s.get('subtitle') or '')}</li>" for s in sleep)
                  or f"<li class='muted'>Not listed by host: {d.get('beds', '?')} beds in total</li>")

    hl = highlights(d)
    hl_html = "".join(f'<li>{escape(h)}</li>' for h in hl) or "<li class='muted'>Nothing special listed</li>"
    rules_html = "".join(f"<li>{escape(r)}</li>" for r in rules(d))
    watch = watch_outs(d, guests)
    watch_html = ("".join(f"<li>{escape(w)}</li>" for w in watch)
                  or "<li class='muted'>Nothing flagged</li>")

    desc = (d.get("description") or "").strip()
    short = desc[:260].rsplit(" ", 1)[0] + "…" if len(desc) > 260 else desc
    about = (f'<details><summary>{escape(short)}</summary><p>{escape(desc)}</p></details>'
             if len(desc) > 260 else f"<p>{escape(desc)}</p>")

    others = [(k, e) for k, e in ctx["by_listing"].get(lid, []) if k != (ci, co)]
    other_html = "".join(
        f'<a href="../{folder(*k)}/{lid}.html">{date_label(*k)} · {money(e["response"]["price"]["amount"] / guests)}/person</a>'
        for k, e in others) or "<span class='muted'>No other requested dates available</span>"

    gallery = "".join(photo_slot(lid, files, i, f"Photo {i + 1}") for i in range(1, PHOTO_SLOTS))

    return f"""<article class="pitch" id="p-{lid}">
  <div class="pitch-hero">{photo_slot(lid, files, 0, "Hero photo", "hero")}
    <div class="badges">{''.join(badges)}</div>
  </div>
  <div class="pitch-body">
    <header class="pitch-top">
      <div>
        <p class="eyebrow">{escape(city(d))} · {escape(d.get('property_type') or '')}</p>
        <h2>{escape(d['name'])}</h2>
        {f'<p class="note">“{escape(note)}”</p>' if note else ''}
      </div>
      <div class="price">
        <span><span class="pp">{money(price['amount'] / guests)}</span><span class="per">/ person</span></span>
        <span class="total">{was}{money(price['amount'])} total · {money(price['amount'] / n)}/night</span>
        <span class="when">{date_label(ci, co, long=True)} · {n} night{'s' * (n != 1)}</span>
      </div>
    </header>
    <div class="facts">{facts_html}</div>
    <div class="pitch-cols">
      <section><h3>Why this one</h3><ul class="chips">{hl_html}</ul></section>
      <section><h3>Sleeping</h3><ul class="plain">{sleep_html}</ul></section>
    </div>
    <div class="gallery">{gallery}</div>
    <div class="pitch-cols">
      <section><h3>House rules</h3><ul class="plain">{rules_html}</ul></section>
      <section class="watch"><h3>Watch out</h3><ul class="plain">{watch_html}</ul></section>
    </div>
    <section><h3>About</h3>{about}</section>
    <section><h3>Other dates</h3><div class="other-dates">{other_html}</div></section>
    <footer class="pitch-foot">
      <a class="btn" href="{escape(d.get('link') or f'https://www.airbnb.com/rooms/{lid}')}?check_in={ci}&amp;check_out={co}&amp;adults={guests}" target="_blank" rel="noopener">View on Airbnb ↗</a>
      <span class="muted">Price before taxes &amp; service fees</span>
    </footer>
  </div>
</article>"""


def topbar(crumbs, depth):
    up = "../" * depth
    parts = [f'<a href="{up}index.html">{escape(TRIP_TITLE)}</a>'] + crumbs
    return f'<nav class="topbar">{" <span>/</span> ".join(parts)}</nav>'


# ---------- pages ----------

def build_pitch_page(entry, ctx):
    d, p = entry["response"], entry["params"]
    ci, co = p["checkin"], p["checkout"]
    crumbs = [f'<a href="index.html">{date_label(ci, co)}</a>', escape(d["name"])]
    body = f"""{topbar(crumbs, 1)}
<main class="single">{pitch(entry, ctx)}</main>"""
    return page(f"{d['name']} · {date_label(ci, co)}", body, 1)


def build_date_page(key, entries, ctx):
    ci, co = key
    guests = int(entries[0]["params"].get("adults") or 2)
    entries = sorted(entries, key=lambda e: e["response"]["price"]["amount"])
    areas = sorted({area(e["response"]) for e in entries})
    area_opts = "".join(f'<option value="{escape(a)}">{escape(a)}</option>' for a in areas)

    slots = []
    for e in entries:
        d = e["response"]
        slots.append(f"""<div class="slot" data-id="{d['id']}" data-pp="{d['price']['amount'] / guests:.2f}"
     data-rating="{d.get('rating') or 0}" data-baths="{d.get('bathrooms') or 0}" data-beds="{d.get('beds') or 0}"
     data-area="{escape(area(d))}">
  <div class="slot-bar">
    <label><input type="checkbox" class="pick"> Compare</label>
    <a href="{d['id']}.html">Full page ↗</a>
  </div>
  <div class="scroll">{pitch(e, ctx)}</div>
</div>""")

    body = f"""{topbar([date_label(ci, co)], 1)}
<header class="date-head">
  <h1>{date_label(ci, co, long=True)}</h1>
  <p>{nights(ci, co)} nights · {guests} guests · {len(entries)} houses available · prices before taxes &amp; fees</p>
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
  <label>Area <select id="area"><option value="">All areas</option>{area_opts}</select></label>
  <span id="sel-count" class="muted"></span>
  <button id="clear" class="link">Clear selection</button>
</div>
<main class="board list" data-dates="{folder(ci, co)}">
{''.join(slots)}
</main>
<script src="../assets/app.js"></script>"""
    return page(f"{date_label(ci, co)} · {TRIP_TITLE}", body, 1)


def build_index(stays, listings, requested, ctx):
    keys = sorted(stays)
    guests = max(requested.values()) if requested else 2
    all_pp = [e["response"]["price"]["amount"] / int(e["params"].get("adults") or 2)
              for es in stays.values() for e in es]
    in_any = {e["response"]["id"] for es in stays.values() for e in es}
    area_count = {}
    for lid in in_any:
        area_count.setdefault(area(listings[lid]), []).append(lid)

    stats = [
        (len(in_any), "houses"), (len(keys), "date options"), (len(area_count), "areas"),
        (f"{money(min(all_pp))}–{money(max(all_pp))}" if all_pp else "–", "per person"),
    ]
    stats_html = "".join(f'<div class="stat"><b>{v}</b><span>{k}</span></div>' for v, k in stats)

    date_cards = []
    for k in keys:
        es = stays[k]
        g = int(es[0]["params"].get("adults") or 2)
        cheapest = min(es, key=lambda e: e["response"]["price"]["amount"])
        by_area = {}
        for e in es:
            by_area[area(e["response"])] = by_area.get(area(e["response"]), 0) + 1
        area_line = " · ".join(f"{a} {n}" for a, n in sorted(by_area.items()))
        date_cards.append(f"""<a class="date-card" href="{folder(*k)}/index.html">
  <span class="eyebrow">{nights(*k)} nights</span>
  <h3>{date_label(*k, long=True)}</h3>
  <p><b>{len(es)}</b> of {len(in_any)} houses available</p>
  <p>From <b>{money(cheapest['response']['price']['amount'] / g)}</b>/person · {escape(cheapest['response']['name'][:34])}</p>
  <p class="muted">{escape(area_line)}</p>
  <span class="go">View houses →</span>
</a>""")

    empty = sorted(set(requested) - set(stays))
    empty_html = ""
    if empty:
        items = ", ".join(f"{date_label(*k, long=True)} ({nights(*k)} night{'s' * (nights(*k) != 1)})" for k in empty)
        empty_html = f'<p class="callout">No houses available for {items}. Most likely a 2-night minimum.</p>'

    # Matrix: one row per house, one column per date range
    best = {k: min(e["response"]["price"]["amount"] for e in stays[k]) for k in keys}
    head = "".join(f'<th><a href="{folder(*k)}/index.html">{date_label(*k)}</a></th>' for k in keys)
    rows = []
    order = sorted(in_any, key=lambda lid: (area(listings[lid]),
                   min(e["response"]["price"]["amount"] for _, e in ctx["by_listing"][lid])))
    for lid in order:
        d = listings[lid]
        priced = dict(ctx["by_listing"][lid])
        cells = []
        for k in keys:
            if k in priced:
                amt = priced[k]["response"]["price"]["amount"]
                g = int(priced[k]["params"].get("adults") or 2)
                cls = ' class="best"' if amt == best[k] else ""
                cells.append(f'<td{cls}><a href="{folder(*k)}/{lid}.html">{money(amt / g)}</a></td>')
            else:
                cells.append('<td class="na">—</td>')
        note = ctx["notes"].get(lid)
        rows.append(f"""<tr><th scope="row"><span class="house">{escape(d['name'])}</span>
  <span class="sub">{escape(area(d))} · {d.get('bedrooms')} bd · {d.get('bathrooms', 0):g} ba · ★ {d.get('rating') or '–'}{f' · “{escape(note)}”' if note else ''}</span></th>{''.join(cells)}</tr>""")

    area_html = "".join(
        f"<li><b>{escape(a)}</b> {len(ids)} houses: {escape(', '.join(sorted({city(listings[i]) for i in ids})))}</li>"
        for a, ids in sorted(area_count.items(), key=lambda x: -len(x[1])))

    picks = []
    for lid, note in ctx["notes"].items():
        if lid not in in_any:
            continue
        k, e = min(ctx["by_listing"][lid], key=lambda x: x[1]["response"]["price"]["amount"])
        d = e["response"]
        g = int(e["params"].get("adults") or 2)
        picks.append(f"""<a class="pick-card" href="{folder(*k)}/{lid}.html">
  <span class="note">“{escape(note)}”</span>
  <b>{escape(d['name'])}</b>
  <span class="muted">{escape(area(d))} · from {money(d['price']['amount'] / g)}/person ({date_label(*k)})</span>
</a>""")

    updated = max((e["requested_at"] for es in stays.values() for e in es), default="")
    body = f"""<header class="hero-head">
  <p class="eyebrow">Trip plan · {guests} guests</p>
  <h1>{escape(TRIP_TITLE)}</h1>
  <div class="stats">{stats_html}</div>
</header>
<main class="overview">
  <section>
    <h2>How we decide</h2>
    <ol class="steps">
      <li><b>Pick the area.</b> The houses are in {len(area_count)} different areas, up to two hours apart.</li>
      <li><b>Pick the weekend.</b> Each date option shows what's still open.</li>
      <li><b>Shortlist.</b> Open a date, tick "Compare" on 2–4 houses, switch to side by side.</li>
      <li><b>Book</b> once everyone agrees. Prices move, so check the live price on Airbnb.</li>
    </ol>
  </section>
  {f'<section><h2>Team picks</h2><div class="picks">{"".join(picks)}</div></section>' if picks else ''}
  <section>
    <h2>Date options</h2>
    <div class="date-grid">{''.join(date_cards)}</div>
    {empty_html}
  </section>
  <section>
    <h2>Price per person, every option</h2>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>House</th>{head}</tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table></div>
    <p class="muted">Highlighted = cheapest for that date. Prices before taxes &amp; service fees.</p>
  </section>
  <section>
    <h2>Areas</h2>
    <ul class="plain areas">{area_html}</ul>
  </section>
  <p class="muted foot">Prices checked {escape(updated.replace('T', ' ')[:16])}.</p>
</main>"""
    return page(TRIP_TITLE, body, 0)


def main():
    stays, listings, requested = load_data()
    by_listing = {}
    for k, es in stays.items():
        for e in es:
            by_listing.setdefault(e["response"]["id"], []).append((k, e))
    for v in by_listing.values():
        v.sort(key=lambda x: x[0])
    ctx = {"notes": load_notes(), "by_listing": by_listing}

    DOCS.mkdir(exist_ok=True)
    (DOCS / ".nojekyll").touch()
    for old in DOCS.iterdir():  # drop date folders from earlier builds
        if old.is_dir() and re.fullmatch(r"\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d", old.name):
            shutil.rmtree(old)

    for k, es in sorted(stays.items()):
        out = DOCS / folder(*k)
        out.mkdir()
        (out / "index.html").write_text(build_date_page(k, es, ctx))
        for e in es:
            (out / f"{e['response']['id']}.html").write_text(build_pitch_page(e, ctx))
        print(f"{out.relative_to(ROOT)}/: {len(es)} pitches")
    (DOCS / "index.html").write_text(build_index(stays, listings, requested, ctx))
    print("docs/index.html")

    missing = [lid for lid in by_listing if not photos(lid)]
    if missing:
        print(f"\n{len(missing)} houses have no photos yet. Add them to docs/images/<listing_id>/ "
              f"(first file = hero), then rebuild.")


if __name__ == "__main__":
    main()
