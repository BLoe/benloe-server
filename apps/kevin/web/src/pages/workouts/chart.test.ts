import { describe, expect, it } from 'vitest';
import { axisFor, labelIndices, linePath, nearestIndex, niceStep, points, xAt, yAt } from './chart';

const box = { left: 40, top: 10, width: 300, height: 200 };

describe('axis', () => {
  it('picks round steps', () => {
    expect(niceStep(20)).toBe(5);
    expect(niceStep(37)).toBe(10);
    expect(niceStep(3)).toBe(1);
    expect(niceStep(0.9)).toBe(0.25);
    expect(niceStep(0)).toBe(1);
  });
  it('contains the data with round ticks and does not start at zero', () => {
    const a = axisFor([185, 190, 197.5, 205]);
    expect(a.min).toBe(185);
    expect(a.max).toBe(205);
    expect(a.ticks).toEqual([185, 190, 195, 200, 205]);
    const b = axisFor([212, 239.2]);
    expect(b.min).toBeLessThanOrEqual(212);
    expect(b.max).toBeGreaterThanOrEqual(239.2);
    expect(b.ticks.every((t) => t % 10 === 0)).toBe(true);
  });
  it('gives a flat or empty series a band', () => {
    const a = axisFor([100, 100]);
    expect(a.min).toBeLessThan(100);
    expect(a.max).toBeGreaterThan(100);
    expect(axisFor([]).ticks.length).toBeGreaterThan(1);
  });
});

describe('placement', () => {
  const axis = { min: 100, max: 200, ticks: [] };
  it('spreads points across the box', () => {
    expect(xAt(0, 5, box)).toBe(40);
    expect(xAt(4, 5, box)).toBe(340);
    expect(xAt(0, 1, box)).toBe(190);
    expect(yAt(200, axis, box)).toBe(10);
    expect(yAt(100, axis, box)).toBe(210);
    expect(yAt(150, axis, box)).toBe(110);
    expect(yAt(100, axis, box, true)).toBe(10); // pace: the fastest at the top
  });
  it('skips sessions without a value and draws through them', () => {
    const pts = points([100, null, 200], axis, box);
    expect(pts.map((p) => p.i)).toEqual([0, 2]);
    expect(linePath(pts)).toBe('M40 210 L340 10');
    expect(linePath([])).toBe('');
  });
  it('finds the point under a finger', () => {
    expect(nearestIndex(40, 5, box)).toBe(0);
    expect(nearestIndex(120, 5, box)).toBe(1);
    expect(nearestIndex(1000, 5, box)).toBe(4);
    expect(nearestIndex(-50, 5, box)).toBe(0);
    expect(nearestIndex(100, 1, box)).toBe(0);
  });
  it('labels the ends and a few between', () => {
    expect(labelIndices(1, 4)).toEqual([0]);
    expect(labelIndices(3, 4)).toEqual([0, 1, 2]);
    expect(labelIndices(13, 4)).toEqual([0, 4, 8, 12]);
    expect(labelIndices(0, 4)).toEqual([]);
  });
});
