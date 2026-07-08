interface SparklineProps {
  points: number[];
  color?: string;
  /** draw a dot on the final point */
  emphasize?: boolean;
  height?: number;
  ariaLabel?: string;
}

/** A bare trend line, scaled to its own range, filling its container width. */
export function Sparkline({ points, color = 'var(--brass)', emphasize = true, height = 30, ariaLabel = 'trend' }: SparklineProps) {
  const W = 160;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const coords = points.map((p, i): [number, number] => [i * step, height - ((p - min) / range) * height]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  return (
    <svg className="inst-spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={ariaLabel}>
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {emphasize && last && <circle cx={last[0]} cy={last[1]} r="2.4" fill="var(--brass-hi)" />}
    </svg>
  );
}
