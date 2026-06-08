import { getHotProducts } from "../components/HotStrip";
import type { Product } from "../components/ProductCard";

function makeProduct(overrides: Partial<Product>): Product {
  return {
    group_key: "test",
    name: "Test Product",
    price: 50,
    retailer: "Test Store",
    url: "https://example.com",
    is_preorder: false,
    updated: new Date().toISOString(),
    all_time_low: 40,
    price_change_7d: null,
    history: [],
    image_url: "",
    other_retailers: [],
    is_new: false,
    in_stock: true,
    back_in_stock: false,
    language: "English",
    product_type: "Booster Box",
    set_name: "Test Set",
    msrp: null,
    deal_score: 50,
    ...overrides,
  };
}

const recent = new Date().toISOString();
const stale  = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

describe("getHotProducts", () => {
  test("excludes products with drop less than 5%", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -3, updated: recent });
    expect(getHotProducts([p])).toHaveLength(0);
  });

  test("excludes products updated more than 48h ago", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -20, updated: stale });
    expect(getHotProducts([p])).toHaveLength(0);
  });

  test("includes product with >=5% drop updated within 48h", () => {
    const p = makeProduct({ group_key: "a", price_change_7d: -6, updated: recent });
    expect(getHotProducts([p])).toHaveLength(1);
  });

  test("sorts by biggest drop first", () => {
    const big   = makeProduct({ group_key: "big",   price_change_7d: -20, updated: recent });
    const small = makeProduct({ group_key: "small", price_change_7d: -6,  updated: recent });
    const result = getHotProducts([small, big]);
    expect(result[0].group_key).toBe("big");
  });

  test("caps at 8 results", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeProduct({ group_key: `p${i}`, price_change_7d: -10, updated: recent })
    );
    expect(getHotProducts(many)).toHaveLength(8);
  });

  test("returns empty array when no products qualify", () => {
    expect(getHotProducts([])).toHaveLength(0);
  });
});
