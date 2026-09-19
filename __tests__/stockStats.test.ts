/**
 * Restock-rhythm presentation.
 *
 * The aggregate upstream already decided what is sayable; these tests guard the
 * ways the UI layer could quietly say more than it was given — naming days on a
 * "spread" verdict, turning a description of the past into a countdown, or
 * merging two games' profiles into a pattern neither of them showed.
 */
import {
  joinDays,
  mergePatterns,
  restockOutlook,
  restockSentence,
  shelfLifeSentence,
  weekdayIntensity,
  type ProductRhythm,
  type RetailerPattern,
} from "../lib/stockStats";

function pattern(over: Partial<RetailerPattern> = {}): RetailerPattern {
  return {
    restocks: 40,
    by_weekday: [4, 14, 4, 12, 3, 2, 1],
    top_days: ["Tuesday", "Thursday"],
    top_share: 0.65,
    p_value: 0.0001,
    verdict: "pattern",
    first_restock: "2026-06-04",
    last_restock: "2026-09-07",
    products: 22,
    ...over,
  };
}

function rhythm(over: Partial<ProductRhythm> = {}): ProductRhythm {
  return {
    restocks: 5,
    median_gap_days: 20,
    p25_gap_days: 14,
    p75_gap_days: 30,
    last_restock: "2026-09-01",
    days_since_restock: 6,
    typical_days_in_stock: 3,
    ...over,
  };
}

describe("restockSentence", () => {
  it("names the days and shows the share and the sample", () => {
    const text = restockSentence(pattern())!;
    expect(text).toContain("Tuesdays and Thursdays");
    expect(text).toContain("65%");
    expect(text).toContain("40 restocks");
  });

  it("says nothing when the aggregate called it spread", () => {
    expect(restockSentence(pattern({ verdict: "spread", top_days: [] }))).toBeNull();
  });

  it("says nothing when there is not enough data", () => {
    expect(restockSentence(pattern({ verdict: "insufficient", top_days: [] }))).toBeNull();
  });

  it("never names days the verdict did not name", () => {
    // A payload that disagrees with itself must not be talked into a claim.
    expect(restockSentence(pattern({ verdict: "spread" }))).toBeNull();
  });

  it("handles a missing pattern", () => {
    expect(restockSentence(null)).toBeNull();
  });
});

describe("joinDays", () => {
  it("pluralises, because this is a habit and not one occasion", () => {
    expect(joinDays(["Tuesday"])).toBe("Tuesdays");
    expect(joinDays(["Tuesday", "Thursday"])).toBe("Tuesdays and Thursdays");
  });
});

describe("weekdayIntensity", () => {
  it("scales against the busiest day", () => {
    const out = weekdayIntensity(pattern({ by_weekday: [0, 10, 5, 0, 0, 0, 0] }));
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(0.5);
    expect(out[0]).toBe(0);
  });

  it("survives a shop with no restocks", () => {
    const out = weekdayIntensity(pattern({ by_weekday: [0, 0, 0, 0, 0, 0, 0] }));
    expect(out).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("mergePatterns", () => {
  it("sums both games, because a shop has one restock habit", () => {
    const merged = mergePatterns([
      pattern({ by_weekday: [1, 8, 1, 6, 1, 1, 0], restocks: 18, products: 10 }),
      pattern({ by_weekday: [1, 7, 1, 5, 1, 0, 1], restocks: 16, products: 8 }),
    ])!;
    expect(merged.restocks).toBe(34);
    expect(merged.by_weekday[1]).toBe(15);
    expect(merged.products).toBe(18);
  });

  it("passes a single game through untouched", () => {
    const only = pattern();
    expect(mergePatterns([only, undefined])).toBe(only);
  });

  it("returns null when the shop appears in neither game", () => {
    expect(mergePatterns([undefined, undefined])).toBeNull();
  });

  it("re-derives the verdict rather than inheriting it", () => {
    // Two games that each look patterned, on opposite days, are not a pattern.
    const merged = mergePatterns([
      pattern({ by_weekday: [20, 0, 0, 0, 0, 0, 0], restocks: 20, top_days: ["Monday"] }),
      pattern({ by_weekday: [0, 0, 0, 0, 0, 7, 7], restocks: 14, top_days: ["Saturday"] }),
    ])!;
    expect(merged.top_share).toBeLessThan(0.85);
    expect(merged.top_days).not.toEqual(["Monday"]);
  });

  it("will not call a thin merged sample a pattern", () => {
    const merged = mergePatterns([
      pattern({ by_weekday: [0, 4, 0, 0, 0, 0, 0], restocks: 4 }),
      pattern({ by_weekday: [0, 3, 0, 0, 0, 0, 0], restocks: 3 }),
    ])!;
    expect(merged.verdict).toBe("insufficient");
    expect(merged.top_days).toEqual([]);
  });

  it("calls a spread merge spread", () => {
    const merged = mergePatterns([
      pattern({ by_weekday: [3, 3, 3, 3, 3, 3, 3], restocks: 21 }),
      pattern({ by_weekday: [2, 2, 2, 2, 2, 2, 2], restocks: 14 }),
    ])!;
    expect(merged.verdict).toBe("spread");
    expect(merged.top_days).toEqual([]);
  });
});

describe("restockOutlook", () => {
  const now = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it("says nothing for a product with no cadence", () => {
    expect(restockOutlook(undefined)).toBeNull();
  });

  it("reads days-since from the date, not the stale field in the payload", () => {
    // days_since_restock was correct the day the file was generated and drifts
    // every day after. A product long overdue must not read as freshly gone.
    const out = restockOutlook(rhythm({ days_since_restock: 1 }), now("2026-10-15"))!;
    expect(out.state).toBe("overdue");
  });

  it("flags a product that is out longer than it usually is", () => {
    const out = restockOutlook(rhythm(), now("2026-10-10"))!;
    expect(out.state).toBe("overdue");
    expect(out.text).toContain("longer than usual");
  });

  it("flags one that is around due", () => {
    const out = restockOutlook(rhythm(), now("2026-09-18"))!;
    expect(out.state).toBe("due");
  });

  it("stays quiet right after a restock", () => {
    const out = restockOutlook(rhythm(), now("2026-09-02"))!;
    expect(out.state).toBe("quiet");
  });

  it("describes the past and never promises the future", () => {
    for (const day of ["2026-09-02", "2026-09-12", "2026-09-18", "2026-10-10"]) {
      const out = restockOutlook(rhythm(), now(day))!;
      expect(out.text).toMatch(/usually|normally|around due/i);
      expect(out.text).not.toMatch(/\bwill\b|guaranteed|expect it/i);
    }
  });

  it("always carries the sample size in its detail", () => {
    const out = restockOutlook(rhythm(), now("2026-09-10"))!;
    expect(out.detail).toContain("5 times");
  });

  it("survives an unparseable date", () => {
    expect(restockOutlook(rhythm({ last_restock: "not-a-date" }))).toBeNull();
  });
});

describe("shelfLifeSentence", () => {
  it("reports the median, the quick share and the sample", () => {
    const text = shelfLifeSentence(
      { runs: 40, median_days: 3, p25_days: 1, p75_days: 9, gone_within_a_day_pct: 0.31 },
      "Boxes"
    )!;
    expect(text).toContain("3 days");
    expect(text).toContain("31%");
    expect(text).toContain("40 restocks");
  });

  it("says nothing when the bucket was too thin to report", () => {
    expect(shelfLifeSentence(null, "Boxes")).toBeNull();
  });
});
