const EXPLICIT_RE  = /(\d+)\s*[-–]?\s*(?:booster\s*)?packs?/i;
const EXPLICIT2_RE = /(\d+)\s*[-–]?\s*boosters?\b/i;

const KNOWN: Array<[RegExp, number]> = [
  [/booster\s*box|\bbbox\b/i,                           36],
  [/elite\s*trainer\s*box|\betb\b/i,                     9],
  [/build\s*[&+]\s*battle/i,                             4],
  [/mini\s*tin/i,                                        2],
  [/checklane|blister/i,                                 3],
  [/booster\s*bundle/i,                                  3],
  [/half\s*(?:booster\s*)?box/i,                        18],
];

export function computePackCount(name: string): number | null {
  let m = EXPLICIT_RE.exec(name) ?? EXPLICIT2_RE.exec(name);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 1) return n;
  }
  for (const [re, count] of KNOWN) {
    if (re.test(name)) return count;
  }
  return null;
}
