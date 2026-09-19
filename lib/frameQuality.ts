/**
 * frameQuality.ts — is this camera frame worth reading, and what should the
 * user change if not.
 *
 * Pure, and in its own file, because the first version of this shipped inside
 * the scanner component and silently broke the entire feature.
 *
 * What went wrong is worth recording. The crop routine padded each band with a
 * white quiet zone for Tesseract's benefit, and the grader then counted
 * every pixel at or above luma 250 across the *whole* canvas — including that
 * border, which is pure white by construction. At 1080p the border alone was
 * 13.5% of the counted pixels against a 6% limit, and at 480p it was 20%. Glare
 * therefore tripped on every frame at every resolution, the reader returned
 * early every time, and OCR never ran at all. The feature looked like it was
 * scanning and could never produce a result.
 *
 * Two design rules came out of that, and they matter more than the thresholds:
 *
 *   1. Grade the pixels that will actually be read — the interior, before any
 *      contrast stretch. Stretching maps the brightest pixel to 255 by
 *      definition, so grading afterwards measures the stretch rather than the
 *      frame.
 *   2. Guidance never blocks a read. This returns advice, and the caller runs
 *      OCR regardless. A miscalibrated threshold should cost a helpful sentence,
 *      never the whole feature — which is exactly the failure above, and the
 *      shape of failure worth designing out rather than re-tuning.
 */

/** Pixels at or above this are blown out rather than merely bright. */
export const GLARE_LUMA = 250;

/**
 * Share of blown-out pixels that earns a glare warning.
 *
 * Looser than the 2% a document scanner uses, because a holofoil legitimately
 * sparkles and a card is not a sheet of paper. It is advice, not a gate.
 */
export const GLARE_WARN_RATIO = 0.12;

/** Variance of the Laplacian below which the frame is too soft to read. */
export const BLUR_WARN_VARIANCE = 60;

export type FrameGrade = {
  /** Fraction of interior pixels blown out, 0–1. */
  glare: number;
  /** Variance of the Laplacian — higher is sharper. */
  sharpness: number;
  /** What to tell the user, or null when the frame looks fine. */
  advice: string | null;
};

/**
 * Grade a grayscale buffer.
 *
 * `gray` holds one byte per pixel for a `width` x `height` region — the crop
 * interior only, with no padding, and before any contrast stretch.
 */
export function gradeFrame(
  gray: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number
): FrameGrade {
  if (width < 3 || height < 3 || gray.length < width * height) {
    return { glare: 0, sharpness: 0, advice: null };
  }

  let blown = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;

  // Interior only: a Laplacian needs all four neighbours, and the edge ring
  // would otherwise be measured against pixels that do not exist.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (gray[i] >= GLARE_LUMA) blown += 1;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }

  if (n === 0) return { glare: 0, sharpness: 0, advice: null };

  const glare = blown / n;
  const sharpness = sumSq / n - (sum / n) ** 2;

  // Glare first: it is the more actionable of the two, and a blown-out band
  // also reads as soft, so reporting blur there would send the user to fix the
  // wrong thing.
  let advice: string | null = null;
  if (glare > GLARE_WARN_RATIO) advice = "Tilt the card away from the light.";
  else if (sharpness < BLUR_WARN_VARIANCE) advice = "Hold steadier, or move closer.";

  return { glare, sharpness, advice };
}

/**
 * Contrast-stretch endpoints from the 2nd and 98th percentiles.
 *
 * Not the plain minimum and maximum. One specular pixel pins the maximum and
 * one shadowed pixel pins the minimum, so a single glare spot flattens the
 * whole band into the middle of the range and the text goes with it. Clipping
 * the extremes costs 4% of the pixels and keeps the other 96% legible.
 */
export function stretchRange(
  gray: Uint8ClampedArray | Uint8Array | number[],
  length: number
): { low: number; high: number } {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < length; i += 1) histogram[gray[i] | 0] += 1;

  const cutoff = Math.floor(length * 0.02);
  let low = 0;
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += histogram[v];
    if (seen > cutoff) {
      low = v;
      break;
    }
  }

  let high = 255;
  seen = 0;
  for (let v = 255; v >= 0; v -= 1) {
    seen += histogram[v];
    if (seen > cutoff) {
      high = v;
      break;
    }
  }

  // A flat band gives low === high; the caller must not divide by zero.
  if (high <= low) return { low: 0, high: 255 };
  return { low, high };
}
