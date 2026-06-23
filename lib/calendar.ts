/**
 * calendar.ts — release-calendar types + the live-price join.
 *
 * release_calendar.json (in the data repo) holds the canonical, cross-validated
 * drop schedule: set entries with dates + confidence and a real product lineup.
 * It deliberately stores NO prices. At read time `joinCalendar` matches each
 * listed product to the live scraped products (same TS classifier on both sides)
 * and attaches current price / stock / MSRP, so prices are always fresh.
 */
import type { TcgConfig } from "./tcg.config";
import { extractLanguage, extractProductType, type Product } from "./products";

export type Confidence = "confirmed" | "tentative" | "tba";

/** Sentinel used by the crawler for "announced, no date yet". */
export const TBA_DATE = "9999-12-31";

// ── Raw shapes (as stored in release_calendar.json) ───────────────────────────
// `products` may be a legacy bare string or the new object form.

export type RawCalendarProduct =
  | string
  | {
      name: string;
      product_type?: string;
      release_date?: string;
      date_confidence?: Confidence;
    };

export type RawCalendarSet = {
  name: string;
  series: string;
  release_date: string;
  date_confidence?: Confidence;
  type: string;
  sources?: string[];
  products: RawCalendarProduct[];
  notes?: string;
  url?: string;
  manual_override?: boolean;
};

export type RawCalendarResponse = { sets: RawCalendarSet[] };

// ── Enriched shapes (what the API returns / the UI consumes) ───────────────────

export type CalendarProduct = {
  name: string;
  product_type: string;
  release_date?: string;
  date_confidence?: Confidence;
  // joined live, present only when a live product matched:
  price?: number;
  msrp?: number | null;
  in_stock?: boolean;
  url?: string;
  image_url?: string;
  deal_score?: number;
  group_key?: string;
};

export type CalendarSet = {
  name: string;
  series: string;
  release_date: string;
  date_confidence: Confidence;
  type: string;
  sources?: string[];
  products: CalendarProduct[];
  notes?: string;
  url?: string;
};

export type CalendarResponse = { sets: CalendarSet[] };

// ── Join ───────────────────────────────────────────────────────────────────────

function rawProductName(p: RawCalendarProduct): string {
  return typeof p === "string" ? p : p.name;
}

/** Classifier-derived product type, falling back to a stored type if the name
 *  doesn't classify. Uses the same `extractProductType` the live products use,
 *  so the join key is self-consistent across both sides. */
function calendarProductType(p: RawCalendarProduct, config: TcgConfig): string {
  const derived = extractProductType(rawProductName(p), config);
  if (derived !== "Other") return derived;
  if (typeof p !== "string" && p.product_type) return p.product_type;
  return derived;
}

/** Pick the best live product for a (set, type, language): prefer a language
 *  match, then in-stock, then the lowest price. */
function pickLiveMatch(
  setName: string,
  productType: string,
  language: string,
  products: Product[]
): Product | undefined {
  const set = setName.toLowerCase();
  const candidates = products.filter(
    (p) => p.set_name.toLowerCase() === set && p.product_type === productType
  );
  if (candidates.length === 0) return undefined;

  return [...candidates].sort((a, b) => {
    const aLang = a.language === language ? 0 : 1;
    const bLang = b.language === language ? 0 : 1;
    if (aLang !== bLang) return aLang - bLang;
    if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
    return a.price - b.price;
  })[0];
}

function joinProduct(
  raw: RawCalendarProduct,
  setName: string,
  products: Product[],
  config: TcgConfig
): CalendarProduct {
  const name = rawProductName(raw);
  const product_type = calendarProductType(raw, config);
  const language = extractLanguage(name);

  const out: CalendarProduct = { name, product_type };
  if (typeof raw !== "string") {
    if (raw.release_date) out.release_date = raw.release_date;
    if (raw.date_confidence) out.date_confidence = raw.date_confidence;
  }

  const match = pickLiveMatch(setName, product_type, language, products);
  if (match) {
    out.price = match.price;
    out.msrp = match.msrp;
    out.in_stock = match.in_stock;
    out.url = match.url;
    out.image_url = match.image_url;
    out.deal_score = match.deal_score;
    out.group_key = match.group_key;
  }
  return out;
}

function setConfidence(raw: RawCalendarSet): Confidence {
  if (raw.release_date === TBA_DATE) return "tba";
  return raw.date_confidence ?? "confirmed";
}

/** Join the raw calendar against live products, attaching current prices and
 *  normalizing legacy string products + missing confidence fields. */
export function joinCalendar(
  raw: RawCalendarResponse,
  products: Product[],
  config: TcgConfig
): CalendarResponse {
  const sets = (raw.sets ?? []).map((set): CalendarSet => ({
    name: set.name,
    series: set.series,
    release_date: set.release_date,
    date_confidence: setConfidence(set),
    type: set.type,
    ...(set.sources ? { sources: set.sources } : {}),
    products: (set.products ?? []).map((p) => joinProduct(p, set.name, products, config)),
    ...(set.notes ? { notes: set.notes } : {}),
    ...(set.url ? { url: set.url } : {}),
  }));
  return { sets };
}
