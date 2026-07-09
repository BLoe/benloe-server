interface GaugeProps {
  value: number;
  max: number;
  /** fraction (0–1) past which the fill turns to alert */
  threshold?: number;
  leftLabel?: string;
  rightLabel?: string;
}

/** A linear bar gauge — budgets, capacity, anything value-of-max. Turns
    vermilion once it crosses the threshold. */
export function Gauge({ value, max, threshold = 0.9, leftLabel, rightLabel }: GaugeProps) {
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const over = f >= threshold;
  return (
    <div className={`inst-gauge${over ? ' over' : ''}`}>
      <div className="bar" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <i style={{ width: `${f * 100}%` }} />
      </div>
      {(leftLabel || rightLabel) && (
        <div className="foot">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}
