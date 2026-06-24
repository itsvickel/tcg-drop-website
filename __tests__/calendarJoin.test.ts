import { joinCalendar, type RawCalendarResponse } from "../lib/calendar";
import type { Product } from "../lib/products";
import { TCG_CONFIGS } from "../lib/tcg.config";

const config = TCG_CONFIGS.pokemon;

function makeProduct(overrides: Partial<Product>): Product {
  return {
    group_key: "gk",
    name: "Product",
    price: 100,
    retailer: "Retailer",
    url: "https://example.com/p",
    is_preorder: false,
    updated: "2026-01-01",
    all_time_low: 90,
    price_change_7d: null,
    history: [],
    image_url: "",
    other_retailers: [],
    is_new: false,
    in_stock: true,
    back_in_stock: false,
    language: "English",
    product_type: "Elite Trainer Box",
    set_name: "Mega Evolution",
    variant: "",
    msrp: null,
    deal_score: 0,
    last_restock_date: null,
    ...overrides,
  };
}

function singleSet(products: RawCalendarResponse["sets"][number]["products"]): RawCalendarResponse {
  return {
    sets: [
      {
        name: "Mega Evolution",
        series: "Mega Evolution",
        release_date: "2025-09-26",
        type: "Main Set",
        products,
      },
    ],
  };
}

describe("joinCalendar — product normalization", () => {
  test("upgrades a legacy string product into an object with a derived product_type", () => {
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [], config);
    expect(out.sets[0].products[0]).toMatchObject({
      name: "Elite Trainer Box",
      product_type: "Elite Trainer Box",
    });
  });

  test("derives product_type from a real product name", () => {
    const out = joinCalendar(
      singleSet([{ name: "Mega Evolution Booster Box", product_type: "Booster Box" }]),
      [],
      config
    );
    expect(out.sets[0].products[0].product_type).toBe("Booster Box");
  });

  test("leaves price fields absent when there is no live match", () => {
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [], config);
    expect(out.sets[0].products[0].price).toBeUndefined();
    expect(out.sets[0].products[0].in_stock).toBeUndefined();
  });
});

describe("joinCalendar — live price attachment", () => {
  test("attaches live price, stock, url, msrp, group_key and deal_score on a match", () => {
    const live = makeProduct({
      group_key: "mega-etb",
      name: "Mega Evolution Elite Trainer Box",
      product_type: "Elite Trainer Box",
      set_name: "Mega Evolution",
      price: 59.99,
      msrp: 64.99,
      in_stock: true,
      url: "https://shop/etb",
      deal_score: 42,
    });
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [live], config);
    expect(out.sets[0].products[0]).toMatchObject({
      product_type: "Elite Trainer Box",
      price: 59.99,
      msrp: 64.99,
      in_stock: true,
      url: "https://shop/etb",
      group_key: "mega-etb",
      deal_score: 42,
    });
  });

  test("attaches the matched retailer name", () => {
    const live = makeProduct({ retailer: "401 Games", set_name: "Mega Evolution", product_type: "Elite Trainer Box" });
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [live], config);
    expect(out.sets[0].products[0].retailer).toBe("401 Games");
  });

  test("picks the in-stock, cheapest live product when several match", () => {
    const cheapOut = makeProduct({ group_key: "a", price: 40, in_stock: false });
    const pricierIn = makeProduct({ group_key: "b", price: 55, in_stock: true });
    const dearerIn  = makeProduct({ group_key: "c", price: 70, in_stock: true });
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [cheapOut, pricierIn, dearerIn], config);
    expect(out.sets[0].products[0].group_key).toBe("b");
    expect(out.sets[0].products[0].price).toBe(55);
  });

  test("does not match a live product from a different set", () => {
    const other = makeProduct({ set_name: "Surging Sparks", product_type: "Elite Trainer Box" });
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [other], config);
    expect(out.sets[0].products[0].price).toBeUndefined();
  });

  test("prefers an English live product over a non-English one for an English calendar entry", () => {
    const jp = makeProduct({ group_key: "jp", language: "Japanese", price: 30, in_stock: true });
    const en = makeProduct({ group_key: "en", language: "English", price: 60, in_stock: true });
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [jp, en], config);
    expect(out.sets[0].products[0].group_key).toBe("en");
  });
});

describe("joinCalendar — set-level confidence defaults", () => {
  test("defaults missing date_confidence to 'confirmed' for a dated set", () => {
    const out = joinCalendar(singleSet(["Elite Trainer Box"]), [], config);
    expect(out.sets[0].date_confidence).toBe("confirmed");
  });

  test("treats the 9999 sentinel date as 'tba'", () => {
    const raw: RawCalendarResponse = {
      sets: [{ name: "Mystery Set", series: "?", release_date: "9999-12-31", type: "Main Set", products: [] }],
    };
    const out = joinCalendar(raw, [], config);
    expect(out.sets[0].date_confidence).toBe("tba");
  });

  test("preserves an explicit date_confidence", () => {
    const raw: RawCalendarResponse = {
      sets: [{
        name: "Pitch Black", series: "Mega Evolution", release_date: "2026-07-17",
        type: "Main Set", date_confidence: "tentative", products: [],
      }],
    };
    const out = joinCalendar(raw, [], config);
    expect(out.sets[0].date_confidence).toBe("tentative");
  });
});
