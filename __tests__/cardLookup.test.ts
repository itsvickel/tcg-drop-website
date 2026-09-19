/**
 * Scanner text parsing.
 *
 * The fixtures are the shapes OCR actually produces on a phone: letters where
 * digits should be, the HP number glued to the card name, the illustrator
 * credit sharing the bottom strip with the collector number. A parser that only
 * handles clean text would work in a test and fail on every real photograph.
 */
import {
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
