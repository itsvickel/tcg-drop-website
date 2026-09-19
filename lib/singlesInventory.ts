/**
 * singlesInventory.ts — the crawled singles catalogue, read by the card lookup.
 *
 * `singles_state.json.gz` is written by singles_crawl.py in the data repo. It
 * is a rotating crawl rather than a sweep: one shop's singles run to tens of
 * thousands of cards, so the crawler spends a fixed request budget per day and
 * comes back round over days. Every listing therefore carries the date it was
 * last seen, and the UI shows that date rather than implying the price was
 * checked this morning.
 *
 * Cards are keyed by what identifies a printing and a copy — name, set,
 * collector number, finish, condition and language — because all six change the
 * price. Matching a scanned card against this catalogue therefore means
 * matching the first three and reporting the other three, never averaging over
 * them: a Damaged Japanese non-foil and a Near Mint English holo are different
 * products, and the cheapest of the two is not a deal on the other.
 */

import { gunzipSync } from "zlib";

export type SinglesListing = {
  name: string;
  set: string;
  number: string;
  finish: string;
  condition: string;
  language: string;
  retailer: string;
  price: number;
  in_stock: boolean;
  url: string;
  /** Date this listing was last observed, YYYY-MM-DD. */
  seen: string;
};

export type SinglesCard = {
  name: string;
  set: string;
  number: string;
  listings: Record<string, SinglesListing>;
};

export type SinglesState = {
  cards: Record<string, SinglesCard>;
  updated: string | null;
};

export const EMPTY_SINGLES: SinglesState = { cards: {}, updated: null };

/**
 * Parse the gzipped state file.
 *
 * Handed the raw bytes rather than a URL so the fetching stays in the data
 * layer and this module stays testable without a network.
 */
/** Gzip's magic number. Two bytes is enough to know whether to inflate. */
function isGzip(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

export function parseSinglesState(raw: ArrayBuffer | Buffer): SinglesState {
  try {
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    // Sniffed rather than assumed. A .gz served with `Content-Encoding: gzip`
    // is inflated by fetch before we ever see it, so the bytes that arrive are
    // already JSON — and inflating them again throws, which looked exactly
    // like "this game has no singles crawl yet".
    const text = (isGzip(buffer) ? gunzipSync(buffer) : buffer).toString("utf-8");
    const parsed = JSON.parse(text) as Partial<SinglesState>;
    return { cards: parsed.cards ?? {}, updated: parsed.updated ?? null };
  } catch {
    // A missing or half-written file must not take the lookup down with it —
    // the card database half still works without any Canadian prices.
    return EMPTY_SINGLES;
  }
}

function normalise(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bareNumber(value: string): string {
  return (value || "").replace(/^[A-Za-z]+/, "").replace(/^0+/, "") || "";
}

/**
 * Every crawled listing for one card, across finishes, conditions and languages.
 *
 * Matched on name plus collector number when we have one. The set is
 * deliberately NOT required to match: shops write it as a code ("sv5k"), as a
 * name ("Obsidian Flames"), and sometimes not at all, and the collector number
 * already pins the printing far more reliably than a string that has three
 * spellings.
 */
export function listingsForCard(
  state: SinglesState,
  cardName: string,
  collectorNumber: string
): SinglesListing[] {
  const wantName = normalise(cardName);
  const wantNumber = bareNumber(collectorNumber);
  if (!wantName) return [];

  const out: SinglesListing[] = [];
  for (const card of Object.values(state.cards ?? {})) {
    if (normalise(card.name) !== wantName) continue;
    if (wantNumber && bareNumber(card.number) && bareNumber(card.number) !== wantNumber) {
      continue;
    }
    out.push(...Object.values(card.listings ?? {}));
  }

  // In stock first, then cheapest. Condition is reported per row rather than
  // ranked on: a $4 Damaged copy is genuinely the cheapest, and it is the
  // reader's call whether that is the one they want.
  return out
    .sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.price - b.price)
    .slice(0, 12);
}

/** "seen today" / "seen 3 days ago" — how fresh a crawled price is. */
export function freshness(seen: string, now: Date = new Date()): string {
  const then = Date.parse(`${seen}T00:00:00Z`);
  if (Number.isNaN(then)) return "";
  const days = Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
  if (days === 0) return "seen today";
  if (days === 1) return "seen yesterday";
  return `seen ${days} days ago`;
}
