import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { fetchGameData } from "../../lib/dataFetcher";
import {
  toApiResponse,
  type StateJson,
  type HistoryJson,
  type StockChangesJson,
} from "../../lib/products";
import { joinCalendar, type CalendarResponse, type RawCalendarResponse } from "../../lib/calendar";

export type { Confidence, CalendarProduct, CalendarSet, CalendarResponse } from "../../lib/calendar";

const REPO  = process.env.GITHUB_REPO ?? "";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; data: CalendarResponse }>();

async function fetchJson<T>(filePath: string): Promise<T> {
  const url = `https://api.github.com/repos/${REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
  });
  if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
  if (!res.ok) throw new Error(`GitHub: ${res.status}`);
  return res.json() as Promise<T>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CalendarResponse | { error: string }>
) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");

  const tcgParam = typeof req.query.tcg === "string" ? req.query.tcg : "pokemon";
  let config;
  try {
    config = getTcgConfig(tcgParam);
  } catch {
    return res.status(400).json({ error: `Invalid tcg param: "${tcgParam}"` });
  }

  const cached = cache.get(config.slug);
  if (cached && cached.expiresAt > Date.now()) {
    return res.status(200).json(cached.data);
  }

  if (!REPO || !TOKEN) return res.status(500).json({ error: "Missing env vars" });

  const p = config.githubDataPath;
  const path = (file: string) => (p ? `${p}/${file}` : file);
  const blobAvailable = !!process.env.BLOB_BASE_URL;

  function load<T>(fileName: string): Promise<T> {
    return blobAvailable ? fetchGameData<T>(p, fileName) : fetchJson<T>(path(fileName));
  }
  function loadOptional<T>(fileName: string, fallback: T): Promise<T> {
    return load<T>(fileName).catch(() => fallback);
  }

  try {
    // The calendar itself is required; a missing file means an empty calendar.
    let rawCalendar: RawCalendarResponse;
    try {
      rawCalendar = await load<RawCalendarResponse>("release_calendar.json");
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        const empty: CalendarResponse = { sets: [] };
        cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, data: empty });
        return res.status(200).json(empty);
      }
      throw err;
    }

    // Live data is best-effort — on failure we still return the (un-enriched) calendar.
    const [state, history, stockChanges] = await Promise.all([
      loadOptional<StateJson>("state.json", { best_prices: {} }),
      loadOptional<HistoryJson>("price_history.json", {}),
      loadOptional<StockChangesJson>("stock_changes.json", { events: [] }),
    ]);

    const liveProducts = toApiResponse(state, history, stockChanges, config).products;
    const data = joinCalendar(rawCalendar, liveProducts, config);

    cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return res.status(200).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
