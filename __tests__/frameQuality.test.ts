/**
 * Frame grading.
 *
 * The first test is the one that matters. A padded white border counted as
 * glare made the grader complain on every frame at every resolution, the
 * scanner returned before calling OCR, and the whole feature was dead while
 * looking like it was working. Nothing here is theoretical — these are the
 * exact numbers that shipped.
 */
import {
  BLUR_WARN_VARIANCE,
  GLARE_LUMA,
  GLARE_WARN_RATIO,
  gradeFrame,
  stretchRange,
} from "../lib/frameQuality";

/** A band of flat mid-grey with `noise` amplitude, as a grayscale buffer. */
function band(width: number, height: number, level = 128, noise = 0): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = level + (noise ? (i % 2 ? noise : -noise) : 0);
  }
  return out;
}

describe("the bug this module exists for", () => {
  it("does not report glare on a frame whose only white is padding", () => {
    // The shipped grader was handed a 641x214 canvas with a 12px white border
    // and counted it: 18,238 of 135,468 pixels, 13.5%, against a 6% limit. It
    // tripped every time. Grading the interior alone is the fix, so a caller
    // that passes only the interior must come back clean.
    const width = 641 - 24;
    const height = 214 - 24;
    const grade = gradeFrame(band(width, height, 128, 40), width, height);

    expect(grade.glare).toBe(0);
    // null is the good answer here, and it is not a string, so normalise.
    expect(grade.advice ?? "").not.toMatch(/light/i);
  });

  it("reports glare only when the readable area really is blown out", () => {
    const width = 200;
    const height = 60;
    const pixels = band(width, height, 120, 30);
    // Blow out a quarter of it, well past the warning ratio.
    for (let i = 0; i < pixels.length / 4; i += 1) pixels[i] = 255;

    const grade = gradeFrame(pixels, width, height);
    expect(grade.glare).toBeGreaterThan(GLARE_WARN_RATIO);
    expect(grade.advice).toMatch(/light/i);
  });
});

describe("gradeFrame", () => {
  it("calls a flat frame blurry", () => {
    const grade = gradeFrame(band(120, 40, 128, 0), 120, 40);
    expect(grade.sharpness).toBeLessThan(BLUR_WARN_VARIANCE);
    expect(grade.advice).toMatch(/steadier/i);
  });

  it("passes a frame with real edge detail", () => {
    const width = 120;
    const height = 40;
    const pixels = new Uint8ClampedArray(width * height);
    // Vertical stripes: plenty of Laplacian energy, nothing blown out.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) pixels[y * width + x] = x % 6 < 3 ? 30 : 220;
    }
    const grade = gradeFrame(pixels, width, height);
    expect(grade.sharpness).toBeGreaterThan(BLUR_WARN_VARIANCE);
    expect(grade.advice).toBeNull();
  });

  it("prefers the glare advice when a frame is both blown out and soft", () => {
    // A blown-out band also reads as flat, and sending someone to hold steadier
    // when the problem is a ceiling light sends them to fix the wrong thing.
    const pixels = band(100, 40, 255, 0);
    const grade = gradeFrame(pixels, 100, 40);
    expect(grade.advice).toMatch(/light/i);
  });

  it("survives a degenerate buffer instead of throwing", () => {
    expect(gradeFrame(new Uint8ClampedArray(0), 0, 0).advice).toBeNull();
    expect(gradeFrame(new Uint8ClampedArray(4), 2, 2).advice).toBeNull();
  });

  it("counts the documented threshold", () => {
    const pixels = band(50, 50, GLARE_LUMA - 1, 0);
    expect(gradeFrame(pixels, 50, 50).glare).toBe(0);
  });
});

describe("stretchRange", () => {
  it("ignores the extremes so one specular pixel cannot flatten a band", () => {
    // 2,500 pixels of real range, plus a single blown-out speck. Taking the
    // plain maximum would stretch against 255 and wash the text out.
    const pixels = band(50, 50, 100, 20);
    pixels[0] = 255;
    pixels[1] = 0;

    const { low, high } = stretchRange(pixels, pixels.length);
    expect(high).toBeLessThan(255);
    expect(low).toBeGreaterThan(0);
  });

  it("returns a usable range for a perfectly flat band", () => {
    const pixels = band(20, 20, 128, 0);
    expect(stretchRange(pixels, pixels.length)).toEqual({ low: 0, high: 255 });
  });
});
