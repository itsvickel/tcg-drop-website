import type { NextApiRequest, NextApiResponse } from "next";

export type CalendarSet = {
  name: string;
  series: string;
  release_date: string;
  type: string;
  products: string[];
  notes?: string;
};

export type CalendarResponse = { sets: CalendarSet[] };

const REPO  = process.env.GITHUB_REPO ?? "";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: { expiresAt: number; data: CalendarResponse } | null = null;

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<CalendarResponse | { error: string }>
) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");

  if (cache && cache.expiresAt > Date.now()) {
    return res.status(200).json(cache.data);
  }

  if (!REPO || !TOKEN) return res.status(500).json({ error: "Missing env vars" });

  try {
    const url = `https://api.github.com/repos/${REPO}/contents/release_calendar.json`;
    const raw = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json" },
    });
    if (!raw.ok) throw new Error(`GitHub: ${raw.status}`);
    const data = await raw.json() as CalendarResponse;
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, data };
    return res.status(200).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
