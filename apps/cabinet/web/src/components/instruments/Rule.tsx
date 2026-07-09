import { Sparkline } from './Sparkline.js';

interface RuleProps {
  readout: string;
  unit?: string;
  points?: number[];
  /** brass marker position along the engraved scale, 0–100 */
  markerPct?: number;
}

/** A horizontal engraved rule with a brass indicator — the weight/trend instrument. */
export function Rule({ readout, unit, points, markerPct = 50 }: RuleProps) {
  const ticks = [8, 28, 48, 68, 88];
  return (
    <div className="inst-rule">
      {points && points.length > 1 && <Sparkline points={points} />}
      <div className="readout"><span className="big">{readout}</span> {unit && <span className="unit">{unit}</span>}</div>
      <div className="scale" aria-hidden="true">
        <div className="track" />
        {ticks.map((t) => (
          <div key={t} className="tick" style={{ left: `${t}%` }} />
        ))}
        <div className="mark" style={{ left: `${Math.max(0, Math.min(100, markerPct))}%` }} />
      </div>
    </div>
  );
}
