# Design: Four Improvements — Deal Score Tooltip, Hot Strip, Comparison Mode, Weekly Digest

**Date:** 2026-06-08  
**Status:** Approved

---

## Scope

Four independent features added to the Pokemon TCG price tracker website:

1. **Deal score breakdown tooltip** — explain the deal score in context
2. **"Hot right now" strip** — surface the biggest recent price drops above the grid
3. **Product comparison mode** — select up to 3 products and compare side-by-side
4. **Weekly deal digest** — `/api/digest` endpoint + preview page for a curated top-10 email

Each feature is self-contained. They can be implemented and shipped independently.

---

## 1. Deal Score Breakdown Tooltip

### Purpose
The `deal_score` number on each card is opaque to users. A tooltip explaining the contributing signals makes the score trustworthy and actionable.

### Data
All signals are computable on the frontend from existing `Product` fields:

| Signal | Source field | Display |
|--------|-------------|---------|
| ATL proximity | `price`, `all_time_low` | "AT ALL-TIME LOW" or "+12% above ATL" |
| Weekly trend | `price_change_7d` | "↓ 15% this week" / "↑ 3% this week" / "no change" |
| MSRP savings | `msrp`, `price` | "22% off MSRP" (omitted when `msrp` is null) |
| Stock status | `in_stock`, `is_preorder` | "In stock" / "Pre-order" / "Out of stock" |

### Component
New `DealScoreBreakdown` component:
- Wraps the deal score badge in a relative-positioned container
- On desktop: tooltip appears on hover (`onMouseEnter`/`onMouseLeave`)
- On mobile: tooltip appears on tap, dismissed by tapping elsewhere
- Tooltip is a small dark card (4 rows max) positioned above the badge, clamped to viewport edges

### Placement
- `ProductCard` — replaces the bare deal score badge
- `ProductDetailModal` — same component reused next to the score display

### No API changes required.

---

## 2. "Hot Right Now" Strip

### Purpose
Give returning users an immediate reason to engage: a curated horizontal row of products with the biggest recent price drops, shown above the main product grid.

### Qualification logic
A product is "hot" if:
- `price_change_7d !== null && price_change_7d < -5` (dropped ≥5% in the last 7 days)
- `updated` timestamp is within the last 48 hours

Sort by `price_change_7d` ascending (most negative = biggest drop). Cap at 8 products.

If fewer than 2 products qualify, the strip renders nothing (no empty heading).

### Component: `HotStrip`
Props: `products: Product[]`, `onSelect: (product: Product) => void`

Each item in the strip shows:
- Product thumbnail (`image_url`) or a placeholder silhouette
- Truncated product name (1 line, ellipsis)
- Current best price
- Drop badge: `↓ X%` in red/orange

Clicking any item calls `onSelect(product)` → opens `ProductDetailModal` (same flow as clicking a card).

Strip is a horizontally scrollable row (`overflow-x: auto`, `-webkit-overflow-scrolling: touch`). On desktop it never wraps; on mobile it scrolls.

### Placement
Rendered in `pages/index.tsx` between the stats bar and the filter controls, above the product grid.

---

## 3. Product Comparison Mode

### Purpose
Let power users select 2–3 products and view their prices, history, and retailer options side-by-side in one panel.

### State
New state in `HomePage`:
```
compareList: Product[]   // max 3 items
```

URL encoding: `?compare=key1,key2,key3` — kept in sync with `compareList` at all times (updated on every add/remove). Cleared when all products are removed. This makes any comparison shareable by copying the URL.

### Card integration
`ProductCard` receives two new optional props:
- `isInComparison: boolean`
- `onToggleComparison: (key: string) => void`

A compare icon button (two overlapping squares) appears on the card. On desktop it's visible on hover; on mobile it's always visible. When `isInComparison` is true the icon is highlighted. Selecting a 4th product when 3 are already selected does nothing (button is disabled/muted).

### Floating bar
When `compareList.length >= 1`, a fixed bar appears at the bottom of the viewport:
- Thumbnails of selected products (small, with ✕ to remove each)
- "Compare (N)" button
- "Clear all" link

The bar does not obstruct the footer; it appears above it with a `z-index` above cards but below modals.

### `CompareModal` component
Opens when the user clicks "Compare (N)". Layout: up to 3 columns (one per product).

Each column contains, top to bottom:
1. Product image (fixed height, object-fit cover)
2. Product name (2-line clamp)
3. Best price (large, prominent)
4. Price vs ATL (colored badge: green = at ATL, yellow/red = % above)
5. 7-day change (colored: green drop, red rise)
6. Deal score (with breakdown tooltip — reuses component from feature 1)
7. MSRP & savings (if `msrp` available)
8. All retailer prices (compact list: name, price, stock status, Buy link)
9. Sparkline (reuses existing `Sparkline` component)

Footer row: "Remove" button per column. When only 1 product remains, modal closes.

Modal is closeable via Escape, overlay click, or the ✕ button.

### No API changes required.

---

## 4. Weekly Deal Digest

### Purpose
A curated email of the top 10 deals, sent each Monday by the existing GitHub Actions workflow in the private repo. The website provides the data endpoint and a preview page.

### `/api/digest` endpoint

**Method:** `GET`

**Auth:** Requests must include header `Authorization: Bearer <DIGEST_SECRET>` where `DIGEST_SECRET` is a new environment variable. Requests without a valid secret return `401`. (The preview page calls this from a Next.js server-side render, so the secret never reaches the browser.)

**Query params:**
- `?format=html` — returns a full HTML email string (`Content-Type: text/html`)
- (default) — returns JSON payload

**Logic:**
1. Fetch products from GitHub (same read as `/api/products`)
2. Filter: `in_stock === true`, `deal_score > 0`
3. Sort by `deal_score` descending
4. Take top 10
5. For each product, include: `name`, `image_url`, `price`, `all_time_low`, `price_change_7d`, `deal_score`, `msrp`, `url`, `retailer`

**JSON response shape:**
```json
{
  "generated_at": "ISO timestamp",
  "week": "2026-06-09",
  "deals": [ /* top 10 products */ ]
}
```

**HTML response:**
A self-contained HTML email (inline styles, no external CSS). Structure:
- Header: "🔥 This week's top Pokemon TCG deals" + date
- 10 deal rows: image thumbnail, name, price, drop badge, "Buy Now" link
- Footer: unsubscribe link placeholder (`{{unsubscribe_url}}` token the GitHub Action replaces)

### `/digest` preview page

`pages/digest.tsx` — server-side rendered via `getServerSideProps`:
- Calls `/api/digest` internally (with the secret from `process.env.DIGEST_SECRET`)
- Renders the top 10 deals as a styled page (same content as the email, but in the site's dark theme)
- Linked from the newsletter signup component: "Preview this week's top deals →"
- No auth required on the page itself (the page fetches server-side, secret stays server-side)

### Environment variable
Add `DIGEST_SECRET` to `.env.local` and Vercel env vars. The GitHub Action sets this as a repository secret and passes it in the `Authorization` header when calling the endpoint.

---

## Architecture notes

- No new dependencies required for features 1–3
- Feature 4 has no new npm dependencies — HTML email is built with template literals
- `SHIPPING_THRESHOLDS` is currently duplicated in `ProductCard.tsx` and `ProductDetailModal.tsx` — this can be extracted to `lib/shipping.ts` as part of the comparison modal work
- The `DealScoreBreakdown` component is shared between the card and the detail modal, so it lives in `components/DealScoreBreakdown.tsx`
- `CompareModal` is a new top-level component `components/CompareModal.tsx`
- `HotStrip` is a new top-level component `components/HotStrip.tsx`

---

## Out of scope

- Browser push notifications (Web Push API) — deferred
- Set/collection tracker — deferred
- Changes to the private `itsvickel/pokemon-drop-alert` repo (except the GitHub Action caller for feature 4, which only requires adding a `curl` step)
