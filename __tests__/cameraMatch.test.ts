/**
 * What the scanner does with a real card in front of a real camera.
 *
 * The other fingerprint test proves the browser and Python compute the same
 * bits. That is necessary and says nothing about whether the thresholds are any
 * good — two implementations can agree perfectly on a number that is useless.
 *
 * So this works from twenty real cards' published artwork, degraded the way a
 * phone degrades it: downscaled, blurred, under- and over-exposed, rotated a
 * couple of degrees, mis-framed by 3%, and JPEG-compressed to 45% quality. Each
 * one was fingerprinted through the same six candidate crops the scanner uses,
 * and the results are matched here against a table of three thousand real
 * cards.
 *
 * The property that matters most is the last one. A scanner that declines is a
 * scanner that reads the title instead; a scanner that confidently names the
 * wrong card puts a $1.78 price on a $95 card, and the user has no way to know.
 * So the bar on wrong-and-confident is zero, not "low".
 */
import fixture from "./fixtures/cameraFrames.json";
import { isArtConfident, matchArt, parseHashTable } from "../lib/artHash";

const table = parseHashTable(fixture.table);

type Case = { id: string; name: string; kind: string; probes: string[] };
const cases = fixture.cases as Case[];

/**
 * Resolved once per case and shared.
 *
 * Each call scans three thousand cards, and Jest's VM sandbox runs that a good
 * deal slower than a browser does. Re-resolving inside every assertion took
 * this file to twelve seconds on its own.
 */
const resolved = new Map<Case, { match: ReturnType<typeof matchArt>; correct: boolean; confident: boolean }>();
const resolve = (c: Case) => {
  let hit = resolved.get(c);
  if (!hit) {
    const match = matchArt(table, c.probes);
    hit = { match, correct: match?.id === c.id, confident: isArtConfident(match) };
    resolved.set(c, hit);
  }
  return hit;
};

describe("matching a degraded camera frame", () => {
  it("loaded a table big enough for the result to mean something", () => {
    expect(table.ids.length).toBeGreaterThan(2500);
    expect(cases.length).toBe(160);
  });

  it("never accepts the wrong card", () => {
    // The one non-negotiable. Everything else here is a quality bar; this is a
    // correctness bar, because a confident wrong answer is indistinguishable
    // from a right one to the person holding the card.
    const wrong = cases.filter((c) => {
      const { correct, confident } = resolve(c);
      return confident && !correct;
    });
    expect(wrong.map((c) => `${c.name} (${c.kind})`)).toEqual([]);
  });

  it("returns the right card for the overwhelming majority of frames", () => {
    const correct = cases.filter((c) => resolve(c).correct).length;
    // Measured at 156/160. The four it misses are two cards that share their
    // artwork with another printing, under the two harshest conditions.
    expect(correct).toBeGreaterThanOrEqual(150);
  });

  it("accepts most frames outright, so the scanner rarely needs OCR", () => {
    const accepted = cases.filter((c) => {
      const { correct, confident } = resolve(c);
      return correct && confident;
    }).length;
    // Measured at 142/160, and that is per *frame*. The scanner reads about
    // four a second and requires two to agree, so a card that is accepted on
    // 89% of frames is recognised almost immediately.
    expect(accepted).toBeGreaterThanOrEqual(135);
  });

  it("handles ordinary conditions nearly perfectly", () => {
    // Blur, dim light and JPEG artefacts are what a phone actually produces;
    // over-exposure and a 3% mis-frame are the hard cases and are allowed to
    // degrade. Separating them keeps a regression in the common path from
    // hiding behind slack left for the uncommon one.
    for (const kind of ["clean", "blur", "dim", "lowcontrast", "jpeg"]) {
      const rs = cases.filter((c) => c.kind === kind);
      expect(rs.length).toBe(20);
      const correct = rs.filter((c) => resolve(c).correct).length;
      expect(`${kind}: ${correct}/20`).toBe(`${kind}: 20/20`);
    }
  });

  it("declines rather than guesses when two printings share artwork", () => {
    // 2.2% of the catalogue has a twin within the margin threshold. The picture
    // genuinely cannot separate those, and the collector number is what does.
    // What must not happen is picking one of them and sounding sure.
    const ambiguous = cases.filter((c) => {
      const { match, correct } = resolve(c);
      return correct && match!.distance <= 2 && match!.margin < 4;
    });
    for (const c of ambiguous) expect(isArtConfident(resolve(c).match)).toBe(false);
  });
});
