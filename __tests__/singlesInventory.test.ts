/**
 * Reading the crawled singles catalogue.
 *
 * The matching rules here decide which price gets shown next to a card, so the
 * tests are mostly about refusing to show a price for a different card — and
 * about surviving the several ways the file can arrive.
 */
import { gzipSync } from "zlib";
import {
  EMPTY_SINGLES,
  freshness,
  listingsForCard,
  parseSinglesState,
  type SinglesState,
} from "../lib/singlesInventory";

function listing(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Bulbasaur",
    set: "base1u",
    number: "44",
    finish: "Non-Foil",
    condition: "Near Mint",
    language: "English",
    retailer: "Face to Face Games",
    price: 4.99,
    in_stock: true,
    url: "https://example.test/products/bulbasaur",
    seen: "2026-09-19",
    ...over,
  };
}

function state(cards: Record<string, unknown>): SinglesState {
  return { cards: cards as SinglesState["cards"], updated: "2026-09-19T00:00:00Z" };
}

const BULBASAUR = state({
  "bulbasaur|base1u|44|non foil|near mint|english": {
    name: "Bulbasaur",
    set: "base1u",
    number: "44",
    listings: { "Face to Face Games": listing() },
  },
  "bulbasaur|base1u|44|non foil|played|english": {
    name: "Bulbasaur",
    set: "base1u",
    number: "44",
    listings: { "Face to Face Games": listing({ condition: "Played", price: 2.5 }) },
  },
  "pikachu|base1u|58|non foil|near mint|english": {
    name: "Pikachu",
    set: "base1u",
    number: "58",
    listings: { "Face to Face Games": listing({ name: "Pikachu", number: "58" }) },
  },
});

describe("parseSinglesState", () => {
  const payload = { cards: { a: { name: "A", set: "s", number: "1", listings: {} } }, updated: "x" };

  it("reads a gzipped file", () => {
    const parsed = parseSinglesState(gzipSync(Buffer.from(JSON.stringify(payload))));
    expect(Object.keys(parsed.cards)).toEqual(["a"]);
  });

  it("reads a file a CDN already decompressed", () => {
    // A .gz served with Content-Encoding: gzip is inflated by fetch before we
    // see it. Inflating again throws, and that looked exactly like "this game
    // has no crawl yet".
    const parsed = parseSinglesState(Buffer.from(JSON.stringify(payload)));
    expect(Object.keys(parsed.cards)).toEqual(["a"]);
  });

  it("returns empty rather than throwing on rubbish", () => {
    expect(parseSinglesState(Buffer.from("not json at all"))).toEqual(EMPTY_SINGLES);
    expect(parseSinglesState(Buffer.alloc(0))).toEqual(EMPTY_SINGLES);
  });
});

describe("listingsForCard", () => {
  it("returns every copy of the card, across conditions", () => {
    const found = listingsForCard(BULBASAUR, "Bulbasaur", "44");
    expect(found).toHaveLength(2);
    expect(found.map((l) => l.condition).sort()).toEqual(["Near Mint", "Played"]);
  });

  it("puts in-stock and cheapest first without ranking away a grade", () => {
    // The $2.50 Played copy genuinely is the cheapest. Whether that is the one
    // they want is the reader's call, so it leads and says what it is.
    const found = listingsForCard(BULBASAUR, "Bulbasaur", "44");
    expect(found[0].price).toBe(2.5);
    expect(found[0].condition).toBe("Played");
  });

  it("does not return a different card", () => {
    expect(listingsForCard(BULBASAUR, "Charizard", "4")).toEqual([]);
  });

  it("rejects the same name at a different collector number", () => {
    expect(listingsForCard(BULBASAUR, "Bulbasaur", "1")).toEqual([]);
  });

  it("matches on name alone when the card has no number", () => {
    expect(listingsForCard(BULBASAUR, "Bulbasaur", "")).toHaveLength(2);
  });

  it("ignores leading zeros on either side", () => {
    expect(listingsForCard(BULBASAUR, "Bulbasaur", "044")).toHaveLength(2);
  });

  it("is accent and punctuation insensitive", () => {
    const farfetchd = state({
      k: {
        name: "Farfetch'd",
        set: "151",
        number: "94",
        listings: { Shop: listing({ name: "Farfetch'd", number: "94" }) },
      },
    });
    expect(listingsForCard(farfetchd, "Farfetchd", "94")).toHaveLength(1);
  });

  it("handles an empty catalogue", () => {
    expect(listingsForCard(EMPTY_SINGLES, "Bulbasaur", "44")).toEqual([]);
  });

  it("handles an empty card name", () => {
    expect(listingsForCard(BULBASAUR, "", "44")).toEqual([]);
  });
});

describe("freshness", () => {
  const now = new Date("2026-09-19T12:00:00Z");

  it("says how old a crawled price is", () => {
    expect(freshness("2026-09-19", now)).toBe("seen today");
    expect(freshness("2026-09-18", now)).toBe("seen yesterday");
    expect(freshness("2026-09-12", now)).toBe("seen 7 days ago");
  });

  it("says nothing for an unparseable date", () => {
    expect(freshness("", now)).toBe("");
  });
});
