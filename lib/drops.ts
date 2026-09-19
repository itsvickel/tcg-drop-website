/**
 * drops.ts — types + view helpers for the upcoming-drops feed.
 *
 * release_calendar.json answers "what is coming and roughly when". drops.json
 * answers the two questions it cannot:
 *
 *   WHEN exactly   go_live.at — an instant, not a date
 *   WHERE          a list of storefronts with a live status
 *
 * plus a confidence percentage that replaces the calendar's coarse
 * confirmed/tentative/tba label. The percentage is produced by drops_core.py in
 * the tcg-drop-alert repo and always ships with the signals that produced it,
 * so the UI never shows a bare number the reader has to take on trust.
 *
 * An asymmetry worth knowing when reading this file: only MTG gets exact
 * go-live times, because Secret Lair is the sole source in either game that
 * publishes them. Pokemon drops carry retailer detection only. `precision`
 * records which is which so the UI never implies accuracy it does not have.
 */

export const TBA_DATE = "9999-12-31";

export type GoLivePrecision = "exact" | "day" | "month" | "unknown";
export type DropKind = "secret_lair" | "set" | "product";
export type ListingStatus = "live" | "coming_soon" | "sold_out" | "unknown";

export type GoLive = {
  /** ISO-8601 UTC instant. */
  at: string;
  source_tz?: string;
  precision: GoLivePrecision;
};

export type Listing = {
  retailer: string;
  status: ListingStatus;
  url: string;
  region?: string;
  /** A Queue-it style waiting room fronts this storefront at drop time. */
  queue?: boolean;
  price?: number;
  currency?: string;
  image_url?: string;
  first_seen?: string;
};

export type ConfidenceSignal = {
  label: string;
  value: string;
  /** Points this signal contributed. Negative values reduce the score. */
  weight: number;
};

export type Confidence = {
  score: number;
  label: string;
  signals: ConfidenceSignal[];
};

/**
 * How fast this *kind* of product sells out, attached by drops_core.attach_sellout.
 *
 * A sibling of `confidence`, never a part of it. `confidence.score` means one
 * thing — the probability the drop lands on its stated date — and the
 * calibration log on /drops measures it against exactly that. Folding demand
 * into it would silently change what every historical bucket was measuring.
 *
 * Optional because most drops do not get one: a drop has to name a unit of
 * product we have enough closed restocks for.
 */
export type Sellout = {
  /** "box" | "bundle" | "pack" | … — the unit this figure describes. */
  size_class: string;
  median_days: number;
  p25_days: number;
  gone_within_a_day_pct: number;
  runs: number;
};

export type DropChange = {
  at: string;
  field: string;
  from: string;
  to: string;
};

export type NewsLink = {
  source: string;
  title: string;
  url: string;
  date?: string;
};

export type Drop = {
  id: string;
  game: string;
  kind: DropKind;
  name: string;
  series?: string;
  type?: string;
  url?: string;
  image_url?: string;
  notes?: string;
  release_date: string;
  go_live?: GoLive;
  where: Listing[];
  confidence: Confidence;
  sellout?: Sellout;
  sources: string[];
  news?: NewsLink[];
  first_seen?: string;
  last_seen?: string;
  changes?: DropChange[];
};

export type DropEventType =
  | "announced"
  | "date_moved"
  | "date_set"
  | "time_changed"
  | "preorder_opened"
  | "went_live"
  | "sold_out";

export type DropEvent = {
  at: string;
  type: DropEventType;
  drop_id: string;
  game: string;
  name: string;
  text: string;
  retailer?: string;
  url?: string;
};

export type Attribution = {
  source: string;
  name: string;
  url: string;
  licence: string | null;
};

export type CalibrationBand = {
  band: string;
  label: string;
  n: number;
  hits: number;
  accuracy: number | null;
};

export type DropsResponse = {
  generated_at: string;
  mode?: string;
  attribution: Attribution[];
  calibration: CalibrationBand[];
  drops: Drop[];
  events: DropEvent[];
};

// ── View helpers ──────────────────────────────────────────────────────────────

export function isDated(drop: Drop): boolean {
  return !!drop.release_date && drop.release_date !== TBA_DATE;
}

/** Whole days from now until an ISO date, in Toronto terms. Negative = past. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const target = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime();
  const today = new Date(`${now.toISOString().slice(0, 10)}T12:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

export type Countdown = { days: number; hours: number; minutes: number; seconds: number; past: boolean };

export function countdownTo(isoInstant: string, now: Date = new Date()): Countdown {
  let delta = Math.floor((new Date(isoInstant).getTime() - now.getTime()) / 1000);
  const past = delta <= 0;
  delta = Math.abs(delta);
  return {
    days: Math.floor(delta / 86_400),
    hours: Math.floor((delta % 86_400) / 3_600),
    minutes: Math.floor((delta % 3_600) / 60),
    seconds: delta % 60,
    past,
  };
}

export function formatCountdown(c: Countdown): string {
  if (c.days > 0) return `${c.days}d ${c.hours}h`;
  if (c.hours > 0) return `${c.hours}h ${c.minutes}m`;
  return `${c.minutes}m ${c.seconds}s`;
}

/** Go-live rendered in the reader's own timezone, since that is what they act in. */
export function formatGoLive(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatReleaseDate(iso: string): string {
  if (!iso || iso === TBA_DATE || iso.startsWith("9999")) return "Date TBA";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Score band, used for colour. Mirrors confidence_label in drops_core.py. */
export type ConfidenceBand = "locked" | "likely" | "soft" | "rumour" | "undated";

export function confidenceBand(score: number): ConfidenceBand {
  if (score <= 0) return "undated";
  if (score >= 90) return "locked";
  if (score >= 70) return "likely";
  if (score >= 45) return "soft";
  return "rumour";
}

export type SelloutBand = "instant" | "fast" | "steady" | "relaxed";

/**
 * Urgency bands for shelf life, in days.
 *
 * The boundaries are set by what a buyer would actually do differently, not by
 * even spacing. Under two days means being there when it goes live is the only
 * way to get one; a week or more means the decision can wait for payday.
 */
export function selloutBand(medianDays: number): SelloutBand {
  if (medianDays <= 1) return "instant";
  if (medianDays <= 3) return "fast";
  if (medianDays <= 7) return "steady";
  return "relaxed";
}

export function bestListing(drop: Drop): Listing | undefined {
  const order: ListingStatus[] = ["unknown", "sold_out", "coming_soon", "live"];
  return [...(drop.where ?? [])].sort((a, b) => {
    const rank = order.indexOf(b.status) - order.indexOf(a.status);
    if (rank !== 0) return rank;
    return (a.price ?? Infinity) - (b.price ?? Infinity);
  })[0];
}

export function isLiveNow(drop: Drop): boolean {
  return (drop.where ?? []).some((w) => w.status === "live");
}

// ── Feed sections ─────────────────────────────────────────────────────────────

export const SOON_DAYS = 14;

export type DropSections = {
  /** Live now, or going live within SOON_DAYS. */
  soon: Drop[];
  /** Dated further out. */
  scheduled: Drop[];
  /** Announced with no date yet. */
  undated: Drop[];
};

export function sectionDrops(drops: Drop[], now: Date = new Date()): DropSections {
  const soon: Drop[] = [];
  const scheduled: Drop[] = [];
  const undated: Drop[] = [];

  for (const drop of drops ?? []) {
    if (!isDated(drop)) {
      undated.push(drop);
      continue;
    }
    // A drop whose release has passed but is still purchasable stays in "soon";
    // one that has passed and sold out everywhere drops out of the feed.
    const days = daysUntil(drop.release_date, now);
    if (days < 0 && !isLiveNow(drop)) continue;
    if (days <= SOON_DAYS || isLiveNow(drop)) soon.push(drop);
    else scheduled.push(drop);
  }

  const byDate = (a: Drop, b: Drop) => a.release_date.localeCompare(b.release_date);
  const byConfidence = (a: Drop, b: Drop) => (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0);

  soon.sort((a, b) => {
    const aLive = isLiveNow(a) ? 0 : 1;
    const bLive = isLiveNow(b) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return byDate(a, b);
  });
  scheduled.sort(byDate);
  undated.sort(byConfidence);

  return { soon, scheduled, undated };
}

export const EVENT_LABELS: Record<DropEventType, string> = {
  announced: "Announced",
  date_moved: "Date moved",
  date_set: "Date confirmed",
  time_changed: "Time changed",
  preorder_opened: "Pre-orders opened",
  went_live: "Went live",
  sold_out: "Sold out",
};
