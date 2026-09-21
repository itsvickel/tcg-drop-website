import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { loadCardIndex } from "../../lib/serverCardIndex";

/**
 * Every set in a game's catalogue, newest first.
 *
 * For the scanner's set picker. Somebody working through one set's box can say
 * so, and the lookup then uses it to settle reprint ties — the one thing a
 * picture cannot do for itself, because two printings of the same artwork are
 * genuinely the same 64 bits.
 *
 * Its own endpoint rather than a field on the lookup, because the picker has to
 * be populated before anything has been searched for. Ids and names only: about
 * 8KB for Pokemon's 216 sets and 20KB for Magic's 587, cached hard because a
 * new set appears every few weeks.
 */

type CardSet = { id: string; name: string };
type Response = { sets: CardSet[] } | { error: string };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; sets: CardSet[] }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  res.setHeader(
    "Cache-Control",
    "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400"
  );

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
    return res.status(200).json({ sets: hit.sets });
  }

  try {
    const index = await loadCardIndex(config);

    // Built by walking the cards rather than reading the index's own set map,
    // so the order matches the catalogue's — which is already newest-set-first,
    // and is the order somebody scanning a recent box wants to see.
    const seen = new Set<string>();
    const sets: CardSet[] = [];
    for (const card of index.cards) {
      if (!card.setId || seen.has(card.setId)) continue;
      seen.add(card.setId);
      sets.push({ id: card.setId, name: card.setName || card.setId });
    }

    cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, sets });
    res.setHeader("X-Cache", "miss");
    return res.status(200).json({ sets });
  } catch (err) {
    // No index for this game yet. An empty list hides the picker, which is the
    // right outcome: there is nothing to narrow to.
    console.warn("[api/card-sets] unavailable:", err);
    return res.status(200).json({ sets: [] });
  }
}
