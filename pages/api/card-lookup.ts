import type { NextApiRequest, NextApiResponse } from "next";
import { getTcgConfig, type TcgConfig } from "../../lib/tcg.config";
import { loadApiResponseCached } from "../../lib/serverProducts";
import { fetchGameBytes, fetchGameData } from "../../lib/dataFetcher";
import { getClientIp, rateLimit } from "../../lib/rateLimit";
import {
  ProviderUnavailable,
  hydratePokemonPage,
  searchCards,
} from "../../lib/cardProviders";
import { loadCardIndex } from "../../lib/serverCardIndex";
import {
  correctName,
  normalise as normaliseIndexName,
  searchIndex,
} from "../../lib/cardIndex";
import {
  listingMatchesCard,
  parseQuery,
  type CardListing,
  type CardMatch,
  type LookupResponse,
} from "../../lib/cardLookup";
import type { Product, SinglesEnrichmentJson } from "../../lib/products";
import {
  EMPTY_SINGLES,
  freshness,
  listingsForCard,
  parseSinglesState,
  type SinglesState,
} from "../../lib/singlesInventory";

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

/**
 * The crawled singles catalogue for one game, cached.
 *
 * Separate from the sealed feed and read separately, because it is built by a
 * different job on a different cadence — a rotating daily crawl rather than a
 * twice-daily sweep. Absent for a game with no verified singles collections
 * yet, which is the normal case rather than an error.
 */
const INVENTORY_TTL_MS = 15 * 60 * 1000;
const inventoryCache = new Map<string, { expiresAt: number; value: SinglesState }>();

async function loadInventory(folder: string, slug: string): Promise<SinglesState> {
  const hit = inventoryCache.get(slug);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value = EMPTY_SINGLES;
  try {
    value = parseSinglesState(await fetchGameBytes(folder, "singles_state.json.gz"));
  } catch {
    // No crawl for this game yet. The lookup still identifies the card.
  }
  inventoryCache.set(slug, { expiresAt: Date.now() + INVENTORY_TTL_MS, value });
  return value;
}

/**
 * Crawled listings, as confirmed matches.
 *
 * Confirmed because the crawler resolved the printing itself: it matched the
 * card's name and collector number out of the store's own title, which is a
 * stronger claim than the name containment used for the sealed feed. Finish,
 * condition and language ride along so the page can show which copy each price
 * is for — a Damaged Japanese non-foil is genuinely cheaper than a Near Mint
 * English holo and is not a deal on it.
 */
function crawledListings(
  inventory: SinglesState,
  cardName: string,
  collectorNumber: string
): CardListing[] {
  return listingsForCard(inventory, cardName, collectorNumber).map((l) => {
    const copy = [l.finish, l.condition];
    // English is the default and saying so on every row is noise; any other
    // language is the single most price-relevant thing about the listing.
    if (l.language && l.language !== "English") copy.push(l.language);
    return {
      groupKey: `${l.set}-${l.number}-${l.finish}-${l.condition}-${l.language}`,
      name: l.name,
      retailer: l.retailer,
      price: l.price,
      url: l.url,
      inStock: l.in_stock,
      confirmed: true,
      detail: `${copy.join(", ")} · ${freshness(l.seen)}`,
    };
  });
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

/** Printings shown at once. The rest are a "show more" away. */
const PAGE_SIZE = 12;

/**
 * The printings matching a query, and how many there are in total.
 *
 * Index first, provider second, and that order is the fix for the complaint
 * that started this: a search for "Pikachu" used to return six cards because
 * six was all the request budget allowed, not because six existed. The index
 * knows all 243 for free; only the twelve on screen cost a request each, and
 * those are cached.
 *
 * The provider is still the fallback for a game with no index published yet,
 * and for Magic it remains the primary — one Scryfall search returns every
 * printing with prices already attached, so an index would add nothing but a
 * name list for fuzzy correction.
 */
async function resolveMatches(
  config: TcgConfig,
  name: string,
  number: string | null,
  setTotal: string | null,
  fx: number,
  offset: number
): Promise<{
  found: Omit<CardMatch, "listings">[];
  total: number;
  correctedTo: string | null;
}> {
  const index = await loadCardIndex(config);

  if (config.slug !== "mtg" && index.cards.length > 0) {
    const result = searchIndex(index, name, {
      number,
      setTotal,
      limit: PAGE_SIZE,
      offset,
    });
    const priced = await hydratePokemonPage(
      result.cards.map((c) => c.id),
      fx
    );

    // A card the index knows but the provider could not price is still listed.
    // Dropping it would silently re-introduce the hole this replaced — the
    // reader would be told the card does not exist because a price lookup was
    // slow.
    const found = result.cards.map(
      (card) =>
        priced.get(card.id) ?? {
          id: card.id,
          name: card.name,
          setName: card.setName,
          setCode: card.setId.toUpperCase(),
          collectorNumber: card.number,
          setTotal: card.setTotal || null,
          rarity: null,
          imageUrl: card.imageUrl,
          sourceUrl: "",
          marketUsd: null,
          marketCad: null,
        }
    );
    return { found, total: result.total, correctedTo: result.correctedTo };
  }

  // Magic, or a game whose index has not been built yet. Fuzzy-correct the
  // name against the index when there is one, because Scryfall's own fuzzy
  // endpoint tolerates a character or two and OCR routinely produces three.
  let term = name;
  let correctedTo: string | null = null;
  if (index.names.length > 0) {
    const corrected = correctName(index, name);
    if (corrected && corrected !== normaliseIndexName(name)) {
      term = corrected;
      correctedTo = corrected;
    }
  }

  const all = await searchCards(config.slug, term, number, fx);
  return {
    found: all.slice(offset, offset + PAGE_SIZE),
    total: all.length,
    correctedTo,
  };
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

  const offset = Math.max(0, Math.min(500, Number(req.query.offset) || 0));

  const cacheKey = `${config.slug}:${raw.toLowerCase()}:${offset}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    res.setHeader("X-Cache", "hit");
    return res.status(200).json(hit.data);
  }

  const { name, number, setTotal } = parseQuery(raw);

  try {
    const fx = await usdToCad();
    const { found, total, correctedTo } = await resolveMatches(
      config,
      name,
      number,
      setTotal,
      fx,
      offset
    );

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
    const inventory = await loadInventory(config.githubDataPath, config.slug);

    const loose: CardListing[] = [];
    const matches: CardMatch[] = found.map((card) => {
      const all = listingsFor(products, card.id, card.name, card.collectorNumber);
      loose.push(...all.filter((l) => !l.confirmed));
      return {
        ...card,
        // Crawled singles first: the crawler read the printing out of the
        // store's own title, which is a stronger claim than name containment.
        listings: [
          ...crawledListings(inventory, card.name, card.collectorNumber),
          ...all.filter((l) => l.confirmed),
        ].slice(0, 10),
      };
    });

    const data: LookupResponse = {
      query: raw,
      tcg: config.slug,
      matches,
      unconfirmedListings: dedupeListings(loose),
      exact: !!number && total === 1,
      total,
      offset,
      correctedTo,
      note:
        total === 0
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
