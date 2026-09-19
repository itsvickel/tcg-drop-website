/**
 * The local card index: search completeness and fuzzy correction.
 *
 * This replaced a lookup that returned six results because six was the request
 * budget, so the first thing worth testing is that a common name returns all of
 * its printings. The second is that fuzzy correction is forgiving enough to fix
 * what OCR actually produces and strict enough to refuse nonsense — a scanner
 * that "corrects" an unreadable frame to the nearest name shows people a card
 * they are not holding.
 */
import { existsSync, readFileSync } from "fs";
import { gzipSync } from "zlib";
import path from "path";
import {
  budgetFor,
  correctName,
  editDistance,
  EMPTY_INDEX,
  normalise,
  parseCardIndex,
  searchIndex,
  type CardIndex,
} from "../lib/cardIndex";

function build(cards: [string, string, string, string, string][]): CardIndex {
  return parseCardIndex(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          game: "pokemon",
          generated_at: "2026-09-19T00:00:00Z",
          image_prefix: "https://img.test/",
          sets: {
            base1: { name: "Base Set", total: 102 },
            swsh3: { name: "Darkness Ablaze", total: 189 },
          },
          cards,
        })
      )
    )
  );
}

const IDX = build([
  ["base1-58", "Pikachu", "58", "base1", "base1/58"],
  ["swsh3-43", "Pikachu", "43", "swsh3", "swsh3/43"],
  ["swsh3-44", "Pikachu VMAX", "44", "swsh3", "swsh3/44"],
  ["swsh3-45", "Surfing Pikachu", "45", "swsh3", "swsh3/45"],
  ["base1-4", "Charizard", "4", "base1", "base1/4"],
]);

describe("parseCardIndex", () => {
  it("expands compact rows and joins set metadata", () => {
    const card = IDX.cards[0];
    expect(card).toMatchObject({
      id: "base1-58",
      name: "Pikachu",
      number: "58",
      setId: "base1",
      setName: "Base Set",
      setTotal: 102,
    });
    expect(card.imageUrl).toBe("https://img.test/base1/58/high.webp");
  });

  it("reads a file a CDN already decompressed", () => {
    const plain = Buffer.from(JSON.stringify({ game: "mtg", names: ["Sol Ring"] }));
    expect(parseCardIndex(plain).names).toEqual(["sol ring"]);
  });

  it("returns an empty index rather than throwing on rubbish", () => {
    expect(parseCardIndex(Buffer.from("nonsense"))).toEqual(EMPTY_INDEX);
  });
});

describe("searchIndex", () => {
  it("returns every printing, not just a page's worth", () => {
    // The bug this replaced: the count reported was the page length, so a name
    // with 153 printings looked like it had six.
    const r = searchIndex(IDX, "Pikachu", { limit: 2 });
    expect(r.total).toBe(4);
    expect(r.cards).toHaveLength(2);
  });

  it("puts exact-name matches ahead of ones that merely contain it", () => {
    const r = searchIndex(IDX, "Pikachu", { limit: 4 });
    expect(r.cards.slice(0, 2).map((c) => c.name)).toEqual(["Pikachu", "Pikachu"]);
    expect(r.cards.map((c) => c.name)).toContain("Surfing Pikachu");
  });

  it("pages with an offset", () => {
    const first = searchIndex(IDX, "Pikachu", { limit: 2, offset: 0 });
    const second = searchIndex(IDX, "Pikachu", { limit: 2, offset: 2 });
    expect(second.total).toBe(4);
    expect(second.cards.map((c) => c.id)).not.toEqual(first.cards.map((c) => c.id));
  });

  it("pins a printing when given a collector number", () => {
    const r = searchIndex(IDX, "Pikachu", { number: "58" });
    expect(r.total).toBe(1);
    expect(r.cards[0].setName).toBe("Base Set");
  });

  it("ignores a number that matches nothing rather than emptying the results", () => {
    const r = searchIndex(IDX, "Pikachu", { number: "999" });
    expect(r.total).toBe(4);
  });

  it("corrects a misread name and says so", () => {
    const r = searchIndex(IDX, "Pikachv");
    expect(r.correctedTo).toBe("pikachu");
    expect(r.total).toBeGreaterThan(0);
  });

  it("does NOT correct a query that already found something", () => {
    // Otherwise a deliberate search for an obscure card silently becomes its
    // more famous neighbour.
    const r = searchIndex(IDX, "Surfing Pikachu");
    expect(r.correctedTo).toBeNull();
    expect(r.cards[0].name).toBe("Surfing Pikachu");
  });

  it("returns nothing for an empty index or empty query", () => {
    expect(searchIndex(EMPTY_INDEX, "Pikachu").total).toBe(0);
    expect(searchIndex(IDX, "").total).toBe(0);
  });
});

describe("editDistance", () => {
  it("measures edits", () => {
    expect(editDistance("pikachu", "pikachu", 3)).toBe(0);
    expect(editDistance("pikachv", "pikachu", 3)).toBe(1);
    expect(editDistance("charlzard", "charizard", 3)).toBe(1);
  });

  it("gives up past the budget instead of computing a useless number", () => {
    expect(editDistance("pikachu", "charizard", 2)).toBeGreaterThan(2);
  });
});

describe("correctName", () => {
  it("fixes the single-character errors OCR actually makes", () => {
    expect(correctName(IDX, "Charlzard")).toBe("charizard");
    expect(correctName(IDX, "Pikachv")).toBe("pikachu");
  });

  it("refuses when nothing is close", () => {
    // Guessing here is how a scanner confidently shows the wrong card.
    expect(correctName(IDX, "zzzzqqqqwwww")).toBeNull();
  });

  it("is stricter on short names, where one edit changes everything", () => {
    expect(budgetFor(4)).toBe(1);
    expect(budgetFor(20)).toBe(4);
  });

  it("passes an already-correct name straight through", () => {
    expect(correctName(IDX, "Charizard")).toBe("charizard");
  });
});

describe("normalise", () => {
  it("makes accents and apostrophes meet", () => {
    expect(normalise("Farfetch'd")).toBe(normalise("Farfetchd"));
    expect(normalise("Pokémon")).toBe(normalise("Pokemon"));
  });
});

/**
 * Against the real generated index when it is present, mirroring the repo's
 * existing contract tests. Skipped in CI, where the data repo is not checked
 * out beside this one.
 */
const REAL = path.join(__dirname, "..", "..", "tcg-drop-alert", "card_index.json.gz");
const maybe = existsSync(REAL) ? describe : describe.skip;

maybe("the real Pokemon index", () => {
  const idx = existsSync(REAL) ? parseCardIndex(readFileSync(REAL)) : EMPTY_INDEX;

  it("holds the whole catalogue", () => {
    expect(idx.cards.length).toBeGreaterThan(20000);
  });

  it("finds every Pikachu, not six of them", () => {
    const r = searchIndex(idx, "Pikachu", { limit: 12 });
    expect(r.total).toBeGreaterThan(100);
    expect(r.cards[0].name.toLowerCase()).toBe("pikachu");
  });

  it("searches fast enough to run per keystroke", () => {
    const t0 = Date.now();
    searchIndex(idx, "Charizard", { limit: 12 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("corrects a realistic OCR misread against 20,000 names", () => {
    expect(correctName(idx, "Charlzard")).toBe("charizard");
  });
});

describe("set total as a discriminator", () => {
  const TOTALS = parseCardIndex(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          game: "pokemon",
          sets: {
            base1: { name: "Base Set", total: 102 },
            swsh3: { name: "Darkness Ablaze", total: 189 },
          },
          cards: [
            ["base1-58", "Pikachu", "58", "base1", ""],
            ["swsh3-58", "Pikachu", "58", "swsh3", ""],
          ],
        })
      )
    )
  );

  it("separates two printings that share a collector number", () => {
    // 58 alone is ambiguous across sets; 58/102 is not. This is the pairing the
    // scanner throws at it, and the reason the denominator is worth reading.
    expect(searchIndex(TOTALS, "Pikachu", { number: "58" }).total).toBe(2);
    const pinned = searchIndex(TOTALS, "Pikachu", { number: "58", setTotal: "102" });
    expect(pinned.total).toBe(1);
    expect(pinned.cards[0].setName).toBe("Base Set");
  });

  it("ignores a misread total rather than emptying the results", () => {
    expect(searchIndex(TOTALS, "Pikachu", { setTotal: "999" }).total).toBe(2);
  });
});

describe("filters and ordering", () => {
  const MIXED = parseCardIndex(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          game: "pokemon",
          sets: {
            old: { name: "Old Set", total: 102 },
            neu: { name: "New Set", total: 189 },
          },
          // Index order is newest-set-first, as the builder writes it.
          cards: [
            ["neu-10", "Pikachu", "10", "neu", ""],
            ["neu-2", "Pikachu", "2", "neu", ""],
            ["old-Museum", "Pikachu", "Museum", "old", ""],
            ["old-1", "Pikachu", "1", "old", ""],
          ],
        })
      )
    )
  );

  it("offers every set with a count", () => {
    const r = searchIndex(MIXED, "Pikachu");
    expect(r.sets).toEqual([
      { id: "neu", name: "New Set", count: 2 },
      { id: "old", name: "Old Set", count: 2 },
    ]);
  });

  it("narrows to one set without collapsing the menu", () => {
    // A filter that removes its own options traps the user in it.
    const r = searchIndex(MIXED, "Pikachu", { setId: "old" });
    expect(r.total).toBe(2);
    expect(r.sets).toHaveLength(2);
  });

  it("sorts numerically, with non-numeric collector numbers last", () => {
    // "Museum" is not a number. Comparing it numerically against real ones
    // gave an inconsistent comparator that sorted it ahead of card 1.
    const r = searchIndex(MIXED, "Pikachu", { sort: "number" });
    expect(r.cards.map((c) => c.number)).toEqual(["1", "2", "10", "Museum"]);
  });

  it("reverses for oldest-first", () => {
    const r = searchIndex(MIXED, "Pikachu", { sort: "oldest" });
    expect(r.cards[0].setName).toBe("Old Set");
  });

  it("defaults to the index order, which is newest first", () => {
    expect(searchIndex(MIXED, "Pikachu").cards[0].setName).toBe("New Set");
  });
});
