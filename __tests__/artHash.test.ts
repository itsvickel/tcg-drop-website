/**
 * Card artwork fingerprinting.
 *
 * The first block is the one that matters: the fingerprints computed here must
 * be bit-identical to the ones `art_hash.py` computes over the publisher's
 * reference images. If they drift apart, nothing throws and nothing looks
 * wrong — every match is simply a little further away than it should be, and
 * the thresholds quietly stop meaning what they were measured to mean. The
 * fixture carries hashes produced by the Python side, so a divergence fails
 * here instead of degrading silently in the field.
 */
import fixture from "./fixtures/artHash.json";
import {
  ART_BOX,
  EMPTY_HASH_TABLE,
  hamming,
  hashCardRegion,
  HASH_SIZE,
  isArtConfident,
  matchArt,
  MAX_ART_DISTANCE,
  parseHashTable,
  OFFSET_BOXES,
  type HashTable,
} from "../lib/artHash";

/** The same deterministic pattern the fixture generator used in Python. */
function synthetic(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let i = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba[i++] = (x * 7 + y * 13) % 256;
      rgba[i++] = (x * 3 + y * 29) % 256;
      rgba[i++] = (x * 17 + y * 5) % 256;
      rgba[i++] = 255;
    }
  }
  return rgba;
}

function wholeCard(width: number, height: number) {
  return { x: 0, y: 0, w: width, h: height };
}

describe("agreement with the Python reference implementation", () => {
  it("matches the algorithm's declared parameters", () => {
    expect(HASH_SIZE).toBe(fixture.size);
    expect([...ART_BOX]).toEqual(fixture.artBox);
  });

  for (const testCase of fixture.cases) {
    it(`produces Python's hash for the ${testCase.kind} ${testCase.width}x${testCase.height} buffer`, () => {
      const { width, height } = testCase;
      const rgba =
        testCase.kind === "card"
          ? new Uint8ClampedArray(Buffer.from(testCase.rgbaBase64!, "base64"))
          : synthetic(width, height);

      expect(hashCardRegion(rgba, width, height, wholeCard(width, height))).toBe(
        testCase.hash
      );
    });
  }
});

describe("hashCardRegion", () => {
  it("returns a hash of the declared width", () => {
    const rgba = synthetic(120, 165);
    // 64 bits is 16 hex characters.
    expect(hashCardRegion(rgba, 120, 165, wholeCard(120, 165))).toHaveLength(
      (HASH_SIZE * HASH_SIZE) / 4
    );
  });

  it("is stable across resolution", () => {
    // The reference images are 245x337 and a camera crop is whatever the phone
    // gives, so a fingerprint that moved with resolution would be useless.
    // Measured on real cards: 0-3 bits between 98px and 600px wide.
    //
    // Tested on a smooth gradient rather than the synthetic pattern above.
    // That pattern is per-pixel modulo arithmetic, so it aliases completely
    // differently at each scale — it is a fine fixture for checking two
    // implementations agree on identical pixels, and a meaningless one for
    // resampling stability, which is a property of photographs.
    const gradient = (w: number, h: number) => {
      const rgba = new Uint8ClampedArray(w * h * 4);
      let i = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const v = Math.round((x / w) * 160 + (y / h) * 80);
          rgba[i++] = v;
          rgba[i++] = 255 - v;
          rgba[i++] = (v * 2) % 255;
          rgba[i++] = 255;
        }
      }
      return rgba;
    };
    const small = hashCardRegion(gradient(120, 165), 120, 165, wholeCard(120, 165));
    const large = hashCardRegion(gradient(480, 660), 480, 660, wholeCard(480, 660));
    expect(hamming(small, large)).toBeLessThanOrEqual(6);
  });

  it("refuses a region too small to sample", () => {
    expect(hashCardRegion(synthetic(10, 10), 10, 10, wholeCard(10, 10))).toBe("");
  });

  it("refuses a region outside the buffer", () => {
    const rgba = synthetic(100, 100);
    expect(hashCardRegion(rgba, 100, 100, { x: 80, y: 80, w: 100, h: 100 })).toBe("");
    expect(hashCardRegion(rgba, 100, 100, { x: -10, y: 0, w: 50, h: 50 })).toBe("");
  });

  it("offers several crops to absorb framing drift", () => {
    expect(OFFSET_BOXES[0]).toEqual(ART_BOX);
    expect(OFFSET_BOXES.length).toBeGreaterThan(3);
  });
});

describe("hamming", () => {
  it("counts differing bits past 32, where bitwise operators truncate", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
    // A single bit in the top half — the region a naive implementation loses.
    expect(hamming("8000000000000000", "0000000000000000")).toBe(1);
  });

  it("refuses to compare mismatched or missing hashes", () => {
    expect(hamming("abcd", "")).toBe(Number.MAX_SAFE_INTEGER);
    expect(hamming("abcd", "abcdef")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("parseHashTable", () => {
  it("refuses a table built with a different hash size", () => {
    // Matching 64-bit fingerprints against 128-bit ones would not throw; it
    // would just return confident nonsense.
    const wrong = parseHashTable({ ids: ["a"], packed: "0".repeat(32), size: 16 });
    expect(wrong.ids).toHaveLength(0);
  });

  it("refuses a truncated table", () => {
    expect(parseHashTable({ ids: ["a", "b"], packed: "0".repeat(16), size: HASH_SIZE }).ids)
      .toHaveLength(0);
  });

  it("refuses nothing at all", () => {
    expect(parseHashTable(null).ids).toHaveLength(0);
  });
});

describe("matchArt", () => {
  const table: HashTable = parseHashTable({
    size: HASH_SIZE,
    ids: ["set-1", "set-2", "set-3"],
    packed:
      "0000000000000000" +
      "ffffffffffffffff" +
      // Three bits from set-1: a different printing of the same artwork.
      "0000000000000007",
  });

  it("finds the closest card", () => {
    const match = matchArt(table, ["0000000000000001"]);
    expect(match?.id).toBe("set-1");
    expect(match?.distance).toBe(1);
  });

  it("reports the margin to the runner-up", () => {
    // set-1 and set-3 are three bits apart, so a query near both has a small
    // margin — which is the signal that the picture alone cannot choose.
    const match = matchArt(table, ["0000000000000003"]);
    expect(match!.margin).toBeLessThanOrEqual(2);
  });

  it("keeps the best result across several candidate crops", () => {
    const match = matchArt(table, ["ffffffffffffff00", "0000000000000000"]);
    expect(match?.id).toBe("set-1");
    expect(match?.distance).toBe(0);
  });

  it("handles an empty table and empty queries", () => {
    expect(matchArt(EMPTY_HASH_TABLE, ["0000000000000000"])).toBeNull();
    expect(matchArt(table, [])).toBeNull();
    expect(matchArt(table, ["", ""])).toBeNull();
  });

  it("scans the whole catalogue fast enough to run per frame", () => {
    // 22,000 cards and six candidate crops is the real shape of a frame — an
    // earlier version of this test used a single probe and so measured a sixth
    // of the work.
    //
    // The bound is generous for a reason worth writing down. This same loop,
    // on this same table, measures 1.5ms under plain Node and 108ms under Jest:
    // the sandbox evaluates modules in a VM context where V8 does not tier up
    // the hot loop the way a browser does. So the number here says nothing
    // about the real cost — which is benchmarked separately at 2.2ms for the
    // match and about 4ms to produce the probes, or roughly 6ms a frame. What
    // this test is for is catching an order-of-magnitude regression, such as
    // the matcher going back to comparing a byte at a time, and a 70x
    // environment penalty leaves plenty of room for that.
    const ids: string[] = [];
    let packed = "";
    for (let i = 0; i < 22000; i += 1) {
      ids.push(`card-${i}`);
      packed += (BigInt(i) * 2654435761n % (2n ** 64n)).toString(16).padStart(16, "0");
    }
    const big = parseHashTable({ ids, packed, size: HASH_SIZE });
    expect(big.ids).toHaveLength(22000);

    const probes = [
      "0123456789abcdef", "0123456789abcdee", "0123456789abcdec",
      "fedcba9876543210", "fedcba9876543211", "fedcba9876543213",
    ];
    // Warmed first: the scanner runs this continuously, so a cold first call
    // is not the cost anyone pays.
    for (let i = 0; i < 5; i += 1) matchArt(big, probes);

    const t0 = Date.now();
    for (let i = 0; i < 10; i += 1) matchArt(big, probes);
    expect((Date.now() - t0) / 10).toBeLessThan(250);
  });
});

describe("isArtConfident", () => {
  it("accepts a close, unambiguous match", () => {
    expect(isArtConfident({ id: "x", distance: 4, margin: 20 })).toBe(true);
  });

  it("refuses a distant match", () => {
    // Different cards measured 19 bits apart at the closest, so anything past
    // the threshold is more likely a coincidence than a card.
    expect(isArtConfident({ id: "x", distance: 18, margin: 20 })).toBe(false);
    expect(MAX_ART_DISTANCE).toBeLessThan(19);
  });

  it("refuses two printings that share artwork", () => {
    // Close to both, so the picture cannot choose between them. The collector
    // number decides that, not the art.
    expect(isArtConfident({ id: "x", distance: 3, margin: 1 })).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isArtConfident(null)).toBe(false);
  });
});
