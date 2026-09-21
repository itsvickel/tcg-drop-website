/**
 * Grading, and the stack total that depends on it.
 *
 * A market price is a Near Mint price. Most cards out of a binder are not Near
 * Mint, so a total built from market prices is systematically high — and
 * wrongest on the expensive cards, where being wrong costs the most.
 */
import {
  CONDITIONS,
  CONDITION_MULTIPLIER,
  DEFAULT_CONDITION,
  isCondition,
  valueAtCondition,
} from "../lib/cardCondition";
import {
  conditionOf,
  entryValue,
  historyValue,
  setCondition,
  addToHistory,
  type ScanHistoryEntry,
} from "../lib/scanHistory";
import { toCsv, csvFilename } from "../lib/scanExport";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as Storage;
}

const card = (over: Partial<ScanHistoryEntry> = {}): ScanHistoryEntry => ({
  hash: "8e0c0c1c2c270402",
  tcg: "pokemon",
  name: "Charizard ex",
  setName: "151",
  collectorNumber: "199",
  imageUrl: "https://example.test/a.webp",
  marketCad: 100,
  at: 1_700_000_000_000,
  ...over,
});

describe("valueAtCondition", () => {
  it("leaves a Near Mint card at its market price", () => {
    expect(valueAtCondition(100, "NM")).toBe(100);
  });

  it("discounts played copies down the scale", () => {
    const values = CONDITIONS.map((c) => valueAtCondition(100, c)!);
    // Monotonically decreasing: a worse grade is never worth more.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
    expect(valueAtCondition(100, "DMG")).toBe(35);
  });

  it("keeps an unknown price unknown rather than calling it zero", () => {
    // Multiplying an unknown by anything is still unknown, and returning zero
    // would quietly drag a stack total down.
    for (const c of CONDITIONS) {
      expect(valueAtCondition(null, c)).toBeNull();
      expect(valueAtCondition(0, c)).toBeNull();
      expect(valueAtCondition(undefined, c)).toBeNull();
    }
  });

  it("rounds to cents", () => {
    expect(valueAtCondition(503.82, "LP")).toBe(428.25);
  });

  it("defaults to the grade a market price already assumes", () => {
    expect(DEFAULT_CONDITION).toBe("NM");
    expect(CONDITION_MULTIPLIER[DEFAULT_CONDITION]).toBe(1);
    expect(valueAtCondition(42)).toBe(42);
  });
});

describe("isCondition", () => {
  it("accepts the grades and refuses anything else", () => {
    expect(isCondition("LP")).toBe(true);
    expect(isCondition("lp")).toBe(false);
    expect(isCondition("MINT")).toBe(false);
    expect(isCondition(undefined)).toBe(false);
  });
});

describe("grading an entry", () => {
  it("treats an ungraded entry as Near Mint", () => {
    // Entries written before grading existed have no condition at all, and a
    // market price is a Near Mint price, so that is the assumption already
    // baked in rather than a new one.
    expect(conditionOf(card())).toBe("NM");
    expect(entryValue(card())).toBe(100);
  });

  it("ignores a stored grade that is not one of ours", () => {
    const bad = { ...card(), condition: "PERFECT" as unknown as ScanHistoryEntry["condition"] };
    expect(conditionOf(bad)).toBe("NM");
  });

  it("re-grades by key, not by position", () => {
    // The list can be re-ordered by a scan landing between the tap and the
    // write, so an index would grade the wrong card.
    const store = fakeStorage();
    addToHistory(card({ hash: "a", name: "A" }), store);
    addToHistory(card({ hash: "b", name: "B" }), store);
    const next = setCondition("a", "MP", store);
    expect(next.find((e) => e.hash === "a")?.condition).toBe("MP");
    expect(next.find((e) => e.hash === "b")?.condition).toBeUndefined();
  });
});

describe("historyValue with grades", () => {
  it("totals the graded value, not the market value", () => {
    const total = historyValue([
      card({ hash: "a", marketCad: 100, condition: "NM" }),
      card({ hash: "b", marketCad: 100, condition: "MP" }),
      card({ hash: "c", marketCad: 100, condition: "DMG" }),
    ]);
    expect(total).toEqual({ totalCad: 205, priced: 3, unpriced: 0 });
  });

  it("still counts an unpriced card as unpriced whatever its grade", () => {
    const total = historyValue([card({ marketCad: null, condition: "LP" })]);
    expect(total).toEqual({ totalCad: 0, priced: 0, unpriced: 1 });
  });
});

describe("toCsv", () => {
  it("has a header and one row per card", () => {
    const csv = toCsv([card({ hash: "a" }), card({ hash: "b", name: "Pikachu" })]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Name,Set,Number");
  });

  it("reports both the market price and the graded estimate", () => {
    // Separate columns so nobody has to guess which number they are reading,
    // or reverse a multiplier to recover the reference.
    const csv = toCsv([card({ marketCad: 100, condition: "LP" })]);
    const row = csv.trim().split("\r\n")[1];
    expect(row).toContain("LP");
    expect(row).toContain("100");
    expect(row).toContain("85");
  });

  it("escapes a name containing a comma", () => {
    const csv = toCsv([card({ name: "Hop's Zacian ex, Full Art" })]);
    expect(csv).toContain('"Hop\'s Zacian ex, Full Art"');
  });

  it("escapes embedded quotes by doubling them", () => {
    const csv = toCsv([card({ name: 'Say "Hello"' })]);
    expect(csv).toContain('"Say ""Hello"""');
    // And the row still has the right number of fields.
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });

  it("survives a split card name", () => {
    const csv = toCsv([card({ name: "Accursed Witch // Infectious Curse", tcg: "mtg" })]);
    expect(csv).toContain("Accursed Witch // Infectious Curse");
  });

  it("leaves an unknown price blank rather than writing zero", () => {
    const row = toCsv([card({ marketCad: null })]).trim().split("\r\n")[1];
    expect(row.endsWith(",")).toBe(false);
    expect(row).toMatch(/,,/); // an empty market and an empty estimate
  });

  it("ends with a newline", () => {
    // Some tools drop or mangle a final row that has none.
    expect(toCsv([card()]).endsWith("\r\n")).toBe(true);
  });

  it("is just a header when nothing was scanned", () => {
    expect(toCsv([]).trim().split("\r\n")).toHaveLength(1);
  });
});

describe("csvFilename", () => {
  it("is dated, so two exports do not overwrite each other", () => {
    expect(csvFilename(new Date("2026-09-21T14:00:00Z"))).toBe("tcg-drop-scans-2026-09-21.csv");
  });
});
