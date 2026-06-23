import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { fetchGameData } from "../../lib/dataFetcher";
import {
  toApiResponse,
  type ApiResponse,
  type StateJson,
  type HistoryJson,
  type StockChangesJson,
} from "../../lib/products";

export type {
  RetailerPrice,
  Product,
  ApiResponse,
} from "../../lib/products";

type ErrorResponse = {
  error: string;
};

type CacheItem = {
  expiresAt: number;
  payload: ApiResponse;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, CacheItem>();

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

  const p = config.githubDataPath;
  const apiPath = (file: string) => p ? `${p}/${file}` : file;

  const blobAvailable = !!process.env.BLOB_BASE_URL;

  function loadRequired<T>(fileName: string): Promise<T> {
    if (blobAvailable) return fetchGameData<T>(p, fileName);
    return fetchJson<T>(repo!, token!, apiPath(fileName));
  }

  function loadOptional<T>(fileName: string, fallback: T): Promise<T> {
    if (blobAvailable) return fetchGameData<T>(p, fileName).catch(() => fallback);
    return fetchJson<T>(repo!, token!, apiPath(fileName)).catch(() => fallback);
  }

  try {
    const [state, history, stockChanges] = await Promise.all([
      loadRequired<StateJson>("state.json"),
      loadOptional<HistoryJson>("price_history.json", {}),
      loadOptional<StockChangesJson>("stock_changes.json", { events: [] }),
    ]);

    const payload = toApiResponse(state, history, stockChanges, config);
    responseCache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
}
