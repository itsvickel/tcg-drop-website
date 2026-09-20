/**
 * fuzzyName.ts — matching a misread card name against the real vocabulary.
 *
 * Browser-safe on purpose: no node imports, so the scanner can run this on the
 * phone instead of asking the server what it just read.
 *
 * That relocation is the point. The scanner used to forward whatever Tesseract
 * produced straight to a lookup and display it while it went, so a bad frame
 * put "fd,15" on screen as though it were a card. Nothing in the pipeline knew
 * what a card is called, so nothing could tell a reading from noise.
 *
 * A card name is drawn from a closed vocabulary of a few thousand strings. Once
 * the reading is matched against that list, "Charlzard" resolves and "fd,15"
 * has nowhere to land — which is the same lever every working scanner pulls,
 * and it is worth more than any amount of OCR tuning.
 *
 * The accept rule is built on the *margin* between the best and second-best
 * match, not on the best distance alone. Measured over 2,000 synthetic OCR
 * queries against a real Pokemon name list: at margin 0 the top hit is right
 * 68.9% of the time, at margin 1 it is 97.7%, and at margin 2 or more it is
 * 100%. Distance alone is a far weaker signal — even an exact match is only
 * 95.4% right, because names genuinely collide.
 */

export function normaliseName(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Levenshtein distance, abandoned once it exceeds `max`.
 *
 * Bounded because the answer is only ever used as "is this within N edits", and
 * giving up on a row whose every cell has passed the budget turns a sweep of
 * thousands of names from seconds into a millisecond.
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

export type NameMatch = {
  /** The real card name this reading most likely is. */
  name: string;
  /** Edits between the reading and that name. */
  distance: number;
  /** Edits between the reading and the *next* best name. */
  margin: number;
  /** distance / reading length — how corrupted the reading is, in proportion. */
  normalised: number;
};

/**
 * The best and second-best names for a reading, or null when nothing is near.
 *
 * Both are needed: the second-best is what makes the first trustworthy. A
 * reading one edit from two different cards is a coin toss however close it is
 * to either.
 */
export function bestMatch(names: string[], reading: string): NameMatch | null {
  const wanted = normaliseName(reading);
  if (wanted.length < 3 || names.length === 0) return null;

  const max = budgetFor(wanted.length);
  let bestName = "";
  let best = max + 1;
  let second = max + 1;

  for (const name of names) {
    if (Math.abs(name.length - wanted.length) > max) continue;
    const d = editDistance(wanted, name, max);
    if (d < best) {
      second = best;
      best = d;
      bestName = name;
    } else if (d < second) {
      second = d;
    }
  }

  if (best > max || !bestName) return null;
  return {
    name: bestName,
    distance: best,
    // Capped: a unique match has no real second-best, and reporting Infinity
    // makes every downstream comparison awkward for no benefit.
    margin: Math.min(second, max + 1) - best,
    normalised: best / wanted.length,
  };
}

/**
 * Whether a match is good enough to act on without asking.
 *
 * The thresholds come from the measurement above: requiring a margin of at
 * least one edit, and no more than a quarter of the reading corrupted, accepts
 * about 60% of readings at 99.8% precision. The rest are not discarded — they
 * are simply not auto-accepted, which is the difference between a scanner that
 * is occasionally wrong and one that is occasionally slow.
 */
export const MAX_NORMALISED_DISTANCE = 0.25;

export function isConfident(match: NameMatch | null): boolean {
  return (
    !!match && match.margin >= 1 && match.normalised <= MAX_NORMALISED_DISTANCE
  );
}

/**
 * Does this reading look like a card name at all?
 *
 * A cheap gate before the expensive sweep, and the thing that would have caught
 * "fd,15" on its own. Real card names are mostly letters; OCR noise off a card
 * border is mostly punctuation, digits and one- or two-character fragments.
 */
export function looksLikeName(reading: string): boolean {
  const text = (reading || "").trim();
  if (text.length < 3) return false;

  const letters = (text.match(/[a-z]/gi) || []).length;
  // Under two thirds letters is not a name. "fd,15" is 40%.
  if (letters / text.length < 0.6) return false;
  // And a name needs a word in it, not just scattered characters.
  return /[a-z]{3}/i.test(text);
}
