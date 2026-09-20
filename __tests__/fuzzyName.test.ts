/**
 * Matching a misread card name against the real vocabulary.
 *
 * The scanner put "fd,15" on screen as a reading, because nothing in the
 * pipeline knew what a card is called. These tests are mostly about refusing:
 * noise must not resolve to a card, and a reading that is equally close to two
 * cards must not pick one.
 */
import {
  bestMatch,
  budgetFor,
  editDistance,
  isConfident,
  looksLikeName,
  MAX_NORMALISED_DISTANCE,
  normaliseName,
} from "../lib/fuzzyName";

const NAMES = [
  "charizard",
  "charmander",
  "charmeleon",
  "pikachu",
  "raichu",
  "blastoise",
  "iono",
  "mew",
  "mewtwo",
  "farfetchd",
  // A real collision: Absol ex (2004) and Absol GX (2017) are different
  // cards at different prices, one edit apart.
  "absol ex",
  "absol gx",
].map(normaliseName);

describe("looksLikeName — the gibberish gate", () => {
  it("rejects the reading that started this", () => {
    // Shown on screen as though it were a card. 40% letters.
    expect(looksLikeName("fd,15")).toBe(false);
  });

  it("rejects other shapes OCR produces off a card border", () => {
    for (const junk of ["", "  ", "a", "12", "1/2", "..-,,", "4 8 15 16", "|| _"]) {
      expect(looksLikeName(junk)).toBe(false);
    }
  });

  it("accepts real card names, including the awkward ones", () => {
    for (const name of ["Iono", "Mew", "Charizard ex", "Farfetch'd", "Mr. Mime"]) {
      expect(looksLikeName(name)).toBe(true);
    }
  });
});

describe("bestMatch", () => {
  it("resolves the single-character errors OCR makes", () => {
    expect(bestMatch(NAMES, "Charlzard")?.name).toBe("charizard");
    expect(bestMatch(NAMES, "Pikachv")?.name).toBe("pikachu");
    expect(bestMatch(NAMES, "Blastoisc")?.name).toBe("blastoise");
  });

  it("returns nothing for noise", () => {
    expect(bestMatch(NAMES, "fd,15")).toBeNull();
    expect(bestMatch(NAMES, "zzqqwwxx")).toBeNull();
  });

  it("reports a margin of zero when two real cards are equally close", () => {
    // "absol ax" is one edit from both "absol ex" and "absol gx". The winner is
    // arbitrary; the margin is what says so.
    const ambiguous = bestMatch(NAMES, "absol ax");
    expect(ambiguous).not.toBeNull();
    expect(ambiguous!.distance).toBe(1);
    expect(ambiguous!.margin).toBe(0);
  });

  it("reports a clear margin for a distinctive name", () => {
    const clear = bestMatch(NAMES, "pikachu");
    expect(clear?.distance).toBe(0);
    expect(clear?.margin).toBeGreaterThanOrEqual(1);
  });

  it("refuses a reading shorter than three characters", () => {
    expect(bestMatch(NAMES, "me")).toBeNull();
  });

  it("handles an empty vocabulary", () => {
    expect(bestMatch([], "Charizard")).toBeNull();
  });
});

describe("isConfident", () => {
  it("accepts a clean read of a distinctive name", () => {
    expect(isConfident(bestMatch(NAMES, "Charizard"))).toBe(true);
    expect(isConfident(bestMatch(NAMES, "Charlzard"))).toBe(true);
  });

  it("refuses when nothing matched", () => {
    expect(isConfident(null)).toBe(false);
    expect(isConfident(bestMatch(NAMES, "fd,15"))).toBe(false);
  });

  it("refuses a tie between two real cards", () => {
    // A reading equidistant from two cards is a coin toss however close it is
    // to either, and guessing is how a scanner shows somebody a card they are
    // not holding. Absol ex and Absol GX differ by ten times in price.
    expect(isConfident(bestMatch(NAMES, "absol ax"))).toBe(false);
  });

  it("refuses a heavily corrupted reading even with a clear winner", () => {
    expect(
      isConfident({ name: "charizard", distance: 4, margin: 3, normalised: 0.45 })
    ).toBe(false);
    expect(MAX_NORMALISED_DISTANCE).toBeLessThanOrEqual(0.25);
  });
});

describe("editDistance", () => {
  it("measures and abandons", () => {
    expect(editDistance("pikachu", "pikachu", 3)).toBe(0);
    expect(editDistance("charlzard", "charizard", 3)).toBe(1);
    expect(editDistance("pikachu", "blastoise", 2)).toBeGreaterThan(2);
  });
});

describe("normaliseName", () => {
  it("folds accents and apostrophes rather than deleting the letter", () => {
    expect(normaliseName("Farfetch'd")).toBe("farfetchd");
    expect(normaliseName("Pokémon")).toBe("pokemon");
  });

  it("is stricter on short names", () => {
    expect(budgetFor(3)).toBe(1);
    expect(budgetFor(20)).toBe(4);
  });
});
