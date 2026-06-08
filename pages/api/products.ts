import type { NextApiRequest, NextApiResponse } from "next";

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
  language: string;
  product_type: string;
  set_name: string;
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
let responseCache: CacheItem | null = null;

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

const PRODUCT_TYPE_PATTERNS: Array<[RegExp, string]> = [
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

function extractProductType(name: string): string {
  for (const [pattern, type] of PRODUCT_TYPE_PATTERNS) {
    if (pattern.test(name)) return type;
  }
  return "Other";
}

// Sorted longest-first so more-specific names take precedence over shorter substrings.
const KNOWN_SETS: string[] = ([
  // English SV
  "Black Bolt & White Flare", "Destined Rivals", "Journey Together",
  "Prismatic Evolutions", "Surging Sparks", "Stellar Crown",
  "Shrouded Fable", "Twilight Masquerade", "Temporal Forces",
  "Paldean Fates", "Paradox Rift", "Obsidian Flames", "Paldea Evolved",
  // English SWSH
  "Crown Zenith", "Silver Tempest", "Lost Origin", "Astral Radiance",
  "Brilliant Stars", "Fusion Strike", "Evolving Skies", "Chilling Reign",
  "Battle Styles", "Shining Fates", "Vivid Voltage", "Champions Path",
  "Darkness Ablaze", "Rebel Clash", "Pokemon GO", "Celebrations",
  // Special
  "30th Celebration",
  // Japanese SV
  "Super Electric Breaker", "Glory of Team Rocket", "Terastal Festival",
  "Battle Partners", "Stellar Miracle", "Paradise Dragon", "Heat Wave Arena",
  "Night Wanderer", "Mask of Change", "Ancient Roar", "Future Flash",
  "Snow Hazard", "Clay Burst", "Raging Surf", "Wild Force", "Cyber Judge",
  "White Flare", "Black Bolt",
  // Japanese SWSH
  "Explosive Flame Walker", "Single Strike Master", "Rapid Strike Master",
  "Astonishing Volt Tackle", "Incandescent Arcana", "Legendary Heartbeat",
  "Paradigm Trigger", "Jet Black Spirit", "Vstar Universe",
  "Space Juggler", "Time Gazer", "Silver Lance", "Star Birth", "Lost Abyss",
  "Eevee Heroes", "Dark Phantasma", "Matchless Fighters", "Match Fighters",
  "Battle Region", "Vmax Rising", "Fusion Arts", "Shiny Star V",
  "Infinity Zone", "Blue Sky Stream", "Towering Perfection",
  // Japanese SV base
  "Shiny Treasure ex", "Scarlet ex", "Violet ex",
  // Mega Evolution sub-sets (checked before "Mega Evolution" fallback)
  "Phantasmal Flames", "Ascended Heroes", "Perfect Order", "Chaos Rising",
  "Mega Inferno X", "Mega Symphonia", "Mega Brave", "Nihil Zero", "Abyss Eye",
  // Chinese
  "Savage Blade Awakening", "Dark Crystal Blaze", "Eternity Island",
  "Blade Awakening", "Collect 151", "True Mystery",
  // Numeric set name — added last so it only matches after all longer names fail
  "151",
] as string[]).sort((a, b) => b.length - a.length);

function extractSetName(name: string): string {
  const lower = name.toLowerCase();
  for (const set of KNOWN_SETS) {
    if (lower.includes(set.toLowerCase())) return set;
  }
  // Mega Evolution product line (checked after all sub-sets so sub-sets win)
  if (/mega.{0,5}evolution|ME0[1-9]/i.test(name)) return "Mega Evolution";
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────

function toApiResponse(state: StateJson, history: HistoryJson): ApiResponse {
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Build group_key → all retailer entries map from raw products
  const byGroup = new Map<string, RetailerPrice[]>();
  for (const raw of Object.values(state.products ?? {})) {
    if (!raw.group_key || raw.price == null || raw.price < 3) continue;
    const list = byGroup.get(raw.group_key) ?? [];
    list.push({ retailer: raw.retailer, price: raw.price, url: raw.url, in_stock: raw.in_stock });
    byGroup.set(raw.group_key, list);
  }

  const products = Object.entries(state.best_prices)
    .map(([group_key, bestPrice]) => {
      const historyItem = history[group_key];
      const entries = historyItem?.entries ?? [];
      const allTimeLow = computeAllTimeLow(entries, bestPrice.price);
      const sevenDayChange = computeSevenDayChange(entries, bestPrice.price);

      // Product is "new" if it appeared in price history within the last 7 days
      const isNew = entries.length > 0
        ? entries[0].date >= sevenDaysAgoStr
        : parseDate(bestPrice.updated).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;

      // Deduplicate by retailer (keep lowest price per retailer), exclude the best retailer
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
        language: extractLanguage(bestPrice.name),
        product_type: extractProductType(bestPrice.name),
        set_name: extractSetName(bestPrice.name),
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
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse | ErrorResponse>
) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");

  if (responseCache && responseCache.expiresAt > Date.now()) {
    res.status(200).json(responseCache.payload);
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

  try {
    const [state, history] = await Promise.all([
      fetchJson<StateJson>(repo, token, "state.json"),
      fetchJson<HistoryJson>(repo, token, "price_history.json").catch(() => ({} as HistoryJson))
    ]);

    const payload = toApiResponse(state, history);
    responseCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload
    };

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
}
