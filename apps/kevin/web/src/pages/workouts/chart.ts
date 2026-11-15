// Scaling for the hand-rolled progress chart: round axis ticks, and points
// placed in a plot box. Pure, so the arithmetic is tested without a DOM.

/** A step from the 1-2-2.5-5-10 family that gives about `count` ticks over `span`. */
export function niceStep(span: number, count = 4): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

export interface Axis {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * A y axis that contains every value with round ticks. The axis does not
 * start at zero: a lift going 185 to 205 should fill the plot, and these are
 * lines, not bars. A flat series still gets a band around it.
 */
export function axisFor(values: number[], count = 4): Axis {
  const vs = values.filter((v) => Number.isFinite(v));
  if (!vs.length) return { min: 0, max: 1, ticks: [0, 1] };
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const s = niceStep(hi - lo, count);
  const min = Math.floor(lo / s + 1e-9) * s;
  const max = Math.ceil(hi / s - 1e-9) * s;
  const ticks: number[] = [];
  for (let i = 0; min + i * s <= max + s * 1e-6; i++) ticks.push(Math.round((min + i * s) * 1e6) / 1e6);
  return { min, max, ticks };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** x for the i-th of n evenly spaced points; a single point sits in the middle. */
export function xAt(i: number, n: number, box: Box): number {
  return n <= 1 ? box.left + box.width / 2 : box.left + (i / (n - 1)) * box.width;
}

/** y for a value; larger values are higher on the screen unless `invert` (pace: faster is up). */
export function yAt(v: number, axis: Axis, box: Box, invert = false): number {
  const t = axis.max === axis.min ? 0.5 : (v - axis.min) / (axis.max - axis.min);
  return box.top + (invert ? t : 1 - t) * box.height;
}

export interface Pt {
  i: number;
  x: number;
  y: number;
  v: number;
}

/** The plotted points of one series; sessions where it has no value are skipped and the line runs across them. */
export function points(values: (number | null)[], axis: Axis, box: Box, invert = false): Pt[] {
  const out: Pt[] = [];
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) out.push({ i, x: xAt(i, values.length, box), y: yAt(v, axis, box, invert), v });
  });
  return out;
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/** An SVG path through the points. */
export function linePath(pts: Pt[]): string {
  return pts.map((p, k) => `${k ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join(' ');
}

/** The index of the point nearest to x: where a finger or the pointer is. */
export function nearestIndex(x: number, n: number, box: Box): number {
  if (n <= 1) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(((x - box.left) / box.width) * (n - 1))));
}

/** Indices to label on the x axis: first, last, and evenly between, at most `max` and never crowded. */
export function labelIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const k = Math.max(2, Math.min(max, n));
  return [...new Set(Array.from({ length: k }, (_x, i) => Math.round((i * (n - 1)) / (k - 1))))];
}
