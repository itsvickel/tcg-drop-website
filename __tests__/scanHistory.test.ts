/**
 * Scan history.
 *
 * The behaviour worth pinning is not "it stores things" — it is what happens
 * when storage misbehaves. This runs on phones, in private windows, with site
 * data blocked and quotas already spent, and the page's actual job is to price
 * a card. Losing the history list is acceptable; taking the page down with it
 * is not.
 */
import {
  addToHistory,
  historyValue,
  clearHistory,
  entryKey,
  loadHistory,
  MAX_HISTORY,
  relativeTime,
  type ScanHistoryEntry,
} from "../lib/scanHistory";

/** A localStorage good enough to test against, with failures on demand. */
function fakeStorage(opts: { throwOnWrite?: boolean; throwOnRead?: boolean } = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts.throwOnRead) throw new Error("blocked");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnWrite) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
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
  marketCad: 503.82,
  at: 1_700_000_000_000,
  ...over,
});

describe("loadHistory", () => {
  it("is empty before anything is stored", () => {
    expect(loadHistory(fakeStorage())).toEqual([]);
  });

  it("survives storage that throws on read", () => {
    // Private windows and blocked site data both do this. The page must render.
    expect(loadHistory(fakeStorage({ throwOnRead: true }))).toEqual([]);
  });

  it("survives contents that are not what we wrote", () => {
    const store = fakeStorage();
    store.setItem("tcgdrop.scanHistory.v1", "{ not json");
    expect(loadHistory(store)).toEqual([]);
  });

  it("drops entries that are missing what a row needs to render", () => {
    // An older build's shape, or something else writing to the key. Half a row
    // is worse than no row.
    const store = fakeStorage();
    store.setItem(
      "tcgdrop.scanHistory.v1",
      JSON.stringify([card(), { name: "no timestamp" }, null, 42])
    );
    expect(loadHistory(store)).toHaveLength(1);
  });
});

describe("addToHistory", () => {
  it("puts the newest scan first", () => {
    const store = fakeStorage();
    addToHistory(card({ name: "First" }), store);
    const list = addToHistory(card({ name: "Second", hash: "ffff" }), store);
    expect(list.map((e) => e.name)).toEqual(["Second", "First"]);
  });

  it("moves a re-scanned card to the top instead of duplicating it", () => {
    // Scanning the same card twice is how people check they read it right.
    const store = fakeStorage();
    addToHistory(card({ name: "Charizard ex" }), store);
    addToHistory(card({ name: "Pikachu", hash: "aaaa" }), store);
    const list = addToHistory(card({ name: "Charizard ex", at: 1_700_000_001_000 }), store);
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Charizard ex");
  });

  it("keeps a bounded list", () => {
    const store = fakeStorage();
    let list: ScanHistoryEntry[] = [];
    for (let i = 0; i < MAX_HISTORY + 15; i += 1) {
      list = addToHistory(card({ hash: `hash-${i}`, name: `Card ${i}` }), store);
    }
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].name).toBe(`Card ${MAX_HISTORY + 14}`);
  });

  it("still returns a correct list when the write fails", () => {
    // A spent quota must not make the scan look like it did not happen.
    const store = fakeStorage({ throwOnWrite: true });
    const list = addToHistory(card(), store);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Charizard ex");
  });
});

describe("entryKey", () => {
  it("identifies a pinned scan by its fingerprint", () => {
    expect(entryKey(card({ hash: "abc" }))).toBe("abc");
  });

  it("identifies an ambiguous scan by the whole tie set", () => {
    // Two reprints of one artwork are the same scan; a different tie set is a
    // different card and must not overwrite it.
    expect(entryKey(card({ hash: undefined, hashes: ["a", "b"] }))).toBe("a,b");
  });

  it("falls back to the game and the search term", () => {
    const typed = card({ hash: undefined, hashes: undefined, query: "Pikachu 25/102" });
    expect(entryKey(typed)).toBe("pokemon:Pikachu 25/102");
  });

  it("keeps the same card in two games apart", () => {
    const a = card({ hash: undefined, query: "Lightning Bolt", tcg: "mtg" });
    const b = card({ hash: undefined, query: "Lightning Bolt", tcg: "pokemon" });
    expect(entryKey(a)).not.toBe(entryKey(b));
  });
});

describe("clearHistory", () => {
  it("forgets everything", () => {
    const store = fakeStorage();
    addToHistory(card(), store);
    expect(clearHistory(store)).toEqual([]);
    expect(loadHistory(store)).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;
  it("reads naturally at every scale", () => {
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 6 * 60_000, now)).toBe("6 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });

  it("does not say a scan happened in the future", () => {
    // Clock skew, or a device whose time was corrected between scans.
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});

describe("historyValue", () => {
  it("adds up what it knows and counts what it does not", () => {
    // A fifth of the catalogue has no published price. Summing the rest
    // silently would report a stack as cheaper than it is, with nothing on
    // screen to explain the gap.
    const value = historyValue([
      card({ marketCad: 503.82 }),
      card({ marketCad: 12.5 }),
      card({ marketCad: null }),
    ]);
    expect(value).toEqual({ totalCad: 516.32, priced: 2, unpriced: 1 });
  });

  it("treats a zero price as unknown, not as free", () => {
    expect(historyValue([card({ marketCad: 0 })])).toEqual({
      totalCad: 0,
      priced: 0,
      unpriced: 1,
    });
  });

  it("does not drift over a long list", () => {
    // Rounding each row before adding loses a cent every few cards.
    const entries = Array.from({ length: 60 }, () => card({ marketCad: 0.005 }));
    expect(historyValue(entries).totalCad).toBe(0.3);
  });

  it("is zero for an empty history", () => {
    expect(historyValue([])).toEqual({ totalCad: 0, priced: 0, unpriced: 0 });
  });
});
