/**
 * serverProducts.ts — server-side product feed loader shared by
 * /api/products and the /api/check-alerts cron.
 *
 * Reads Blob first (via dataFetcher), falls back to GitHub raw.
 */
import { fetchGameData } from "./dataFetcher";
import type { TcgConfig } from "./tcg.config";
import {
  toApiResponse,
  type ApiResponse,
  type StateJson,
  type HistoryJson,
  type StockChangesJson,
  type SinglesEnrichmentJson,
} from "./products";
import { EMPTY_STOCK_STATS, type StockStats } from "./stockStats";

/**
 * Deadline for an upstream read. See the note on FETCH_TIMEOUT_MS in
 * dataFetcher.ts: without one, a stalled connection runs out Next's 60-second
 * static-generation budget and fails the build rather than falling back.
 */
const FETCH_TIMEOUT_MS = 15_000;

async function fetchFromGitHubRaw<T>(repo: string, token: string, filePath: string): Promise<T> {
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed fetching ${filePath}: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`
    );
  }
  return response.json() as Promise<T>;
}

/**
 * Load and transform the full product feed for one game.
 * Throws when required files can't be fetched from any source.
 */
export async function loadApiResponse(config: TcgConfig): Promise<ApiResponse> {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const blobAvailable = !!process.env.BLOB_BASE_URL;

  if (!blobAvailable && (!repo || !token)) {
    throw new Error("Missing GITHUB_REPO or GITHUB_TOKEN environment variables.");
  }

  const p = config.githubDataPath;
  const gitPath = (file: string) => (p ? `${p}/${file}` : file);

  function loadRequired<T>(fileName: string): Promise<T> {
    if (blobAvailable) return fetchGameData<T>(p, fileName);
    return fetchFromGitHubRaw<T>(repo!, token!, gitPath(fileName));
  }

  function loadOptional<T>(fileName: string, fallback: T): Promise<T> {
    return loadRequired<T>(fileName).catch(() => fallback);
  }

  const [state, history, stockChanges, enrichment, stats] = await Promise.all([
    loadRequired<StateJson>("state.json"),
    loadOptional<HistoryJson>("price_history.json", {}),
    loadOptional<StockChangesJson>("stock_changes.json", { events: [] }),
    loadOptional<SinglesEnrichmentJson | null>("singles_enrichment.json", null),
    loadOptional<StockStats>("stock_stats.json", EMPTY_STOCK_STATS),
  ]);

  return toApiResponse(state, history, stockChanges, config, enrichment, stats.products);
}

/**
 * Restock-rhythm and sellout-speed stats for one game.
 *
 * Separate from loadApiResponse rather than folded into it: only the retailer
 * pages and the out-of-stock hint need this, and the product feed is already
 * the heaviest thing the site loads. An absent or unreadable file yields empty
 * stats, never an error — every consumer of it renders nothing rather than
 * breaking, because a restock heatmap is a nice-to-have on a page whose job is
 * to show prices.
 */
export async function loadStockStats(config: TcgConfig): Promise<StockStats> {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const blobAvailable = !!process.env.BLOB_BASE_URL;
  const p = config.githubDataPath;

  try {
    if (blobAvailable) return await fetchGameData<StockStats>(p, "stock_stats.json");
    if (!repo || !token) return EMPTY_STOCK_STATS;
    return await fetchFromGitHubRaw<StockStats>(
      repo,
      token,
      p ? `${p}/stock_stats.json` : "stock_stats.json"
    );
  } catch {
    return EMPTY_STOCK_STATS;
  }
}

const STATS_TTL_MS = 5 * 60 * 1000;
const statsCache = new Map<string, { expiresAt: number; value: Promise<StockStats> }>();

export function loadStockStatsCached(config: TcgConfig): Promise<StockStats> {
  const hit = statsCache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = loadStockStats(config);
  statsCache.set(config.slug, { expiresAt: Date.now() + STATS_TTL_MS, value });
  return value;
}

/**
 * Build-time / ISR cache for the whole feed.
 *
 * getStaticProps runs once per page, and a listing plus its product pages would
 * otherwise re-fetch and re-transform the same multi-megabyte feed for each one.
 * Cached per game for a short window so a burst of ISR regenerations shares one
 * upstream read.
 */
const SSG_TTL_MS = 60 * 1000;
const ssgCache = new Map<string, { expiresAt: number; value: Promise<ApiResponse> }>();

export function loadApiResponseCached(config: TcgConfig): Promise<ApiResponse> {
  const hit = ssgCache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = loadApiResponse(config).catch((err) => {
    ssgCache.delete(config.slug); // never cache a rejection
    throw err;
  });
  ssgCache.set(config.slug, { expiresAt: Date.now() + SSG_TTL_MS, value });
  return value;
}

/** One product with its full history, for a statically generated detail page. */
export async function loadProduct(config: TcgConfig, groupKey: string) {
  const feed = await loadApiResponseCached(config);
  return feed.products.find((p) => p.group_key === groupKey) ?? null;
}
