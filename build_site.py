"""
Build the site's data model from raw API logs.

Reads every raw/run_*.json (newest wins per listing + dates), notes from
inputs.csv, and photo file names from docs/images/<listing_id>/, then writes
docs/data/model.json. The pages themselves (docs/index.html + docs/assets/*.js)
are hand-written and render everything from that model in the browser.

Run:
    uv run build_site.py
"""
import csv
import json
import re
from datetime import date
from pathlib import Path

from main import house_rule_times, listing_id

TRIP_TITLE = "WeekendsWithoutRedWizards"
# Date range the group recommends; highlighted in the overview table
RECOMMENDED_DATES = "2026-11-13_2026-11-15"
ROOT = Path(__file__).parent
RAW = ROOT / "raw"
DOCS = ROOT / "docs"
IMAGES = DOCS / "images"
MODEL = DOCS / "data" / "model.json"
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


# ---------- raw data ----------

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


# ---------- derived fields ----------

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


def date_key(ci, co):
    return f"{ci}_{co}"


def nights(ci, co):
    return (date.fromisoformat(co) - date.fromisoformat(ci)).days


def date_label(ci, co, long=False):
    a, b = date.fromisoformat(ci), date.fromisoformat(co)
    if long:
        return f"{a:%a %b} {a.day} – {b:%a %b} {b.day}"
    return f"{a:%b} {a.day}–{b.day}" if a.month == b.month else f"{a:%b} {a.day} – {b:%b} {b.day}"


# ---------- model ----------

def build_listing(d, guests, note):
    t = house_rule_times(d.get("house_rules"))
    host = d.get("host") or {}
    return {
        "id": d["id"],
        "name": d["name"],
        "link": d.get("link") or f"https://www.airbnb.com/rooms/{d['id']}",
        "city": city(d),
        "area": area(d),
        # Street address isn't returned by the API; "Oceano, California" is the closest it gets
        "location": (d.get("location") or {}).get("address")
                    or re.sub(r",\s*United States$", "", (d.get("location") or {}).get("name") or ""),
        "property_type": d.get("property_type"),
        "capacity": d.get("person_capacity"),
        "bedrooms": d.get("bedrooms"),
        "beds": d.get("beds"),
        "baths": d.get("bathrooms"),
        "rating": d.get("rating"),
        "reviews": d.get("reviews_count") or 0,
        "guest_favorite": bool(d.get("is_guest_favorite")),
        "superhost": bool(host.get("is_superhost")),
        "check_in_time": t.get("check_in_time"),
        "check_out_time": t.get("check_out_time"),
        "highlights": highlights(d),
        "sleeping": [{"title": s["title"], "beds": s.get("subtitle") or ""}
                     for s in d.get("sleeping_arrangement") or []],
        "rules": rules(d),
        "watch": watch_outs(d, guests),
        "description": (d.get("description") or "").strip(),
        "note": note,
        "photos": photos(d["id"]),
    }


def build_stay(e, n):
    price = e["response"]["price"]
    guests = int(e["params"].get("adults") or 2)
    # original_amount is unreliable on its own; only keep a "was" price when the breakdown has a discount
    breakdown = price.get("breakdown") or []
    discounts = [b for b in breakdown if (b.get("amount") or 0) < 0]
    return {
        "total": price["amount"],
        "per_person": round(price["amount"] / guests, 2),
        "per_night": round(price["amount"] / n, 2),
        "was": breakdown[0]["amount"] if discounts else None,
        "discounts": [b["description"] for b in discounts],
        "currency": price.get("currency") or "USD",
        "checked_at": e["requested_at"],
    }


def main():
    stays, listings, requested = load_data()
    notes = load_notes()
    guests = max(requested.values()) if requested else 2

    model_stays = {}
    for (ci, co), es in sorted(stays.items()):
        model_stays[date_key(ci, co)] = {e["response"]["id"]: build_stay(e, nights(ci, co)) for e in es}
    ids = sorted({lid for s in model_stays.values() for lid in s})

    model = {
        "trip": {
            "title": TRIP_TITLE,
            "guests": guests,
            "recommended": RECOMMENDED_DATES,
            "updated": max((s["checked_at"] for d in model_stays.values() for s in d.values()), default=None),
        },
        "dates": [{
            "key": date_key(ci, co), "check_in": ci, "check_out": co, "nights": nights(ci, co),
            "label": date_label(ci, co), "long_label": date_label(ci, co, long=True),
            "guests": requested[(ci, co)],
        } for ci, co in sorted(requested)],
        "listings": {lid: build_listing(listings[lid], guests, notes.get(lid)) for lid in ids},
        "stays": model_stays,
    }

    MODEL.parent.mkdir(parents=True, exist_ok=True)
    MODEL.write_text(json.dumps(model, indent=1, ensure_ascii=False))
    print(f"{MODEL.relative_to(ROOT)}: {len(ids)} houses, "
          f"{sum(map(len, model_stays.values()))} priced stays across {len(model_stays)} date ranges")

    missing = [lid for lid in ids if not model["listings"][lid]["photos"]]
    if missing:
        print(f"{len(missing)} houses have no photos yet. Add them to docs/images/<listing_id>/ "
              f"(first file = hero), then rebuild.")


if __name__ == "__main__":
    main()
