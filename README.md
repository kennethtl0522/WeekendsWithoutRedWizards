# AirbnbCrawl

Fetch Airbnb prices for specific dates, then publish a static pitch site so a group can compare and pick a house.

## Workflow

```bash
uv sync
uv run main.py                                   # inputs.csv -> results.csv + raw/run_*.json
uv run split_raw.py raw/run_<timestamp>.json     # optional: one JSON per date range
uv run build_site.py                             # raw/*.json -> docs/ (static site)
```

`main.py` needs `OMKAR_API_KEY=...` in `.env` (gitignored). Each row of `inputs.csv` is one API request.

## Site layout (`docs/`)

| Path | What |
|---|---|
| `index.html` | Overview plan: date options, team picks, price-per-person matrix, areas |
| `<check_in>_<check_out>/index.html` | All houses for those dates: list view, side-by-side compare, sort, area filter |
| `<check_in>_<check_out>/<listing_id>.html` | One-page pitch for one house on those dates |
| `assets/` | Shared CSS/JS (hand-edited, not generated) |
| `images/<listing_id>/` | Your photos (not generated) |

Each pitch is a self-contained `<article class="pitch">` that adapts to its container width,
so the same block works as a full page, a scrollable list card, or a compare column.

Compare selections are saved per browser and in the URL, e.g.
`2026-11-14_2026-11-16/?view=compare&ids=1040827055809906305,49975245`, so a shortlist can be shared as a link.

## Photos

Put images in `docs/images/<listing_id>/` (jpg/png/webp). Files are used in name order:
the first is the hero, the next four fill the gallery. Rebuild after adding them.

## Notes and title

- Team notes come from the `note` column of `inputs.csv`.
- Trip title and the city → area grouping are at the top of `build_site.py`.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Build and deployment → Source: *Deploy from a branch*, Branch: `main`, folder: `/docs`.
3. Rebuild and push whenever prices are refreshed.

The Pages site is public even if the repo is private (outside GitHub Enterprise), so anyone with the link
can see prices and notes. `raw/`, `results*.csv` and `.env` are gitignored and never published.
