import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig } from "../../lib/tcg.config";
import { loadApiResponseCached } from "../../lib/serverProducts";
import { fetchGameData } from "../../lib/dataFetcher";
import { getClientIp, rateLimit } from "../../lib/rateLimit";
import { ProviderUnavailable, searchCards } from "../../lib/cardProviders";
import {
  listingMatchesCard,
  parseQuery,
  type CardListing,
  type CardMatch,
  type LookupResponse,
} from "../../lib/cardLookup";
import type { Product, SinglesEnrichmentJson } from "../../lib/products";

/**
 * Identify a card and price it — the engine behind /scan.
 *
 * Two halves, and keeping them distinct is the whole design:
 *
 *   Identity and market reference come from a card database (Scryfall for
 *   Magic, TCGdex for Pokemon). This works for every card in print, including
 *   the overwhelming majority that no Canadian shop we track happens to list.
 *
 *   Canadian prices come from our own scraping, and only from it. They are
 *   attached per card, and their absence is reported as "no Canadian listing
 *   tracked" rather than left to look like a card with no value.
 *
 * A scanner that only recognised cards we had listings for would fail on almost
 * every scan, so identity never depends on our own catalogue.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
/** A miss is remembered only long enough to absorb a repeated keystroke. */
const EMPTY_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

type Entry = { expiresAt: number; data: LookupResponse };
const cache = new Map<string, Entry>();

/**
 * USD→CAD, taken from whichever singles enrichment last ran.
 *
 * Reusing the rate the Python side already fetched keeps one number in the
 * system: a card priced here and the same card on a listing page must not
 * disagree because two processes asked two different sources on two days.
 */
const FX_FALLBACK = 1.38;
let fxCache: { expiresAt: number; rate: number } | null = null;

async function usdToCad(): Promise<number> {
  if (fxCache && fxCache.expiresAt > Date.now()) return fxCache.rate;
  try {
    const enrichment = await fetchGameData<SinglesEnrichmentJson>(
      "mtg",
      "singles_enrichment.json"
    );
    const rate = Number(enrichment?.fx_rate);
    if (Number.isFinite(rate) && rate > 0) {
      fxCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, rate };
      return rate;
    }
  } catch {
    // Fall through: a stale-but-sane rate beats refusing to price the card.
  }
  fxCache = { expiresAt: Date.now() + 15 * 60 * 1000, rate: FX_FALLBACK };
  return FX_FALLBACK;
}

/**
 * Our tracked Canadian listings for one card, cheapest first.
 *
 * Only listings classified as singles are eligible, and that restriction is
 * load-bearing rather than tidy. Searching the whole feed by name matches
 * "Mega Charizard ex Tin" and "Charizard EX Super-Premium Collection" for a
 * scan of a Charizard card, and the cheapest of those was a $73.93 tin shown
 * beside a card with a $140 market price — a sealed box presented as the
 * Canadian price of a single. The category is already on every product; a name
 * is simply not enough to tell a card from a box named after it.
 */
function listingsFor(
  products: Product[],
  cardId: string,
  cardName: string,
  collectorNumber: string
): CardListing[] {
  const out: CardListing[] = [];

  for (const product of products) {
    if (product.category !== "single") continue;

    // The singles enrichment resolved many listings to an exact Scryfall
    // printing, and where it did that answer is authoritative in both
    // directions: it confirms a match and it rules one out.
    //
    // But only where it is exact. The enrichment sets `approximate` when it
    // fell back to a name-only match, and those land on an arbitrary printing —
    // three visibly different Secret Lair Sol Rings (Pool Party Foil, Countdown
    // Kit, Retro Foil Etched) all resolve to one id that way. Treating those as
    // confirmed put a $23 listing and a $95 listing under the same card as
    // though both were that printing.
    const card = product.card;
    const exactlyResolved = !!card?.scryfall_id && !card.approximate;
    let confirmed = false;

    if (exactlyResolved) {
      if (card!.scryfall_id !== cardId) continue;
      confirmed = true;
    } else {
      // Fall back to the printed name and number. An approximate enrichment
      // adds nothing here — its id is a guess — so it is ignored rather than
      // trusted or used to exclude.
      if (!listingMatchesCard(product.name, cardName, collectorNumber || null)) continue;
    }

    const rows = [
      { retailer: product.retailer, price: product.price, url: product.url, in_stock: product.in_stock },
      ...(product.other_retailers ?? []),
    ];
    for (const row of rows) {
      out.push({
        groupKey: product.group_key,
        name: product.name,
        retailer: row.retailer,
        price: row.price,
        url: row.url,
        inStock: row.in_stock,
        confirmed,
      });
    }
  }

  // In stock before out of stock, then cheapest. A $2 listing nobody can buy is
  // not a better answer than a $6 one in stock.
  return out
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price)
    .slice(0, 8);
}

/** One row per shop and listing, so a card matched twelve times is listed once. */
function dedupeListings(listings: CardListing[]): CardListing[] {
  const seen = new Map<string, CardListing>();
  for (const listing of listings) {
    const key = `${listing.groupKey}|${listing.retailer}|${listing.price}`;
    if (!seen.has(key)) seen.set(key, listing);
  }
  return [...seen.values()]
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price)
    .slice(0, 8);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LookupResponse | { error: string }>
) {
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");

  const limited = rateLimit(getClientIp(req));
  if (!limited.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
    return res.status(429).json({ error: "Too many lookups — give it a moment." });
  }

  const tcgParam = typeof req.query.tcg === "string" ? req.query.tcg : "pokemon";
  let config;
  try {
    config = getTcgConfig(tcgParam);
  } catch {
    return res.status(400).json({ error: `Invalid tcg param: "${tcgParam}"` });
  }

  const raw = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (raw.length < 2) {
    return res.status(400).json({ error: "Search for at least two characters." });
  }

  const cacheKey = `${config.slug}:${raw.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    res.setHeader("X-Cache", "hit");
    return res.status(200).json(hit.data);
  }

  const { name, number } = parseQuery(raw);

  try {
    const fx = await usdToCad();
    const found = await searchCards(config.slug, name, number, fx);

    // Our own listings are a join onto whatever the provider identified, and a
    // feed outage must not stop the lookup from identifying the card.
    let products: Awaited<ReturnType<typeof loadApiResponseCached>>["products"] = [];
    try {
      products = (await loadApiResponseCached(config)).products;
    } catch (err) {
      console.warn("[api/card-lookup] listings unavailable:", err);
    }

    // A confirmed listing belongs to its printing; an unconfirmed one belongs
    // to the search, and is collected once across every printing rather than
    // repeated under each.
    const loose: CardListing[] = [];
    const matches: CardMatch[] = found.map((card) => {
      const all = listingsFor(products, card.id, card.name, card.collectorNumber);
      loose.push(...all.filter((l) => !l.confirmed));
      return { ...card, listings: all.filter((l) => l.confirmed) };
    });

    const data: LookupResponse = {
      query: raw,
      tcg: config.slug,
      matches,
      unconfirmedListings: dedupeListings(loose),
      exact: !!number && matches.length === 1,
      note:
        matches.length === 0
          ? "No card matched. Check the spelling, or try the collector number from the bottom of the card."
          : null,
    };

    // Bounded: this cache is keyed by user input, so an unbounded map is a
    // memory leak with a public trigger. Oldest out first.
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    // A genuine "no such card" is cheap to remember, but only briefly: it is
    // usually a typo being corrected a second later, and the half-hour TTL that
    // suits a real card would keep answering "not found" long after the
    // provider recovered. A found card is stable and gets the full window.
    cache.set(cacheKey, {
      expiresAt: Date.now() + (matches.length > 0 ? CACHE_TTL_MS : EMPTY_TTL_MS),
      data,
    });

    res.setHeader("X-Cache", "miss");
    return res.status(200).json(data);
  } catch (err) {
    if (err instanceof ProviderUnavailable) {
      // Never cached, and never reported as "no such card" — telling somebody
      // their card does not exist because a third party timed out is the one
      // wrong answer this endpoint can give.
      console.warn("[api/card-lookup] provider unreachable for:", raw);
      return res
        .status(503)
        .json({ error: "The card database is not responding. Try again in a moment." });
    }
    console.error("[api/card-lookup] failed:", err);
    return res.status(503).json({ error: "Card lookup temporarily unavailable" });
  }
}
