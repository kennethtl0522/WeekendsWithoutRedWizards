"""
Split a raw run log into one JSON file per check-in/check-out pair.

Keeps only entries with a price, sorted cheapest first. Entries are kept
exactly as logged (request params + full API response).

Run:
    uv run split_raw.py raw/run_2026-11-01_182351.json
    -> raw/run_2026-11-01_182351/2026-11-13_2026-11-15.json, ...
"""
import json
import sys
from pathlib import Path


def main():
    src = Path(sys.argv[1])
    out_dir = src.with_suffix("")
    out_dir.mkdir(exist_ok=True)

    groups = {}
    for entry in json.loads(src.read_text()):
        resp = entry.get("response")
        if not isinstance(resp, dict) or resp.get("price") is None:
            continue
        key = (entry["params"]["checkin"], entry["params"]["checkout"])
        groups.setdefault(key, []).append(entry)

    for (check_in, check_out), entries in sorted(groups.items()):
        entries.sort(key=lambda e: e["response"]["price"]["amount"])
        path = out_dir / f"{check_in}_{check_out}.json"
        path.write_text(json.dumps(entries, indent=2, ensure_ascii=False))
        print(f"{path}: {len(entries)} listings")


if __name__ == "__main__":
    main()
