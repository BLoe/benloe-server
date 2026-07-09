import type { InstrumentSpec } from '../../lib/contracts.js';
import { Dial } from './Dial.js';
import { Ring } from './Ring.js';
import { Rule } from './Rule.js';
import { Gauge } from './Gauge.js';
import { Sparkline } from './Sparkline.js';
import { Card, StatReadout } from './primitives.js';

/**
 * The one dispatcher every surface uses to render a data-driven InstrumentSpec
 * (from the API contract) inside a captioned Card. This is what keeps all seven
 * domains' vitals in one visual family.
 */
export function Instrument({ spec }: { spec: InstrumentSpec }) {
  return (
    <Card cap={spec.label} tag={spec.tag} tagTone={spec.tagTone}>
      {renderInner(spec)}
    </Card>
  );
}

function renderInner(spec: InstrumentSpec) {
  switch (spec.kind) {
    case 'dial':
      return <Dial value={spec.value} max={spec.max} unit={spec.unit} sub={spec.sub} />;
    case 'rule':
      return <Rule readout={spec.readout} unit={spec.unit} points={spec.points} markerPct={spec.markerPct} />;
    case 'ring':
      return (
        <div className="inst-ring">
          <Ring value={spec.value} max={spec.max} center={spec.center} />
          <StatReadout big={<span className="unit">{spec.sub ?? `of ${spec.max}`}</span>} />
        </div>
      );
    case 'gauge':
      return <Gauge value={spec.value} max={spec.max} threshold={spec.threshold} leftLabel={spec.leftLabel} rightLabel={spec.rightLabel} />;
    case 'stat':
      return (
        <>
          <StatReadout big={spec.big} unit={spec.unit} sub={spec.sub} tone={spec.tone} />
          {spec.points && <Sparkline points={spec.points} color={spec.pointsColor ?? 'var(--brass)'} height={22} />}
        </>
      );
  }
}
