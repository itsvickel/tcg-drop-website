/**
 * Scanner text parsing.
 *
 * The fixtures are the shapes OCR actually produces on a phone: letters where
 * digits should be, the HP number glued to the card name, the illustrator
 * credit sharing the bottom strip with the collector number. A parser that only
 * handles clean text would work in a test and fail on every real photograph.
 */
import {
  buildLookupQuery,
  listingMatchesCard,
  normaliseCardName,
  numberVariants,
  parseQuery,
  parseScan,
  scanToQuery,
} from "../lib/cardLookup";

describe("parseScan — collector number", () => {
  it("reads a Pokemon fraction", () => {
    const scan = parseScan("Charizard ex", "136/189");
    expect(scan.number).toBe("136");
    expect(scan.setTotal).toBe("189");
  });

  it("repairs digits misread as letters", () => {
    // "1S6/1B9" is what a phone camera gives for 156/189 over holofoil.
    const scan = parseScan("Charizard ex", "1S6/1B9");
    expect(scan.number).toBe("156");
    expect(scan.setTotal).toBe("189");
  });

  it("keeps the number exactly as printed, zeros and all", () => {
    // TCGdex stores promo numbers padded ("001", "SVP075") and most main-set
    // numbers bare, so there is no single right form to normalise to. The
    // parser preserves the card; numberVariants offers the alternatives.
    expect(parseScan("Iono", "012/159").number).toBe("012");
    expect(numberVariants("012")).toContain("12");
  });

  it("keeps a promo prefix", () => {
    expect(parseScan("Mimikyu", "SVP 075").number).toBe("SVP075");
  });

  it("handles a Trainer Gallery number", () => {
    const scan = parseScan("Rayquaza VMAX", "TG12/TG30");
    expect(scan.number).toBe("TG12");
    expect(scan.setTotal).toBe("TG30");
  });

  it("reads an MTG set code without mistaking it for the number", () => {
    const scan = parseScan("Lightning Bolt", "0123/281 R  MOM • EN  Chris Rahn");
    expect(scan.setCode).toBe("MOM");
    // As printed; Scryfall numbers this card "123", which numberVariants offers.
    expect(scan.number).toBe("0123");
    expect(numberVariants(scan.number)).toEqual(expect.arrayContaining(["0123", "123"]));
  });

  it("falls back to a bare number", () => {
    expect(parseScan("Pikachu", "Illus. Mitsuhiro Arita   58").number).toBe("58");
  });

  it("returns null when the bottom strip is unreadable", () => {
    const scan = parseScan("Pikachu", "~~~ ...");
    expect(scan.number).toBeNull();
  });
});

describe("parseScan — name", () => {
  it("takes the title line", () => {
    expect(parseScan("Charizard ex", "136/189").nameCandidates[0]).toBe("Charizard ex");
  });

  it("strips the HP furniture from the title bar", () => {
    const scan = parseScan("Charizard ex 330 HP", "136/189");
    expect(scan.nameCandidates[0]).toBe("Charizard ex");
  });

  it("drops the illustrator credit and copyright", () => {
    const scan = parseScan("Iono\nIllus. Saboteri\n© 2023 Pokemon", "");
    expect(scan.nameCandidates).toEqual(["Iono"]);
  });

  it("prefers the longer of two readings", () => {
    const scan = parseScan("zard ex\nCharizard ex", "");
    expect(scan.nameCandidates[0]).toBe("Charizard ex");
  });

  it("keeps apostrophes and commas that belong to card names", () => {
    const scan = parseScan("Jeska's Will", "");
    expect(scan.nameCandidates[0]).toBe("Jeska's Will");
  });

  it("does not turn letters into digits in a name", () => {
    // The digit repair must never touch the name: Iono would become 1ono.
    expect(parseScan("Iono", "012/159").nameCandidates[0]).toBe("Iono");
  });

  it("survives an empty title strip", () => {
    expect(parseScan("", "136/189").nameCandidates).toEqual([]);
  });
});

describe("scanToQuery", () => {
  it("keeps the set total, which is the strongest discriminator on the card", () => {
    // This used to drop the denominator. Measured against the real 23,736-card
    // index: name alone leaves 16.3 candidate printings, name plus number
    // leaves 2.2, and adding the total pins 99.2% of cards to exactly one.
    expect(scanToQuery(parseScan("Charizard ex", "136/189"))).toBe("Charizard ex 136/189");
  });

  it("falls back to a bare number when there is no denominator", () => {
    expect(scanToQuery(parseScan("Mimikyu", "SVP 075"))).toBe("Mimikyu SVP075");
  });

  it("copes with a name and no number", () => {
    expect(scanToQuery(parseScan("Iono", ""))).toBe("Iono");
  });
});

describe("parseQuery", () => {
  it("splits a typed fraction off the name", () => {
    expect(parseQuery("charizard 223/197")).toEqual({
      name: "charizard",
      number: "223",
      setTotal: "197",
    });
  });

  it("splits a trailing bare number", () => {
    expect(parseQuery("Iono 237")).toEqual({ name: "Iono", number: "237", setTotal: null });
  });

  it("leaves a bare name alone", () => {
    expect(parseQuery("Black Lotus")).toEqual({
      name: "Black Lotus",
      number: null,
      setTotal: null,
    });
  });

  it("does not strip a number that is part of the name", () => {
    // "Team Rocket's Mewtwo ex" has no number; "Mewtwo 2" would be ambiguous,
    // but a short stem is more likely a truncated name than a card number.
    expect(parseQuery("M2 4").name).toBe("M2 4");
  });

  it("handles an empty query", () => {
    expect(parseQuery("")).toEqual({ name: "", number: null, setTotal: null });
  });
});

describe("normaliseCardName", () => {
  it("makes accents and punctuation meet", () => {
    expect(normaliseCardName("Pokémon")).toBe(normaliseCardName("Pokemon"));
    expect(normaliseCardName("Farfetch'd")).toBe(normaliseCardName("Farfetchd"));
  });
});

describe("listingMatchesCard", () => {
  it("matches a listing that contains the card name", () => {
    expect(
      listingMatchesCard("Pokemon Charizard ex (136/189) [Obsidian Flames]", "Charizard ex", "136")
    ).toBe(true);
  });

  it("rejects a listing whose number disagrees", () => {
    // The whole point of the scanner: a $4 reverse holo and a $400 alt art
    // share a name and must not share a price.
    expect(
      listingMatchesCard("Pokemon Charizard ex (223/197) [Obsidian Flames]", "Charizard ex", "136")
    ).toBe(false);
  });

  it("accepts a listing that states no number", () => {
    expect(listingMatchesCard("Pokemon Charizard ex Obsidian Flames", "Charizard ex", "136")).toBe(
      true
    );
  });

  it("rejects a different card", () => {
    expect(listingMatchesCard("Pokemon Pikachu (58/102)", "Charizard ex", "136")).toBe(false);
  });

  it("handles empty input", () => {
    expect(listingMatchesCard("", "Charizard", null)).toBe(false);
    expect(listingMatchesCard("Charizard", "", null)).toBe(false);
  });
});

describe("buildLookupQuery", () => {
  /**
   * This exists because of a bug it would have caught.
   *
   * When the fingerprint table dropped card ids, the scanner started matching
   * pictures and handing back a fingerprint — but the page still sent it as
   * `id`, the parameter for a catalogue id. TypeScript was happy, because a
   * fingerprint and a card id are both strings. Every unit test passed. Every
   * scan came back empty, and the only way to see why was to read the actual
   * request the page made.
   *
   * So the parameter names are pinned here. They are a contract with
   * /api/card-lookup, and a contract nothing checks is a contract that drifts.
   */
  const get = (q: URLSearchParams) => Object.fromEntries(q.entries());

  it("sends a matched fingerprint as `hash`, never as `id`", () => {
    const q = buildLookupQuery({ tcg: "pokemon", cardHash: "8e0c0c1c2c270402" });
    expect(get(q).hash).toBe("8e0c0c1c2c270402");
    expect(q.has("id")).toBe(false);
  });

  it("sends tied fingerprints as a comma-separated `hashes`", () => {
    const q = buildLookupQuery({ tcg: "pokemon", tiedHashes: ["aaaa", "bbbb"] });
    expect(get(q).hashes).toBe("aaaa,bbbb");
    expect(q.has("ids")).toBe(false);
  });

  it("omits the fingerprint parameters entirely for a typed search", () => {
    const q = buildLookupQuery({ tcg: "mtg", q: "Sol Ring" });
    expect(q.has("hash")).toBe(false);
    expect(q.has("hashes")).toBe(false);
    expect(get(q).q).toBe("Sol Ring");
  });

  it("always names the game, the offset and the sort", () => {
    // The API reads all three unconditionally; leaving one out silently
    // changes which page of which ordering comes back.
    const q = buildLookupQuery({ tcg: "mtg" });
    expect(get(q)).toMatchObject({ tcg: "mtg", offset: "0", sort: "newest" });
  });

  it("passes the filters through under the names the API reads", () => {
    const q = buildLookupQuery({
      tcg: "pokemon", q: "Pikachu", offset: 12, sort: "oldest",
      setId: "sv08.5", stocked: true,
    });
    expect(get(q)).toEqual({
      tcg: "pokemon", q: "Pikachu", offset: "12", sort: "oldest",
      set: "sv08.5", stocked: "1",
    });
  });

  it("leaves out filters that are not set, rather than sending empties", () => {
    const q = buildLookupQuery({ tcg: "pokemon", q: "Pikachu", stocked: false });
    expect(q.has("set")).toBe(false);
    expect(q.has("stocked")).toBe(false);
  });
});
