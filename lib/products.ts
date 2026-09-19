/**
 * products.ts — shared product data model + transform.
 *
 * The raw scraper output (state.json / price_history.json / stock_changes.json)
 * is turned into the enriched `Product[]` shape consumed by the UI here, so that
 * both /api/products and /api/calendar build products from one implementation.
 */
import type { TcgConfig } from "./tcg.config";
import { conflictsWithGroup } from "./sizeClass";
import { implausibleFloor } from "./priceOutliers";
import { LOW_BADGE_MIN_DAYS } from "./siteFacts";
import { changeOver, pricePerPack } from "./insights";
import { computePackCount } from "./packCount";
import type { ProductRhythm } from "./stockStats";

// ── Raw scraper shapes ────────────────────────────────────────────────────────

export type StatePrice = {
  name: string;
  price: number;
  retailer: string;
  url: string;
  is_preorder: boolean;
  updated: string;
  image_url?: string;
  /** Set by newer scraper runs; absent in older data — the website falls back to extractCategory(). */
  category?: "sealed" | "single";
};

export type StateRawProduct = {
  name: string;
  price: number;
  retailer: string;
  url: string;
  in_stock: boolean;
  is_preorder: boolean;
  group_key: string;
  image_url?: string;
  last_seen: string;
  stock_qty?: number | null;
  category?: "sealed" | "single";
};

export type StateJson = {
  best_prices: Record<string, StatePrice>;
  products?: Record<string, StateRawProduct>;
};

export type HistoryEntry = {
  date: string;
  price: number;
  retailer: string;
};

export type HistoryItem = {
  name: string;
  entries: HistoryEntry[];
};

export type HistoryJson = Record<string, HistoryItem>;

export type StockEvent = {
  group_key: string;
  timestamp: string;
};

export type StockChangesJson = {
  events: StockEvent[];
};

// ── Scryfall singles enrichment (written by tcg-drop-alert/singles_enrich.py) ─

export type CardEnrichment = {
  scryfall_id: string;
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  image_url: string;
  scryfall_uri: string;
  treatment: string;
  market_usd: number | null;
  market_cad: number | null;
  /** true when matched by name only (printing-level price may be off) */
  approximate: boolean;
};

/** How large a set is, for measuring collection completion against. */
export type SetInfo = {
  name: string;
  /**
   * The numbered run a collector completes — Scryfall's printed_size where it
   * exists, card_count otherwise. Deliberately not card_count everywhere: that
   * counts promos and alternate arts that were never part of the set.
   */
  total: number;
  released_at: string;
  set_type: string;
  digital: boolean;
};

export type SinglesEnrichmentJson = {
  generated_at: string;
  fx_rate: number;
  matched: number;
  unmatched: number;
  cards: Record<string, CardEnrichment>;
  /** Keyed by lowercase set code. Absent when Scryfall was unreachable. */
  sets?: Record<string, SetInfo>;
};

// ── Enriched output shapes ────────────────────────────────────────────────────

export type RetailerPrice = {
  retailer: string;
  price: number;
  url: string;
  in_stock: boolean;
  stock_qty: number | null;
};

export type Product = {
  group_key: string;
  name: string;
  price: number;
  retailer: string;
  url: string;
  is_preorder: boolean;
  updated: string;
  all_time_low: number;
  price_change_7d: number | null;
  history: HistoryEntry[];
  /**
   * Days spanned by the FULL history, even when `history` has been trimmed for
   * the list payload. Without it, a trimmed feed would make every product look
   * newly tracked and silently suppress the low badge.
   */
  history_days: number;
  /** Percent change over 1 and 30 days. 7-day lives in price_change_7d. */
  price_change_1d: number | null;
  price_change_30d: number | null;
  /** Boosters in this product, when derivable — lets a box and a pack compare. */
  pack_count: number | null;
  /** Cost of one booster. Null when pack_count is unknown. */
  price_per_pack: number | null;
  image_url: string;
  other_retailers: RetailerPrice[];
  is_new: boolean;
  in_stock: boolean;
  back_in_stock: boolean;
  language: string;
  product_type: string;
  set_name: string;
  variant: string;
  category: "sealed" | "single";
  /** Scryfall card data — present only on enriched singles. */
  card?: CardEnrichment;
  msrp: number | null;
  deal_score: number;
  last_restock_date: string | null;
  /**
   * How often this product has come back in stock, when it has done so often
   * enough to have a rhythm. Present on a few hundred products out of several
   * thousand — most have restocked once or never, and two sightings is not a
   * cadence. See lib/stockStats.
   */
  restock_rhythm?: ProductRhythm;
};

export type ApiResponse = {
  products: Product[];
  generated_at: string;
  retailers_count: number;
  /**
   * Totals for the WHOLE catalogue, not just the products in this response.
   * The sub-nav shows both tab counts, so a view-scoped payload still has to
   * say how many are on the other tab.
   */
  counts?: { sealed: number; singles: number };
  /**
   * Set sizes, keyed by lowercase set code, for collection completion. Absent
   * when the enrichment run could not reach Scryfall — the collection page
   * falls back to counting only what we track.
   */
  sets?: Record<string, SetInfo>;
};

// ── Numeric helpers ───────────────────────────────────────────────────────────

export function parseDate(input: string): Date {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

export function computeAllTimeLow(entries: HistoryEntry[], currentPrice: number): number {
  if (entries.length === 0) {
    return currentPrice;
  }
  return Math.min(currentPrice, ...entries.map((entry) => entry.price));
}

/** Days between the first and last price we have recorded for a product. */
export function historySpanDays(entries: HistoryEntry[] | undefined): number {
  if (!entries || entries.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const entry of entries) {
    const t = parseDate(entry.date).getTime();
    if (t <= 0) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return Math.round((max - min) / 86_400_000);
}

/**
 * Whether we have watched a product long enough for its lowest price to mean
 * anything. Under LOW_BADGE_MIN_DAYS the "low" describes when we started
 * tracking rather than the market, so the badge is suppressed rather than
 * presented as a buying signal.
 *
 * Accepts either a product or a bare history array. Given a product it prefers
 * the precomputed `history_days`, because the list payload ships only a trimmed
 * slice of history — measuring that slice would understate the real span.
 */
export function hasReliableLow(
  input: { history_days?: number; history?: HistoryEntry[] } | HistoryEntry[] | undefined
): boolean {
  if (!input) return false;
  if (Array.isArray(input)) return historySpanDays(input) >= LOW_BADGE_MIN_DAYS;
  const days = input.history_days ?? historySpanDays(input.history);
  return days >= LOW_BADGE_MIN_DAYS;
}

/**
 * Points kept per product in the list payload.
 *
 * The grid draws a ~40px sparkline, which cannot resolve more than about ten
 * points anyway, and the full series is one request away at
 * /api/product/[group_key]. Was 30; dropped to 10 when the store registry made
 * the catalogue several times larger and history was still 44% of the payload.
 */
export const LIST_HISTORY_POINTS = 10;

/**
 * Trim a product for the list payload. History was 59% of a 6.8 MB response
 * (69,751 points, median 11 each), downloaded and parsed every five minutes to
 * draw a sparkline that cannot show most of it.
 */
export type ListView = "sealed" | "singles" | "all";

/**
 * Cut the list payload down to one view.
 *
 * /mtg/sealed and /mtg/singles each downloaded the entire catalogue and then
 * filtered client-side, so every visitor paid for the half they were not
 * looking at — and `card` enrichment, 14% of the payload, only ever renders on
 * the singles page.
 */
export function scopeForView(products: Product[], view: ListView): Product[] {
  if (view === "all") return products;
  const wantSingles = view === "singles";
  return products
    .filter((p) => (p.category === "single") === wantSingles)
    .map((p) => {
      if (wantSingles) return p;
      // Sealed cards never read `card`, so it is pure weight there.
      const { card, ...rest } = p;
      void card;
      return rest as Product;
    });
}

export function catalogueCounts(products: Product[]): { sealed: number; singles: number } {
  let singles = 0;
  for (const p of products) if (p.category === "single") singles += 1;
  return { singles, sealed: products.length - singles };
}

export function slimProduct(product: Product): Product {
  const history = product.history ?? [];
  if (history.length <= LIST_HISTORY_POINTS) return product;
  return { ...product, history: history.slice(-LIST_HISTORY_POINTS) };
}

export function computeDealScore(
  price: number,
  atl: number,
  change7d: number | null,
  msrp: number | null
): number {
  // When MSRP is unavailable (e.g. MTG), redistribute its 30pts to ATL/drop
  // so the score can still reach 100. With MSRP: ATL=40, drop=30, MSRP=30.
  // Without MSRP: ATL=60, drop=40, MSRP=0.
  const hasMsrp  = msrp !== null && msrp > 0;
  const atlMax   = hasMsrp ? 40 : 60;
  const dropMax  = hasMsrp ? 30 : 40;
  const atlSpread = Math.max(atl * 0.5, 0.01);
  const atlScore  = atl > 0 ? Math.max(0, 1 - (price - atl) / atlSpread) * atlMax : 0;
  const dropScore = change7d !== null && change7d < 0
    ? Math.min(dropMax, (Math.abs(change7d) / 15) * dropMax) : 0;
  const msrpScore = hasMsrp && msrp > price
    ? Math.min(30, ((msrp - price) / msrp) * 2 * 30) : 0;
  return Math.round(Math.min(100, atlScore + dropScore + msrpScore));
}

export function computeSevenDayChange(entries: HistoryEntry[], currentPrice: number, now = new Date()): number | null {
  if (entries.length < 2) {
    return null;
  }

  const sorted = [...entries].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  const targetMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  let reference = sorted[0];
  for (const entry of sorted) {
    const entryMs = parseDate(entry.date).getTime();
    if (entryMs <= targetMs) {
      reference = entry;
    } else {
      break;
    }
  }

  if (reference.price <= 0) {
    return null;
  }

  const change = ((currentPrice - reference.price) / reference.price) * 100;
  return Number(change.toFixed(2));
}

// ── Product attribute extraction ─────────────────────────────────────────────

const KNOWN_LANGUAGES = [
  "Korean", "Japanese", "Simplified Chinese", "Traditional Chinese",
  "French", "German", "Spanish", "Italian", "Portuguese",
];

export function extractLanguage(name: string): string {
  // Match any parenthetical in the name — covers both leading and trailing positions
  const matches = name.match(/\(([^)]+)\)/g) ?? [];
  for (const m of matches) {
    const inner = m.slice(1, -1);
    if (KNOWN_LANGUAGES.includes(inner)) return inner;
  }
  return "English";
}

const POKEMON_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/ultra.{0,5}premium.{0,10}collection/i,                              "Ultra Premium Collection"],
  [/elite.{0,5}trainer.{0,5}box/i,                                      "Elite Trainer Box"],
  [/build.{0,5}&?.{0,5}battle.{0,5}(?:box|kit|stadium)/i,              "Build & Battle Box"],
  [/premium.{0,10}collection/i,                                          "Premium Collection"],
  [/special.{0,10}collection/i,                                          "Special Collection"],
  [/collect(?:ion|or).{0,5}(?:box|chest|case)/i,                        "Collection Box"],
  [/special.{0,5}set/i,                                                  "Special Collection"],
  [/\bchest\b/i,                                                         "Collection Box"],
  [/mini.{0,3}tin/i,                                                     "Mini Tin"],
  [/championship.{0,10}deck|(?:league.{0,5})?battle.{0,5}deck|starter.{0,5}deck/i, "Deck"],
  [/half.{0,5}(?:booster.{0,5})?box/i,                                  "Half Box"],
  [/booster.{0,5}box|\bbbx\b/i,                                          "Booster Box"],
  [/checklane|blister/i,                                                 "Blister Pack"],
  [/\d+s?\s+booster.{0,5}pack|booster.{0,5}pack/i,                     "Booster Pack"],
  [/\bpack\b/i,                                                          "Booster Pack"],
  [/\bbundle\b/i,                                                        "Bundle"],
  [/\btins?\b/i,                                                         "Tin"],
  [/\bbox\b/i,                                                           "Collection Box"],
  [/\bdisplay\b/i,                                                       "Display"],
  [/\bcollection\b/i,                                                    "Collection"],
];

const MTG_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/collector.{0,5}booster.{0,5}box/i,   "Collector Booster Box"],
  [/collector.{0,5}booster/i,             "Collector Booster"],
  [/play.{0,5}booster.{0,5}box/i,        "Play Booster Box"],
  [/play.{0,5}booster/i,                  "Play Booster"],
  [/draft.{0,5}booster.{0,5}box/i,       "Draft Booster Box"],
  [/draft.{0,5}booster/i,                 "Draft Booster"],
  [/set.{0,5}booster.{0,5}box/i,         "Set Booster Box"],
  [/set.{0,5}booster/i,                   "Set Booster"],
  [/jumpstart.{0,5}booster/i,             "Jumpstart Booster"],
  [/\bjumpstart\b/i,                       "Jumpstart Booster"],
  [/booster.{0,5}box/i,                   "Booster Box"],
  [/commander.{0,5}collection/i,          "Commander Collection"],
  [/commander.{0,5}deck/i,                "Commander Deck"],
  [/\bcommander\b/i,                       "Commander Deck"],
  [/prerelease.{0,5}kit/i,                "Prerelease Kit"],
  [/\bprerelease\b/i,                      "Prerelease Kit"],
  [/starter.{0,5}kit/i,                   "Starter Kit"],
  [/secret.{0,5}lair/i,                   "Secret Lair"],
  [/\bbundle\b/i,                          "Bundle"],
  [/fat.{0,5}pack/i,                       "Bundle"],
  [/booster.{0,5}pack|\bpack\b/i,          "Booster Pack"],
  [/\bdisplay\b/i,                          "Display"],
];

export function extractProductType(name: string, config: TcgConfig): string {
  const patterns = config.slug === "mtg" ? MTG_TYPE_PATTERNS : POKEMON_TYPE_PATTERNS;
  for (const [pattern, type] of patterns) {
    if (pattern.test(name)) return type;
  }
  return "Other";
}

export type ProductCategory = "sealed" | "single";

// Sealed SKU keywords — when present, the product is sealed regardless of
// singles markers ("Secret Lair Commander Deck" is sealed).
const SEALED_KEYWORDS =
  /booster|\bbox\b|bundle|\bdecks?\b|display|\bcase\b|\bkits?\b|\btins?\b|blister|collection|elite trainer|\betb\b|prerelease|fat pack|jumpstart|\bpack\b|chest|starter/i;

// Compound product terms strong enough to override the bracket-suffix singles
// format — a card merely NAMED "Pack Rat" or "The Deck of Many Things" is not
// sealed, but "Play Booster Box [Pre-Order]" is.
const STRONG_SEALED =
  /booster\s+(box|pack|display|bundle|case)|collector\s+booster|commander\s+deck|starter\s+deck|deck\s+box|elite\s+trainer|prerelease|\bdisplay\b/i;

// Bracket suffixes that are order status, not a set name.
const STATUS_BRACKET = /\[\s*(pre.?order|in.?store|pickup|sealed|new|damaged)\s*\]\s*$/i;

// Card-level markers: collector numbers "(1589)" / "(SLP-004)" and premium
// treatments that only appear on individual cards.
const SINGLE_MARKERS =
  /\((?:[A-Z]{2,4}-)?\d{1,4}\)|rainbow foil|etched foil|galaxy foil|confetti foil|raised foil|textured foil|borderless|extended art|showcase/i;

// BinderPOS-style singles end with the set in brackets: "Blood Crypt [Secret Lair Drop Series]"
const BRACKET_SET_SUFFIX = /\[[^\]]+\]\s*$/;

export function extractCategory(name: string): ProductCategory {
  if (BRACKET_SET_SUFFIX.test(name) && !STATUS_BRACKET.test(name)) {
    const beforeBracket = name.replace(BRACKET_SET_SUFFIX, "");
    return STRONG_SEALED.test(beforeBracket) ? "sealed" : "single";
  }
  // Names LEADING with "Secret Lair" are whole drops (sealed); broken-out
  // singles lead with the card name instead.
  if (/^(mtg[\s:-]*)?secret lair/i.test(name.trim())) return "sealed";
  if (!SEALED_KEYWORDS.test(name) && SINGLE_MARKERS.test(name)) return "single";
  return "sealed";
}

export function extractVariant(name: string): string {
  const lower = name.toLowerCase();
  if (/non.?foil/i.test(lower)) return "Non-Foil";
  if (/etched\s+foil/i.test(lower)) return "Etched Foil";
  if (/\bfoil\b/i.test(lower)) return "Foil";
  if (/\bprerelease\b/i.test(lower)) return "Prerelease";
  if (/\bjapanese\b/i.test(lower)) return "";
  return "";
}

export function extractSetName(name: string, config: TcgConfig): string {
  const lower = name.toLowerCase();
  for (const set of config.knownSets) {
    if (lower.includes(set.toLowerCase())) return set;
  }
  if (config.knownSetPatterns) {
    for (const [pattern, setName] of config.knownSetPatterns) {
      if (pattern.test(name)) return setName;
    }
  }
  return "";
}

// ── Transform ─────────────────────────────────────────────────────────────────

export function toApiResponse(
  state: StateJson,
  history: HistoryJson,
  stockChanges: StockChangesJson,
  config: TcgConfig,
  enrichment?: SinglesEnrichmentJson | null,
  rhythms?: Record<string, ProductRhythm> | null
): ApiResponse {
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twoDaysAgoMs    = Date.now() - 48 * 60 * 60 * 1000;
  const recentBackInStock = new Set(
    stockChanges.events
      .filter(e => new Date(e.timestamp).getTime() >= twoDaysAgoMs)
      .map(e => e.group_key)
  );

  // Most recent restock event per product (all time, not just 48h)
  const lastRestockMap = new Map<string, string>();
  for (const event of stockChanges.events) {
    const existing = lastRestockMap.get(event.group_key);
    if (!existing || event.timestamp > existing) {
      lastRestockMap.set(event.group_key, event.timestamp);
    }
  }

  const byGroup    = new Map<string, RetailerPrice[]>();
  const namesByListing = new Map<string, string>();
  const msrpPrices = new Map<string, number>();
  for (const raw of Object.values(state.products ?? {})) {
    if (!raw.group_key || raw.price == null || raw.price < 3) continue;
    // A group whose key says "box" must not be priced by a listing whose name
    // says "pack". See lib/sizeClass for the $6.95 booster box this prevents.
    if (conflictsWithGroup(raw.name ?? "", raw.group_key)) continue;
    const list = byGroup.get(raw.group_key) ?? [];
    list.push({ retailer: raw.retailer, price: raw.price, url: raw.url, in_stock: raw.in_stock, stock_qty: raw.stock_qty ?? null });
    namesByListing.set(`${raw.group_key}|${raw.retailer}|${raw.price}`, raw.name ?? "");
    byGroup.set(raw.group_key, list);
    if (config.msrpRetailer && raw.retailer === config.msrpRetailer && raw.price > 0) {
      msrpPrices.set(raw.group_key, raw.price);
    }
  }

  const products = Object.entries(state.best_prices)
    .map(([group_key, storedBest]) => {
      let bestPrice = storedBest;
      const historyItem = history[group_key];
      const entries = historyItem?.entries ?? [];
      const allTimeLow = computeAllTimeLow(entries, bestPrice.price);
      const sevenDayChange = computeSevenDayChange(entries, bestPrice.price);

      const isNew = entries.length > 0 && entries[0].date >= sevenDaysAgoStr;

      const rawRetailers = byGroup.get(group_key) ?? [];

      // Second pass, for the mislabelled listings a name check cannot catch:
      // a shop titling a $6.99 pack "Booster Box" next to five real boxes at
      // $599-$808. Only fires below a tenth of the group median, which is far
      // outside any real sealed discount.
      // byGroup already holds every listing in the group, the best one
      // included. Appending bestPrice again counted it twice and pulled the
      // median toward it — which is exactly the wrong direction, since the
      // listing under suspicion is the one doing the pulling. Two groups
      // survived the filter that way.
      const groupPrices = rawRetailers.some(
        (r) => r.retailer === bestPrice.retailer && r.price === bestPrice.price
      )
        ? rawRetailers.map((r) => r.price)
        : [...rawRetailers.map((r) => r.price), bestPrice.price];
      const floor = implausibleFloor(groupPrices);
      const allRetailers = floor === null
        ? rawRetailers
        : rawRetailers.filter((r) => r.price >= floor);

      // The stored best price comes from the crawler, whose state refreshes
      // twice a day. When it names a different unit than the group, prefer the
      // cheapest listing that does belong — otherwise a corrected group would
      // keep showing the wrong price until the next scan.
      const bestIsBadData =
        conflictsWithGroup(bestPrice.name ?? "", group_key) ||
        (floor !== null && bestPrice.price < floor);

      if (bestIsBadData) {
        const buyable = allRetailers.filter((r) => r.in_stock);
        const replacement = (buyable.length ? buyable : allRetailers)
          .reduce<RetailerPrice | null>((a, b) => (a === null || b.price < a.price ? b : a), null);
        if (replacement) {
          const replacementName = namesByListing.get(
            `${group_key}|${replacement.retailer}|${replacement.price}`
          );
          bestPrice = {
            ...bestPrice,
            price: replacement.price,
            retailer: replacement.retailer,
            url: replacement.url,
            // Correcting the price but keeping "Booster Pack" as the title
            // would only move the contradiction.
            name: replacementName || bestPrice.name,
          };
        }
      }

      const byRetailer = new Map<string, RetailerPrice>();
      for (const r of allRetailers) {
        if (r.retailer === bestPrice.retailer) continue;
        const existing = byRetailer.get(r.retailer);
        if (!existing || (r.in_stock && !existing.in_stock) || (r.in_stock === existing.in_stock && r.price < existing.price)) {
          byRetailer.set(r.retailer, r);
        }
      }
      const otherRetailers = Array.from(byRetailer.values()).sort((a, b) => {
        if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
        return a.price - b.price;
      });

      const bestRetailerEntry = allRetailers.find(r => r.retailer === bestPrice.retailer);
      const inStock = bestRetailerEntry ? bestRetailerEntry.in_stock : true;

      const packCount = computePackCount(bestPrice.name);
      const msrp = msrpPrices.get(group_key) ?? null;
      const deal_score = computeDealScore(bestPrice.price, allTimeLow, sevenDayChange, msrp);

      const product: Product = {
        group_key,
        name: bestPrice.name,
        price: bestPrice.price,
        retailer: bestPrice.retailer,
        url: bestPrice.url,
        is_preorder: bestPrice.is_preorder,
        updated: bestPrice.updated,
        all_time_low: allTimeLow,
        price_change_7d: sevenDayChange,
        history: entries,
        history_days: historySpanDays(entries),
        price_change_1d: changeOver(entries, bestPrice.price, 1),
        price_change_30d: changeOver(entries, bestPrice.price, 30),
        pack_count: packCount,
        price_per_pack: pricePerPack(bestPrice.price, packCount),
        image_url: bestPrice.image_url ?? "",
        other_retailers: otherRetailers,
        is_new: isNew,
        in_stock: inStock,
        back_in_stock: recentBackInStock.has(group_key),
        language: extractLanguage(bestPrice.name),
        product_type: extractProductType(bestPrice.name, config),
        set_name: extractSetName(bestPrice.name, config),
        variant: extractVariant(bestPrice.name),
        category: bestPrice.category ?? extractCategory(bestPrice.name),
        card: enrichment?.cards[group_key],
        msrp,
        deal_score,
        last_restock_date: lastRestockMap.get(group_key) ?? null,
        restock_rhythm: rhythms?.[group_key],
      };

      return product;
    })
    .filter((product) => product.price >= 3)
    .sort((a, b) => a.price - b.price);

  return {
    products,
    generated_at: new Date().toISOString(),
    retailers_count: new Set(products.map((product) => product.retailer)).size,
    sets: enrichment?.sets,
  };
}

/**
 * Points kept per product in a server-rendered slice. Enough for the sparkline
 * to have a shape; SWR swaps in the full series moments later.
 */
export const SSR_HISTORY_POINTS = 8;

/**
 * Shrink a product for embedding in server-rendered HTML.
 *
 * Two hard constraints, both learned from the build failing:
 *
 *   1. getStaticProps props must be JSON-serializable, and `card` is `undefined`
 *      on every sealed product. A JSON round-trip drops undefined keys entirely,
 *      which is what Next wants.
 *   2. Next warns past 128 kB of page data. The whole point of server-rendering
 *      is that a crawler sees real products — not that the catalogue ships twice —
 *      so history is trimmed hard here.
 *
 * The client re-renders from the full feed on mount, so this shape only has to
 * survive first paint and hydration.
 */
export function leanForSsr(product: Product): Product {
  const history = product.history ?? [];
  const lean: Product = {
    ...product,
    history: history.length > SSR_HISTORY_POINTS ? history.slice(-SSR_HISTORY_POINTS) : history,
  };
  // Drops undefined values, which getStaticProps rejects outright.
  return JSON.parse(JSON.stringify(lean)) as Product;
}

/**
 * True when no retailer has this product in stock.
 *
 * Matters more than it used to: the crawler now keeps recording a group after
 * every listing sells out, holding the last known price so the page can say
 * "last seen at $X" instead of the product vanishing. That is the right
 * behaviour for history and restock alerts, but it means a price on screen is
 * no longer proof you can buy it — so anything that ranks by price has to know
 * the difference.
 */
export function isSoldOutEverywhere(p: {
  in_stock: boolean;
  other_retailers?: { in_stock: boolean }[];
}): boolean {
  // other_retailers is optional rather than required: the in-stock case
  // short-circuits before reading it, so a payload missing the field would
  // throw only for sold-out products — the exact case this is asked about.
  return !p.in_stock && !(p.other_retailers ?? []).some((r) => r.in_stock);
}

/**
 * Orders buyable products ahead of sold-out ones, leaving each side to the
 * comparator it wraps.
 *
 * Applied to the price and deal sorts, where an unbuyable listing would
 * otherwise take the top slot precisely because nobody could buy it at that
 * price. Not applied to "recently updated", where a sold-out product changing
 * state is exactly the news the sort exists to surface.
 */
export function buyableFirst<T extends Parameters<typeof isSoldOutEverywhere>[0]>(
  compare: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const aOut = isSoldOutEverywhere(a);
    const bOut = isSoldOutEverywhere(b);
    if (aOut !== bOut) return aOut ? 1 : -1;
    return compare(a, b);
  };
}
