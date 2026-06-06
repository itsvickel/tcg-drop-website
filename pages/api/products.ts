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

type StateJson = {
  best_prices: Record<string, StatePrice>;
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

function toApiResponse(state: StateJson, history: HistoryJson): ApiResponse {
  const products = Object.entries(state.best_prices)
    .map(([group_key, bestPrice]) => {
      const historyItem = history[group_key];
      const entries = historyItem?.entries ?? [];
      const allTimeLow = computeAllTimeLow(entries, bestPrice.price);
      const sevenDayChange = computeSevenDayChange(entries, bestPrice.price);

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
        image_url: bestPrice.image_url ?? ""
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
