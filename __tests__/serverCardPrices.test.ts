/**
 * Choosing which price to show.
 *
 * A card is often sold in several finishes at once and they are not close
 * together: a Base Set Charizard is about $2,250 unlimited and $10,000 first
 * edition. Whichever one we print is "the market price" as far as a reader is
 * concerned, so the choice is not cosmetic — it is the number someone decides
 * whether to buy on.
 */
import { priceFor, productUrl, type CardPrice } from "../lib/serverCardPrices";

const table = (p: Record<string, number>, extra: object = {}) => ({
  "x-1": { u: 12345, r: "Holo Rare", p, ...extra },
});

describe("priceFor", () => {
  it("returns nothing for a card we have no price for", () => {
    // Roughly a fifth of the catalogue. It must read as "no figure", never as
    // a figure of zero.
    expect(priceFor({}, "x-1")).toBeNull();
  });

  it("returns nothing when every finish is priced at zero", () => {
    // TCGplayer reports 0 for "no sales data", which is not a price.
    expect(priceFor(table({ Normal: 0 }), "x-1")).toBeNull();
  });

  it("quotes the only finish there is", () => {
    const found = priceFor(table({ Holofoil: 359.87 }), "x-1") as CardPrice;
    expect(found.usd).toBe(359.87);
    expect(found.finish).toBe("Holofoil");
  });

  it("prefers the common printing over the rare one", () => {
    // The case that matters. Most people holding a Base Set card have the
    // unlimited print; quoting the first-edition price would tell almost
    // everyone their card is worth four times what it is.
    const found = priceFor(
      table({ "1st Edition Holofoil": 10000, "Unlimited Holofoil": 2257.87 }),
      "x-1"
    ) as CardPrice;
    expect(found.finish).toBe("Unlimited Holofoil");
    expect(found.usd).toBe(2257.87);
  });

  it("falls back to the rare printing when it is the only one", () => {
    const found = priceFor(table({ "1st Edition": 183.49 }), "x-1") as CardPrice;
    expect(found.usd).toBe(183.49);
  });

  it("takes the cheapest of finishes it does not recognise", () => {
    // A new finish name we have not seen. Understating a card is the less
    // damaging way to be wrong: it costs a sale, not a purchase at a bad price.
    const found = priceFor(table({ "Some New Foil": 90, "Another Foil": 40 }), "x-1") as CardPrice;
    expect(found.usd).toBe(40);
  });

  it("gives a TCGplayer link that resolves", () => {
    // The whole reason this file exists alongside the price: every tcgdex.net
    // link the site used to emit returned 404, for every card.
    const found = priceFor(table({ Normal: 1 }), "x-1") as CardPrice;
    expect(found.productUrl).toBe("https://www.tcgplayer.com/product/12345");
    expect(productUrl(999)).toContain("/product/999");
  });

  it("carries the rarity through, and treats an empty one as unknown", () => {
    expect((priceFor(table({ Normal: 1 }), "x-1") as CardPrice).rarity).toBe("Holo Rare");
    const blank = { "x-1": { u: 1, r: "", p: { Normal: 1 } } };
    expect((priceFor(blank, "x-1") as CardPrice).rarity).toBeNull();
  });

  it("ignores a card's variant printings when quoting its own price", () => {
    // A Master Ball Pattern reverse holo at the same collector number can be
    // worth many times the plain card. It is a different product and must not
    // become this card's headline price.
    const withVariants = table({ Normal: 0.15 }, {
      v: [["Master Ball Pattern", 676852, { "Reverse Holofoil": 18.4 }]],
    });
    expect((priceFor(withVariants, "x-1") as CardPrice).usd).toBe(0.15);
  });
});
