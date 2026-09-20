import { gunzipSync } from "zlib";
import { fetchGameBytes } from "./dataFetcher";
import type { TcgConfig } from "./tcg.config";

/**
 * serverCardPrices.ts — TCGplayer market prices, loaded once and held.
 *
 * This replaces asking TCGdex for a price per card per request, which was not
 * working: every lookup on the live site returned `marketUsd: null` for every
 * result, so the "market reference" column the page is built around was empty
 * for the entire catalogue. TCGdex is a fine catalogue and does not claim to be
 * a price source; its own FAQ warns that variant-level price collisions happen.
 *
 * It also fixes the links. Every card's `sourceUrl` pointed at tcgdex.net and
 * every one of those 404s — not the occasional card, all of them. The product
 * ids here rebuild a real TCGplayer URL that opens.
 *
 * The data is built daily by build_tcgplayer_prices.py in the data repo, which
 * does the hard part: matching two catalogues that share no identifiers. It is
 * keyed by our own card id precisely so that nothing here has to guess. Sets it
 * could not match confidently are absent rather than approximated — a wrong
 * price is much worse than no price, and one bad set mapping is a wrong price
 * on every card in that set.
 *
 * Roughly 79% of the catalogue is priced. The rest are promos, energy sets and
 * boxed-product decks whose numbering does not line up between the two
 * databases, and they show no market reference at all.
 */

/** One card's TCGplayer data, in the compact shape the file ships. */
type PriceRecord = {
  /** TCGplayer product id. */
  u: number;
  /** TCGplayer's rarity label. */
  r: string;
  /** Market price per finish, e.g. {"Holofoil": 359.87}. */
  p: Record<string, number>;
  /**
   * Printings TCGplayer sells separately that our catalogue has one entry for,
   * as [variant, productId, prices]. A Master Ball Pattern reverse holo is a
   * different card at the same collector number and can be worth many times
   * the plain one, so these are kept apart rather than averaged into a figure
   * nobody charges.
   */
  v?: [string, number, Record<string, number>][];
};

export type CardPrice = {
  usd: number;
  /** Which finish the figure is for — "Holofoil", "1st Edition", and so on. */
  finish: string;
  productUrl: string;
  rarity: string | null;
};

type PriceFile = { generated_at?: string; cards?: Record<string, PriceRecord> };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; cards: Record<string, PriceRecord> }>();
/** In-flight loads, so a cold start with concurrent requests fetches once. */
const inFlight = new Map<string, Promise<Record<string, PriceRecord>>>();

/**
 * The finish to quote when a card has several.
 *
 * Ordered by what someone holding the card most likely has. A base-set card
 * lists "1st Edition Holofoil" and "Unlimited Holofoil" and those differ by a
 * factor of four, so picking the cheaper one and calling it the market price
 * would understate the card badly; picking the dearer one would overstate every
 * unlimited copy. Unlimited is the common case and therefore the honest default,
 * with the rarer 1st Edition only used when nothing else exists.
 */
const FINISH_ORDER = [
  "Normal",
  "Holofoil",
  "Unlimited",
  "Unlimited Holofoil",
  "Reverse Holofoil",
  "1st Edition",
  "1st Edition Holofoil",
];

function pickFinish(prices: Record<string, number>): { finish: string; usd: number } | null {
  const entries = Object.entries(prices).filter(([, v]) => typeof v === "number" && v > 0);
  if (entries.length === 0) return null;
  for (const finish of FINISH_ORDER) {
    const hit = entries.find(([name]) => name === finish);
    if (hit) return { finish: hit[0], usd: hit[1] };
  }
  // An unrecognised finish name. Take the cheapest rather than the dearest:
  // overstating what a card is worth is the more damaging way to be wrong.
  entries.sort((a, b) => a[1] - b[1]);
  return { finish: entries[0][0], usd: entries[0][1] };
}

async function load(config: TcgConfig): Promise<Record<string, PriceRecord>> {
  const raw = await fetchGameBytes(config.githubDataPath, "tcgplayer_prices.json.gz");
  // Sniffed rather than assumed: a .gz served with Content-Encoding: gzip is
  // inflated by fetch before we see it, and inflating twice throws.
  const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const file = JSON.parse((isGzip ? gunzipSync(raw) : raw).toString("utf-8")) as PriceFile;
  return file.cards ?? {};
}

/**
 * Every priced card for one game.
 *
 * Returns an empty table rather than throwing when the file is missing, because
 * a game with no price data published yet must still be searchable. The caller
 * then shows no market reference, which is what it did before this existed.
 */
export async function loadCardPrices(
  config: TcgConfig
): Promise<Record<string, PriceRecord>> {
  const hit = cache.get(config.slug);
  if (hit && hit.expiresAt > Date.now()) return hit.cards;

  const existing = inFlight.get(config.slug);
  if (existing) return existing;

  const pending = load(config)
    .then((cards) => {
      cache.set(config.slug, { expiresAt: Date.now() + CACHE_TTL_MS, cards });
      return cards;
    })
    .catch((err) => {
      console.warn("[serverCardPrices] unavailable:", err);
      // Cached briefly even on failure, so one slow upstream does not have
      // every request in the next minute retry it in parallel.
      cache.set(config.slug, { expiresAt: Date.now() + 60_000, cards: {} });
      return {};
    })
    .finally(() => inFlight.delete(config.slug));

  inFlight.set(config.slug, pending);
  return pending;
}

/** TCGplayer's own product URL. The slug is cosmetic; the id is what resolves. */
export function productUrl(productId: number): string {
  return `https://www.tcgplayer.com/product/${productId}`;
}

/** One card's market reference, or null when we have no trustworthy figure. */
export function priceFor(
  cards: Record<string, PriceRecord>,
  cardId: string
): CardPrice | null {
  const record = cards[cardId];
  if (!record) return null;
  const picked = pickFinish(record.p ?? {});
  if (!picked) return null;
  return {
    usd: picked.usd,
    finish: picked.finish,
    productUrl: productUrl(record.u),
    rarity: record.r || null,
  };
}
