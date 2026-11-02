"""
Airbnb price checker (omkar.cloud Airbnb Scraper API).

Reads listings + date ranges from an input CSV, fetches each listing's details
and price for those dates, and appends results to an output CSV.

Setup:
    uv sync
    put your key in .env:  OMKAR_API_KEY=ok_...

Run:
    uv run main.py --input inputs.csv --output results.csv

inputs.csv columns: listing, check_in, check_out, adults
    listing   = full room URL or just the numeric ID
    check_in  = YYYY-MM-DD
    check_out = YYYY-MM-DD
    adults    = optional, default 2

Free plan = 200 requests/month; each input row uses one request.
"""
import argparse
import csv
import json
import os
import re
import time
from datetime import date, datetime
from pathlib import Path

import requests

API_URL = "https://airbnb-scraper-api.omkar.cloud/airbnb/rooms/details"

FIELDS = [
    "title", "price", "price_per_night", "original_price", "nights", "check_in", "check_out",
    "rooms", "beds", "baths", "check_in_time", "check_out_time", "property_type",
    "location", "rating", "adults", "currency", "listing_id", "url", "noted_price", "note",
    "status", "scraped_at",
]

TIME = r"\d{1,2}(?::\d{2})?\s*[AP]M"


def load_api_key():
    env = Path(__file__).with_name(".env")
    if env.exists():
        for line in env.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
    key = os.environ.get("OMKAR_API_KEY")
    if not key:
        raise SystemExit("Missing OMKAR_API_KEY (add it to .env)")
    return key


def listing_id(value):
    m = re.search(r"rooms/(?:plus/)?(\d+)", value) or re.fullmatch(r"\s*(\d+)\s*", value)
    if not m:
        raise ValueError(f"Can't find a listing ID in: {value!r}")
    return m.group(1)


def house_rule_times(house_rules):
    """Pull check-in/out times from rules like 'Check in after 2:00 PM' or 'Check-in: 3:00 PM - 10:00 PM'."""
    lines = [i.replace(" ", " ") for s in house_rules or [] for i in s.get("items", [])]
    text = "\n".join(lines)
    out = {}
    if m := re.search(rf"Check[- ]?in[^\n]*?({TIME}(?:\s*[–-]\s*{TIME})?)", text, re.I):
        out["check_in_time"] = m.group(1)
    if m := re.search(rf"Check[- ]?out[^\n]*?({TIME})", text, re.I):
        out["check_out_time"] = m.group(1)
    return out


def fetch(session, lid, check_in, check_out, adults, raw_log):
    nights = (date.fromisoformat(check_out) - date.fromisoformat(check_in)).days
    row = {"listing_id": lid, "check_in": check_in, "check_out": check_out, "adults": adults,
           "nights": nights, "status": "ok",
           "scraped_at": datetime.now().isoformat(timespec="seconds")}

    params = {"query": lid, "checkin": check_in, "checkout": check_out, "adults": adults}
    r = session.get(API_URL, params=params, timeout=90)
    try:
        body = r.json()
    except ValueError:
        body = r.text
    raw_log.append({"requested_at": row["scraped_at"], "params": params,
                    "status_code": r.status_code, "response": body})
    if r.status_code != 200:
        row["status"] = f"error: HTTP {r.status_code} {r.text[:120]}"
        return row
    d = body

    price = d.get("price") or {}
    row.update({
        "title": d.get("name"),
        "url": d.get("link"),
        "property_type": d.get("property_type"),
        "location": (d.get("location") or {}).get("name"),
        "rating": d.get("rating"),
        "rooms": d.get("bedrooms"),
        "beds": d.get("beds"),
        "baths": d.get("bathrooms"),
        "price": price.get("amount"),
        "original_price": price.get("original_amount"),
        "currency": price.get("currency") or d.get("currency"),
    })
    row.update(house_rule_times(d.get("house_rules")))

    if row["price"] and nights > 0:
        row["price_per_night"] = round(row["price"] / nights, 2)
    elif d.get("is_available") is False or not price:
        row["status"] = "unavailable"
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="inputs.csv")
    ap.add_argument("--output", default="results.csv")
    ap.add_argument("--raw-dir", default="raw", help="folder for raw API response logs (JSON)")
    ap.add_argument("--delay", type=float, default=1, help="seconds between requests")
    args = ap.parse_args()

    os.makedirs(args.raw_dir, exist_ok=True)
    raw_path = Path(args.raw_dir) / f"run_{datetime.now():%Y-%m-%d_%H%M%S}.json"
    raw_log = []

    with open(args.input, newline="") as f:
        jobs = [r for r in csv.DictReader(f) if r.get("listing", "").strip()]

    session = requests.Session()
    session.headers["API-Key"] = load_api_key()

    new_file = not os.path.exists(args.output)
    results = []
    with open(args.output, "a", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=FIELDS, extrasaction="ignore")
        if new_file:
            writer.writeheader()

        for i, job in enumerate(jobs, 1):
            lid = listing_id(job["listing"])
            ci, co = job["check_in"].strip(), job["check_out"].strip()
            adults = (job.get("adults") or "2").strip()
            print(f"[{i}/{len(jobs)}] {lid} {ci} → {co} ...", end=" ", flush=True)
            try:
                row = fetch(session, lid, ci, co, adults, raw_log)
            except Exception as e:
                row = {"listing_id": lid, "check_in": ci, "check_out": co, "adults": adults,
                       "status": f"error: {e.__class__.__name__}: {e}"[:200],
                       "scraped_at": datetime.now().isoformat(timespec="seconds")}
            row["noted_price"] = job.get("noted_price", "")
            row["note"] = job.get("note", "")
            writer.writerow(row)
            out.flush()
            # Rewrite after every request so a crash still leaves a valid log
            raw_path.write_text(json.dumps(raw_log, indent=2, ensure_ascii=False))
            results.append(row)
            print(f"{row.get('currency', '')} {row['price']:,.2f}" if row.get("price") else row["status"])
            time.sleep(args.delay)

    # Compare dates per listing, cheapest per night first
    print("\n=== Price comparison ===")
    by_listing = {}
    for r in results:
        by_listing.setdefault(r["listing_id"], []).append(r)
    for lid, rows in by_listing.items():
        print(f"\n{rows[0].get('title') or lid}")
        for r in sorted(rows, key=lambda r: r.get("price_per_night") or float("inf")):
            if r.get("price"):
                print(f"  {r['check_in']} → {r['check_out']}  {r['price']:>9,.2f} total"
                      f"  {r['price_per_night']:>8,.2f}/night")
            else:
                print(f"  {r['check_in']} → {r['check_out']}  {r['status']}")
    print(f"\nSaved to {args.output}, raw responses in {raw_path}")


if __name__ == "__main__":
    main()
