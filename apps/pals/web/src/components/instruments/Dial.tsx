import type { CSSProperties } from 'react';

interface DialProps {
  value: number;
  max: number;
  /** big readout number (defaults to value) */
  readout?: string;
  unit?: string;
  sub?: string;
  /** small label above/beside, e.g. "Nutrition · today" */
  size?: number;
}

const R = 46;
const C = 2 * Math.PI * R; // ~289
const SWEEP = 0.75 * C; // 270° arc

const TICKS = Array.from({ length: 11 }, (_, i) => -135 + i * 27); // -135..135

/** The signature instrument: a 270° engraved dial with a needle that settles. */
export function Dial({ value, max, readout, unit, sub, size = 120 }: DialProps) {
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const needle = -135 + 270 * f;
  return (
    <div className="inst-dial">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${value} of ${max}`}>
        <g stroke="var(--linen-faint)" strokeWidth="1.4">
          {TICKS.map((t, i) => (
            <line key={i} x1="60" y1="14" x2="60" y2={i % 5 === 0 ? 21 : 20} transform={`rotate(${t} 60 60)`} />
          ))}
        </g>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--panel-2)" strokeWidth="5"
                strokeDasharray={`${SWEEP.toFixed(1)} ${C.toFixed(1)}`} transform="rotate(135 60 60)" strokeLinecap="round" />
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--brass)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(f * SWEEP).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(135 60 60)" opacity="0.92" />
        <g className="needle" style={{ '--needle': `${needle.toFixed(1)}deg` } as CSSProperties}>
          <line x1="60" y1="60" x2="60" y2="24" stroke="var(--brass-hi)" strokeWidth="2" />
          <circle cx="60" cy="24" r="2.2" fill="var(--brass-hi)" />
        </g>
        <circle cx="60" cy="60" r="4.5" fill="var(--panel)" stroke="var(--brass)" strokeWidth="1.4" />
      </svg>
      <div className="readout">
        <span className="big">{readout ?? value}</span> {unit && <span className="unit">{unit}</span>}
        {sub && <span className="sub">{sub}</span>}
      </div>
    </div>
  );
}
