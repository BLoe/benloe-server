import type { ReactNode } from 'react';

type Tone = 'default' | 'ok' | 'warn' | 'crit';
type Severity = 'ok' | 'warn' | 'crit';

/* ---- SectionLabel: a mono eyebrow with a trailing rule ---- */
export function SectionLabel({ children, n }: { children: ReactNode; n?: string | number }) {
  return (
    <div className="section-label">
      {n !== undefined && <span className="n">{n}</span>}
      {children}
    </div>
  );
}

/* ---- StatReadout: mono number + unit + sub ---- */
export function StatReadout({ big, unit, sub, tone = 'default' }: { big: ReactNode; unit?: string; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="readout">
      <span className={`big${tone !== 'default' ? ' ' + tone : ''}`}>{big}</span>
      {unit && <span className="unit"> {unit}</span>}
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

/* ---- Card: the instrument panel. Optional cap label + severity stripe.
        `paper` variant is reserved for authored / signable surfaces. ---- */
export function Card({
  children,
  cap,
  tag,
  tagTone = 'ok',
  severity,
  paper,
  className = '',
}: {
  children: ReactNode;
  cap?: ReactNode;
  tag?: ReactNode;
  tagTone?: Severity;
  severity?: Severity;
  paper?: boolean;
  className?: string;
}) {
  const cls = [
    'inst-card',
    paper ? 'paper' : '',
    severity ? `sev-${severity} has-stripe` : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {severity && <span className="stripe" aria-hidden="true" />}
      {(cap || tag) && (
        <div className="cap">
          <span>{cap}</span>
          {tag && <span className={`tag${tagTone !== 'ok' ? ' ' + tagTone : ''}`}>{tag}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
