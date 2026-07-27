import { describe, it, expect } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, () => new Rng(1).next());
    const b = Array.from({ length: 20 }, () => new Rng(2).next());
    expect(a).not.toEqual(b);
  });

  it('hashes string seeds deterministically and distinctly', () => {
    expect(Rng.hashString('week-3')).toBe(Rng.hashString('week-3'));
    expect(Rng.hashString('week-3')).not.toBe(Rng.hashString('week-4'));
  });

  it('survives a zero seed', () => {
    const rng = new Rng(0);
    const values = Array.from({ length: 10 }, () => rng.next());
    expect(new Set(values).size).toBe(10);
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = new Rng(99);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]++;
    for (const count of buckets) {
      // Each bucket should hold about 10%; allow a generous 1.5% drift.
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.015);
    }
  });

  it('int() stays in range', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle keeps every element and does not mutate the input', () => {
    const rng = new Rng(11);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
  });

  it('shuffle actually reorders over repeated draws', () => {
    const rng = new Rng(5);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const seen = new Set(Array.from({ length: 50 }, () => rng.shuffle(input).join(',')));
    expect(seen.size).toBeGreaterThan(40);
  });

  it('pick throws on an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });

  it('weightedIndex respects the weights', () => {
    const rng = new Rng(123);
    const weights = [1, 3, 0];
    const counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) counts[rng.weightedIndex(weights)]++;
    expect(counts[2]).toBe(0);
    expect(counts[1] / counts[0]).toBeGreaterThan(2.7);
    expect(counts[1] / counts[0]).toBeLessThan(3.3);
  });

  it('weightedIndex returns -1 when there is nothing to pick', () => {
    expect(new Rng(1).weightedIndex([0, 0, 0])).toBe(-1);
    expect(new Rng(1).weightedIndex([])).toBe(-1);
  });

  it('weightedIndex ignores negative weights', () => {
    const rng = new Rng(8);
    const counts = [0, 0];
    for (let i = 0; i < 1000; i++) counts[rng.weightedIndex([-5, 1])]++;
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBe(1000);
  });
});
