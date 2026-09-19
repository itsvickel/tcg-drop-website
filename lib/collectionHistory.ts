/**
 * collectionHistory.ts — what your collection would have been worth, day by day.
 *
 * The collection page prices what you hold at today's best price and has no
 * memory. This reconstructs a daily series from the price history we already
 * keep, so the answer to "is my stuff going up?" does not require having
 * started tracking months ago.
 *
 * WHAT THE LINE MEANS, precisely: the value of the basket you hold *today*,
 * priced backwards. It is not a record of your account balance. Someone who
 * bought half their collection last week still sees the whole basket priced
 * across the whole window, because we do not know when things were acquired —
 * `purchased_at` is optional and usually blank. Inventing acquisition dates to
 * make the line look like a balance would produce a chart that is wrong in a
 * way nobody could detect. The UI states the constant-basket reading in words.
 *
 * Three reconstruction traps, each of which produces a flattering lie:
 *
 *   1. The coverage ramp. Products enter price history on different dates. A
 *      basket summed over whatever has data on each day starts small and grows
 *      as coverage fills in, drawing a rising line out of nothing but our own
 *      onboarding. `chooseWindow` fixes the basket first and only then draws:
 *      the window starts where enough of the basket already has data, and
 *      products that begin later are excluded from the series entirely rather
 *      than joining partway through.
 *
 *   2. Sold-out gaps. price_history has no row for a day a product was
 *      unbuyable everywhere. Treating a gap as zero would show a crash and
 *      recovery every time something sold out, so the last known price is
 *      carried forward. That is an assumption, and it is the conservative one:
 *      it holds value flat rather than inventing movement.
 *
 *   3. Partial coverage read as total. A basket where a third of the value has
 *      no usable history is still worth charting, but the reader has to be told
 *      what fraction they are looking at. Every result carries its coverage.
 */

export type PricePoint = { date: string; price: number };

export type BasketItem = {
  group_key: string;
  quantity: number;
  /** Daily price points, ascending by date. May have gaps. */
  history: PricePoint[];
  /** Today's per-unit price, used to weight coverage by value. */
  marketPrice: number | null;
};

export type ValuePoint = { date: string; value: number };

export type CollectionSeries = {
  points: ValuePoint[];
  /** Holdings represented in the line. */
  included: number;
  /** Holdings left out — no history, or history that starts too late. */
  excluded: number;
  /** Share of today's market value the line represents, 0–1. */
  valueCoverage: number;
  startDate: string | null;
  endDate: string | null;
  /** Change across the window, in dollars and percent. Null when too short. */
  change: number | null;
  changePct: number | null;
};

export const EMPTY_SERIES: CollectionSeries = {
  points: [],
  included: 0,
  excluded: 0,
  valueCoverage: 0,
  startDate: null,
  endDate: null,
  change: null,
  changePct: null,
};

/**
 * Fraction of today's value that must already have price data before the window
 * is allowed to open. Below this the line is describing a different basket than
 * the totals above it, and the two disagreeing on the same screen is worse than
 * a shorter chart.
 */
export const MIN_VALUE_COVERAGE = 0.9;

/** A chart of three points is a rounding error with an axis. */
export const MIN_POINTS = 5;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  // Bounded rather than while(true): a malformed date pair must not spin.
  for (let i = 0; i < 400 && cursor <= end; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * The earliest start date at which enough of the basket's value already has
 * price data, plus the items that qualify at that date.
 *
 * Walks candidate starts from earliest to latest and takes the first that
 * clears the coverage bar, which maximises window length subject to the basket
 * being constant across it.
 */
export function chooseWindow(items: BasketItem[]): { start: string | null; included: BasketItem[] } {
  const usable = items.filter((i) => i.history.length > 0);
  if (usable.length === 0) return { start: null, included: [] };

  const totalValue = items.reduce(
    (sum, i) => sum + (i.marketPrice ?? 0) * i.quantity,
    0
  );

  const firstDates = usable
    .map((i) => i.history[0].date)
    .sort();

  for (const candidate of firstDates) {
    const included = usable.filter((i) => i.history[0].date <= candidate);
    const covered = included.reduce(
      (sum, i) => sum + (i.marketPrice ?? 0) * i.quantity,
      0
    );
    // A basket with no priced items at all falls back to counting holdings, so
    // a collection of delisted products still gets a window rather than a
    // divide-by-zero.
    const ratio = totalValue > 0 ? covered / totalValue : included.length / items.length;
    if (ratio >= MIN_VALUE_COVERAGE) {
      return { start: candidate, included };
    }
  }

  // Nothing clears the bar. Use the widest basket available — the caller still
  // gets an honest coverage number and can decide whether to draw it.
  const latest = firstDates[firstDates.length - 1];
  return { start: latest, included: usable.filter((i) => i.history[0].date <= latest) };
}

/** Price on each day of the window, carrying the last known price over gaps. */
function forwardFill(history: PricePoint[], days: string[]): (number | null)[] {
  const byDate = new Map(history.map((p) => [p.date, p.price]));
  let last: number | null = null;
  return days.map((day) => {
    const price = byDate.get(day);
    if (price !== undefined) last = price;
    return last;
  });
}

/**
 * Build the daily value series for a basket.
 *
 * `today` is passed rather than read so the function is testable and so a
 * server-rendered and a client-rendered call cannot disagree about the last
 * point on the chart.
 */
export function buildSeries(items: BasketItem[], today: string): CollectionSeries {
  if (!items.length) return EMPTY_SERIES;

  const { start, included } = chooseWindow(items);
  if (!start || included.length === 0) {
    return { ...EMPTY_SERIES, excluded: items.length };
  }

  const days = dateRange(start, today);
  if (days.length < MIN_POINTS) {
    return { ...EMPTY_SERIES, excluded: items.length };
  }

  const filled = included.map((item) => ({
    quantity: item.quantity,
    prices: forwardFill(item.history, days),
  }));

  const points: ValuePoint[] = days.map((date, i) => {
    let value = 0;
    for (const item of filled) {
      const price = item.prices[i];
      if (price !== null) value += price * item.quantity;
    }
    return { date, value: Math.round(value * 100) / 100 };
  });

  const totalValue = items.reduce((sum, i) => sum + (i.marketPrice ?? 0) * i.quantity, 0);
  const coveredValue = included.reduce((sum, i) => sum + (i.marketPrice ?? 0) * i.quantity, 0);

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const change = last - first;

  return {
    points,
    included: included.length,
    excluded: items.length - included.length,
    valueCoverage: totalValue > 0 ? coveredValue / totalValue : 0,
    startDate: days[0],
    endDate: days[days.length - 1],
    change: Math.round(change * 100) / 100,
    // A basket that started at zero has no percentage to report; showing
    // "+Infinity%" or "+100%" would both be inventions.
    changePct: first > 0 ? (change / first) * 100 : null,
  };
}

/** Plain-language caveat about what the line does and does not cover. */
export function seriesNote(series: CollectionSeries): string | null {
  if (!series.points.length) return null;
  const parts: string[] = [
    "This is what the items you hold now would have been worth, not a record of your balance over time.",
  ];
  if (series.excluded > 0) {
    parts.push(
      `${series.excluded} holding${series.excluded === 1 ? "" : "s"} left out — we have not tracked ${series.excluded === 1 ? "it" : "them"} long enough.`
    );
  }
  if (series.valueCoverage < 0.999) {
    parts.push(`The line covers ${Math.round(series.valueCoverage * 100)}% of today's value.`);
  }
  return parts.join(" ");
}
