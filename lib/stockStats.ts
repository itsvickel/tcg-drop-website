/**
 * stockStats.ts — reading `stock_stats.json`, the restock-rhythm and
 * sellout-speed aggregate built by `update_stock_stats.py` in tcg-drop-alert.
 *
 * Every judgement about whether a claim is supportable was made upstream, on
 * the full event history, and is baked into the payload: a retailer arrives
 * with `verdict: "pattern" | "spread" | "insufficient"`, a shelf-life bucket
 * arrives only once it has enough closed runs to mean something, and a product
 * gets a cadence only once it has restocked enough times to have one. This
 * module's job is to render those verdicts, never to second-guess them and
 * never to invent a softer version of a claim the aggregate declined to make.
 *
 * Two honesty rules the UI has to carry, because the data cannot:
 *
 *   1. Never show an hour. The trackers run twice a day, so the finest bucket
 *      that exists is a weekday, and even that is dated in UTC — the evening
 *      scan lands late the previous day in Eastern time. Wherever a weekday
 *      shows, the sample size shows with it.
 *   2. A restock cadence is a description of the past, not a schedule. Phrases
 *      here say "usually", "typically", "tends to"; none of them says "will".
 *      A shop that restocked every 18 days for three months has made no promise
 *      about day 19.
 */

/** A retailer's restock weekday profile. Mirrors stock_stats_core.weekday_profile. */
export type RetailerPattern = {
  restocks: number;
  /** Monday-first counts, always length 7. */
  by_weekday: number[];
  /** Named only when verdict is "pattern". */
  top_days: string[];
  top_share: number | null;
  p_value: number | null;
  verdict: "pattern" | "spread" | "insufficient";
  first_restock: string;
  last_restock: string;
  products: number;
};

export type ShelfLife = {
  runs: number;
  median_days: number;
  p25_days: number;
  p75_days: number;
  gone_within_a_day_pct: number;
};

export type ProductRhythm = {
  restocks: number;
  median_gap_days: number;
  p25_gap_days: number;
  p75_gap_days: number;
  last_restock: string;
  days_since_restock: number;
  typical_days_in_stock: number | null;
};

export type StockStats = {
  generated_at: string;
  game: string;
  coverage: {
    restocks: number;
    from_scan: number;
    from_history: number;
    first_event: string | null;
    last_event: string | null;
    measurable_runs: number;
    open_runs: number;
    observed_days: number;
    span_days: number;
    first_observed: string | null;
    last_observed: string | null;
  };
  limits: {
    scan_interval_hours: number;
    resolution: string;
    min_gap_days: number;
    min_restocks_for_pattern: number;
    date_basis: string;
  };
  retailers: Record<string, RetailerPattern>;
  shelf_life: {
    overall: ShelfLife | null;
    by_size_class: Record<string, ShelfLife>;
  };
  products: Record<string, ProductRhythm>;
};

export const EMPTY_STOCK_STATS: StockStats = {
  generated_at: "",
  game: "",
  coverage: {
    restocks: 0,
    from_scan: 0,
    from_history: 0,
    first_event: null,
    last_event: null,
    measurable_runs: 0,
    open_runs: 0,
    observed_days: 0,
    span_days: 0,
    first_observed: null,
    last_observed: null,
  },
  limits: {
    scan_interval_hours: 12,
    resolution: "day",
    min_gap_days: 2,
    min_restocks_for_pattern: 8,
    date_basis: "UTC",
  },
  retailers: {},
  shelf_life: { overall: null, by_size_class: {} },
  products: {},
};

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Merge two games' stats into one view.
 *
 * Retailer pages span both games — 401 Games sells Pokemon and Magic — so a
 * page that showed only one game's profile would be describing a fraction of
 * the shop's activity and calling it the shop.
 *
 * Weekday counts add cleanly, but `verdict` does not: two "spread" games can
 * sum to a real pattern and two patterns on different days can cancel. So the
 * counts are summed and the verdict is left for `combinedVerdict` to re-derive
 * from the total, using the same rule the aggregate applied per game.
 */
export function mergePatterns(parts: (RetailerPattern | undefined)[]): RetailerPattern | null {
  const present = parts.filter((p): p is RetailerPattern => !!p);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];

  const by_weekday = [0, 0, 0, 0, 0, 0, 0];
  for (const part of present) {
    part.by_weekday.forEach((n, i) => {
      by_weekday[i] += n;
    });
  }
  const restocks = by_weekday.reduce((a, b) => a + b, 0);

  return {
    ...combinedVerdict(by_weekday, restocks),
    restocks,
    by_weekday,
    first_restock: present.map((p) => p.first_restock).sort()[0],
    last_restock: present.map((p) => p.last_restock).sort().slice(-1)[0],
    products: present.reduce((sum, p) => sum + p.products, 0),
  };
}

/**
 * The share and verdict for a merged weekday histogram.
 *
 * Deliberately the weaker of the two tests the aggregate applies: it checks the
 * concentration floor but not the binomial tail, because reimplementing a
 * Bonferroni-corrected binomial in the browser to second-guess Python is how
 * the two drift apart. A merged profile therefore has to clear a concentration
 * bar and carry enough restocks, and it never claims more than a per-game
 * verdict would.
 */
const MERGED_MIN_RESTOCKS = 16;
const MERGED_MIN_SHARE = 0.45;

function combinedVerdict(
  by_weekday: number[],
  restocks: number
): Pick<RetailerPattern, "top_days" | "top_share" | "p_value" | "verdict"> {
  if (restocks < MERGED_MIN_RESTOCKS) {
    return { top_days: [], top_share: null, p_value: null, verdict: "insufficient" };
  }
  const ranked = by_weekday
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
  const top = ranked.slice(0, 2).sort((a, b) => a.index - b.index);
  const share = top.reduce((sum, d) => sum + d.count, 0) / restocks;

  if (share < MERGED_MIN_SHARE) {
    return { top_days: [], top_share: share, p_value: null, verdict: "spread" };
  }
  return {
    top_days: top.map((d) => WEEKDAY_FULL[d.index]),
    top_share: share,
    p_value: null,
    verdict: "pattern",
  };
}

export const WEEKDAY_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** "Tuesdays and Saturdays" — plural, because this describes a habit. */
export function joinDays(days: string[]): string {
  const plural = days.map((d) => `${d}s`);
  if (plural.length <= 1) return plural[0] ?? "";
  return `${plural.slice(0, -1).join(", ")} and ${plural[plural.length - 1]}`;
}

/**
 * One sentence describing a shop's restock habit, or null when there is nothing
 * honest to say. Callers render the null case as "not enough data yet" rather
 * than hiding the section: the absence is informative, and hiding it invites
 * the reader to assume we simply have not looked.
 */
export function restockSentence(pattern: RetailerPattern | null): string | null {
  if (!pattern || pattern.verdict !== "pattern" || pattern.top_days.length === 0) {
    return null;
  }
  const share = Math.round((pattern.top_share ?? 0) * 100);
  return `Usually restocks on ${joinDays(pattern.top_days)} — ${share}% of ${pattern.restocks} restocks landed on those two days.`;
}

/** Relative intensity of a weekday cell, 0–1, against the busiest day. */
export function weekdayIntensity(pattern: RetailerPattern): number[] {
  const peak = Math.max(...pattern.by_weekday, 0);
  if (peak <= 0) return pattern.by_weekday.map(() => 0);
  return pattern.by_weekday.map((n) => n / peak);
}

export type RestockOutlook = {
  /** "soon" | "due" | "overdue" | "quiet" — drives tone, not a promise. */
  state: "soon" | "due" | "overdue" | "quiet";
  text: string;
  detail: string;
};

/**
 * The out-of-stock hint: what this product's own restock history suggests.
 *
 * Returns null when the product has no cadence on record, which is the common
 * case and the correct one — most products have restocked once or not at all,
 * and two sightings is not a rhythm.
 *
 * `daysSince` is recomputed here from `last_restock` rather than read from the
 * payload's own `days_since_restock`, which was correct when the file was
 * generated and drifts every day after.
 */
export function restockOutlook(
  rhythm: ProductRhythm | undefined,
  now: Date = new Date()
): RestockOutlook | null {
  if (!rhythm || !rhythm.median_gap_days) return null;

  const last = Date.parse(`${rhythm.last_restock}T00:00:00Z`);
  if (Number.isNaN(last)) return null;
  const daysSince = Math.max(0, Math.floor((now.getTime() - last) / 86_400_000));

  const median = Math.round(rhythm.median_gap_days);
  const detail = `Restocked ${rhythm.restocks} times while we have been watching, typically every ${median} ${median === 1 ? "day" : "days"}.`;

  if (daysSince >= rhythm.p75_gap_days) {
    return {
      state: "overdue",
      text: `Out longer than usual — normally back within ${Math.round(rhythm.p75_gap_days)} days`,
      detail,
    };
  }
  if (daysSince >= rhythm.p25_gap_days) {
    return {
      state: "due",
      text: `Around due for a restock — usually every ${median} days`,
      detail,
    };
  }
  if (daysSince >= rhythm.p25_gap_days / 2) {
    return {
      state: "soon",
      text: `Usually back in about ${Math.max(1, median - daysSince)} days`,
      detail,
    };
  }
  return {
    state: "quiet",
    text: `Usually restocks every ${median} days`,
    detail,
  };
}

/** How long this kind of product tends to stay on the shelf, if we know. */
export function shelfLifeSentence(shelf: ShelfLife | null | undefined, unit: string): string | null {
  if (!shelf) return null;
  const days = Math.round(shelf.median_days);
  const quick = Math.round(shelf.gone_within_a_day_pct * 100);
  const noun = days === 1 ? "day" : "days";
  return `${unit} have been lasting about ${days} ${noun} in stock (${quick}% sold out within a day, across ${shelf.runs} restocks).`;
}
