// A key's bitting (its cuts) is read from a trader's head hash, so the shape shown is real data.

/** The 12 hex digits a short hash prints (first 8 and last 4). Each digit is one cut, 0 shallow to f deep. */
export const CUT_COUNT = 12;

/** An uncut blank (all zeros) when there is no hash yet. */
export function cutsOf(hash: string | null | undefined): number[] {
  const digits = hash && hash.length >= CUT_COUNT ? hash.slice(0, 8) + hash.slice(-4) : "";
  return Array.from({ length: CUT_COUNT }, (_, i) => parseInt(digits[i] ?? "0", 16) || 0);
}

type Edge = { x0: number; x1: number; top: number; step: number; root: number };

/** SVG path commands for the cut edge, left to right: flat roots joined by crests, as on a real key. */
export function cutEdge(cuts: number[], { x0, x1, top, step, root }: Edge): string {
  const pitch = (x1 - x0) / cuts.length;
  let d = "";
  cuts.forEach((cut, i) => {
    const centre = x0 + pitch * (i + 0.5);
    const y = top + cut * step;
    d += ` L${(centre - root).toFixed(1)} ${y.toFixed(1)} L${(centre + root).toFixed(1)} ${y.toFixed(1)}`;
    const next = cuts[i + 1];
    if (next !== undefined) {
      const crest = Math.max(top, Math.min(y, top + next * step) - (pitch / 2 - root) * 0.9);
      d += ` L${(centre + pitch / 2).toFixed(1)} ${crest.toFixed(1)}`;
    }
  });
  return d;
}
