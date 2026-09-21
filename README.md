# The Mana Cafe

Next.js 14 web app for tracking live Pokémon TCG and Magic: The Gathering prices across Canadian retailers.
It reads `{tcg}/state.json` and `{tcg}/price_history.json` from a private GitHub repository and presents searchable, sortable product cards with 7-day trend context.

## Sections

Each game splits into dedicated sections (sub-nav under the game tabs):

- `/{tcg}/sealed` — sealed product price tracking (default; old `/{tcg}` URLs redirect here)
- `/{tcg}/singles` — single cards with Scryfall images and CAD-vs-market pricing
- `/{tcg}/deals` — deals-only view (7-day price drops)

Two cross-game pages sit alongside them:

- `/calendar?tcg=` — the release **schedule**, grouped by set, for browsing
- `/drops?tcg=` — the upcoming-drop **feed**, for checking

## Drops feed (`/drops`)

Answers *when and where* a drop goes live, which the calendar cannot:

- **When** — `go_live.at`, an exact instant with a live countdown. Only MTG has
  these: Secret Lair is the sole source in either game that publishes drop times.
  Pokémon carries retailer detection only, and the `precision` field records
  which is which so the UI never implies accuracy it does not have.
- **Where** — a per-retailer list with live/coming-soon/sold-out status, plus a
  flag when a virtual waiting room fronts the drop.
- **How sure** — a confidence percentage that always ships with the signals that
  produced it (`components/ConfidenceBadge.tsx`), never a bare number.

Sections: *going live soon*, *what just changed* (the news feed — date moved,
pre-orders opened, sold out), *scheduled*, and *announced with no date yet*.

The data is produced by `update_drops.py` in the `tcg-drop-alert` repo — see
`DROPS.md` there for the scoring model, source list, and licensing constraints.
`__tests__/dropsContract.test.tsx` guards the schema seam between the two repos
using real generated output; regenerate the fixture when the Python side changes.

## Stack

- Next.js 14 (pages router)
- TypeScript
- SWR (client polling every 5 minutes)
- Recharts (price sparkline)
- CSS Modules (custom dark UI)

## Environment Variables

Create `.env.local` with:

```env
GITHUB_REPO=itsvickel/tcg-drop-alert
GITHUB_TOKEN=<private repo token>
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API Route

`/api/products`:

- Fetches `state.json` and `price_history.json` from:
	`https://raw.githubusercontent.com/${GITHUB_REPO}/main/<filename>`
- Authenticates with `GITHUB_TOKEN`
- Joins records by `group_key`
- Computes:
	- `all_time_low`
	- `price_change_7d` (percentage delta versus a 7-day reference point)
- Filters out prices below CAD $3
- Sorts by lowest price
- Returns typed payload with cache headers:
	- `Cache-Control: s-maxage=300, stale-while-revalidate=300`

## UI Features

- Sticky live header
- Stats bar: products, deals, all-time lows, retailer count
- Controls:
	- search
	- sorting (price, biggest drop, recently updated, name)
	- retailer filter
	- toggles (hide pre-orders, deals only, all-time-low only)
- Product cards:
	- badges for all-time low / pre-order / weekly movement
	- cleaned Buy Now links (tracking params removed)
	- shipping threshold label by retailer
	- sparkline trend or fallback when history is insufficient
- Shimmer skeletons while loading
- Mobile responsive layout

## Deployment (Vercel)

1. Push this project to GitHub.
2. Import into Vercel.
3. Set env vars:
	 - `GITHUB_REPO`
	 - `GITHUB_TOKEN`
4. Deploy.

`vercel.json` uses:

```json
{
	"framework": "nextjs"
}
```