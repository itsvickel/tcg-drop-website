import { gunzipSync } from "zlib";
import { fetchGameBytes } from "./dataFetcher";
import { HASH_SIZE, HEX_CHARS } from "./artHash";
import type { TcgConfig } from "./tcg.config";

/**
 * serverCardHashes.ts — turning a fingerprint back into a card.
 *
 * The browser downloads fingerprints without card ids, because the ids are
 * three quarters of the payload and it never reads them: it matches a picture
 * and hands the winning fingerprint back. This is the other half of that trade
 * — the map from a fingerprint to the cards that have it.
 *
 * Why a fingerprint and not a row number. A row number would be meaningless if
 * the table were rebuilt between the browser's download and its next lookup,
 * and meaningless in the worst way: it would still resolve, to a different
 * card, with no way to notice. A fingerprint either exists in the table or it
 * does not, and a rebuild that drops one turns into a clean decline.
 *
 * One fingerprint can belong to several cards — about 2% of the Pokemon
 * catalogue and a handful of Magic's, all reprints that share their artwork.
 * That is returned as-is rather than resolved arbitrarily, because the caller
 * already knows what to do with a tie: search the card by name and let the
 * collector number settle it.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type Index = Map<string, string[]>;

const cache = new Map<string, { expiresAt: number; index: Index }>();
/** In-flight loads, so a cold start with concurrent scans fetches once. */
const inFlight = new Map<string, Promise<Index>>();

type HashFile = { size?: number; hashes?: Record<string, string> };

async function load(config: TcgConfig): Promise<Index> {
  const raw = await fetchGameBytes(config.githubDataPath, "card_hashes.json.gz");
  // Sniffed rather than assumed: a .gz served with Content-Encoding: gzip is
  // inflated by fetch before we see it, and inflating twice throws.
  const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const file = JSON.parse((isGzip ? gunzipSync(raw) : raw).toString("utf-8")) as HashFile;

  if (file.size !== HASH_SIZE) {
    // Built by a different version of the algorithm. Resolving against it would
    // name cards from fingerprints that mean something else.
    console.warn("[serverCardHashes] size mismatch:", file.size, "expected", HASH_SIZE);
    return new Map();
  }

  const index: Index = new Map();
  for (const [id, hex] of Object.entries(file.hashes ?? {})) {
    if (typeof hex !== "string" || hex.length !== HEX_CHARS) continue;
    const found = index.get(hex);
    if (found) found.push(id);
    else index.set(hex, [id]);
  }
  return index;
}

/** The fingerprint-to-cards map for one game, cached. */
export function loadHashIndex(config: TcgConfig): Promise<Index> {
  const hit = cache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.index);

  const existing = inFlight.get(config.slug);
  if (existing) return existing;

  const pending = load(config)
    .then((index) => {
      cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, index });
      return index;
    })
    .catch((err) => {
      // Not published for this game yet, or unreachable. An empty map is a
      // working answer: the scan declines and the user types the name.
      console.warn("[serverCardHashes] unavailable:", err);
      cache.set(config.slug, { expiresAt: Date.now() + 60_000, index: new Map() });
      return new Map<string, string[]>();
    })
    .finally(() => inFlight.delete(config.slug));

  inFlight.set(config.slug, pending);
  return pending;
}

/** True for a string that could be one of our fingerprints. */
export function isFingerprint(value: string): boolean {
  return value.length === HEX_CHARS && /^[0-9a-f]+$/.test(value);
}

/**
 * Every card matching any of these fingerprints.
 *
 * Order is preserved and duplicates removed, so the caller sees the best
 * candidate first. An unknown fingerprint contributes nothing rather than
 * failing the whole request — the table may have been rebuilt since the
 * browser downloaded it, and the others are still good.
 */
export async function cardsForHashes(
  config: TcgConfig,
  hashes: string[]
): Promise<string[]> {
  if (hashes.length === 0) return [];
  const index = await loadHashIndex(config);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hash of hashes) {
    if (!isFingerprint(hash)) continue;
    for (const id of index.get(hash) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
