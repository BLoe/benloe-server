interface RingProps {
  value: number;
  max: number;
  /** text in the center (defaults to value) */
  center?: string;
  size?: number;
}

/** A small progress ring — a compact cousin of the Dial. */
export function Ring({ value, max, center, size = 52 }: RingProps) {
  const r = 21;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <svg className="inst-ring-svg" width={size} height={size} viewBox="0 0 52 52" role="img" aria-label={`${value} of ${max}`}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--panel-2)" strokeWidth="4" />
      <circle className="ring-prog" cx="26" cy="26" r={r} fill="none" stroke="var(--brass)" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${(f * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 26 26)" />
      <text x="26" y="30" textAnchor="middle" fontFamily="var(--mono)" fontSize="15" fill="var(--linen)">{center ?? value}</text>
    </svg>
  );
}
