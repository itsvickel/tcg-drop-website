import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig, type TcgConfig } from "../../lib/tcg.config";

type StatePrice = {
  name: string;
  price: number;
  retailer: string;
  url: string;
  is_preorder: boolean;
  updated: string;
  image_url?: string;
};

type StateRawProduct = {
  name: string;
  price: number;
  retailer: string;
  url: string;
  in_stock: boolean;
  is_preorder: boolean;
  group_key: string;
  image_url?: string;
  last_seen: string;
};

type StateJson = {
  best_prices: Record<string, StatePrice>;
  products?: Record<string, StateRawProduct>;
};

type HistoryEntry = {
  date: string;
  price: number;
  retailer: string;
};

type HistoryItem = {
  name: string;
  entries: HistoryEntry[];
};

type HistoryJson = Record<string, HistoryItem>;

type StockEvent = {
  group_key: string;
  timestamp: string;
};

type StockChangesJson = {
  events: StockEvent[];
};

export type RetailerPrice = {
  retailer: string;
  price: number;
  url: string;
  in_stock: boolean;
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
  image_url: string;
  other_retailers: RetailerPrice[];
  is_new: boolean;
  in_stock: boolean;
  back_in_stock: boolean;
  language: string;
  product_type: string;
  set_name: string;
  msrp: number | null;
  deal_score: number;
};

export type ApiResponse = {
  products: Product[];
  generated_at: string;
  retailers_count: number;
};

type ErrorResponse = {
  error: string;
};

type CacheItem = {
  expiresAt: number;
  payload: ApiResponse;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, CacheItem>();

function parseDate(input: string): Date {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function computeAllTimeLow(entries: HistoryEntry[], currentPrice: number): number {
  if (entries.length === 0) {
    return currentPrice;
  }
  return Math.min(currentPrice, ...entries.map((entry) => entry.price));
}

function computeDealScore(
  price: number,
  atl: number,
  change7d: number | null,
  msrp: number | null
): number {
  const atlSpread = Math.max(atl * 0.5, 0.01);
  const atlScore = atl > 0 ? Math.max(0, 1 - (price - atl) / atlSpread) * 40 : 0;
  const dropScore = change7d !== null && change7d < 0
    ? Math.min(30, (Math.abs(change7d) / 15) * 30) : 0;
  const msrpScore = msrp !== null && msrp > price
    ? Math.min(30, ((msrp - price) / msrp) * 2 * 30) : 0;
  return Math.round(Math.min(100, atlScore + dropScore + msrpScore));
}

function computeSevenDayChange(entries: HistoryEntry[], currentPrice: number, now = new Date()): number | null {
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

async function fetchJson<T>(repo: string, token: string, fileName: string): Promise<T> {
  const url = `https://api.github.com/repos/${repo}/contents/${fileName}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed fetching ${fileName}: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

// ── Product attribute extraction ─────────────────────────────────────────────

const KNOWN_LANGUAGES = [
  "Korean", "Japanese", "Simplified Chinese", "Traditional Chinese",
  "French", "German", "Spanish", "Italian", "Portuguese",
];

function extractLanguage(name: string): string {
  const m = name.match(/^\(([^)]+)\)/);
  if (m && KNOWN_LANGUAGES.includes(m[1])) return m[1];
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

function extractProductType(name: string, config: TcgConfig): string {
  const patterns = config.slug === "mtg" ? MTG_TYPE_PATTERNS : POKEMON_TYPE_PATTERNS;
  for (const [pattern, type] of patterns) {
    if (pattern.test(name)) return type;
  }
  return "Other";
}

function extractSetName(name: string, config: TcgConfig): string {
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

// ─────────────────────────────────────────────────────────────────────────────

function toApiResponse(
  state: StateJson,
  history: HistoryJson,
  stockChanges: StockChangesJson,
  config: TcgConfig
): ApiResponse {
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twoDaysAgoMs    = Date.now() - 48 * 60 * 60 * 1000;
  const recentBackInStock = new Set(
    stockChanges.events
      .filter(e => new Date(e.timestamp).getTime() >= twoDaysAgoMs)
      .map(e => e.group_key)
  );

  const byGroup    = new Map<string, RetailerPrice[]>();
  const msrpPrices = new Map<string, number>();
  for (const raw of Object.values(state.products ?? {})) {
    if (!raw.group_key || raw.price == null || raw.price < 3) continue;
    const list = byGroup.get(raw.group_key) ?? [];
    list.push({ retailer: raw.retailer, price: raw.price, url: raw.url, in_stock: raw.in_stock });
    byGroup.set(raw.group_key, list);
    if (config.msrpRetailer && raw.retailer === config.msrpRetailer && raw.price > 0) {
      msrpPrices.set(raw.group_key, raw.price);
    }
  }

  const products = Object.entries(state.best_prices)
    .map(([group_key, bestPrice]) => {
      const historyItem = history[group_key];
      const entries = historyItem?.entries ?? [];
      const allTimeLow = computeAllTimeLow(entries, bestPrice.price);
      const sevenDayChange = computeSevenDayChange(entries, bestPrice.price);

      const isNew = entries.length > 0
        ? entries[0].date >= sevenDaysAgoStr
        : parseDate(bestPrice.updated).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;

      const allRetailers = byGroup.get(group_key) ?? [];
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
        image_url: bestPrice.image_url ?? "",
        other_retailers: otherRetailers,
        is_new: isNew,
        in_stock: inStock,
        back_in_stock: recentBackInStock.has(group_key),
        language: extractLanguage(bestPrice.name),
        product_type: extractProductType(bestPrice.name, config),
        set_name: extractSetName(bestPrice.name, config),
        msrp,
        deal_score,
      };

      return product;
    })
    .filter((product) => product.price >= 3)
    .sort((a, b) => a.price - b.price);

  return {
    products,
    generated_at: new Date().toISOString(),
    retailers_count: new Set(products.map((product) => product.retailer)).size
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse | ErrorResponse>
) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");

  const tcgParam = typeof req.query.tcg === "string" ? req.query.tcg : "pokemon";
  let config;
  try {
    config = getTcgConfig(tcgParam);
  } catch {
    res.status(400).json({ error: `Invalid tcg param: "${tcgParam}"` });
    return;
  }

  const cached = responseCache.get(config.slug);
  if (cached && cached.expiresAt > Date.now()) {
    res.status(200).json(cached.payload);
    return;
  }

  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    res.status(500).json({
      error: "Missing GITHUB_REPO or GITHUB_TOKEN environment variables."
    });
    return;
  }

  const prefix = config.githubDataPath;

  try {
    const [state, history, stockChanges] = await Promise.all([
      fetchJson<StateJson>(repo, token, `${prefix}/state.json`),
      fetchJson<HistoryJson>(repo, token, `${prefix}/price_history.json`).catch(() => ({} as HistoryJson)),
      fetchJson<StockChangesJson>(repo, token, `${prefix}/stock_changes.json`).catch(() => ({ events: [] } as StockChangesJson)),
    ]);

    const payload = toApiResponse(state, history, stockChanges, config);
    responseCache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
}
