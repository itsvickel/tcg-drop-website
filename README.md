# Pokemon TCG Price Tracker

Next.js 14 web app for tracking live Pokemon TCG prices across Canadian retailers.
It reads `state.json` and `price_history.json` from a private GitHub repository and presents searchable, sortable product cards with 7-day trend context.

## Stack

- Next.js 14 (pages router)
- TypeScript
- SWR (client polling every 5 minutes)
- Recharts (price sparkline)
- CSS Modules (custom dark UI)

## Environment Variables

Create `.env.local` with:

```env
GITHUB_REPO=itsvickel/pokemon-drop-alert
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