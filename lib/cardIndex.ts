import { gunzipSync } from "zlib";

/**
 * cardIndex.ts — the local catalogue of every card, and how it is searched.
 *
 * Built by build_card_index.py in the data repo. It exists because asking the
 * provider per query could not answer the question properly: TCGdex's list
 * endpoint returns names and numbers only, so every result needed its own
 * request for set and price, and the six-request budget that made affordable
 * meant a search for "Pikachu" returned 6 of the 243 cards TCGdex holds.
 *
 * Searching locally fixes three things at once — completeness, speed, and
 * forgiveness. The third matters most for the scanner: OCR of a photographed
 * card produces "Charlzard" and "1ono" routinely, and no remote exact-match API
 * will ever find those. A local index can be fuzzy-matched.
 *
 * The ranking below is tiered rather than weighted. A weighted blend of "starts
 * with" and "edit distance" produces a single number nobody can reason about
 * when it puts the wrong card first; a tier list can be read straight off and
 * argued with.
 */

export type IndexedCard = {
  id: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  setTotal: number;
  imageUrl: string;
};

type SetInfo = { name: string; total: number };

/** Wire format: compact rows, because keys repeated 23,736 times are the file. */
type RawIndex = {
  generated_at?: string;
  game?: string;
  image_prefix?: string;
  sets?: Record<string, SetInfo>;
  /** [id, name, number, setId, image] */
  cards?: [string, string, string, string, string][];
  /** Magic carries names only — Scryfall search covers printings itself. */
  names?: string[];
};

export type CardIndex = {
  game: string;
  generatedAt: string | null;
  cards: IndexedCard[];
  /** Normalised name to positions in `cards`, for exact lookups. */
  byName: Map<string, number[]>;
  /** Every distinct normalised name, for fuzzy correction. */
  names: string[];
};

export const EMPTY_INDEX: CardIndex = {
  game: "",
  generatedAt: null,
  cards: [],
  byName: new Map(),
  names: [],
};

export function normalise(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCardIndex(raw: ArrayBuffer | Buffer): CardIndex {
  try {
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    // Sniffed, not assumed: a .gz served with Content-Encoding: gzip is
    // inflated by fetch before we see it, and inflating twice throws.
    const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
    const text = (isGzip ? gunzipSync(buffer) : buffer).toString("utf-8");
    const parsed = JSON.parse(text) as RawIndex;

    const sets = parsed.sets ?? {};
    const prefix = parsed.image_prefix ?? "";
    const cards: IndexedCard[] = (parsed.cards ?? []).map(
      ([id, name, number, setId, image]) => ({
        id,
        name,
        number,
        setId,
        setName: sets[setId]?.name ?? setId,
        setTotal: sets[setId]?.total ?? 0,
        imageUrl: image ? `${prefix}${image}/high.webp` : "",
      })
    );

    const byName = new Map<string, number[]>();
    cards.forEach((card, i) => {
      const key = normalise(card.name);
      const bucket = byName.get(key);
      if (bucket) bucket.push(i);
      else byName.set(key, [i]);
    });

    // Magic ships names only; Pokemon's come from its cards.
    const names = parsed.names
      ? [...new Set(parsed.names.map(normalise))].filter(Boolean)
      : [...byName.keys()];

    return {
      game: parsed.game ?? "",
      generatedAt: parsed.generated_at ?? null,
      cards,
      byName,
      names,
    };
  } catch {
    return EMPTY_INDEX;
  }
}

// ── Fuzzy name correction ───────────────────────────────────────────────────

/**
 * Levenshtein distance, abandoned once it exceeds `max`.
 *
 * Bounded because the answer is only ever used as "is this within N edits", and
 * giving up on a row whose every cell has passed the budget turns a 35,000-name
 * sweep from seconds into milliseconds. Exact distances for names that are
 * obviously unrelated are work nobody reads.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let best = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < best) best = curr[j];
    }
    if (best > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Edits allowed for a name of this length. Longer names absorb more noise. */
export function budgetFor(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  if (length <= 14) return 3;
  return 4;
}

/**
 * The closest real card name to a misread one, or null when nothing is close.
 *
 * Null rather than a best guess when the nearest name is still far away.
 * "Correcting" an unreadable scan to whatever happened to be nearest is exactly
 * how a scanner confidently shows somebody a card they are not holding.
 */
export function correctName(index: CardIndex, guess: string): string | null {
  const wanted = normalise(guess);
  if (!wanted || index.names.length === 0) return null;
  if (index.byName.has(wanted)) return wanted;

  const max = budgetFor(wanted.length);
  let best: string | null = null;
  let bestScore = max + 1;

  for (const name of index.names) {
    // A cheap length gate before the expensive comparison.
    if (Math.abs(name.length - wanted.length) > max) continue;
    const distance = editDistance(wanted, name, max);
    if (distance < bestScore) {
      bestScore = distance;
      best = name;
      if (distance === 0) break;
    }
  }
  return bestScore <= max ? best : null;
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchResult = {
  cards: IndexedCard[];
  /** Set when the query was corrected, so the UI can say what it searched for. */
  correctedTo: string | null;
  total: number;
};

function bare(value: string): string {
  return (value || "").replace(/^[A-Za-z]+/, "").replace(/^0+/, "") || "";
}

function collect(index: CardIndex, term: string): IndexedCard[] {
  const exactIdx = index.byName.get(term) ?? [];
  const seen = new Set(exactIdx);
  const exact = exactIdx.map((i) => index.cards[i]);

  const starts: IndexedCard[] = [];
  const contains: IndexedCard[] = [];

  for (let i = 0; i < index.cards.length; i += 1) {
    if (seen.has(i)) continue;
    const name = normalise(index.cards[i].name);
    if (name.startsWith(term)) starts.push(index.cards[i]);
    else if (name.includes(term)) contains.push(index.cards[i]);
  }

  return [...exact, ...starts, ...contains];
}

/**
 * Every printing matching a query, best first.
 *
 * Tiers, in order: exact name, name starts with the query, name contains it.
 * So a search for "Pikachu" leads with the 153 cards actually called Pikachu
 * rather than with "Pikachu V-UNION" or "Surfing Pikachu VMAX".
 */
export function searchIndex(
  index: CardIndex,
  query: string,
  opts: {
    number?: string | null;
    /**
     * The denominator from a "223/197" collector line.
     *
     * The strongest discriminator available and the one this originally threw
     * away. Measured against the real 23,736-card index: a name alone leaves
     * 16.3 candidate printings, a name and number leave 2.2, and adding the set
     * total pins 99.2% of cards to exactly one. It also halves the rate at
     * which a fuzzy match is confidently wrong, because it shrinks the pool the
     * fuzzy matcher can go astray in.
     */
    setTotal?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): SearchResult {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const wanted = normalise(query);
  if (!wanted || index.cards.length === 0) {
    return { cards: [], correctedTo: null, total: 0 };
  }

  let correctedTo: string | null = null;
  let matches = collect(index, wanted);

  // Only reach for the fuzzy index when the literal query found nothing at all.
  // Correcting a query that already works would turn a deliberate search for an
  // obscure card into its more famous neighbour.
  if (matches.length === 0) {
    const corrected = correctName(index, wanted);
    if (corrected && corrected !== wanted) {
      correctedTo = corrected;
      matches = collect(index, corrected);
    }
  }

  // Set total first: it narrows far harder than the number does, and narrowing
  // before the number means a misread digit is chosen from a much smaller pool.
  if (opts.setTotal) {
    const wantTotal = Number(bare(opts.setTotal));
    if (Number.isFinite(wantTotal) && wantTotal > 0) {
      const inSet = matches.filter((c) => c.setTotal === wantTotal);
      if (inSet.length > 0) matches = inSet;
    }
  }

  if (opts.number) {
    const wantNumber = bare(opts.number);
    const pinned = matches.filter((c) => bare(c.number) === wantNumber);
    // Narrow only when the number actually hit something: a misread digit must
    // not empty a result set that had the right card in it.
    if (pinned.length > 0) matches = pinned;
  }

  return {
    cards: matches.slice(offset, offset + limit),
    correctedTo,
    total: matches.length,
  };
}
