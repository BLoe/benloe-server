import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Instrument } from '../src/components/instruments/index.js';
import type { InstrumentSpec } from '../src/lib/contracts.js';

afterEach(cleanup);

const specs: InstrumentSpec[] = [
  { kind: 'dial', label: 'Nutrition', value: 142, max: 185 },
  { kind: 'rule', label: 'Weight', readout: '178.4', points: [1, 2, 3] },
  { kind: 'ring', label: 'Tasks', value: 3, max: 11 },
  { kind: 'gauge', label: 'Dining', value: 454, max: 500 },
  { kind: 'stat', label: 'Cash', big: '+$1,240', tone: 'ok', points: [1, 2] },
];

describe('Instrument dispatcher', () => {
  it.each(specs)('renders a $kind spec inside a captioned card', (spec) => {
    const { container } = render(<Instrument spec={spec} />);
    expect(container.querySelector('.inst-card')).toBeTruthy();
    expect(screen.getByText(spec.label)).toBeTruthy();
  });

  it('chats the corner tag through to the card', () => {
    render(<Instrument spec={{ kind: 'dial', label: 'X', value: 1, max: 2, tag: 'on track' }} />);
    expect(screen.getByText('on track')).toBeTruthy();
  });
});
