"""
Download each house's Airbnb photos into docs/images/<listing_id>/.

Uses the photo links saved in raw/run_*.json (newest run wins). Files are named
01.jpg (hero) … 05.jpg so they fill the pitch gallery in order. Existing files
are never overwritten, so a photo you replaced by hand stays.

Run, then rebuild the model so the site picks them up:
    uv run fetch_photos.py
    uv run build_site.py
"""
import json
from pathlib import Path

import requests

ROOT = Path(__file__).parent
IMAGES = ROOT / "docs" / "images"
SLOTS = 5
HERO_WIDTH, THUMB_WIDTH = 1200, 720  # Airbnb's CDN resizes via ?im_w=


def latest_listings():
    listings = {}
    for f in sorted((ROOT / "raw").glob("run_*.json")):
        for e in json.loads(f.read_text()):
            d = e.get("response")
            if isinstance(d, dict) and d.get("id") and d.get("images"):
                listings[d["id"]] = d
    return listings


def main():
    session = requests.Session()
    for lid, d in latest_listings().items():
        folder = IMAGES / lid
        folder.mkdir(parents=True, exist_ok=True)
        got = 0
        for i, img in enumerate(d["images"][:SLOTS]):
            path = folder / f"{i + 1:02d}.jpg"
            if path.exists():
                continue
            width = HERO_WIDTH if i == 0 else THUMB_WIDTH
            r = session.get(img["link"], params={"im_w": width}, timeout=60)
            if r.ok and r.headers.get("content-type", "").startswith("image/"):
                path.write_bytes(r.content)
                got += 1
            else:
                print(f"  {lid} photo {i + 1}: HTTP {r.status_code}")
        print(f"{d['name'][:45]:45} {got} downloaded")


if __name__ == "__main__":
    main()
