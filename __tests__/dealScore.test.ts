import { computeDealSignals } from "../components/DealScoreBreakdown";

const base = {
  price: 50,
  all_time_low: 40,
  price_change_7d: null as number | null,
  in_stock: true,
  is_preorder: false,
  msrp: null as number | null,
};

describe("computeDealSignals — ATL signal", () => {
  test("reports at-all-time-low when price equals all_time_low", () => {
    const s = computeDealSignals({ ...base, price: 40, all_time_low: 40 });
    const atl = s.find((x) => x.label === "Price");
    expect(atl?.value).toBe("At all-time low");
    expect(atl?.positive).toBe(true);
  });

  test("reports % above ATL when price is higher", () => {
    const s = computeDealSignals({ ...base, price: 50, all_time_low: 40 });
    const atl = s.find((x) => x.label === "Price");
    expect(atl?.value).toBe("+25% above ATL");
  });

  test("marks as positive when <10% above ATL", () => {
    const s = computeDealSignals({ ...base, price: 43, all_time_low: 40 });
    expect(s.find((x) => x.label === "Price")?.positive).toBe(true);
  });

  test("marks as negative when >=10% above ATL", () => {
    const s = computeDealSignals({ ...base, price: 50, all_time_low: 40 });
    expect(s.find((x) => x.label === "Price")?.positive).toBe(false);
  });
});

describe("computeDealSignals — 7-day trend signal", () => {
  test("reports drop when price_change_7d <= -1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: -15.3 });
    const t = s.find((x) => x.label === "7-day trend");
    expect(t?.value).toBe("↓ 15.3%");
    expect(t?.positive).toBe(true);
  });

  test("reports rise when price_change_7d >= 1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: 8.0 });
    const t = s.find((x) => x.label === "7-day trend");
    expect(t?.value).toBe("↑ 8.0%");
    expect(t?.positive).toBe(false);
  });

  test("reports Stable when change is between -1 and 1", () => {
    const s = computeDealSignals({ ...base, price_change_7d: 0.5 });
    expect(s.find((x) => x.label === "7-day trend")?.value).toBe("Stable");
  });

  test("omits trend signal when price_change_7d is null", () => {
    const s = computeDealSignals({ ...base, price_change_7d: null });
    expect(s.find((x) => x.label === "7-day trend")).toBeUndefined();
  });
});

describe("computeDealSignals — MSRP signal", () => {
  test("shows savings when msrp > price", () => {
    const s = computeDealSignals({ ...base, price: 40, msrp: 50 });
    const m = s.find((x) => x.label === "vs MSRP");
    expect(m?.value).toBe("20% off ($50.00)");
    expect(m?.positive).toBe(true);
  });

  test("omits MSRP signal when msrp is null", () => {
    expect(computeDealSignals({ ...base, msrp: null }).find((x) => x.label === "vs MSRP")).toBeUndefined();
  });

  test("omits MSRP signal when msrp <= price", () => {
    expect(computeDealSignals({ ...base, price: 55, msrp: 50 }).find((x) => x.label === "vs MSRP")).toBeUndefined();
  });
});

describe("computeDealSignals — status signal", () => {
  test("In stock", () => {
    const s = computeDealSignals({ ...base, in_stock: true, is_preorder: false });
    expect(s.find((x) => x.label === "Status")?.value).toBe("In stock");
  });

  test("Pre-order takes priority over in_stock", () => {
    const s = computeDealSignals({ ...base, in_stock: true, is_preorder: true });
    expect(s.find((x) => x.label === "Status")?.value).toBe("Pre-order");
  });

  test("Out of stock", () => {
    const s = computeDealSignals({ ...base, in_stock: false, is_preorder: false });
    expect(s.find((x) => x.label === "Status")?.value).toBe("Out of stock");
  });
});
