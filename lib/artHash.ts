/**
 * artHash.ts — recognising a card by its picture.
 *
 * The browser half of the fingerprint. `art_hash.py` in the data repo produces
 * the same 64 bits from the publisher's reference image, and the two must agree
 * bit for bit or every match is quietly slightly wrong. The algorithm is
 * therefore restated here rather than approximated:
 *
 *   1. Crop the card rectangle to its art window, x 8-92%, y 10-58%.
 *   2. Convert to greyscale with ITU-R 601-2 luma weights.
 *   3. Area-average down to 9x8.
 *   4. One bit per horizontally adjacent pair: 1 when the left cell is brighter.
 *
 * Read left to right, top to bottom, packed big-endian into hex.
 *
 * The resampling is written out longhand instead of being handed to
 * `drawImage`. Canvas downscaling is implementation-defined — it differs
 * between browsers and between GPU and software paths — and a difference hash
 * flips a bit wherever two adjacent cells are nearly equal, so a slightly
 * different filter is a slightly different fingerprint. Explicit area averaging
 * is about twenty lines and is the same operation Pillow's BOX filter performs.
 *
 * Why this beats reading the name: OCR on a phone tops out around 60-70% on
 * cards, because holofoil, glare and stylised type defeat text recognition in
 * exactly the conditions people scan in. A glare spot destroys a few characters
 * of a title and leaves most of a picture intact, so the picture is the more
 * robust signal by a wide margin. Measured end to end — greyscale, six crops,
 * and 22,000 comparisons — a frame costs about 6ms, so this runs on every frame
 * rather than once a second, and four passes a second is a couple of percent of
 * one core.
 */

/** Cells per side. 8 gives 64 bits. Must match art_hash.SIZE. */
export const HASH_SIZE = 8;

/** Art window as fractions of the card. Must match art_hash.ART_BOX. */
export const ART_BOX: readonly [number, number, number, number] = [0.08, 0.1, 0.92, 0.58];

/** Hex characters in one fingerprint. */
export const HEX_CHARS = (HASH_SIZE * HASH_SIZE) / 4;
/** Bytes in one fingerprint. */
export const HASH_BYTES = HEX_CHARS / 2;
/**
 * 32-bit words in one fingerprint.
 *
 * The matcher works in words rather than bytes because it is the hot loop of
 * the whole feature: six candidate crops against twenty-two thousand cards is
 * 132,000 comparisons per frame, four times a second. A byte at a time, that
 * measured 31ms a frame; a word at a time it is a quarter of that. 64 bits
 * divides evenly into two words, and `parseHashTable` refuses anything that
 * does not.
 */
export const HASH_WORDS = HASH_BYTES / 4;

/**
 * The wire format: one long run of fixed-width hex, and nothing else.
 *
 * Card ids are deliberately absent. The browser does not need them — it matches
 * a picture and hands the winning *fingerprint* back, and the server turns that
 * into a card. Measured on Magic's 49,047 cards, shipping the ids alongside
 * costs 1.37MB gzipped against 0.39MB without them: the ids are UUIDs and are
 * three quarters of the payload. That download has to finish before artwork
 * matching can start at all, so on a phone it was the difference between a
 * scanner that works and one that silently falls back to reading titles for the
 * first ten seconds.
 *
 * Echoing the fingerprint rather than an index also avoids any version
 * coupling. An index would be meaningless if the table were rebuilt between the
 * download and the lookup; a fingerprint either exists in the server's table or
 * it does not, and "does not" is a clean decline rather than a wrong card.
 */
export type PackedHashTable = {
  /** Concatenated fingerprints, HEX_CHARS each. */
  packed: string;
  size: number;
};

/**
 * The matching form: a flat word buffer, plus the hex it came from.
 *
 * Unpacked once on arrival so the hot loop is XOR over a typed array rather
 * than slicing substrings and re-parsing hex tens of thousands of times per
 * frame. The original hex is kept so a winner can be named without
 * re-serialising it.
 */
export type HashTable = {
  /** All fingerprints end to end, HASH_WORDS per card, big-endian. */
  words: Uint32Array;
  /** The same fingerprints as hex, for reading a match back out. */
  packed: string;
  count: number;
  size: number;
};

export const EMPTY_HASH_TABLE: HashTable = {
  words: new Uint32Array(0),
  packed: "",
  count: 0,
  size: HASH_SIZE,
};

export function parseHashTable(table: PackedHashTable | null): HashTable {
  if (!table || typeof table.packed !== "string" || table.packed.length === 0) {
    return EMPTY_HASH_TABLE;
  }
  // A table built with a different hash size is not comparable with ours, and
  // matching against it would produce confident nonsense rather than an error.
  if (table.size !== HASH_SIZE) return EMPTY_HASH_TABLE;
  // A truncated table would leave a partial fingerprint at the end and match
  // against whatever the padding happened to be.
  if (table.packed.length % HEX_CHARS !== 0) return EMPTY_HASH_TABLE;
  // The word-at-a-time matcher below assumes the fingerprint divides into whole
  // 32-bit words. It does at 64 bits; this refuses rather than reading past the
  // end if that ever changes.
  if (!Number.isInteger(HASH_WORDS)) return EMPTY_HASH_TABLE;

  const count = table.packed.length / HEX_CHARS;
  const words = new Uint32Array(count * HASH_WORDS);
  for (let i = 0; i < words.length; i += 1) {
    // >>> 0 because parseInt returns a signed-looking number for anything with
    // the top bit set, and Uint32Array would otherwise take the wrong value.
    words[i] = parseInt(table.packed.slice(i * 8, i * 8 + 8), 16) >>> 0;
  }
  return { words, packed: table.packed, count, size: table.size };
}

/** The fingerprint at one position in the table, as hex. */
function hashAt(table: HashTable, index: number): string {
  return table.packed.slice(index * HEX_CHARS, index * HEX_CHARS + HEX_CHARS);
}

/** A single fingerprint as 32-bit words, for comparing against the table. */
export function hexToWords(hex: string): Uint32Array | null {
  if (!hex || hex.length !== HEX_CHARS) return null;
  const out = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < HASH_WORDS; i += 1) {
    out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  }
  return out;
}

/**
 * RGBA to one byte of luma per pixel.
 *
 * Pillow's exact `convert("L")`: ITU-R 601-2 in 16-bit fixed point, rounded and
 * truncated to an integer *before* anything is averaged. Using floating-point
 * weights instead left a real card two bits away from its own reference
 * fingerprint — invisible, and a straight subtraction from the margin the
 * thresholds depend on.
 *
 * Separate from the resampling below so that a frame probed with several crops
 * converts once rather than once per crop. The crops overlap almost completely,
 * so that was six passes over the same pixels; it was most of the cost of a
 * frame, and the matcher it was blamed on turned out to be a fifth of it.
 */
export function toLuma(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const grey = new Uint8Array(width * height);
  for (let i = 0, g = 0; g < grey.length; i += 4, g += 1) {
    grey[g] = (rgba[i] * 19595 + rgba[i + 1] * 38470 + rgba[i + 2] * 7471 + 32768) >> 16;
  }
  return grey;
}

/**
 * Area-average a greyscale region down to `outW` x `outH`.
 *
 * Fractional at the edges: an output cell that covers 3.4 input pixels weights
 * the fourth by 0.4 rather than including or dropping it whole. Pillow's BOX
 * filter does the same, and rounding it differently is exactly the kind of
 * small divergence that shows up as unexplained bit flips.
 */
function areaAverageGrey(
  grey: Uint8Array,
  width: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outW: number,
  outH: number
): Float64Array {
  const out = new Float64Array(outW * outH);
  const cellW = sw / outW;
  const cellH = sh / outH;

  for (let oy = 0; oy < outH; oy += 1) {
    const top = sy + oy * cellH;
    const bottom = top + cellH;
    const y0 = Math.floor(top);
    const y1 = Math.ceil(bottom);

    for (let ox = 0; ox < outW; ox += 1) {
      const left = sx + ox * cellW;
      const right = left + cellW;
      const x0 = Math.floor(left);
      const x1 = Math.ceil(right);

      let sum = 0;
      let weight = 0;
      for (let y = y0; y < y1; y += 1) {
        const wy = Math.min(y + 1, bottom) - Math.max(y, top);
        if (wy <= 0) continue;
        for (let x = x0; x < x1; x += 1) {
          const wx = Math.min(x + 1, right) - Math.max(x, left);
          if (wx <= 0) continue;
          const w = wy * wx;
          sum += grey[y * width + x] * w;
          weight += w;
        }
      }
      // Rounded to an 8-bit value, because Pillow's resize writes uint8 and the
      // comparison below is made on those. Comparing unrounded floats decides
      // differently wherever two neighbouring cells land within half a level of
      // each other, which on a real card was two flipped bits against its own
      // reference — invisible, and a straight subtraction from the margin.
      const mean = weight > 0 ? sum / weight : 0;
      out[oy * outW + ox] = Math.max(0, Math.min(255, Math.round(mean)));
    }
  }
  return out;
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Fingerprint one card rectangle inside an RGBA buffer.
 *
 * `box` lets a caller probe slightly different crops of the same frame — see
 * `OFFSET_BOXES`.
 */
export function hashCardRegion(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  card: { x: number; y: number; w: number; h: number },
  box: readonly [number, number, number, number] = ART_BOX
): string {
  return hashLumaRegion(toLuma(rgba, width, height), width, height, card, box);
}

/**
 * Fingerprint several crops of one frame, converting to greyscale once.
 *
 * This is what the scanner calls. The crops in `OFFSET_BOXES` overlap almost
 * entirely, so converting per crop meant six luma passes over substantially the
 * same pixels — measured at four fifths of the cost of a frame.
 */
export function hashCardRegions(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  card: { x: number; y: number; w: number; h: number },
  boxes: readonly (readonly [number, number, number, number])[] = OFFSET_BOXES
): string[] {
  const grey = toLuma(rgba, width, height);
  return boxes.map((box) => hashLumaRegion(grey, width, height, card, box));
}

/** `hashCardRegion` over a greyscale plane that has already been prepared. */
export function hashLumaRegion(
  grey: Uint8Array,
  width: number,
  height: number,
  card: { x: number; y: number; w: number; h: number },
  box: readonly [number, number, number, number] = ART_BOX
): string {
  const [l, t, r, b] = box;
  // Floored to whole pixels, because the Python side crops with PIL and
  // `int(width * 0.08)` truncates. Leaving these as floats sampled a region a
  // fraction of a pixel away from the reference, which is invisible and shifted
  // every fingerprint by a bit or two — enough to eat most of the margin the
  // thresholds rely on.
  const sx = Math.floor(card.x + card.w * l);
  const sy = Math.floor(card.y + card.h * t);
  const sw = Math.floor(card.x + card.w * r) - sx;
  const sh = Math.floor(card.y + card.h * b) - sy;

  if (sw < HASH_SIZE + 1 || sh < HASH_SIZE || sx < 0 || sy < 0) return "";
  if (sx + sw > width || sy + sh > height) return "";

  const cells = areaAverageGrey(grey, width, sx, sy, sw, sh, HASH_SIZE + 1, HASH_SIZE);

  const bits: number[] = [];
  for (let y = 0; y < HASH_SIZE; y += 1) {
    const row = y * (HASH_SIZE + 1);
    for (let x = 0; x < HASH_SIZE; x += 1) {
      bits.push(cells[row + x] > cells[row + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

/**
 * Crops to try for one frame.
 *
 * A card held up to a phone is never framed exactly where the reference image
 * was cropped, and a fingerprint is sensitive to that drift. Hashing a handful
 * of slightly shifted and scaled windows and keeping whichever matches best
 * absorbs it, which is what published implementations do rather than demanding
 * the user align perfectly.
 */
export const OFFSET_BOXES: readonly (readonly [number, number, number, number])[] = [
  ART_BOX,
  [0.08, 0.08, 0.92, 0.56],
  [0.08, 0.12, 0.92, 0.6],
  [0.06, 0.1, 0.9, 0.58],
  [0.1, 0.1, 0.94, 0.58],
  [0.1, 0.12, 0.9, 0.56],
];

/**
 * A trading card's aspect ratio, 63mm x 88mm. Close enough to 5:7 for framing.
 */
const CARD_ASPECT = 63 / 88;

/**
 * How much of a photo the card might occupy.
 *
 * The live camera crops to the on-screen guide, so the card fills the frame and
 * one rectangle is enough. A photo does not: there is a desk around it. That
 * difference is total rather than gradual — measured on real cards, a card
 * filling 85% of a photo matched 0 times out of 18 against the whole frame and
 * 18 out of 18 when a few centred card-shaped rectangles were tried instead.
 *
 * The ladder stops at 0.6 because it stops working there: at 55% fill this
 * recovers 7 of 18, and going wider mostly adds chances to land near the wrong
 * card. A card smaller than that in frame is a cropping problem, and the UI
 * says so rather than pretending.
 */
const PHOTO_SCALES = [1, 0.92, 0.84, 0.76, 0.68, 0.6];

/** Centred, card-shaped rectangles to look for a card in, largest first. */
export function photoCardRects(
  width: number,
  height: number
): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const scale of PHOTO_SCALES) {
    let h = height * scale;
    let w = h * CARD_ASPECT;
    // A landscape photo runs out of width before height.
    if (w > width * scale) {
      w = width * scale;
      h = w / CARD_ASPECT;
    }
    out.push({
      x: Math.floor((width - w) / 2),
      y: Math.floor((height - h) / 2),
      w: Math.floor(w),
      h: Math.floor(h),
    });
  }
  return out;
}

/**
 * Fingerprint a still photo, which is not cropped to the card.
 *
 * The full frame gets the usual offset crops, since a tightly cropped image or
 * a screenshot of a card is the common case and deserves the best treatment.
 * The smaller rectangles get the plain art window only — they are a search for
 * where the card is, and multiplying them by six offsets would mostly buy
 * chances to land near the wrong card.
 */
export function hashPhoto(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): string[] {
  const grey = toLuma(rgba, width, height);
  const full = { x: 0, y: 0, w: width, h: height };
  const out = OFFSET_BOXES.map((box) => hashLumaRegion(grey, width, height, full, box));
  for (const rect of photoCardRects(width, height)) {
    out.push(hashLumaRegion(grey, width, height, rect));
  }
  return out.filter(Boolean);
}

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];
}

/**
 * Set bits in a 32-bit word, by the usual SWAR trick.
 *
 * Arithmetic rather than a lookup table on purpose: this runs 132,000 times a
 * frame and the table version spends most of its time waiting on memory.
 */
function popcount32(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}

/** Differing bits between two hex fingerprints of equal length. */
export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let total = 0;
  // Byte at a time off the hex, so this stays exact past 32 bits where
  // JavaScript's bitwise operators would silently truncate.
  for (let i = 0; i < a.length; i += 2) {
    const xor = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    total += POPCOUNT[xor];
  }
  return total;
}

export type ArtMatch = {
  /** The winning fingerprint, as hex. The server turns this into a card. */
  hash: string;
  /** Bits differing from the closest reference. */
  distance: number;
  /** Extra bits to the next-closest *different* card. */
  margin: number;
  /**
   * Every fingerprint within the margin of the winner, including it.
   *
   * More than one means the picture cannot choose, and that is usually not a
   * failure — it is the same artwork reprinted. Measured on the real table, an
   * Applin photographed from its own reference sits 1 bit from the Prismatic
   * Evolutions printing and 2 from the Stellar Crown one, with the next card 16
   * bits away. The artwork is certain; only the printing is open. Declining
   * there and falling back to reading the title threw away a perfect match.
   */
  ties: string[];
};

/**
 * Thresholds, chosen against a measurement rather than by feel.
 *
 * Across 217 real cards no two different ones came within 10 bits of each
 * other, with a median separation of 19. So 10 is the point below which a match
 * is unlikely to be a coincidence, and a margin requirement on top of that
 * handles the case the raw distance cannot: two printings that share artwork
 * sit a few bits apart, and picking between them on the picture alone is
 * guessing. That is what the collector number and the name are for.
 */
export const MAX_ART_DISTANCE = 10;
/**
 * Bits of daylight required before one printing is named outright.
 *
 * Swept against the full 21,937-card table with 160 real degraded frames. At 4
 * an over-exposed Electrike was pinned to the wrong printing — right card, 
 * wrong set, and therefore the wrong price shown with full confidence. At 5 
 * that disappears and the usable total does not move, because the cases it 
 * stops pinning become ambiguous rather than declined, and an ambiguous match 
 * still shows the user every printing of the card in their hand.
 *
 *   margin  usable   wrong
 *        3   150/160     1
 *        4   145/160     1
 *        5   145/160     0   <- here
 *        6   141/160     0
 *
 * Going further only costs precision. Below 5 it buys a little reach and pays
 * for it with a confidently wrong price, which is the one outcome this whole
 * design is built to avoid.
 */
export const MIN_ART_MARGIN = 5;

/**
 * The closest card to any of a frame's candidate fingerprints.
 *
 * Brute force over the whole table: six probes against 22,000 cards measures
 * 2.2ms, against 4ms to produce the probes in the first place. So this is not
 * the expensive half, and a cleverer index would be a liability — a BK-tree or
 * an LSH bucket would have to be kept consistent with the table, and neither
 * answers the query that actually matters here, which is nearest-neighbour
 * *plus the runner-up* under a threshold wide enough that pruning saves little.
 *
 * The runner-up is tracked alongside the winner because the distance alone
 * cannot tell a real match from a near-tie. Two printings that reuse artwork
 * sit a few bits apart, and choosing between them on the picture is guessing;
 * the margin is what makes that visible to the caller.
 */
export function matchArt(table: HashTable, queries: string[]): ArtMatch | null {
  // Flattened into one array rather than an array of arrays: the inner loop
  // indexes this once per card per probe, and chasing a pointer per probe was
  // measurable at this call rate.
  const probes = new Uint32Array(queries.length * HASH_WORDS);
  let probeCount = 0;
  for (const query of queries) {
    const w = hexToWords(query);
    if (!w) continue;
    probes.set(w, probeCount * HASH_WORDS);
    probeCount += 1;
  }
  if (probeCount === 0 || table.count === 0) return null;

  const words = table.words;
  let bestIndex = -1;
  let best = Number.MAX_SAFE_INTEGER;
  let second = Number.MAX_SAFE_INTEGER;

  for (let card = 0; card < table.count; card += 1) {
    const offset = card * HASH_WORDS;
    let distance = Number.MAX_SAFE_INTEGER;

    for (let p = 0; p < probeCount; p += 1) {
      const base = p * HASH_WORDS;
      let d = 0;
      for (let w = 0; w < HASH_WORDS; w += 1) {
        d += popcount32(probes[base + w] ^ words[offset + w]);
      }
      if (d < distance) distance = d;
    }

    if (distance < best) {
      second = best;
      best = distance;
      bestIndex = card;
    } else if (distance < second) {
      second = distance;
    }
  }

  if (bestIndex < 0) return null;

  // Second pass for the near-ties. Collected separately rather than during the
  // search because the winner is not known until the end, and a card is only a
  // tie relative to it.
  const ties: string[] = [];
  const cutoff = best + MIN_ART_MARGIN;
  for (let card = 0; card < table.count && ties.length < MAX_TIES; card += 1) {
    const offset = card * HASH_WORDS;
    let distance = Number.MAX_SAFE_INTEGER;
    for (let p = 0; p < probeCount; p += 1) {
      const base = p * HASH_WORDS;
      let d = 0;
      for (let w = 0; w < HASH_WORDS; w += 1) {
        d += popcount32(probes[base + w] ^ words[offset + w]);
      }
      if (d < distance) distance = d;
    }
    if (distance <= cutoff) ties.push(hashAt(table, card));
  }

  return {
    hash: hashAt(table, bestIndex),
    distance: best,
    margin: second === Number.MAX_SAFE_INTEGER ? HASH_SIZE * HASH_SIZE : second - best,
    // De-duplicated: two cards sharing one fingerprint appear twice here and
    // the repeat carries no information. The server expands a single
    // fingerprint to every card holding it anyway.
    ties: [...new Set(ties)],
  };
}

/** Enough to name a reprint family; past this the picture is telling us nothing. */
const MAX_TIES = 8;

/**
 * What a picture match is good for.
 *
 *   "pinned"    — one card, name the printing outright.
 *   "ambiguous" — the artwork is certain, the printing is not. Search the card
 *                 by name and let the collector number or the user decide.
 *   "none"      — nothing close enough; read the title instead.
 *
 * The middle case is the one that matters and the one the first version got
 * wrong. It treated a low margin as failure, which is right when it means "this
 * might be the wrong card" and wrong when it means "this is definitely this
 * artwork, printed twice". Distance separates those: a two-bit match with a
 * one-bit margin is not a doubtful match, it is a reprint.
 */
export function artOutcome(match: ArtMatch | null): "pinned" | "ambiguous" | "none" {
  if (!match || match.distance > MAX_ART_DISTANCE) return "none";
  if (match.margin >= MIN_ART_MARGIN) return "pinned";
  return match.ties.length > 1 ? "ambiguous" : "none";
}

/** Whether a picture match is strong enough to name a card on its own. */
export function isArtConfident(match: ArtMatch | null): boolean {
  return (
    !!match && match.distance <= MAX_ART_DISTANCE && match.margin >= MIN_ART_MARGIN
  );
}
