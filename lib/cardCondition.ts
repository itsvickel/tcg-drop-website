/**
 * cardCondition.ts — what a played copy is worth.
 *
 * The scanner reports a market reference, and a market reference is for a Near
 * Mint card. Most cards coming out of a binder are not Near Mint, so a stack
 * total built from market prices is systematically too high — and the error is
 * largest on exactly the expensive cards where it matters.
 *
 * The multipliers are trade conventions, not measurements. Shops price played
 * copies in roughly these bands and individual cards vary either side of them,
 * so this is an estimate and the UI says so. It is a far better estimate than
 * pretending every card is mint, which is what not having this at all amounted
 * to.
 *
 * Deliberately not sourced from the price feed: TCGplayer does publish
 * per-condition prices, but only for listings that exist, so a card with no
 * played copy for sale would have no played price and would silently fall back
 * to mint. A stated convention applied uniformly is more honest than a figure
 * that is sometimes real and sometimes not, with no way to tell which.
 */

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

export type Condition = (typeof CONDITIONS)[number];

export const DEFAULT_CONDITION: Condition = "NM";

/** What each grade is called, for a control that has to be readable at a glance. */
export const CONDITION_LABELS: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

/**
 * Share of the Near Mint price a grade typically fetches.
 *
 * Conventional trade bands. Rounded to the nearest 5% because any more
 * precision would imply a measurement that has not been made.
 */
export const CONDITION_MULTIPLIER: Record<Condition, number> = {
  NM: 1,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.35,
};

/** Whether a stored value is a grade we know. */
export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/**
 * A card's estimated value at a grade.
 *
 * Returns null when there is no market price to scale — an unknown price
 * multiplied by anything is still unknown, and returning zero would quietly
 * drag a stack total down.
 */
export function valueAtCondition(
  marketCad: number | null | undefined,
  condition: Condition = DEFAULT_CONDITION
): number | null {
  const exact = exactValueAtCondition(marketCad, condition);
  return exact === null ? null : Math.round(exact * 100) / 100;
}

/**
 * The same figure, unrounded, for adding up.
 *
 * Rounding each card to cents before summing drifts: sixty half-cent commons
 * round to a cent apiece and a 30-cent pile reports as 60 cents. Displays round
 * once, at the point of display; totals round once, at the end.
 */
export function exactValueAtCondition(
  marketCad: number | null | undefined,
  condition: Condition = DEFAULT_CONDITION
): number | null {
  if (typeof marketCad !== "number" || !Number.isFinite(marketCad) || marketCad <= 0) {
    return null;
  }
  return marketCad * CONDITION_MULTIPLIER[condition];
}
