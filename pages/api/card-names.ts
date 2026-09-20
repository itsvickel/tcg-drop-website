import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { loadCardIndex } from "../../lib/serverCardIndex";

/**
 * Every distinct card name for one game, for the scanner to match against.
 *
 * The scanner needs this on the device, not on the server. It reads a frame
 * every second or so and most readings are noise; sending each one to be looked
 * up would be a request per second per user to answer "is this even a card",
 * and the answer would arrive too late to stop the noise being displayed.
 *
 * Small enough to make that practical: the distinct names are a few thousand
 * strings, around 20KB over the wire once compressed, fetched once per session
 * and kept in memory. The full index stays on the server, because the scanner
 * only needs to know what cards are *called* — which printing it is comes from
 * the lookup afterwards.
 *
 * Cached hard. New names appear when a set releases, not hourly.
 */

type Response = { names: string[] } | { error: string };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; names: string[] }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");

  const tcgParam = typeof req.query.tcg === "string" ? req.query.tcg : "pokemon";
  let config;
  try {
    config = getTcgConfig(tcgParam);
  } catch {
    return res.status(400).json({ error: `Invalid tcg param: "${tcgParam}"` });
  }

  const hit = cache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) {
    res.setHeader("X-Cache", "hit");
    return res.status(200).json({ names: hit.names });
  }

  try {
    const index = await loadCardIndex(config);
    // Already normalised and de-duplicated by the index loader, which is what
    // makes this small: 23,736 printings share about 4,000 distinct names.
    const names = index.names;

    cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, names });
    res.setHeader("X-Cache", "miss");
    return res.status(200).json({ names });
  } catch (err) {
    console.error("[api/card-names] failed:", err);
    // An empty list is a working answer: the scanner falls back to accepting
    // readings unvalidated, which is how it behaved before this existed.
    return res.status(200).json({ names: [] });
  }
}
