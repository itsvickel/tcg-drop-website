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
  hashPhoto,
  HASH_SIZE,
  artOutcome,
  isArtConfident,
  matchArt,
  MAX_ART_DISTANCE,
  parseHashTable,
  OFFSET_BOXES,
  photoCardRects,
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
    const wrong = parseHashTable({ packed: "0".repeat(32), size: 16 });
    expect(wrong.count).toBe(0);
  });

  it("refuses a table that does not divide into whole fingerprints", () => {
    // A truncated download would otherwise leave a partial fingerprint at the
    // end and match against whatever the padding happened to be.
    expect(parseHashTable({ packed: "0".repeat(24), size: HASH_SIZE }).count).toBe(0);
  });

  it("counts whole fingerprints", () => {
    expect(parseHashTable({ packed: "0".repeat(48), size: HASH_SIZE }).count).toBe(3);
  });

  it("refuses nothing at all", () => {
    expect(parseHashTable(null).count).toBe(0);
    expect(parseHashTable({ packed: "", size: HASH_SIZE }).count).toBe(0);
  });
});

describe("matchArt", () => {
  const A = "0000000000000000";
  const B = "ffffffffffffffff";
  // Three bits from A: a different printing of the same artwork.
  const C = "0000000000000007";
  const table: HashTable = parseHashTable({ size: HASH_SIZE, packed: A + B + C });

  it("finds the closest fingerprint", () => {
    const match = matchArt(table, ["0000000000000001"]);
    expect(match?.hash).toBe(A);
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
    expect(match?.hash).toBe(A);
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
    let packed = "";
    for (let i = 0; i < 22000; i += 1) {
      packed += (BigInt(i) * 2654435761n % (2n ** 64n)).toString(16).padStart(16, "0");
    }
    const big = parseHashTable({ packed, size: HASH_SIZE });
    expect(big.count).toBe(22000);

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

describe("artOutcome", () => {
  it("pins a close, unambiguous match", () => {
    expect(artOutcome({ hash: "x000000000000000", distance: 2, margin: 14, ties: ["x000000000000000"] })).toBe("pinned");
  });

  it("calls two printings of one artwork ambiguous, not a failure", () => {
    // The case this was built for. A real Applin matched its own reference at
    // 1 bit, the Stellar Crown printing at 2, and everything else at 16 — a
    // perfect read of the artwork that the margin rule was throwing away. The
    // right answer is to search the card by name, not to give up and try OCR.
    expect(artOutcome({ hash: "a000000000000000", distance: 1, margin: 1, ties: ["a000000000000000", "b000000000000000"] })).toBe("ambiguous");
  });

  it("gives up when nothing is close enough", () => {
    expect(artOutcome({ hash: "x000000000000000", distance: 20, margin: 9, ties: ["x000000000000000"] })).toBe("none");
    expect(artOutcome(null)).toBe("none");
  });

  it("gives up on a narrow margin with nothing to expand to", () => {
    // A thin margin and only one candidate is a doubtful match, not a reprint.
    expect(artOutcome({ hash: "x000000000000000", distance: 8, margin: 1, ties: ["x000000000000000"] })).toBe("none");
  });
});

describe("matchArt ties", () => {
  it("reports every fingerprint within the margin of the winner", () => {
    const near1 = "0000000000000000";
    const near2 = "0000000000000003";
    const far = "ffffffffffffffff";
    const table = parseHashTable({ size: HASH_SIZE, packed: near1 + near2 + far });
    const match = matchArt(table, [near1]);
    expect(match!.ties.sort()).toEqual([near1, near2].sort());
    expect(match!.ties).not.toContain(far);
  });

  it("does not repeat a fingerprint two cards happen to share", () => {
    // Duplicates are real — about 2% of the Pokemon catalogue — and a repeated
    // fingerprint in the tie list tells the server nothing it does not already
    // know, since it expands one fingerprint to every card holding it.
    const dup = "0000000000000000";
    const table = parseHashTable({ size: HASH_SIZE, packed: dup + dup + "ffffffffffffffff" });
    expect(matchArt(table, [dup])!.ties).toEqual([dup]);
  });
});

describe("isArtConfident", () => {
  it("accepts a close, unambiguous match", () => {
    expect(isArtConfident({ hash: "x000000000000000", distance: 4, margin: 20, ties: ["x000000000000000"] })).toBe(true);
  });

  it("refuses a distant match", () => {
    // Different cards measured 19 bits apart at the closest, so anything past
    // the threshold is more likely a coincidence than a card.
    expect(isArtConfident({ hash: "x000000000000000", distance: 18, margin: 20, ties: ["x000000000000000"] })).toBe(false);
    expect(MAX_ART_DISTANCE).toBeLessThan(19);
  });

  it("refuses two printings that share artwork", () => {
    // Close to both, so the picture cannot choose between them. The collector
    // number decides that, not the art.
    expect(isArtConfident({ hash: "x000000000000000", distance: 3, margin: 1, ties: ["x000000000000000", "y000000000000000"] })).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isArtConfident(null)).toBe(false);
  });
});

describe("photoCardRects", () => {
  /**
   * A photo is not a viewfinder. The camera crops to the on-screen guide so the
   * card fills the frame; a photo has a desk around it, and that difference is
   * total rather than gradual. Measured on real cards at 85% fill: nothing
   * matched against the whole frame, everything matched once these rectangles
   * were searched.
   */
  it("offers the whole frame first, then progressively smaller crops", () => {
    const rects = photoCardRects(800, 1000);
    expect(rects.length).toBeGreaterThan(3);
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i].h).toBeLessThan(rects[i - 1].h);
    }
  });

  it("keeps every rectangle card-shaped and centred", () => {
    for (const [w, h] of [[800, 1000], [1000, 800], [600, 600]]) {
      for (const r of photoCardRects(w, h)) {
        // 63mm x 88mm, within a pixel of rounding.
        expect(r.w / r.h).toBeCloseTo(63 / 88, 1);
        expect(Math.abs(r.x + r.w / 2 - w / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.y + r.h / 2 - h / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stays inside a landscape photo, which runs out of width first", () => {
    for (const r of photoCardRects(1200, 500)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1200);
      expect(r.y + r.h).toBeLessThanOrEqual(500);
    }
  });
});

describe("hashPhoto", () => {
  const frame = (w: number, h: number) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0, i = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1, i += 4) {
        const v = Math.round((x / w) * 200 + (y / h) * 55);
        rgba[i] = v; rgba[i + 1] = 255 - v; rgba[i + 2] = (v * 3) % 255; rgba[i + 3] = 255;
      }
    }
    return rgba;
  };

  it("produces a probe for the whole frame and for each search rectangle", () => {
    const probes = hashPhoto(frame(400, 560), 400, 560);
    expect(probes.length).toBe(OFFSET_BOXES.length + photoCardRects(400, 560).length);
    for (const p of probes) expect(p).toHaveLength((HASH_SIZE * HASH_SIZE) / 4);
  });

  it("drops rather than emits an unusable probe", () => {
    // A frame too small to sample must not contribute an empty string that the
    // matcher would then have to guard against.
    for (const p of hashPhoto(frame(40, 56), 40, 56)) expect(p).not.toBe("");
  });
});
