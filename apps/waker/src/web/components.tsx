import type { ReactNode } from 'react';

/* The almanac's parts. Ruled, square, no shadows — an entry is a row in a
   table with a mark in the margin, not a card. */

export function Sheet({
  title,
  count,
  note,
  children,
  className = '',
}: {
  title: string;
  count?: ReactNode;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sheet ${className}`}>
      <header className="flex items-baseline gap-3 px-4 py-2.5 border-b border-[var(--rule)]">
        <h2 className="label" style={{ color: 'var(--graphite)' }}>
          {title}
        </h2>
        {count != null && (
          <span className="fig ml-auto" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
            {count}
          </span>
        )}
      </header>
      {children}
      {note && (
        <p
          className="px-4 py-2.5 border-t border-[var(--rule)]"
          style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)', lineHeight: 1.5 }}
        >
          {note}
        </p>
      )}
    </section>
  );
}

const POS_TOKEN: Record<string, string> = {
  QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'def',
  FLEX: 'flex', SUPER_FLEX: 'flex', PICK: 'def',
};

export const posColor = (pos: string | null | undefined) =>
  `var(--pos-${POS_TOKEN[(pos ?? '').toUpperCase()] ?? 'def'})`;

/** Position chip. Always carries its text, which is what lets the palette
    run at the contrast it does. */
export function Pos({ pos }: { pos: string | null | undefined }) {
  const label = (pos ?? '?').toUpperCase().replace('SUPER_FLEX', 'SFLX');
  return (
    <span
      className="fig inline-flex items-center justify-center shrink-0"
      style={{
        fontSize: 'var(--t-tick)',
        letterSpacing: '.08em',
        fontWeight: 600,
        color: posColor(pos),
        border: `1px solid ${posColor(pos)}`,
        padding: '1px 4px',
        minWidth: 30,
      }}
    >
      {label}
    </span>
  );
}

export function Loading({ label = 'Reading' }: { label?: string }) {
  return (
    <div className="px-4 py-8 label" style={{ color: 'var(--faint)' }}>
      {label}…
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="sheet px-4 py-4" style={{ borderColor: 'var(--alarm)' }}>
      <div className="label" style={{ color: 'var(--alarm)' }}>Could not load</div>
      <p className="mt-1.5" style={{ fontSize: 'var(--t-body)' }}>{message}</p>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-8">
      <div className="slab" style={{ fontSize: 'var(--t-lede)' }}>{title}</div>
      {hint && (
        <p className="mt-1" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>{hint}</p>
      )}
    </div>
  );
}
