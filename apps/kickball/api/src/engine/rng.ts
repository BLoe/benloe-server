/**
 * A tiny seeded pseudo-random number generator.
 *
 * Every optimizer in this app is randomized (Monte Carlo simulation, local
 * search restarts, tie-breaking). Seeding them means a given game generates the
 * same lineup twice in a row, and means the unit tests are deterministic.
 *
 * mulberry32: 32-bit state, good enough statistically for simulation work and
 * short enough to verify by eye.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? Rng.hashString(seed) : seed >>> 0;
    // A zero state produces a degenerate stream; nudge it off zero.
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** FNV-1a, so string seeds like a game slug spread across the 32-bit space. */
  static hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a new array, Fisher-Yates shuffled. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Picks one element uniformly. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called on an empty array');
    return items[this.int(items.length)];
  }

  /**
   * Picks an index with probability proportional to its weight.
   * Negative weights are treated as zero. Returns -1 if every weight is zero.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
