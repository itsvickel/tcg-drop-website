/**
 * cardProviders.ts — resolving a card name or number against a card database.
 *
 * Two providers, because the two games have different ones:
 *
 *   Magic    → Scryfall (https://scryfall.com/docs/api). Already the source
 *              behind singles_enrichment.json, so the shapes here match what
 *              the rest of the site already knows how to render.
 *   Pokemon  → TCGdex (https://tcgdex.dev). MIT-licensed catalogue, no API key,
 *              CORS-open image CDN.
 *
 * Why TCGdex and not the obvious choice: pokemontcg.io, the API every Pokemon
 * tool was built on, is deprecated — new registrations are closed and existing
 * keys stop working on 2027-03-01, with its own docs pointing users elsewhere.
 * The official successor, Scrydex, forbids exactly this use in its terms
 * ("Use the Services primarily as a substitute backend, proxy, or wholesale
 * data source for a competing commercial product… without written
 * authorization"), and has no free tier. TCGdex's MIT licence carries no
 * non-commercial clause and no share-alike, which is the same standard that
 * ruled Bulbapedia out of the drops feature.
 *
 * Prices from both providers are treated as a *reference*, never as our answer.
 * Our own retailer scraping is the price this site is actually for; the
 * provider figure is a US market anchor that tells someone whether a Canadian
 * listing is a good one. TCGdex's own FAQ warns that variant-level price
 * collisions happen, so it is labelled as a market reference in the UI and
 * never presented as a Canadian price.
 *
 * Requests are server-side only. Both providers ask for a descriptive
 * User-Agent and neither wants to be hammered, so every response is cached and
 * lookups are capped.
 */

import { numberVariants, type CardMatch } from "./cardLookup";

const UA = "tcg-drop-website/1.0 (+https://pokemon-drop.ca) card lookup";
/**
 * Generous, because the providers are. Scryfall's response time for a card with
 * a hundred printings swings between two and ten seconds for the identical
 * query, so a tight timeout does not make the page fast — it makes it
 * intermittently wrong.
 */
const TIMEOUT_MS = 20000;

export const MAX_MATCHES = 12;

/**
 * How many full card records to fetch per Pokemon lookup.
 *
 * TCGdex's list endpoint returns id and name only, so each result costs a
 * second request. Twelve of those per keystroke-driven lookup is not being a
 * considerate client of a free, no-key API that asks callers to cache rather
 * than re-fetch, and it is also what pushed lookups past their own timeout.
 */
const MAX_HYDRATE = 6;

/**
 * A request outcome that distinguishes "the provider says no" from "the
 * provider did not answer".
 *
 * Collapsing the two is what let a single slow response cache an empty result
 * for half an hour: with no way to tell a genuine miss from a timeout, the
 * route had to treat both as "no such card".
 */
type Fetched<T> = { ok: true; data: T | null } | { ok: false; data: null };

async function getJson<T>(url: string): Promise<Fetched<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
    // 404 is a real answer — "no card by that name" — not a failure.
    if (res.status === 404) return { ok: true, data: null };
    if (!res.ok) return { ok: false, data: null };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Thrown when no provider request succeeded, so the caller can avoid caching. */
export class ProviderUnavailable extends Error {
  constructor() {
    super("Card provider did not respond");
    this.name = "ProviderUnavailable";
  }
}

// ── Scryfall (Magic) ────────────────────────────────────────────────────────

type ScryfallCard = {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  scryfall_uri?: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: { image_uris?: { normal?: string } }[];
  prices?: Record<string, string | null>;
};

function scryfallImage(card: ScryfallCard): string {
  if (card.image_uris?.normal) return card.image_uris.normal;
  for (const face of card.card_faces ?? []) {
    if (face.image_uris?.normal) return face.image_uris.normal;
  }
  return "";
}

function scryfallPrice(card: ScryfallCard): number | null {
  const prices = card.prices ?? {};
  for (const key of ["usd", "usd_foil", "usd_etched"]) {
    const raw = prices[key];
    const value = raw ? Number(raw) : NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function fromScryfall(card: ScryfallCard, fx: number): Omit<CardMatch, "listings"> {
  const usd = scryfallPrice(card);
  return {
    id: card.id,
    name: card.name,
    setName: card.set_name,
    setCode: (card.set || "").toUpperCase(),
    collectorNumber: card.collector_number,
    setTotal: null,
    rarity: card.rarity ?? null,
    imageUrl: scryfallImage(card),
    sourceUrl: card.scryfall_uri ?? "",
    marketUsd: usd,
    marketCad: usd === null ? null : Math.round(usd * fx * 100) / 100,
  };
}

async function searchScryfall(
  name: string,
  number: string | null,
  fx: number
): Promise<Omit<CardMatch, "listings">[]> {
  let reached = false;

  // A collector number pins one printing, so it is tried first and alone.
  if (number && name) {
    for (const variant of numberVariants(number)) {
      const url =
        "https://api.scryfall.com/cards/search?unique=prints&order=released&q=" +
        encodeURIComponent(`!"${name}" cn:${variant}`);
      const payload = await getJson<{ data?: ScryfallCard[] }>(url);
      reached = reached || payload.ok;
      if (payload.data?.data?.length) {
        return payload.data.data.slice(0, MAX_MATCHES).map((c) => fromScryfall(c, fx));
      }
    }
  }

  if (!name) return [];

  // Every printing, newest first: the same card at 19 different prices is the
  // answer to "what is this worth", not noise to be collapsed.
  const url =
    "https://api.scryfall.com/cards/search?unique=prints&order=released&dir=desc&q=" +
    encodeURIComponent(name);
  const payload = await getJson<{ data?: ScryfallCard[] }>(url);
  if (payload.data?.data?.length) {
    return payload.data.data.slice(0, MAX_MATCHES).map((c) => fromScryfall(c, fx));
  }

  // Fuzzy runs only when the search genuinely came back empty — a typo or an
  // OCR slip — never when it failed to answer. Scryfall's latency on a
  // many-printing card swings between two and ten seconds, and falling through
  // on a timeout returned exactly one arbitrary printing, unpriced, in place of
  // the hundred-odd real ones. A single wrong-looking card presented as the
  // answer is worse than saying the lookup did not work.
  if (!payload.ok && !reached) throw new ProviderUnavailable();
  if (!payload.ok) return [];

  const fuzzy = await getJson<ScryfallCard>(
    "https://api.scryfall.com/cards/named?fuzzy=" + encodeURIComponent(name)
  );
  return fuzzy.data?.id ? [fromScryfall(fuzzy.data, fx)] : [];
}

// ── TCGdex (Pokemon) ────────────────────────────────────────────────────────

type TcgdexBrief = { id: string; localId?: string; name?: string; image?: string };

type TcgdexCard = {
  id: string;
  localId?: string;
  name?: string;
  image?: string;
  rarity?: string;
  category?: string;
  set?: {
    id?: string;
    name?: string;
    logo?: string;
    cardCount?: { official?: number; total?: number };
  };
  variants_detailed?: {
    type?: string;
    pricing?: { tcgplayer?: Record<string, unknown> };
  }[];
};

/**
 * A USD market price from TCGdex's per-variant pricing block.
 *
 * The prices are a level deeper than the block itself: `pricing.tcgplayer`
 * holds `unit` and `updated` alongside one object per finish, so a normal card
 * reads `pricing.tcgplayer.normal.marketPrice` and a holo-only card
 * `pricing.tcgplayer.holofoil.marketPrice`. Reading `marketPrice` off the block
 * directly finds nothing, which is how this shipped returning null for every
 * Pokemon card.
 *
 * Finishes are tried plainest-first, because that is what someone holding an
 * ordinary copy has. A reverse-holo or first-edition price shown for a normal
 * card overstates it, routinely by an order of magnitude.
 */
const FINISH_PRIORITY = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "reverse-holofoil",
  "1stEditionNormal",
  "1stEditionHolofoil",
];

function priceFromFinish(finish: unknown): number | null {
  if (!finish || typeof finish !== "object") return null;
  const block = finish as Record<string, unknown>;
  for (const key of ["marketPrice", "midPrice", "directLowPrice", "lowPrice"]) {
    const value = Number(block[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function tcgdexPrice(card: TcgdexCard): number | null {
  for (const variant of card.variants_detailed ?? []) {
    const block = variant.pricing?.tcgplayer as Record<string, unknown> | undefined;
    if (!block) continue;

    for (const name of FINISH_PRIORITY) {
      const price = priceFromFinish(block[name]);
      if (price !== null) return price;
    }
    // An unfamiliar finish name still carries a real price; taking any of them
    // beats reporting a card as unpriced because TCGdex added a new foil.
    for (const [key, value] of Object.entries(block)) {
      if (key === "unit" || key === "updated") continue;
      const price = priceFromFinish(value);
      if (price !== null) return price;
    }
  }
  return null;
}

/** TCGdex serves images without an extension; the caller picks size and format. */
function tcgdexImage(base: string | undefined): string {
  return base ? `${base}/high.webp` : "";
}

function fromTcgdex(card: TcgdexCard, fx: number): Omit<CardMatch, "listings"> {
  const usd = tcgdexPrice(card);
  return {
    id: card.id,
    name: card.name ?? "",
    setName: card.set?.name ?? "",
    setCode: (card.set?.id ?? "").toUpperCase(),
    collectorNumber: card.localId ?? "",
    // official is the numbered run a collector completes; total counts promos
    // and alternate arts that were never part of it.
    setTotal: card.set?.cardCount?.official ?? null,
    rarity: card.rarity ?? null,
    imageUrl: tcgdexImage(card.image),
    // Deliberately empty. This used to build a tcgdex.net card URL, and every
    // one of them 404s — the site has no per-card pages at that path. The
    // working link is TCGplayer's, which card-lookup overlays from the price
    // table; a card we have no price for gets no link rather than a dead one.
    sourceUrl: "",
    marketUsd: usd,
    marketCad: usd === null ? null : Math.round(usd * fx * 100) / 100,
  };
}

async function searchTcgdex(
  name: string,
  number: string | null,
  fx: number
): Promise<Omit<CardMatch, "listings">[]> {
  if (!name && !number) return [];

  // The brief list endpoint returns id/name/image only, so the full record is
  // fetched per candidate. That is one request per result, which is why the
  // candidate list is trimmed hard before hydrating.
  const params = new URLSearchParams();
  if (name) params.set("name", `like:${name}`);
  const listed = await getJson<TcgdexBrief[]>(`https://api.tcgdex.net/v2/en/cards?${params}`);
  if (!listed.ok) throw new ProviderUnavailable();
  const brief = listed.data ?? [];

  let candidates = brief;
  if (number) {
    const variants = new Set(numberVariants(number));
    const pinned = brief.filter((c) => c.localId && variants.has(c.localId));
    // Only narrow when the number actually matched something; a misread number
    // should not empty a result set that had the right card in it.
    if (pinned.length > 0) candidates = pinned;
  }

  const hydrated = await Promise.all(
    candidates
      .slice(0, MAX_HYDRATE)
      .map((c) => getJson<TcgdexCard>(`https://api.tcgdex.net/v2/en/cards/${c.id}`))
  );

  const cards = hydrated
    .map((h) => h.data)
    .filter((c): c is TcgdexCard => !!c && !!c.id);

  // The list said there were cards and not one of them could be fetched: that
  // is an outage, not an empty shelf, and must not be cached as "no such card".
  if (cards.length === 0 && candidates.length > 0) throw new ProviderUnavailable();

  return cards.map((c) => fromTcgdex(c, fx));
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Order results the way someone holding the card would want them.
 *
 * Two rules, both earned from what the raw provider ordering returns:
 *
 *   Exact name first. Searching Pokemon for "Iono" matches every card whose
 *   name merely contains it, and TCGdex returns them in set order, so the card
 *   actually asked for arrives behind "Iono's Voltorb" and "Iono's Tadbulb".
 *
 *   Priced before unpriced. Scryfall's newest-first ordering puts preview and
 *   just-spoiled printings at the top, and those have no market price yet, so
 *   the first screen of a search for a staple card could be nothing but blanks.
 *   A printing we cannot price does not answer the question, so it yields to
 *   one that does — but it is still listed, because it is still the card.
 */
function rankMatches(
  matches: Omit<CardMatch, "listings">[],
  name: string
): Omit<CardMatch, "listings">[] {
  const wanted = name.trim().toLowerCase();
  const score = (card: Omit<CardMatch, "listings">) => {
    const exact = card.name.trim().toLowerCase() === wanted ? 0 : 1;
    const priced = card.marketUsd === null ? 1 : 0;
    return exact * 2 + priced;
  };
  return [...matches].sort((a, b) => score(a) - score(b));
}

export async function searchCards(
  tcg: string,
  name: string,
  number: string | null,
  fx: number
): Promise<Omit<CardMatch, "listings">[]> {
  const found =
    tcg === "mtg"
      ? await searchScryfall(name, number, fx)
      : await searchTcgdex(name, number, fx);
  return rankMatches(found, name);
}

// ── Hydrating one card ──────────────────────────────────────────────────────

/**
 * Full details for a single Pokemon printing, cached.
 *
 * The index knows every card's name, set and number but deliberately carries no
 * prices — TCGdex has no bulk price endpoint, and fetching 23,736 of them
 * against a free API would be indefensible. So the index answers "which cards
 * are these" for free, and this answers "what is this one worth" for the
 * handful actually on screen.
 *
 * Cached for six hours and keyed by card id. Card details barely change and
 * prices move daily, so a long TTL costs freshness nobody can perceive and
 * saves the provider a request per card per visitor.
 */
const CARD_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CARD_CACHE = 4000;
const cardCache = new Map<string, { expiresAt: number; value: TcgdexCard | null }>();

/**
 * One Magic card by its Scryfall id.
 *
 * The counterpart to hydratePokemonCard, and it exists for the same reason the
 * Pokemon one does: the scanner recognises a card by its artwork and hands back
 * an id, which then has to become a priced card. Without this, an artwork match
 * on a Magic card resolved to nothing at all.
 *
 * Scryfall ids are UUIDs and TCGdex ids are not, so the two never collide and
 * the caller can route on the game alone.
 */
export async function hydrateScryfallCard(
  id: string,
  fx: number
): Promise<Omit<CardMatch, "listings"> | null> {
  // Ids come off a scan and go straight into a URL. Scryfall ids are UUIDs and
  // nothing else, so anything that is not one is rejected rather than sent.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const fetched = await getJson<ScryfallCard>(`https://api.scryfall.com/cards/${id}`);
  // A failed request is not cached and not reported as "no such card": a slow
  // moment must not tell somebody the card in their hand does not exist.
  if (!fetched.ok || !fetched.data) return null;
  return fromScryfall(fetched.data, fx);
}

export async function hydratePokemonCard(
  id: string,
  fx: number
): Promise<Omit<CardMatch, "listings"> | null> {
  const hit = cardCache.get(id);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value ? fromTcgdex(hit.value, fx) : null;
  }

  const fetched = await getJson<TcgdexCard>(`https://api.tcgdex.net/v2/en/cards/${id}`);
  // A failed request is not cached: a slow moment must not make a card look
  // priceless for six hours.
  if (!fetched.ok) return null;

  if (cardCache.size >= MAX_CARD_CACHE) {
    const oldest = cardCache.keys().next().value;
    if (oldest) cardCache.delete(oldest);
  }
  cardCache.set(id, { expiresAt: Date.now() + CARD_TTL_MS, value: fetched.data });
  return fetched.data ? fromTcgdex(fetched.data, fx) : null;
}

/**
 * Prices for a page of results, fetched together.
 *
 * Bounded by how many are on screen rather than by how many matched, which is
 * the whole point of pairing an index with on-demand hydration: 153 Pikachus
 * can be listed, and only the dozen someone is looking at costs anything.
 */
/**
 * How long the page will wait for prices before rendering without them.
 *
 * Twelve hydrations on a cold cache took twelve seconds, because they are only
 * as fast as the slowest one and TCGdex's latency has a long tail. The index
 * already supplies the name, set, number and image, so a card whose price has
 * not arrived is still a complete, useful result — and it will have a price on
 * the next search, because the request that missed this deadline still lands
 * and still fills the cache.
 */
const HYDRATE_BUDGET_MS = 3500;

export async function hydratePokemonPage(
  ids: string[],
  fx: number
): Promise<Map<string, Omit<CardMatch, "listings">>> {
  const out = new Map<string, Omit<CardMatch, "listings">>();

  await Promise.race([
    Promise.all(
      ids.map(async (id) => {
        const card = await hydratePokemonCard(id, fx);
        if (card) out.set(id, card);
      })
    ),
    new Promise((resolve) => setTimeout(resolve, HYDRATE_BUDGET_MS)),
  ]);

  // Whatever arrived inside the budget. The map is read after the race rather
  // than built from its result, so a slow straggler simply is not in it.
  return out;
}

/** Attribution the UI is required to show. Both are conditions of use. */
export function providerCredit(tcg: string): { label: string; url: string } {
  return tcg === "mtg"
    ? { label: "Card data and images from Scryfall", url: "https://scryfall.com" }
    : { label: "Card data and images from TCGdex", url: "https://tcgdex.dev" };
}
