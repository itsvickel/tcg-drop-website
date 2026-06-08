# Four Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deal score tooltips, a "Hot right now" strip, product comparison mode, and a weekly digest API + preview page to the Pokemon TCG price tracker.

**Architecture:** Four independent features built on the existing Next.js 14 / CSS Modules / SWR stack. Features 1–3 are pure frontend additions. Feature 4 adds one API route and one server-rendered page. Shared logic lives in new focused files. No new npm dependencies.

**Tech Stack:** Next.js 14 (pages router), TypeScript, CSS Modules, SWR, Recharts, Jest (added in Task 1)

---

## File Map

**New files:**
- `jest.config.ts` — Jest configuration
- `__mocks__/styleMock.js` — CSS module mock for tests
- `__tests__/dealScore.test.ts` — unit tests for `computeDealSignals`
- `__tests__/hotStrip.test.ts` — unit tests for `getHotProducts`
- `lib/shipping.ts` — extracted `SHIPPING_THRESHOLDS` constant (currently duplicated in 2 components)
- `components/DealScoreBreakdown.tsx` — score badge with hover/tap tooltip
- `styles/DealScoreBreakdown.module.css`
- `components/HotStrip.tsx` — horizontal strip of biggest recent price drops
- `styles/HotStrip.module.css`
- `components/CompareModal.tsx` — comparison modal + exports `CompareBar`
- `styles/CompareModal.module.css`
- `pages/api/digest.ts` — digest endpoint (JSON + HTML email)
- `pages/digest.tsx` — SSR preview page
- `styles/Digest.module.css`

**Modified files:**
- `package.json` — add jest + ts-jest + @types/jest to devDependencies; add `"test"` script
- `components/ProductCard.tsx` — import `lib/shipping`; replace HOT DEAL badge with `DealScoreBreakdown`; add compare toggle button
- `components/ProductDetailModal.tsx` — import `lib/shipping`; wrap Deal Score stat with `DealScoreBreakdown`
- `components/NewsletterSignup.tsx` — add "Preview this week's deals →" link
- `pages/index.tsx` — add `HotStrip`; add `compareList` state + URL sync; pass compare props to `ProductCard`; render `CompareBar` and `CompareModal`

---

## Task 1: Jest Setup

**Files:**
- Create: `jest.config.ts`
- Create: `__mocks__/styleMock.js`
- Modify: `package.json`

- [ ] **Step 1: Install jest and ts-jest**

```bash
npm install --save-dev jest ts-jest @types/jest jest-environment-jsdom
```

Expected: installs 4 packages, `package.json` devDependencies updated.

- [ ] **Step 2: Create `jest.config.ts`**

```ts
import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "<rootDir>/__mocks__/styleMock.js",
  },
};

export default config;
```

- [ ] **Step 3: Create `__mocks__/styleMock.js`**

```js
module.exports = {};
```

- [ ] **Step 4: Add test script to `package.json`**

In `package.json`, add `"test": "jest"` to the `"scripts"` section:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "jest"
},
```

- [ ] **Step 5: Verify jest runs (no tests yet)**

```bash
npm test
```

Expected output: `No tests found, exiting with code 1` or similar — that's fine. If you see a parse/config error, fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add jest.config.ts __mocks__/styleMock.js package.json package-lock.json
git commit -m "chore: add jest + ts-jest test infrastructure"
```

---

## Task 2: Extract SHIPPING_THRESHOLDS

`SHIPPING_THRESHOLDS` is currently duplicated in `ProductCard.tsx` (19 entries) and `ProductDetailModal.tsx` (16 entries). Extract the union to `lib/shipping.ts`.

**Files:**
- Create: `lib/shipping.ts`
- Modify: `components/ProductCard.tsx`
- Modify: `components/ProductDetailModal.tsx`

- [ ] **Step 1: Create `lib/shipping.ts`**

```ts
export const SHIPPING_THRESHOLDS: Record<string, string> = {
  "Best Buy CA":        "Free $35+",
  "Walmart CA":         "Free $35+",
  "Amazon.ca":          "Free $35+/Prime",
  "Pokemon Center CA":  "Free $50+",
  "EB Games":           "Free $49+",
  "401 Games":          "Free $149+",
  "Deck Out Gaming":    "Free $100+",
  Hobbiesville:         "Free $150+",
  Danireon:             "Free $200+",
  "A&C Games":          "Free $100+",
  "Face to Face":       "Free $100+",
  "Game Keeper":        "Free $75+",
  "Remi Card Trader":   "Free $75+",
  Meeplemart:           "Free $75+",
  "Carta Magica":       "Free $100+",
  "Epic Loot":          "Free $75+",
  "Dragon Card & Game": "Check site",
  "Untapped Games":     "Check site",
  "The End Games":      "Check site",
  "Border City Games":  "Check site",
  "Ivory Tower Comics": "Check site",
};
```

- [ ] **Step 2: Update `components/ProductCard.tsx`**

Replace the entire `SHIPPING_THRESHOLDS` constant block (lines 50–72) with an import:

```ts
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
```

Remove the `const SHIPPING_THRESHOLDS: Record<string, string> = { ... };` block that follows it (lines 50–72).

- [ ] **Step 3: Update `components/ProductDetailModal.tsx`**

Replace the entire `SHIPPING_THRESHOLDS` constant block (lines 11–28) with an import at the top of the file:

```ts
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
```

Remove the `const SHIPPING_THRESHOLDS: Record<string, string> = { ... };` block that follows.

- [ ] **Step 4: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: build completes with no errors. If you see `SHIPPING_THRESHOLDS` not found, double-check the import path.

- [ ] **Step 5: Commit**

```bash
git add lib/shipping.ts components/ProductCard.tsx components/ProductDetailModal.tsx
git commit -m "refactor: extract SHIPPING_THRESHOLDS to lib/shipping.ts"
```

---

## Task 3: DealScoreBreakdown — Component

**Files:**
- Create: `components/DealScoreBreakdown.tsx`
- Create: `styles/DealScoreBreakdown.module.css`

- [ ] **Step 1: Create `styles/DealScoreBreakdown.module.css`**

```css
.wrap {
  position: relative;
  display: inline-block;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
  cursor: pointer;
  border: 1px solid transparent;
  user-select: none;
  transition: opacity 0.1s;
}

.badge:hover {
  opacity: 0.85;
}

.hot {
  background: rgba(255, 166, 87, 0.15);
  color: #ffa657;
  border-color: rgba(255, 166, 87, 0.3);
}

.good {
  background: rgba(63, 185, 80, 0.1);
  color: #3fb950;
  border-color: rgba(63, 185, 80, 0.25);
}

.neutral {
  background: rgba(139, 148, 158, 0.1);
  color: #8b949e;
  border-color: rgba(139, 148, 158, 0.2);
}

.compact .badge {
  font-size: 0.65rem;
  padding: 1px 5px;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 200px;
  z-index: 200;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  pointer-events: none;
}

.tooltipTitle {
  font-size: 0.68rem;
  font-weight: 700;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.78rem;
  margin-bottom: 5px;
}

.row:last-child {
  margin-bottom: 0;
}

.rowLabel {
  color: #8b949e;
}

.positive {
  color: #3fb950;
  font-weight: 600;
}

.negative {
  color: #f85149;
  font-weight: 600;
}
```

- [ ] **Step 2: Create `components/DealScoreBreakdown.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { Product } from "./ProductCard";
import styles from "../styles/DealScoreBreakdown.module.css";

export type DealSignal = {
  label: string;
  value: string;
  positive: boolean;
};

export function computeDealSignals(product: {
  price: number;
  all_time_low: number;
  price_change_7d: number | null;
  in_stock: boolean;
  is_preorder: boolean;
  msrp: number | null;
}): DealSignal[] {
  const signals: DealSignal[] = [];

  if (product.all_time_low > 0) {
    const pctAbove = ((product.price - product.all_time_low) / product.all_time_low) * 100;
    if (pctAbove <= 0.01) {
      signals.push({ label: "Price", value: "At all-time low", positive: true });
    } else {
      signals.push({
        label: "Price",
        value: `+${pctAbove.toFixed(0)}% above ATL`,
        positive: pctAbove < 10,
      });
    }
  }

  if (product.price_change_7d !== null) {
    const pct = product.price_change_7d;
    if (pct <= -1) {
      signals.push({ label: "7-day trend", value: `↓ ${Math.abs(pct).toFixed(1)}%`, positive: true });
    } else if (pct >= 1) {
      signals.push({ label: "7-day trend", value: `↑ ${pct.toFixed(1)}%`, positive: false });
    } else {
      signals.push({ label: "7-day trend", value: "Stable", positive: true });
    }
  }

  if (product.msrp !== null && product.msrp > product.price) {
    const savings = ((product.msrp - product.price) / product.msrp) * 100;
    signals.push({
      label: "vs MSRP",
      value: `${savings.toFixed(0)}% off ($${product.msrp.toFixed(2)})`,
      positive: true,
    });
  }

  if (product.is_preorder) {
    signals.push({ label: "Status", value: "Pre-order", positive: false });
  } else if (product.in_stock) {
    signals.push({ label: "Status", value: "In stock", positive: true });
  } else {
    signals.push({ label: "Status", value: "Out of stock", positive: false });
  }

  return signals;
}

type Props = {
  product: Product;
  score: number;
  compact?: boolean;
};

export default function DealScoreBreakdown({ product, score, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const signals = computeDealSignals(product);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const colorClass =
    score >= 70 ? styles.hot : score >= 40 ? styles.good : styles.neutral;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${compact ? styles.compact : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <span
        className={`${styles.badge} ${colorClass}`}
        title="Deal score — hover or tap for breakdown"
      >
        {score >= 70 ? "🔥 " : ""}
        {score}
      </span>
      {open && (
        <div className={styles.tooltip} role="tooltip">
          <p className={styles.tooltipTitle}>Deal score breakdown</p>
          {signals.map((s) => (
            <div key={s.label} className={styles.row}>
              <span className={styles.rowLabel}>{s.label}</span>
              <span className={s.positive ? styles.positive : styles.negative}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: no errors. The component is not yet used anywhere so nothing visible changes.

- [ ] **Step 4: Commit**

```bash
git add components/DealScoreBreakdown.tsx styles/DealScoreBreakdown.module.css
git commit -m "feat: add DealScoreBreakdown component with computeDealSignals"
```

---

## Task 4: DealScoreBreakdown — Tests

**Files:**
- Create: `__tests__/dealScore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dealScore.test.ts`:

```ts
import { computeDealSignals } from "../components/DealScoreBreakdown";

const base = {
  price: 50,
  all_time_low: 40,
  price_change_7d: null as number | null,
  in_stock: true,
  is_preorder: false,
  msrp: null as number | null,
};

describe("computeDealSignals — ATL signal", () => {
  test("reports at-all-time-low when price equals all_time_low", () => {
    const s = computeDealSignals({ ...base, price: 40, all_time_low: 40 });
    const atl = s.find((x) => x.label === "Price");
    expect(atl?.value).toBe("At all-time low");
    expect(atl?.positive).toBe(true);
  });

  test("reports % above ATL when price is higher", () => {
    const s = computeDealSignals({ ...base, price: 50, all_time_low: 40 });
    const atl = s.find((x) => x.label === "Price");
    expect(atl?.value).toBe("+25% above ATL");
  });

  test("marks as positive when <10% above ATL", () => {
    const s = computeDealSignals({ ...base, price: 43, all_time_low: 40 });
    expect(s.find((x) => x.label === "Price")?.positive).toBe(true);
  });

  test("marks as negative when >=10% above ATL", () => {
    const s = computeDealSignals({ ...base, price: 50, all_time_low: 40 });
    expect(s.find((x) => x.label === "Price")?.positive).toBe(false);
  });
});

describe("computeDealSignals — 7-day trend signal", () => {
  test("reports drop when price_change_7d <= -1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: -15.3 });
    const t = s.find((x) => x.label === "7-day trend");
    expect(t?.value).toBe("↓ 15.3%");
    expect(t?.positive).toBe(true);
  });

  test("reports rise when price_change_7d >= 1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: 8.0 });
    const t = s.find((x) => x.label === "7-day trend");
    expect(t?.value).toBe("↑ 8.0%");
    expect(t?.positive).toBe(false);
  });

  test("reports Stable when change is between -1 and 1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: 0.5 });
    expect(s.find((x) => x.label === "7-day trend")?.value).toBe("Stable");
  });

  test("omits trend signal when price_change_7d is null", () => {
    const s = computeDealSignals({ ...base, price_change_7d: null });
    expect(s.find((x) => x.label === "7-day trend")).toBeUndefined();
  });
});

describe("computeDealSignals — MSRP signal", () => {
  test("shows savings when msrp > price", () => {
    const s = computeDealSignals({ ...base, price: 40, msrp: 50 });
    const m = s.find((x) => x.label === "vs MSRP");
    expect(m?.value).toBe("20% off ($50.00)");
    expect(m?.positive).toBe(true);
  });

  test("omits MSRP signal when msrp is null", () => {
    expect(computeDealSignals({ ...base, msrp: null }).find((x) => x.label === "vs MSRP")).toBeUndefined();
  });

  test("omits MSRP signal when msrp <= price", () => {
    expect(computeDealSignals({ ...base, price: 55, msrp: 50 }).find((x) => x.label === "vs MSRP")).toBeUndefined();
  });
});

describe("computeDealSignals — status signal", () => {
  test("In stock", () => {
    const s = computeDealSignals({ ...base, in_stock: true, is_preorder: false });
    expect(s.find((x) => x.label === "Status")?.value).toBe("In stock");
  });

  test("Pre-order takes priority over in_stock", () => {
    const s = computeDealSignals({ ...base, in_stock: true, is_preorder: true });
    expect(s.find((x) => x.label === "Status")?.value).toBe("Pre-order");
  });

  test("Out of stock", () => {
    const s = computeDealSignals({ ...base, in_stock: false, is_preorder: false });
    expect(s.find((x) => x.label === "Status")?.value).toBe("Out of stock");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- __tests__/dealScore.test.ts
```

Expected: all tests PASS (the function was already written in Task 3).

- [ ] **Step 3: Commit**

```bash
git add __tests__/dealScore.test.ts
git commit -m "test: add unit tests for computeDealSignals"
```

---

## Task 5: DealScoreBreakdown — Wire Into Cards

**Files:**
- Modify: `components/ProductCard.tsx`
- Modify: `components/ProductDetailModal.tsx`

### ProductCard changes

The card currently shows a `🔥 HOT DEAL` badge (line ~170) for `deal_score >= 70` but never shows the score number. Replace it with `DealScoreBreakdown` when `deal_score >= 40`.

- [ ] **Step 1: Add import to `components/ProductCard.tsx`**

After the existing imports, add:

```ts
import DealScoreBreakdown from "./DealScoreBreakdown";
```

- [ ] **Step 2: Replace the HOT DEAL badge in `components/ProductCard.tsx`**

Find this block (around line 170):

```tsx
{product.deal_score >= 70 && !isAllTimeLow && (
  <span className={`${styles.badge} ${styles.badgeHotDeal}`}>🔥 HOT DEAL</span>
)}
```

Replace it with:

```tsx
{product.deal_score >= 40 && (
  <DealScoreBreakdown product={product} score={product.deal_score} compact />
)}
```

- [ ] **Step 3: Remove the now-unused `badgeHotDeal` reference**

The `badgeHotDeal` CSS class in `styles/Card.module.css` is now unused. Leave it in CSS for now (no harm) but remove the `styles.badgeHotDeal` reference from the JSX (already done in step 2).

### ProductDetailModal changes

The modal already shows `{deal_score}/100` as a stat (around line 178). Replace it with `DealScoreBreakdown`.

- [ ] **Step 4: Add import to `components/ProductDetailModal.tsx`**

After the existing imports, add:

```ts
import DealScoreBreakdown from "./DealScoreBreakdown";
```

- [ ] **Step 5: Replace the Deal Score stat in `components/ProductDetailModal.tsx`**

Find this block (around line 177):

```tsx
<div className={styles.stat}>
  <span className={styles.statLabel}>Deal Score</span>
  <strong className={styles.statValue} style={{ color: product.deal_score >= 70 ? "#ffa657" : product.deal_score >= 40 ? "#3fb950" : "#8b949e" }}>
    {product.deal_score}/100
  </strong>
</div>
```

Replace it with:

```tsx
<div className={styles.stat}>
  <span className={styles.statLabel}>Deal Score</span>
  <DealScoreBreakdown product={product} score={product.deal_score} />
</div>
```

- [ ] **Step 6: Build to confirm no errors**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add components/ProductCard.tsx components/ProductDetailModal.tsx
git commit -m "feat: wire DealScoreBreakdown into ProductCard and ProductDetailModal"
```

---

## Task 6: HotStrip — Component

**Files:**
- Create: `components/HotStrip.tsx`
- Create: `styles/HotStrip.module.css`

- [ ] **Step 1: Create `styles/HotStrip.module.css`**

```css
.strip {
  margin: 0 0 20px;
}

.heading {
  font-size: 0.78rem;
  font-weight: 700;
  color: #ffa657;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 10px;
}

.row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
  scrollbar-width: thin;
  scrollbar-color: #30363d transparent;
}

.row::-webkit-scrollbar {
  height: 4px;
}

.row::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 2px;
}

.item {
  flex: 0 0 auto;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  width: 110px;
  transition: border-color 0.15s, background 0.15s;
}

.item:hover,
.item:focus-visible {
  border-color: #ffa657;
  background: #1c2128;
  outline: none;
}

.thumb {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 4px;
}

.thumbPlaceholder {
  width: 56px;
  height: 56px;
  background: #21262d;
  border-radius: 4px;
}

.name {
  font-size: 0.68rem;
  color: #c9d1d9;
  text-align: center;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 100%;
}

.price {
  font-size: 0.76rem;
  font-weight: 700;
  color: #58a6ff;
  font-family: "JetBrains Mono", monospace;
}

.drop {
  font-size: 0.68rem;
  font-weight: 700;
  color: #3fb950;
  background: rgba(63, 185, 80, 0.12);
  padding: 1px 6px;
  border-radius: 6px;
}
```

- [ ] **Step 2: Create `components/HotStrip.tsx`**

```tsx
import type { Product } from "./ProductCard";
import styles from "../styles/HotStrip.module.css";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
};

const HOT_DROP_PCT     = -5;
const HOT_WINDOW_MS    = 48 * 60 * 60 * 1000;
const HOT_MAX_ITEMS    = 8;
const HOT_MIN_TO_SHOW  = 2;

export function getHotProducts(products: Product[]): Product[] {
  const cutoff = Date.now() - HOT_WINDOW_MS;
  return products
    .filter(
      (p) =>
        p.price_change_7d !== null &&
        p.price_change_7d <= HOT_DROP_PCT &&
        new Date(p.updated).getTime() >= cutoff
    )
    .sort((a, b) => (a.price_change_7d ?? 0) - (b.price_change_7d ?? 0))
    .slice(0, HOT_MAX_ITEMS);
}

export default function HotStrip({ products, onSelect }: Props) {
  const hot = getHotProducts(products);
  if (hot.length < HOT_MIN_TO_SHOW) return null;

  return (
    <section className={styles.strip} aria-label="Hot deals right now">
      <h3 className={styles.heading}>🔥 Hot right now</h3>
      <div className={styles.row}>
        {hot.map((p) => (
          <button
            key={p.group_key}
            className={styles.item}
            onClick={() => onSelect(p)}
            type="button"
            aria-label={`View ${p.name} — ${Math.abs(p.price_change_7d!).toFixed(0)}% drop`}
          >
            {p.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image_url} alt="" className={styles.thumb} loading="lazy" />
            ) : (
              <div className={styles.thumbPlaceholder} />
            )}
            <span className={styles.name}>{p.name}</span>
            <span className={styles.price}>${p.price.toFixed(2)}</span>
            <span className={styles.drop}>↓{Math.abs(p.price_change_7d!).toFixed(0)}%</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/HotStrip.tsx styles/HotStrip.module.css
git commit -m "feat: add HotStrip component"
```

---

## Task 7: HotStrip — Tests

**Files:**
- Create: `__tests__/hotStrip.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/hotStrip.test.ts`:

```ts
import { getHotProducts } from "../components/HotStrip";
import type { Product } from "../components/ProductCard";

function makeProduct(overrides: Partial<Product>): Product {
  return {
    group_key: "test",
    name: "Test Product",
    price: 50,
    retailer: "Test Store",
    url: "https://example.com",
    is_preorder: false,
    updated: new Date().toISOString(),
    all_time_low: 40,
    price_change_7d: null,
    history: [],
    image_url: "",
    other_retailers: [],
    is_new: false,
    in_stock: true,
    back_in_stock: false,
    language: "English",
    product_type: "Booster Box",
    set_name: "Test Set",
    msrp: null,
    deal_score: 50,
    ...overrides,
  };
}

const recent = new Date().toISOString();
const stale  = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

describe("getHotProducts", () => {
  test("excludes products with drop less than 5%", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -3, updated: recent });
    expect(getHotProducts([p])).toHaveLength(0);
  });

  test("excludes products updated more than 48h ago", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -20, updated: stale });
    expect(getHotProducts([p])).toHaveLength(0);
  });

  test("includes product with >=5% drop updated within 48h", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -6, updated: recent });
    expect(getHotProducts([p])).toHaveLength(1);
  });

  test("sorts by biggest drop first", () => {
    const big   = makeProduct({ group_key: "big",   price_change_7d: -20, updated: recent });
    const small = makeProduct({ group_key: "small", price_change_7d: -6,  updated: recent });
    const result = getHotProducts([small, big]);
    expect(result[0].group_key).toBe("big");
  });

  test("caps at 8 results", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeProduct({ group_key: `p${i}`, price_change_7d: -10, updated: recent })
    );
    expect(getHotProducts(many)).toHaveLength(8);
  });

  test("returns empty array when no products qualify", () => {
    expect(getHotProducts([])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- __tests__/hotStrip.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/hotStrip.test.ts
git commit -m "test: add unit tests for getHotProducts"
```

---

## Task 8: HotStrip — Wire Into Index Page

**Files:**
- Modify: `pages/index.tsx`

- [ ] **Step 1: Add import to `pages/index.tsx`**

After the existing imports, add:

```ts
import HotStrip from "../components/HotStrip";
```

Also add state for the hot strip modal target:

```ts
const [hotProduct, setHotProduct] = useState<Product | null>(null);
```

Place this near the other `useState` calls at the top of `HomePage`.

- [ ] **Step 2: Render HotStrip between the stats bar and the controls section**

Find this comment in the JSX (around line 351):

```tsx
{/* ── Controls ────────────────────────────────────────────────────────── */}
```

Insert the `HotStrip` immediately before it:

```tsx
{/* ── Hot strip ──────────────────────────────────────────────────────── */}
{products.length > 0 && (
  <HotStrip products={products} onSelect={setHotProduct} />
)}
```

- [ ] **Step 3: Render the detail modal for hot strip selections**

Find the existing `autoAlertProduct` modal render (around line 595):

```tsx
{autoAlertProduct && (
  <ProductDetailModal
    product={autoAlertProduct}
    autoOpenAlert={true}
    onClose={() => setAutoAlertProduct(null)}
  />
)}
```

Add a second modal render immediately after:

```tsx
{hotProduct && (
  <ProductDetailModal
    product={hotProduct}
    onClose={() => setHotProduct(null)}
  />
)}
```

- [ ] **Step 4: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add pages/index.tsx
git commit -m "feat: add Hot right now strip to homepage"
```

---

## Task 9: CompareModal — Component

**Files:**
- Create: `components/CompareModal.tsx`
- Create: `styles/CompareModal.module.css`

- [ ] **Step 1: Create `styles/CompareModal.module.css`**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 500;
  padding: 0;
}

@media (min-width: 640px) {
  .overlay {
    align-items: center;
    padding: 16px;
  }
}

.modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 960px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

@media (min-width: 640px) {
  .modal {
    border-radius: 16px;
  }
}

.modalHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #21262d;
  position: sticky;
  top: 0;
  background: #0d1117;
  z-index: 1;
}

.title {
  font-size: 1rem;
  font-weight: 700;
  color: #c9d1d9;
  margin: 0;
}

.closeBtn {
  background: none;
  border: none;
  color: #8b949e;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}

.closeBtn:hover {
  background: #21262d;
  color: #c9d1d9;
}

.columns {
  display: grid;
  gap: 1px;
  background: #21262d;
  flex: 1;
  overflow-x: auto;
}

.col {
  background: #0d1117;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 220px;
}

.image {
  width: 100%;
  max-height: 140px;
  object-fit: contain;
  border-radius: 6px;
}

.name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #c9d1d9;
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid #21262d;
  padding-top: 10px;
}

.dataRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}

.dataLabel {
  color: #8b949e;
  flex-shrink: 0;
}

.dataValue {
  font-weight: 600;
  color: #c9d1d9;
  text-align: right;
}

.green  { color: #3fb950; }
.orange { color: #ffa657; }
.red    { color: #f85149; }

.sparkWrap {
  border-top: 1px solid #21262d;
  padding-top: 10px;
}

.retailerList {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid #21262d;
  padding-top: 10px;
}

.retailerRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dotGreen { background: #3fb950; }
.dotGrey  { background: #484f58; }

.retailerName {
  flex: 1;
  color: #8b949e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retailerPrice {
  font-family: "JetBrains Mono", monospace;
  font-weight: 700;
  color: #58a6ff;
  flex-shrink: 0;
}

.buyLink {
  color: #58a6ff;
  text-decoration: none;
  flex-shrink: 0;
}

.buyLink:hover { text-decoration: underline; }

.buyLinkOos { color: #8b949e; }

.colFooter {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid #21262d;
}

.buyBtn {
  display: block;
  text-align: center;
  background: #238636;
  color: #fff;
  padding: 8px;
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 600;
  transition: background 0.15s;
}

.buyBtn:hover { background: #2ea043; }

.removeBtn {
  background: none;
  border: 1px solid #30363d;
  color: #8b949e;
  font-size: 0.75rem;
  padding: 5px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  width: 100%;
}

.removeBtn:hover {
  border-color: #f85149;
  color: #f85149;
}

/* ── Floating compare bar ──────────────────────────────────────────────── */

.compareBar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #161b22;
  border-top: 1px solid #30363d;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 400;
  flex-wrap: wrap;
}

.compareBarItems {
  display: flex;
  gap: 8px;
  flex: 1;
}

.compareBarItem {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  overflow: visible;
  border: 1px solid #30363d;
}

.compareBarThumb {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 6px;
}

.compareBarRemove {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #21262d;
  border: 1px solid #30363d;
  color: #8b949e;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 0.55rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}

.compareBarRemove:hover { color: #f85149; }

.compareBarBtn {
  background: #238636;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.compareBarBtn:hover { background: #2ea043; }

.compareBarClear {
  background: none;
  border: none;
  color: #8b949e;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 4px;
  text-decoration: underline;
}

.compareBarClear:hover { color: #c9d1d9; }
```

- [ ] **Step 2: Create `components/CompareModal.tsx`**

```tsx
import { useEffect } from "react";
import Sparkline from "./Sparkline";
import DealScoreBreakdown from "./DealScoreBreakdown";
import { stripTrackingParams } from "./ProductCard";
import { SHIPPING_THRESHOLDS } from "../lib/shipping";
import type { Product } from "./ProductCard";
import styles from "../styles/CompareModal.module.css";

type ModalProps = {
  products: Product[];
  onClose: () => void;
  onRemove: (key: string) => void;
};

export default function CompareModal({ products, onClose, onRemove }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compare products"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.title}>Compare products</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close comparison"
          >
            ✕
          </button>
        </div>

        <div
          className={styles.columns}
          style={{ gridTemplateColumns: `repeat(${products.length}, 1fr)` }}
        >
          {products.map((p) => {
            const atlPct =
              p.all_time_low > 0
                ? ((p.price - p.all_time_low) / p.all_time_low) * 100
                : null;
            const isAtl = atlPct !== null && atlPct <= 0.01;
            const allRetailers = [
              { retailer: p.retailer, price: p.price, url: p.url, in_stock: p.in_stock },
              ...p.other_retailers,
            ].sort((a, b) => a.price - b.price);

            return (
              <div key={p.group_key} className={styles.col}>
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt={p.name} className={styles.image} />
                )}
                <h3 className={styles.name}>{p.name}</h3>

                <div className={styles.rows}>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Best price</span>
                    <span className={`${styles.dataValue}`}>
                      ${p.price.toFixed(2)}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>vs ATL</span>
                    <span
                      className={`${styles.dataValue} ${
                        isAtl ? styles.green : styles.orange
                      }`}
                    >
                      {isAtl
                        ? "AT ATL"
                        : atlPct !== null
                        ? `+${atlPct.toFixed(0)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>7-day</span>
                    <span
                      className={`${styles.dataValue} ${
                        p.price_change_7d !== null && p.price_change_7d < 0
                          ? styles.green
                          : p.price_change_7d !== null && p.price_change_7d > 0
                          ? styles.red
                          : ""
                      }`}
                    >
                      {p.price_change_7d !== null
                        ? `${p.price_change_7d < 0 ? "↓" : "↑"} ${Math.abs(
                            p.price_change_7d
                          ).toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className={styles.dataRow}>
                    <span className={styles.dataLabel}>Deal score</span>
                    <DealScoreBreakdown
                      product={p}
                      score={p.deal_score}
                      compact
                    />
                  </div>
                  {p.msrp !== null && (
                    <div className={styles.dataRow}>
                      <span className={styles.dataLabel}>MSRP</span>
                      <span className={styles.dataValue}>
                        ${p.msrp.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                <div className={styles.sparkWrap}>
                  <Sparkline points={p.history} />
                </div>

                <div className={styles.retailerList}>
                  {allRetailers.slice(0, 5).map((r) => (
                    <div key={r.retailer} className={styles.retailerRow}>
                      <span
                        className={`${styles.dot} ${
                          r.in_stock ? styles.dotGreen : styles.dotGrey
                        }`}
                      />
                      <span className={styles.retailerName}>{r.retailer}</span>
                      <span className={styles.retailerPrice}>
                        ${r.price.toFixed(2)}
                      </span>
                      <a
                        href={stripTrackingParams(r.url)}
                        target="_blank"
                        rel="noreferrer"
                        className={`${styles.buyLink} ${
                          !r.in_stock ? styles.buyLinkOos : ""
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.in_stock ? "Buy →" : "View →"}
                      </a>
                    </div>
                  ))}
                  {allRetailers.length > 5 && (
                    <p
                      style={{
                        fontSize: "0.72rem",
                        color: "#8b949e",
                        margin: 0,
                      }}
                    >
                      +{allRetailers.length - 5} more — open product for full list
                    </p>
                  )}
                </div>

                <div className={styles.colFooter}>
                  <a
                    href={stripTrackingParams(p.url)}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.buyBtn}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Buy best price →
                  </a>
                  <button
                    className={styles.removeBtn}
                    onClick={() => onRemove(p.group_key)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Floating compare bar ─────────────────────────────────────────────── */

type BarProps = {
  products: Product[];
  onRemove: (key: string) => void;
  onCompare: () => void;
  onClear: () => void;
};

export function CompareBar({ products, onRemove, onCompare, onClear }: BarProps) {
  if (products.length === 0) return null;

  return (
    <div className={styles.compareBar}>
      <div className={styles.compareBarItems}>
        {products.map((p) => (
          <div key={p.group_key} className={styles.compareBarItem}>
            {p.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image_url}
                alt={p.name}
                className={styles.compareBarThumb}
              />
            ) : (
              <div className={styles.compareBarThumb} />
            )}
            <button
              className={styles.compareBarRemove}
              onClick={() => onRemove(p.group_key)}
              type="button"
              aria-label={`Remove ${p.name} from comparison`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className={styles.compareBarBtn} onClick={onCompare} type="button">
        Compare ({products.length})
      </button>
      <button className={styles.compareBarClear} onClick={onClear} type="button">
        Clear all
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/CompareModal.tsx styles/CompareModal.module.css
git commit -m "feat: add CompareModal and CompareBar components"
```

---

## Task 10: Comparison Mode — Wire Into Index Page

**Files:**
- Modify: `pages/index.tsx`
- Modify: `components/ProductCard.tsx`

### Add compare state and URL sync

- [ ] **Step 1: Add imports to `pages/index.tsx`**

After the existing component imports, add:

```ts
import CompareModal, { CompareBar } from "../components/CompareModal";
```

- [ ] **Step 2: Add `compareList` and `showCompare` state in `pages/index.tsx`**

Near the other `useState` declarations at the top of `HomePage`, add:

```ts
const [compareList,  setCompareList]  = useState<Product[]>([]);
const [showCompare,  setShowCompare]  = useState(false);
```

- [ ] **Step 3: Add compare read from URL in `pages/index.tsx`**

The existing URL-read `useEffect` fires when `router.isReady` but products aren't loaded yet, so compare keys can't be resolved at that point. Add a **separate** `useEffect` that fires once products are loaded:

After the existing URL-sync effects (around line 140), add:

```ts
// Restore compare list from URL once products are loaded
useEffect(() => {
  if (!router.isReady || products.length === 0) return;
  const raw = router.query.compare;
  if (typeof raw !== "string" || !raw) return;
  const keys = raw.split(",").filter(Boolean);
  const matched = keys
    .map((k) => products.find((p) => p.group_key === k))
    .filter((p): p is Product => p !== undefined)
    .slice(0, 3);
  if (matched.length > 0) setCompareList(matched);
}, [router.isReady, products]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Add compare list to the URL write effect in `pages/index.tsx`**

Find the existing URL write `useEffect` (the one that calls `router.replace`). In the `params` object, add the compare keys before the `router.replace` call:

```ts
if (compareList.length > 0) params.compare = compareList.map((p) => p.group_key).join(",");
```

Add `compareList` to the dependency array of that effect.

- [ ] **Step 5: Add `toggleCompare` helper in `pages/index.tsx`**

After the `clearFilters` function, add:

```ts
function toggleCompare(product: Product) {
  setCompareList((prev) => {
    const exists = prev.some((p) => p.group_key === product.group_key);
    if (exists) return prev.filter((p) => p.group_key !== product.group_key);
    if (prev.length >= 3) return prev;
    return [...prev, product];
  });
}
```

### Add compare props to ProductCard

- [ ] **Step 6: Add compare props to `ProductCardProps` in `components/ProductCard.tsx`**

In the `ProductCardProps` type, add:

```ts
isInComparison?: boolean;
onToggleComparison?: (key: string) => void;
compareDisabled?: boolean;
```

- [ ] **Step 7: Add compare button to `ProductCard` JSX**

In `components/ProductCard.tsx`, add the compare button in the `cardTopRow` div, adjacent to the wishlist button. Find this block:

```tsx
{onToggleWishlist && (
  <button
    className={`${styles.wishlistBtn} ${isWishlisted ? styles.wishlistBtnActive : ""}`}
    ...
  >
```

Add the compare button **before** it:

```tsx
{onToggleComparison && (
  <button
    className={`${styles.compareBtn} ${isInComparison ? styles.compareBtnActive : ""} ${compareDisabled && !isInComparison ? styles.compareBtnDisabled : ""}`}
    onClick={(e) => { e.stopPropagation(); onToggleComparison(product.group_key); }}
    type="button"
    disabled={compareDisabled && !isInComparison}
    aria-label={isInComparison ? "Remove from comparison" : "Add to comparison"}
    title={isInComparison ? "Remove from comparison" : compareDisabled ? "Max 3 products" : "Compare this product"}
  >
    {isInComparison ? "⊠" : "⊞"}
  </button>
)}
```

- [ ] **Step 8: Add compare button styles to `styles/Card.module.css`**

Open `styles/Card.module.css` and append:

```css
.compareBtn {
  background: none;
  border: 1px solid #30363d;
  color: #8b949e;
  font-size: 1rem;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: border-color 0.15s, color 0.15s;
  flex-shrink: 0;
}

.compareBtn:hover:not(:disabled) {
  border-color: #58a6ff;
  color: #58a6ff;
}

.compareBtnActive {
  border-color: #58a6ff;
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

.compareBtnDisabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

### Wire compare into the ProductCard render in index.tsx

- [ ] **Step 9: Pass compare props to `ProductCard` in `pages/index.tsx`**

Find the `ProductCard` render in the grid (around line 569):

```tsx
<ProductCard
  key={product.group_key}
  product={product}
  onRetailerClick={handleRetailerClick}
  activeRetailer={retailer}
  isWishlisted={wishlist.hydrated ? wishlist.has(product.group_key) : false}
  onToggleWishlist={wishlist.toggle}
/>
```

Replace with:

```tsx
<ProductCard
  key={product.group_key}
  product={product}
  onRetailerClick={handleRetailerClick}
  activeRetailer={retailer}
  isWishlisted={wishlist.hydrated ? wishlist.has(product.group_key) : false}
  onToggleWishlist={wishlist.toggle}
  isInComparison={compareList.some((p) => p.group_key === product.group_key)}
  onToggleComparison={toggleCompare}
  compareDisabled={compareList.length >= 3}
/>
```

### Render CompareBar and CompareModal

- [ ] **Step 10: Add `CompareBar` and `CompareModal` to `pages/index.tsx`**

Find the `autoAlertProduct` modal render at the bottom of the JSX. Before the `<Footer>` component, add:

```tsx
<CompareBar
  products={compareList}
  onRemove={(key) => setCompareList((prev) => prev.filter((p) => p.group_key !== key))}
  onCompare={() => setShowCompare(true)}
  onClear={() => { setCompareList([]); setShowCompare(false); }}
/>

{showCompare && compareList.length > 0 && (
  <CompareModal
    products={compareList}
    onClose={() => setShowCompare(false)}
    onRemove={(key) => {
      const next = compareList.filter((p) => p.group_key !== key);
      setCompareList(next);
      if (next.length === 0) setShowCompare(false);
    }}
  />
)}
```

- [ ] **Step 11: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 12: Commit**

```bash
git add pages/index.tsx components/ProductCard.tsx styles/Card.module.css
git commit -m "feat: add product comparison mode with floating bar and modal"
```

---

## Task 11: Weekly Digest — API Endpoint

**Files:**
- Create: `pages/api/digest.ts`

- [ ] **Step 1: Create `pages/api/digest.ts`**

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { ApiResponse, Product } from "./products";

const SECRET = process.env.DIGEST_SECRET ?? "";
const TOP_N  = 10;

export type DigestDeal = Pick<
  Product,
  | "group_key"
  | "name"
  | "price"
  | "all_time_low"
  | "price_change_7d"
  | "deal_score"
  | "msrp"
  | "image_url"
  | "url"
  | "retailer"
>;

export type DigestResponse = {
  generated_at: string;
  week: string;
  deals: DigestDeal[];
};

function getWeekString(now: Date): string {
  const d = new Date(now);
  const dayOfWeek = d.getDay();
  const daysToMonday = (dayOfWeek + 6) % 7;
  d.setDate(d.getDate() - daysToMonday);
  return d.toISOString().slice(0, 10);
}

function buildHtml(deals: DigestDeal[], week: string): string {
  const rows = deals
    .map((d, i) => {
      const dropBadge =
        d.price_change_7d !== null && d.price_change_7d < 0
          ? `<span style="color:#3fb950;font-weight:700;">↓${Math.abs(
              d.price_change_7d
            ).toFixed(0)}%</span>`
          : "";
      const msrpLine =
        d.msrp !== null && d.msrp > d.price
          ? `<div style="font-size:12px;color:#8b949e;">MSRP $${d.msrp.toFixed(2)} &middot; ${(
              ((d.msrp - d.price) / d.msrp) *
              100
            ).toFixed(0)}% off</div>`
          : "";
      const imgTag = d.image_url
        ? `<img src="${d.image_url}" alt="" width="48" height="48" style="object-fit:contain;border-radius:4px;" />`
        : "";
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;font-size:13px;color:#8b949e;">${
            i + 1
          }</td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;">${imgTag}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;">
            <div style="font-weight:600;color:#c9d1d9;">${d.name}</div>
            <div style="font-size:12px;color:#8b949e;">${d.retailer}</div>
            ${msrpLine}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;text-align:right;white-space:nowrap;">
            <div style="font-family:monospace;font-weight:700;color:#58a6ff;">$${d.price.toFixed(
              2
            )}</div>
            ${dropBadge}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #30363d;vertical-align:middle;text-align:center;">
            <a href="${d.url}" style="background:#238636;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Buy</a>
          </td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pokemon TCG Top Deals — Week of ${week}</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <h1 style="color:#c9d1d9;font-size:20px;margin:0 0 4px;">🔥 Top Pokemon TCG deals</h1>
    <p style="color:#8b949e;font-size:13px;margin:0 0 24px;">Week of ${week} &middot; Canadian retailers &middot; Prices in CAD</p>
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:24px;font-size:12px;color:#8b949e;text-align:center;">
      <a href="{{unsubscribe_url}}" style="color:#58a6ff;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (SECRET) {
    const auth = (req.headers.authorization ?? "").trim();
    if (auth !== `Bearer ${SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const host = req.headers.host ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const productsRes = await fetch(`${protocol}://${host}/api/products`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!productsRes.ok) {
      throw new Error(`products endpoint returned ${productsRes.status}`);
    }

    const data = (await productsRes.json()) as ApiResponse;
    const products = data.products ?? [];

    const deals: DigestDeal[] = products
      .filter((p) => p.in_stock && p.deal_score > 0)
      .sort((a, b) => b.deal_score - a.deal_score)
      .slice(0, TOP_N)
      .map((p) => ({
        group_key:      p.group_key,
        name:           p.name,
        price:          p.price,
        all_time_low:   p.all_time_low,
        price_change_7d: p.price_change_7d,
        deal_score:     p.deal_score,
        msrp:           p.msrp,
        image_url:      p.image_url,
        url:            p.url,
        retailer:       p.retailer,
      }));

    const week         = getWeekString(new Date());
    const generated_at = new Date().toISOString();

    if (req.query.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
      return res.status(200).send(buildHtml(deals, week));
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json({ generated_at, week, deals } satisfies DigestResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
```

- [ ] **Step 2: Add `DIGEST_SECRET` to `.env.local`**

Open `.env.local` and append:

```
DIGEST_SECRET=change-me-to-a-long-random-string
```

Generate a real secret (e.g. `openssl rand -hex 32`) for production. For local dev, any non-empty value works.

- [ ] **Step 3: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/digest.ts .env.local
git commit -m "feat: add /api/digest endpoint for weekly deal email"
```

---

## Task 12: Weekly Digest — Preview Page

**Files:**
- Create: `pages/digest.tsx`
- Create: `styles/Digest.module.css`
- Modify: `components/NewsletterSignup.tsx`

- [ ] **Step 1: Create `styles/Digest.module.css`**

```css
.page {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}

.heading {
  font-size: 1.5rem;
  font-weight: 800;
  color: #c9d1d9;
  margin: 0 0 6px;
}

.sub {
  font-size: 0.85rem;
  color: #8b949e;
  margin: 0 0 28px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dealRow {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 10px;
  padding: 12px 14px;
  transition: border-color 0.15s;
}

.dealRow:hover {
  border-color: #30363d;
}

.rank {
  font-size: 0.78rem;
  color: #8b949e;
  font-weight: 700;
  width: 20px;
  flex-shrink: 0;
  text-align: center;
}

.thumb {
  width: 52px;
  height: 52px;
  object-fit: contain;
  border-radius: 6px;
  flex-shrink: 0;
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #c9d1d9;
  margin: 0 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retailer {
  font-size: 0.75rem;
  color: #8b949e;
  margin: 0;
}

.msrp {
  font-size: 0.72rem;
  color: #3fb950;
  margin: 2px 0 0;
}

.right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.price {
  font-size: 0.95rem;
  font-weight: 800;
  color: #58a6ff;
  font-family: "JetBrains Mono", monospace;
}

.drop {
  font-size: 0.72rem;
  font-weight: 700;
  color: #3fb950;
  background: rgba(63, 185, 80, 0.12);
  padding: 1px 6px;
  border-radius: 6px;
}

.atl {
  font-size: 0.65rem;
  font-weight: 700;
  color: #ffa657;
  background: rgba(255, 166, 87, 0.12);
  padding: 1px 5px;
  border-radius: 5px;
}

.buyBtn {
  background: #238636;
  color: #fff;
  padding: 5px 10px;
  border-radius: 7px;
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 600;
  transition: background 0.15s;
  white-space: nowrap;
}

.buyBtn:hover {
  background: #2ea043;
}

.footer {
  margin-top: 28px;
  font-size: 0.75rem;
  color: #8b949e;
  text-align: center;
}

.error {
  color: #f85149;
  font-size: 0.9rem;
  text-align: center;
  padding: 40px;
}
```

- [ ] **Step 2: Create `pages/digest.tsx`**

```tsx
import type { GetServerSideProps } from "next";
import Link from "next/link";
import type { DigestResponse } from "./api/digest";
import styles from "../styles/Digest.module.css";

type Props = { digest: DigestResponse | null };

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
  const host     = req.headers.host ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const secret   = process.env.DIGEST_SECRET ?? "";

  try {
    const res = await fetch(`${protocol}://${host}/api/digest`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) return { props: { digest: null } };
    const digest = (await res.json()) as DigestResponse;
    return { props: { digest } };
  } catch {
    return { props: { digest: null } };
  }
};

export default function DigestPage({ digest }: Props) {
  if (!digest) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Could not load this week&apos;s deals right now.</p>
        <p style={{ textAlign: "center" }}>
          <Link href="/">← Back to tracker</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>🔥 Top Pokemon TCG deals</h1>
      <p className={styles.sub}>
        Week of {digest.week} &middot; Canadian retailers &middot; Prices in CAD
      </p>

      <div className={styles.list}>
        {digest.deals.map((deal, i) => {
          const isAtl =
            deal.all_time_low > 0 && deal.price <= deal.all_time_low + 0.0001;
          const hasDiscount =
            deal.msrp !== null && deal.msrp > deal.price;
          const savings =
            hasDiscount
              ? (((deal.msrp! - deal.price) / deal.msrp!) * 100).toFixed(0)
              : null;

          return (
            <div key={deal.group_key} className={styles.dealRow}>
              <span className={styles.rank}>{i + 1}</span>
              {deal.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={deal.image_url}
                  alt=""
                  className={styles.thumb}
                  loading="lazy"
                />
              ) : (
                <div className={styles.thumb} />
              )}
              <div className={styles.info}>
                <p className={styles.name}>{deal.name}</p>
                <p className={styles.retailer}>{deal.retailer}</p>
                {hasDiscount && (
                  <p className={styles.msrp}>
                    {savings}% off MSRP (${deal.msrp!.toFixed(2)})
                  </p>
                )}
              </div>
              <div className={styles.right}>
                <span className={styles.price}>${deal.price.toFixed(2)}</span>
                {deal.price_change_7d !== null && deal.price_change_7d < 0 && (
                  <span className={styles.drop}>
                    ↓{Math.abs(deal.price_change_7d).toFixed(0)}%
                  </span>
                )}
                {isAtl && <span className={styles.atl}>ATL</span>}
                <a
                  href={deal.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.buyBtn}
                >
                  Buy →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.footer}>
        Generated{" "}
        {new Date(digest.generated_at).toLocaleString("en-CA", {
          timeZone: "America/Toronto",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        {" · "}
        <Link href="/">← Back to tracker</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add "Preview this week's deals" link to `components/NewsletterSignup.tsx`**

Find the description paragraph (the one with the 🔔 bell, around line 65):

```tsx
<p className={styles.label}>
  <span className={styles.bell}>🔔</span>
  Get notified — new preorders &amp; best weekly drops, straight to your inbox
</p>
```

Replace with:

```tsx
<p className={styles.label}>
  <span className={styles.bell}>🔔</span>
  Get notified — new preorders &amp; best weekly drops, straight to your inbox.{" "}
  <a href="/digest" style={{ color: "#58a6ff", fontSize: "0.85em" }}>
    Preview this week&apos;s deals →
  </a>
</p>
```

- [ ] **Step 4: Build to confirm no errors**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add pages/digest.tsx styles/Digest.module.css components/NewsletterSignup.tsx
git commit -m "feat: add /digest preview page and newsletter link"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests in `__tests__/dealScore.test.ts` and `__tests__/hotStrip.test.ts` PASS.

- [ ] **Step 2: Run a production build**

```bash
npm run build
```

Expected: clean build, no TypeScript errors, no missing module warnings.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Open `http://localhost:3000` and verify:

1. **Deal score tooltip** — hover a product card's score badge; tooltip shows 3–4 signals. Tap works on mobile too.
2. **Hot strip** — if any products qualify (≥5% drop, updated <48h), the strip appears above the filter controls. Click a strip item to open the product detail modal.
3. **Comparison mode** — click the ⊞ icon on two or three cards; floating bar appears at bottom with thumbnails. Click "Compare (N)" to open the modal. Verify columns, sparklines, retailer list, "Remove" button, and Escape to close. Paste the URL with `?compare=...` into a new tab; confirm the comparison restores.
4. **Digest preview** — open `http://localhost:3000/digest`; verify the top-10 deals list renders with prices, drop badges, and buy buttons. Click "Buy →" link, confirm it works.
5. **Newsletter link** — check the hero section's newsletter block; "Preview this week's deals →" link should appear and navigate to `/digest`.

- [ ] **Step 4: Final commit (if any last fixes were made)**

```bash
git add -A
git commit -m "chore: final smoke-test fixes"
```
