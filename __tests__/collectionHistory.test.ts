/**
 * Collection value reconstruction.
 *
 * Every test here guards against a version of the same failure: a chart that
 * shows growth the collection did not have. The coverage ramp is the dangerous
 * one — summing whatever has data on each day draws a rising line out of our
 * own onboarding schedule, and it looks exactly like a portfolio going up.
 */
import {
  buildSeries,
  chooseWindow,
  seriesNote,
  MIN_VALUE_COVERAGE,
  type BasketItem,
} from "../lib/collectionHistory";

function daily(start: string, prices: number[]): { date: string; price: number }[] {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (const price of prices) {
    out.push({ date: d.toISOString().slice(0, 10), price });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function item(over: Partial<BasketItem> = {}): BasketItem {
  return {
    group_key: "booster box alpha",
    quantity: 1,
    history: daily("2026-06-01", [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
    marketPrice: 100,
    ...over,
  };
}

const TODAY = "2026-06-10";

describe("chooseWindow", () => {
  it("opens as early as coverage allows", () => {
    const { start, included } = chooseWindow([item(), item({ group_key: "b" })]);
    expect(start).toBe("2026-06-01");
    expect(included).toHaveLength(2);
  });

  it("excludes a product whose history starts too late", () => {
    // 90% of value has data from June 1; the latecomer is a tenth of the value.
    const { start, included } = chooseWindow([
      item({ group_key: "a", marketPrice: 900, quantity: 1 }),
      item({
        group_key: "late",
        marketPrice: 100,
        history: daily("2026-06-08", [100, 100, 100]),
      }),
    ]);
    expect(start).toBe("2026-06-01");
    expect(included.map((i) => i.group_key)).toEqual(["a"]);
  });

  it("delays the start when the latecomer is most of the value", () => {
    const { start, included } = chooseWindow([
      item({ group_key: "small", marketPrice: 10 }),
      item({
        group_key: "big",
        marketPrice: 990,
        history: daily("2026-06-08", [990, 990, 990]),
      }),
    ]);
    expect(start).toBe("2026-06-08");
    expect(included).toHaveLength(2);
  });

  it("returns nothing for a basket with no history at all", () => {
    expect(chooseWindow([item({ history: [] })])).toEqual({ start: null, included: [] });
  });
});

describe("buildSeries", () => {
  it("multiplies price by quantity", () => {
    const series = buildSeries([item({ quantity: 3 })], TODAY);
    expect(series.points[0].value).toBe(300);
  });

  it("sums the basket", () => {
    const series = buildSeries(
      [item({ group_key: "a" }), item({ group_key: "b", quantity: 2 })],
      TODAY
    );
    expect(series.points[0].value).toBe(300);
  });

  it("does NOT ramp up as coverage fills in", () => {
    // The trap: 'late' has no data before June 8. Summed only from the day it
    // appears, the line would step up on June 8 and read as a gain. It is a
    // tenth of the value, so the basket drops it and keeps the long window.
    const series = buildSeries(
      [
        item({ group_key: "a", marketPrice: 900, history: daily("2026-06-01", Array(10).fill(900)) }),
        item({
          group_key: "late",
          marketPrice: 100,
          history: daily("2026-06-08", [100, 100, 100]),
        }),
      ],
      TODAY
    );
    const values = series.points.map((p) => p.value);
    expect(new Set(values).size).toBe(1);
    expect(series.excluded).toBe(1);
    expect(series.included).toBe(1);
  });

  it("shortens the window rather than ramping when the latecomer matters", () => {
    // Same trap, opposite resolution: half the basket's value has no early
    // data, so dropping it would chart a basket the totals do not describe.
    // The window moves in instead, and the line stays flat across it.
    const series = buildSeries(
      [
        item({ group_key: "a", history: daily("2026-06-01", Array(15).fill(100)) }),
        item({ group_key: "late", history: daily("2026-06-05", Array(11).fill(100)) }),
      ],
      "2026-06-15"
    );
    expect(series.startDate).toBe("2026-06-05");
    expect(series.included).toBe(2);
    expect(series.excluded).toBe(0);
    expect(new Set(series.points.map((p) => p.value)).size).toBe(1);
  });

  it("carries the last price over a sold-out gap instead of dropping to zero", () => {
    const history = [
      ...daily("2026-06-01", [100, 100, 100]),
      // June 4-6 missing: unbuyable everywhere.
      ...daily("2026-06-07", [120, 120, 120, 120]),
    ];
    const series = buildSeries([item({ history })], TODAY);
    const byDate = new Map(series.points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-06-05")).toBe(100);
    expect(byDate.get("2026-06-07")).toBe(120);
    expect(Math.min(...series.points.map((p) => p.value))).toBeGreaterThan(0);
  });

  it("reports change across the window", () => {
    const series = buildSeries(
      [item({ history: daily("2026-06-01", [100, 100, 100, 100, 100, 110, 120, 130, 140, 150]) })],
      TODAY
    );
    expect(series.change).toBe(50);
    expect(series.changePct).toBeCloseTo(50);
  });

  it("reports coverage as a share of today's value", () => {
    const series = buildSeries(
      [
        item({ group_key: "a", marketPrice: 900 }),
        item({
          group_key: "late",
          marketPrice: 100,
          history: daily("2026-06-08", [100]),
        }),
      ],
      TODAY
    );
    expect(series.valueCoverage).toBeCloseTo(0.9);
  });

  it("refuses a window too short to be a chart", () => {
    const series = buildSeries(
      [item({ history: daily("2026-06-09", [100, 100]) })],
      TODAY
    );
    expect(series.points).toEqual([]);
  });

  it("handles an empty collection", () => {
    expect(buildSeries([], TODAY).points).toEqual([]);
  });

  it("handles holdings with no history", () => {
    const series = buildSeries([item({ history: [] })], TODAY);
    expect(series.points).toEqual([]);
    expect(series.excluded).toBe(1);
  });

  it("gives no percentage when the basket started at zero", () => {
    const series = buildSeries(
      [item({ history: daily("2026-06-01", [0, 0, 0, 0, 0, 10, 20, 30, 40, 50]) })],
      TODAY
    );
    expect(series.changePct).toBeNull();
  });

  it("ends on today, not on the last price point", () => {
    // Everything sold out three days ago. The chart must still reach today,
    // holding the last known value, rather than implying the data stops.
    const series = buildSeries(
      [item({ history: daily("2026-06-01", [100, 100, 100, 100, 100, 100, 100]) })],
      TODAY
    );
    expect(series.endDate).toBe(TODAY);
    expect(series.points[series.points.length - 1].value).toBe(100);
  });
});

describe("seriesNote", () => {
  it("states the constant-basket reading first", () => {
    const series = buildSeries([item()], TODAY);
    expect(seriesNote(series)).toContain("not a record of your balance");
  });

  it("names how many holdings were left out", () => {
    const series = buildSeries(
      [
        item({ group_key: "a", marketPrice: 900 }),
        item({ group_key: "late", marketPrice: 100, history: daily("2026-06-08", [100]) }),
      ],
      TODAY
    );
    expect(seriesNote(series)).toContain("1 holding left out");
    expect(seriesNote(series)).toContain("90%");
  });

  it("says nothing when there is no chart", () => {
    expect(seriesNote(buildSeries([], TODAY))).toBeNull();
  });
});

describe("coverage threshold", () => {
  it("is strict enough that the line matches the totals beside it", () => {
    expect(MIN_VALUE_COVERAGE).toBeGreaterThanOrEqual(0.9);
  });
});
