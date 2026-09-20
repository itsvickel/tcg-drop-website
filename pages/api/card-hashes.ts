import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { fetchGameBytes } from "../../lib/dataFetcher";
import { gunzipSync } from "zlib";
import { HASH_SIZE, HEX_CHARS, type PackedHashTable } from "../../lib/artHash";

/**
 * Artwork fingerprints for every card, for the scanner to match against.
 *
 * This has to be on the device. Matching a frame against the whole catalogue
 * costs about 6ms locally, which is what lets the scanner check every frame
 * instead of once a second — and checking every frame is the entire reason
 * picture matching beats reading the title. Round-tripping each frame to a
 * server would throw that away and turn a 6ms local computation into a request
 * per second per user.
 *
 * Sent as parallel arrays rather than an object of id-to-hash pairs: twenty-two
 * thousand JSON pairs spend most of their bytes on punctuation. The ids
 * compress well because they share set prefixes; the fingerprints are
 * near-random and do not compress at all, which puts a hard floor of about
 * eight bytes a card on this however it is encoded.
 *
 * Cached hard, and partial by design. The builder works newest-set-first and is
 * resumable, so a catalogue that is only half fingerprinted still covers the
 * cards people are most likely to be holding.
 */

type Response = PackedHashTable | { error: string };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: PackedHashTable }>();

const EMPTY: PackedHashTable = { ids: [], packed: "", size: HASH_SIZE };

type HashFile = { size?: number; hashes?: Record<string, string> };

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
    return res.status(200).json(hit.value);
  }

  try {
    const raw = await fetchGameBytes(config.githubDataPath, "card_hashes.json.gz");
    // Sniffed rather than assumed: a .gz served with Content-Encoding: gzip is
    // inflated by fetch before we see it, and inflating twice throws.
    const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const file = JSON.parse((isGzip ? gunzipSync(raw) : raw).toString("utf-8")) as HashFile;

    if (file.size !== HASH_SIZE) {
      // Built by a different version of the algorithm. Serving it would have
      // the scanner match against fingerprints that mean something else.
      console.warn("[api/card-hashes] size mismatch:", file.size, "expected", HASH_SIZE);
      return res.status(200).json(EMPTY);
    }

    const ids: string[] = [];
    const parts: string[] = [];
    for (const [id, hex] of Object.entries(file.hashes ?? {})) {
      if (typeof hex !== "string" || hex.length !== HEX_CHARS) continue;
      ids.push(id);
      parts.push(hex);
    }

    const value: PackedHashTable = { ids, packed: parts.join(""), size: HASH_SIZE };
    cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    res.setHeader("X-Cache", "miss");
    return res.status(200).json(value);
  } catch (err) {
    // Not built for this game yet. An empty table is a working answer: the
    // scanner falls back to reading the title, which is how it worked before.
    console.warn("[api/card-hashes] unavailable:", err);
    return res.status(200).json(EMPTY);
  }
}
