import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Dial, Ring, Rule, Gauge, Sparkline, Card, StatReadout, SectionLabel } from '../src/components/instruments/index.js';

afterEach(cleanup);

describe('Dial', () => {
  it('renders a labelled dial and points the needle by value/max', () => {
    const { container } = render(<Dial value={142} max={185} unit="g" sub="3 meals" />);
    expect(screen.getByLabelText('142 of 185')).toBeTruthy();
    expect(screen.getByText('142')).toBeTruthy();
    const needle = container.querySelector('.needle') as HTMLElement;
    // 142/185 ≈ 0.768 → -135 + 270*0.768 ≈ 72.3deg
    expect(needle.style.getPropertyValue('--needle')).toMatch(/^7[12]\.\ddeg$/);
  });
  it('clamps out-of-range values (never over-rotates)', () => {
    const { container } = render(<Dial value={999} max={185} />);
    expect((container.querySelector('.needle') as HTMLElement).style.getPropertyValue('--needle')).toBe('135.0deg');
  });
});

describe('Ring', () => {
  it('shows the center value and a proportional arc', () => {
    const { container } = render(<Ring value={3} max={11} />);
    expect(screen.getByText('3')).toBeTruthy();
    const prog = container.querySelector('.ring-prog') as SVGElement;
    // f = 3/11 of circumference (2π·21 ≈ 131.9) ≈ 36
    expect(prog.getAttribute('stroke-dasharray')?.startsWith('36')).toBe(true);
  });
});

describe('Rule', () => {
  it('renders the readout, a sparkline when given points, and positions the marker', () => {
    const { container } = render(<Rule readout="178.4" unit="lb" points={[8, 10, 7, 13, 12]} markerPct={41} />);
    expect(screen.getByText('178.4')).toBeTruthy();
    expect(container.querySelector('.inst-spark')).toBeTruthy();
    expect((container.querySelector('.mark') as HTMLElement).style.left).toBe('41%');
  });
  it('omits the sparkline with too few points and clamps the marker', () => {
    const { container } = render(<Rule readout="x" markerPct={250} />);
    expect(container.querySelector('.inst-spark')).toBeNull();
    expect((container.querySelector('.mark') as HTMLElement).style.left).toBe('100%');
  });
});

describe('Gauge', () => {
  it('fills to value/max and exposes meter semantics', () => {
    const { container } = render(<Gauge value={454} max={500} leftLabel="dining" rightLabel="$46 left" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('454');
    expect((container.querySelector('.bar > i') as HTMLElement).style.width).toBe('90.8%');
  });
  it('turns to alert past the threshold', () => {
    const { container } = render(<Gauge value={480} max={500} threshold={0.9} />);
    expect(container.querySelector('.inst-gauge')?.className).toContain('over');
  });
});

describe('Sparkline', () => {
  it('draws one point per datum', () => {
    const { container } = render(<Sparkline points={[1, 2, 3, 4]} />);
    const pts = container.querySelector('polyline')!.getAttribute('points')!.trim().split(' ');
    expect(pts).toHaveLength(4);
  });
});

describe('primitives', () => {
  it('Card renders a severity stripe and cap/tag', () => {
    const { container } = render(<Card cap="Nutrition" tag="on track" severity="crit">body</Card>);
    expect(container.querySelector('.sev-crit')).toBeTruthy();
    expect(container.querySelector('.stripe')).toBeTruthy();
    expect(screen.getByText('on track')).toBeTruthy();
  });
  it('Card paper variant is opt-in and stripe-less by default', () => {
    const { container } = render(<Card paper>signature</Card>);
    expect(container.querySelector('.inst-card.paper')).toBeTruthy();
    expect(container.querySelector('.stripe')).toBeNull();
  });
  it('StatReadout applies a tone class', () => {
    const { container } = render(<StatReadout big="+$1,240" tone="ok" />);
    expect(container.querySelector('.big.ok')).toBeTruthy();
  });
  it('SectionLabel shows a marker and children', () => {
    render(<SectionLabel n={2}>Need you today</SectionLabel>);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Need you today')).toBeTruthy();
  });
});
