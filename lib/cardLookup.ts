/**
 * cardLookup.ts — turning what a camera saw into a card we can price.
 *
 * The scanner reads two strips of a card: the title bar at the top and the
 * small print along the bottom. Neither arrives clean. OCR on a photographed
 * card, through a phone camera, over holofoil, at an angle, produces text like
 * "Charlzard ex" and "1S6/1B9". So nothing here trusts a single reading:
 * everything is a *candidate*, the identifiers are ranked by how much they
 * constrain the search, and the UI always offers the typed path beside the
 * scanned one.
 *
 * The collector line is the valuable half and it is worth saying why. A card
 * name is ambiguous — there are 100-odd distinct Pikachu cards and 19 printings
 * of Lightning Bolt, and they are not worth the same money. "136/189" plus a
 * set symbol identifies exactly one printing. The name is what people can type;
 * the number is what actually resolves. So the scanner reads both, and a
 * lookup that has the number pins the printing while one that has only a name
 * says plainly that it is showing several.
 *
 * OCR confusions are corrected in one place, `_deOcr`, and only inside runs of
 * digits. Applying the same substitution to a name would turn "Iono" into
 * "1ono"; applying it to a collector number turns a misread "1S6" back into
 * "156", which is what it was.
 */

export type ScannedCard = {
  /** Best guesses at the printed card name, most likely first. */
  nameCandidates: string[];
  /** Collector number as printed, e.g. "136" or "SVP075" or "TG12". */
  number: string | null;
  /** Set total from a "136/189" style line, when present. */
  setTotal: string | null;
  /** Three-to-five letter set code, e.g. "MOM". MTG prints this; Pokemon rarely does. */
  setCode: string | null;
};

export type CardMatch = {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  setTotal: number | null;
  rarity: string | null;
  imageUrl: string;
  sourceUrl: string;
  marketUsd: number | null;
  marketCad: number | null;
  /** Canadian listings we track for this card, cheapest first. */
  listings: CardListing[];
};

export type CardListing = {
  groupKey: string;
  name: string;
  retailer: string;
  price: number;
  url: string;
  inStock: boolean;
  /**
   * True when the listing was resolved to this exact printing by the singles
   * enrichment, false when it was matched on name alone.
   *
   * The difference is money. A store listing that says only "Sol Ring [Secret
   * Lair Drop]" could be any of several printings whose market prices differ by
   * a factor of ten, and attaching it to all of them makes the same $95 listing
   * read as a bargain under one and a fleecing under another. Unconfirmed
   * matches are still shown — they are probably the card, and a shopper wants
   * to see them — but they are labelled, and they never set the headline.
   */
  confirmed: boolean;
  /**
   * Which copy this price is for — "Holo, Near Mint, Japanese · seen 2 days
   * ago" — when we know.
   *
   * Its own field rather than folded into the name, because it always has to be
   * shown. Finish, condition and language each move a single's price by
   * multiples, so a bare number beside a card is not a comparable price: a
   * Damaged Japanese non-foil at $4 is not a deal on a Near Mint English holo
   * at $40, and a page that printed only the $4 would say it was.
   */
  detail?: string;
};

export type LookupResponse = {
  query: string;
  tcg: string;
  matches: CardMatch[];
  /**
   * Canadian listings that are this card by name but could not be pinned to one
   * printing.
   *
   * Deliberately attached to the search rather than to a card. Repeating one
   * "Sol Ring (Retro Foil Etched)" listing under each of twelve printings put a
   * $95 price beside a card whose market value is $1.78, eleven times over, and
   * every one of those pairings was a claim we could not support. We know
   * somebody is selling a Sol Ring; we do not know which one; so it is listed
   * once, under the search that found it.
   */
  unconfirmedListings: CardListing[];
  /** True when the collector number pinned a single printing. */
  exact: boolean;
  /**
   * How many printings matched in total, not how many are in `matches`.
   *
   * The two differ because results are paged: a search for "Pikachu" matches
   * 153 cards and shows twelve. Reporting only the page length is what made
   * the lookup look like it had six Pikachus in the world.
   */
  total: number;
  /** Where this page starts, for "show more". */
  offset: number;
  /**
   * The name actually searched for, when the query was fuzzy-corrected.
   *
   * Always surfaced. A scanner that silently turns "Charlzard" into
   * "Charizard" is helpful; one that silently turns a deliberate search into a
   * different card is not, and the reader cannot tell which happened unless
   * they are told.
   */
  correctedTo: string | null;
  note: string | null;
};

// ── Parsing what the camera read ────────────────────────────────────────────

/**
 * Digits misread as letters. Applied only to strings that should be numeric,
 * never to names — "Iono" must not become "1ono".
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0",
  I: "1", l: "1", i: "1", "|": "1", "!": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

function deOcrDigits(text: string): string {
  return text.replace(/[A-Za-z|!]/g, (ch) => DIGIT_CONFUSIONS[ch] ?? ch);
}

/** "136/189", "012/159", "TG12/TG30" — the Pokemon collector line. */
const FRACTION_RE = /\b([A-Z]{0,3}\s?[0-9OoIlSsZzBbGgTtDQq]{1,4})\s*[\/⁄]\s*([A-Z]{0,3}\s?[0-9OoIlSsZzBbGgTtDQq]{1,4})\b/;

/** "SVP075", "XY-P", "SM210" — promo-style numbers with a letter prefix. */
const PROMO_RE = /\b([A-Z]{2,4})[\s-]?([0-9OoIlSsZzBbGgTtDQq]{2,4})\b/;

/** MTG's bottom line: "0123/281 R" then "MOM • EN". */
const MTG_SET_CODE_RE = /\b([A-Z0-9]{3,5})\s*[•·*]\s*[A-Z]{2}\b/;

/** A bare number on its own, last resort. */
const BARE_NUMBER_RE = /\b([0-9]{1,4})\b/;

/**
 * Lines that are never a card name: rules text markers, copyright, the
 * illustrator credit, and the HP/energy furniture along the top bar.
 */
const NAME_NOISE_RE =
  /(illus|illustrat|^\s*hp\b|\bhp\s*$|©|\(c\)|nintendo|creatures|game\s*freak|wizards of the coast|pok[eé]mon|^\d+$|^[^a-z]*$)/i;

function cleanNameLine(line: string): string {
  return line
    // Strip the HP number and energy symbols that share the title bar.
    .replace(/\b\d{2,3}\s*HP\b/gi, "")
    .replace(/\bHP\s*\d{2,3}\b/gi, "")
    // Drop anything that is not a letter, digit, space or card punctuation.
    .replace(/[^\p{L}\p{N}\s'’,.:&!?-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull card identifiers out of raw OCR text.
 *
 * `titleText` and `bottomText` are kept separate because position is the
 * strongest signal available: the biggest text at the top is the name, and the
 * collector number is always in the small print at the bottom. Searching the
 * whole card for a number finds the attack damage instead.
 */
export function parseScan(titleText: string, bottomText: string): ScannedCard {
  const out: ScannedCard = {
    nameCandidates: [],
    number: null,
    setTotal: null,
    setCode: null,
  };

  // ── Name, from the title strip ──
  const lines = (titleText || "")
    .split(/\r?\n/)
    .map(cleanNameLine)
    .filter((l) => l.length >= 3 && !NAME_NOISE_RE.test(l));

  // Longest first: OCR often emits a stray fragment beside the real name, and
  // the real name is almost always the longer of the two.
  out.nameCandidates = [...new Set(lines)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  // ── Collector number, from the bottom strip ──
  const bottom = bottomText || "";

  const fraction = bottom.match(FRACTION_RE);
  if (fraction) {
    out.number = normaliseNumber(fraction[1]);
    out.setTotal = normaliseNumber(fraction[2]);
  }

  const mtgCode = bottom.match(MTG_SET_CODE_RE);
  if (mtgCode) out.setCode = mtgCode[1].toUpperCase();

  if (!out.number) {
    const promo = bottom.match(PROMO_RE);
    // A promo prefix that is really the set code (MTG) must not become the
    // number — those are caught by MTG_SET_CODE_RE above and skipped here.
    if (promo && promo[1].toUpperCase() !== out.setCode) {
      out.number = `${promo[1].toUpperCase()}${deOcrDigits(promo[2])}`;
    }
  }

  if (!out.number) {
    const bare = bottom.match(BARE_NUMBER_RE);
    if (bare) out.number = normaliseNumber(bare[1]);
  }

  return out;
}

/**
 * "1S6" → "156", "tg1Z" → "TG12".
 *
 * The letter prefix is separated off *before* the digit repair, because the
 * repair maps T→7 and G→6 and would otherwise turn a Trainer Gallery "TG12"
 * into "7612".
 *
 * Leading zeros are preserved. It is tempting to strip them, and wrong: TCGdex
 * stores promo numbers exactly as printed ("001", "SVP075") while numbering
 * most main-set cards without padding, so there is no single right form. The
 * parser keeps what the card says and `numberVariants` generates the
 * alternatives for the lookup to try.
 */
function normaliseNumber(raw: string): string {
  const compact = raw.replace(/\s+/g, "");
  const letters = compact.match(/^[A-Za-z]+/)?.[0] ?? "";
  const rest = compact.slice(letters.length);
  return `${letters.toUpperCase()}${deOcrDigits(rest)}`;
}

/**
 * The forms a collector number might take in a provider's database, most
 * faithful to the card first.
 *
 * Cheaper than deciding which is right: a lookup tries each in turn and stops
 * at the first that resolves.
 */
export function numberVariants(number: string | null): string[] {
  if (!number) return [];
  const letters = number.match(/^[A-Za-z]+/)?.[0] ?? "";
  const digits = number.slice(letters.length);
  const stripped = digits.replace(/^0+/, "") || "0";

  const out = [number];
  if (stripped !== digits) out.push(`${letters}${stripped}`);
  // A three-digit zero-padded form, for sets that number that way.
  if (!letters && stripped.length < 3) out.push(stripped.padStart(3, "0"));
  return [...new Set(out)];
}

/**
 * A single search string for the typed path, built from a scan.
 *
 * Used as the value the scanner drops into the search box, so that a person
 * whose scan went wrong can see what we read and fix the two characters that
 * are off rather than retyping the card.
 */
export function scanToQuery(scan: ScannedCard): string {
  const parts = [scan.nameCandidates[0] ?? ""];
  // The denominator goes in too. It used to be parsed and dropped, which threw
  // away the strongest discriminator on the card: name plus number leaves 2.2
  // candidate printings on average, and adding the set total pins 99.2% of
  // cards to exactly one.
  if (scan.number && scan.setTotal) parts.push(`${scan.number}/${scan.setTotal}`);
  else if (scan.number) parts.push(scan.number);
  return parts.filter(Boolean).join(" ").trim();
}

/**
 * Split a typed query into a name and a collector number.
 *
 * People type "charizard 223/197" and "iono sv 237" as naturally as they type a
 * bare name, and throwing the number at a name search returns nothing.
 */
export function parseQuery(query: string): { name: string; number: string | null; setTotal: string | null } {
  const text = (query || "").trim();
  if (!text) return { name: "", number: null, setTotal: null };

  const fraction = text.match(/\b(\w{1,6})\s*\/\s*(\w{1,6})\b/);
  if (fraction) {
    return {
      name: text.replace(fraction[0], "").replace(/\s+/g, " ").trim(),
      number: normaliseNumber(fraction[1]),
      setTotal: normaliseNumber(fraction[2]),
    };
  }

  // A trailing bare number is a collector number; one embedded in the name
  // ("Team Rocket's Mewtwo ex") is part of the name and stays put.
  const trailing = text.match(/^(.*?)[\s#]+([A-Z]{0,4}\d{1,4})$/i);
  if (trailing && trailing[1].trim().length >= 3) {
    return {
      name: trailing[1].trim(),
      number: normaliseNumber(trailing[2]),
      setTotal: null,
    };
  }

  return { name: text, number: null, setTotal: null };
}

// ── Matching provider results to our own listings ───────────────────────────

/**
 * Comparison form for joining a provider's card name to a store listing title.
 *
 * Accent- and punctuation-insensitive because store listings are typed by hand
 * and "Pokémon" and "Pokemon", "Farfetch'd" and "Farfetchd" have to meet.
 */
export function normaliseCardName(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrophes are deleted rather than spaced, so "Farfetch'd" meets
    // "Farfetchd". Spacing them apart puts the two forms further away than
    // leaving the punctuation in would have.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this store listing plausibly sell this card?
 *
 * Requires the collector number to agree when the listing states one. A name
 * match alone puts a $4 reverse holo and a $400 alt art in the same bucket, and
 * the whole point of the scanner is telling those apart.
 */
export function listingMatchesCard(
  listingName: string,
  cardName: string,
  collectorNumber: string | null
): boolean {
  const listing = normaliseCardName(listingName);
  const card = normaliseCardName(cardName);
  if (!listing || !card) return false;
  if (!listing.includes(card)) return false;

  if (collectorNumber) {
    const wanted = collectorNumber.replace(/^[A-Za-z]+/, "").replace(/^0+/, "") || "0";
    // Both sides stripped of padding, so "012" in a title meets "12" on a card.
    const numbers: string[] = (listing.match(/\b\d{1,4}\b/g) ?? []).map(
      (n) => n.replace(/^0+/, "") || "0"
    );
    // No number in the title is not a contradiction — plenty of listings omit
    // it — but a number that disagrees is.
    if (numbers.length > 0 && !numbers.includes(wanted)) return false;
  }
  return true;
}
