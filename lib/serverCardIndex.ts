import { fetchGameBytes } from "./dataFetcher";
import { EMPTY_INDEX, parseCardIndex, type CardIndex } from "./cardIndex";
import type { TcgConfig } from "./tcg.config";

/**
 * Loading the card index, once per process.
 *
 * The parsed index is a few tens of megabytes of JavaScript objects and it is
 * read on every lookup, so it is built once and kept. The TTL is long because
 * the underlying file changes weekly at most — new sets and promos, not prices,
 * which the index deliberately does not carry.
 *
 * The in-flight promise is cached rather than the result, so a burst of lookups
 * on a cold server shares one download instead of starting twelve.
 */
const INDEX_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; value: Promise<CardIndex> }>();

export function loadCardIndex(config: TcgConfig): Promise<CardIndex> {
  const hit = cache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = fetchGameBytes(config.githubDataPath, "card_index.json.gz")
    .then(parseCardIndex)
    .catch(() => {
      // No index published for this game yet. Callers fall back to querying the
      // provider directly, which is what they did before the index existed.
      cache.delete(config.slug);
      return EMPTY_INDEX;
    });

  cache.set(config.slug, { expiresAt: Date.now() + INDEX_TTL_MS, value });
  return value;
}
