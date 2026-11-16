import { ArrowRightLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Markdown } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { boardColumns, boardField, rowSummary, splitDone, tableColumns, type SpaceRecord } from '@/lib/spaces';
import { cn } from '@/lib/utils';
import { Clip, DueChip, QuickAdd, Tick, Value, type LayoutProps } from './parts';

const card = 'divide-y overflow-hidden rounded-xl border bg-card';

/** Title, due chip and a couple of field values; the row opens the record. */
function Row({ p, r, tick, skipKey }: { p: LayoutProps; r: SpaceRecord; tick: boolean; skipKey?: string | null }) {
  const summary = rowSummary(p.space, r, 2, skipKey, p.today);
  return (
    <li className="flex items-center">
      {tick && <div className="pl-1.5">{<Tick checked={r.done} onChange={() => p.onToggle(r)} label={`${r.title} done`} />}</div>}
      <button type="button" onClick={() => p.onOpen(r)} className={cn('flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-1 py-2 pr-4 text-left hover:bg-muted active:bg-secondary', tick ? 'pl-1' : 'pl-4')}>
        <span className={cn('leading-snug break-words', r.done ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'font-medium')}>{r.title}</span>
        {(r.due_on || summary.length > 0 || !!r.attachments?.length) && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <DueChip record={r} today={p.today} />
            <Clip record={r} />
            {summary.map((s) => (
              <span key={s.field.key} className="tabular min-w-0 truncate">
                {s.field.type === 'checkbox' || s.field.type === 'select' ? s.text : `${s.field.label} ${s.text}`}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

function DoneGroup({ p, done, tick }: { p: LayoutProps; done: SpaceRecord[]; tick: boolean }) {
  const [open, setOpen] = useState(false);
  if (!done.length) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        Done ({done.length})
      </button>
      {open && (
        <ul className={card}>
          {done.map((r) => (
            <Row key={r.id} p={p} r={r} tick={tick} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Checklist(p: LayoutProps) {
  const { open, done } = splitDone(p.records);
  return (
    <>
      <QuickAdd placeholder="Add an item" onAdd={(t) => p.onAdd(t)} />
      {open.length > 0 && (
        <ul className={card}>
          {open.map((r) => (
            <Row key={r.id} p={p} r={r} tick />
          ))}
        </ul>
      )}
      {open.length === 0 && done.length > 0 && <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Everything is ticked off.</p>}
      <DoneGroup p={p} done={done} tick />
    </>
  );
}

export function Rows(p: LayoutProps) {
  const { open, done } = splitDone(p.records);
  return (
    <>
      <QuickAdd placeholder="Add an item" onAdd={(t) => p.onAdd(t)} />
      {open.length > 0 && (
        <ul className={card}>
          {open.map((r) => (
            <Row key={r.id} p={p} r={r} tick={false} />
          ))}
        </ul>
      )}
      <DoneGroup p={p} done={done} tick={false} />
    </>
  );
}

/** Columns when the page is wide enough for them; one card per record when it is not. Never a sideways-scrolling table on a phone. */
export function Table(p: LayoutProps) {
  const cols = tableColumns(p.space, p.records);
  return (
    <>
      <QuickAdd placeholder="Add a row" onAdd={(t) => p.onAdd(t)} />
      {p.records.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card @2xl/page:block">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  {cols.done && <th className="w-11 font-medium" aria-label="Done" />}
                  <th className={cn('py-2.5 pr-3 font-medium', !cols.done && 'pl-4')}>Title</th>
                  {cols.fields.map((f) => (
                    <th key={f.key} className={cn('px-3 py-2.5 font-medium whitespace-nowrap', (f.type === 'number' || f.type === 'money') && 'text-right')}>
                      {f.label}
                    </th>
                  ))}
                  {cols.due && <th className="py-2.5 pr-4 pl-3 font-medium">Due</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.records.map((r) => (
                  <tr key={r.id} onClick={() => p.onOpen(r)} className="cursor-pointer hover:bg-muted">
                    {cols.done && (
                      <td className="pl-1" onClick={(e) => e.stopPropagation()}>
                        <Tick checked={r.done} onChange={() => p.onToggle(r)} label={`${r.title} done`} />
                      </td>
                    )}
                    <td className={cn('max-w-64 py-2.5 pr-3', !cols.done && 'pl-4')}>
                      <span className="flex items-center gap-2">
                        <button type="button" className={cn('text-left break-words', r.done ? 'text-muted-foreground' : 'font-medium')}>
                          {r.title}
                        </button>
                        <Clip record={r} />
                      </span>
                    </td>
                    {cols.fields.map((f) => (
                      <td key={f.key} className={cn('max-w-56 px-3 py-2.5 align-middle', (f.type === 'number' || f.type === 'money') && 'text-right', f.type === 'longtext' && 'text-muted-foreground')}>
                        <span className={f.type === 'longtext' ? 'line-clamp-2' : undefined}>
                          <Value field={f} value={r.data[f.key]} today={f.type === 'date' ? p.today : undefined} />
                        </span>
                      </td>
                    ))}
                    {cols.due && (
                      <td className="py-2.5 pr-4 pl-3 whitespace-nowrap">
                        <DueChip record={r} today={p.today} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2.5 @2xl/page:hidden">
            {p.records.map((r) => {
              const filled = cols.fields.filter((f) => r.data[f.key] != null && r.data[f.key] !== '');
              return (
                <li key={r.id} className="flex rounded-xl border bg-card">
                  {cols.done && (
                    <div className="pt-1.5 pl-1.5">
                      <Tick checked={r.done} onChange={() => p.onToggle(r)} label={`${r.title} done`} />
                    </div>
                  )}
                  <button type="button" onClick={() => p.onOpen(r)} className={cn('min-w-0 flex-1 py-3 pr-4 text-left', cols.done ? 'pl-1' : 'pl-4')}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn('leading-snug break-words', r.done ? 'text-muted-foreground' : 'font-medium')}>{r.title}</span>
                      <DueChip record={r} today={p.today} />
                      <Clip record={r} />
                    </span>
                    {filled.length > 0 && (
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        {filled.map((f) => (
                          <div key={f.key} className="contents">
                            <dt className="text-muted-foreground">{f.label}</dt>
                            <dd className="min-w-0">
                              <Value field={f} value={r.data[f.key]} today={f.type === 'date' ? p.today : undefined} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** Columns from a choice field. Cards move with a "Move to" menu everywhere, and by dragging where there is a mouse. */
export function Board(p: LayoutProps) {
  const field = boardField(p.space);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!field) return <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">This board has no choice field for its columns yet. Add one in “Edit space”.</p>;
  const columns = boardColumns(field, p.records);
  const key = (v: string | null) => v ?? '\u0000none';
  const move = (r: SpaceRecord, to: string | null) => p.onMove(r, { [field.key]: to });

  const onDrop = (e: DragEvent, to: string | null) => {
    e.preventDefault();
    setOver(null);
    const r = p.records.find((x) => x.id === dragging);
    setDragging(null);
    if (r && String(r.data[field.key] ?? '') !== String(to ?? '')) move(r, to);
  };

  return (
    <>
      <QuickAdd placeholder={`Add to ${field.options?.[0] ?? 'the board'}`} onAdd={(t) => p.onAdd(t, field.options?.[0] ? { [field.key]: field.options[0] } : undefined)} />
      <div className="flex flex-col gap-5 @2xl/page:flex-row @2xl/page:items-start @2xl/page:gap-3 @2xl/page:overflow-x-auto @2xl/page:pb-2">
        {columns.map((col) => (
          <section
            key={key(col.value)}
            aria-label={col.label}
            onDragOver={(e) => {
              if (dragging == null) return;
              e.preventDefault();
              setOver(key(col.value));
            }}
            onDragLeave={() => setOver((o) => (o === key(col.value) ? null : o))}
            onDrop={(e) => onDrop(e, col.value)}
            className={cn('flex min-w-0 flex-col gap-2 rounded-xl @2xl/page:min-w-52 @2xl/page:flex-1 @2xl/page:bg-secondary/60 @2xl/page:p-2', over === key(col.value) && 'outline-2 outline-primary')}
          >
            <header className="flex h-8 items-center gap-2 px-1">
              <h3 className="min-w-0 truncate text-sm font-semibold">{col.label}</h3>
              <span className="tabular text-sm text-muted-foreground">{col.records.length}</span>
              {col.value !== null && (
                <button type="button" onClick={() => p.onNew({ [field.key]: col.value })} aria-label={`Add to ${col.label}`} className="-my-1 ml-auto grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground lg:size-8">
                  <Plus className="size-4" />
                </button>
              )}
            </header>
            {col.records.length === 0 && <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground @2xl/page:border-border/70">Nothing here.</p>}
            {col.records.map((r) => {
              const summary = rowSummary(p.space, r, 2, field.key, p.today);
              return (
                <article
                  key={r.id}
                  draggable
                  onDragStart={(e) => {
                    setDragging(r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', r.title);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn('flex items-start rounded-lg border bg-card', dragging === r.id && 'opacity-50')}
                >
                  <button type="button" onClick={() => p.onOpen(r)} className="flex min-w-0 flex-1 flex-col gap-1.5 py-2.5 pr-1 pl-3 text-left">
                    <span className={cn('leading-snug break-words', r.done ? 'text-muted-foreground line-through' : 'font-medium')}>{r.title}</span>
                    {(r.due_on || summary.length > 0 || !!r.attachments?.length) && (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <DueChip record={r} today={p.today} />
                        <Clip record={r} />
                        {summary.map((s) => (
                          <span key={s.field.key} className="tabular min-w-0 truncate">
                            {s.text}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="m-0.5 shrink-0 text-muted-foreground" aria-label={`Move ${r.title}`}>
                        <ArrowRightLeft />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {(field.options ?? []).map((o) => (
                        <DropdownMenuItem key={o} disabled={o === col.value} onSelect={() => move(r, o)}>
                          Move to {o}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

function Note({ p, r }: { p: LayoutProps; r: SpaceRecord }) {
  const [open, setOpen] = useState(false);
  const long = (r.body?.length ?? 0) > 700;
  return (
    <article className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
        <h3 className={cn('min-w-0 flex-1 text-[17px] leading-snug font-semibold break-words', r.done && 'text-muted-foreground')}>{r.title}</h3>
        <DueChip record={r} today={p.today} />
        <Clip record={r} />
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => p.onOpen(r)} aria-label={`Edit ${r.title}`}>
          <Pencil />
        </Button>
      </header>
      {r.body?.trim() ? (
        <div className="px-4 pb-4">
          <div className={cn(long && !open && 'max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]')}>
            <Markdown text={r.body} />
          </div>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 h-9 text-sm font-medium text-primary">
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => p.onOpen(r)} className="block w-full px-4 pb-4 text-left text-sm text-muted-foreground">
          Empty. Tap to write.
        </button>
      )}
    </article>
  );
}

export function Notes(p: LayoutProps) {
  return (
    <>
      {/* The list of titles is the way around a space with many notes. */}
      {p.records.length > 3 && (
        <nav aria-label="Notes in this space" className="flex flex-wrap gap-1.5">
          {p.records.map((r) => (
            <a key={r.id} href={`#note-${r.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`note-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="flex h-9 max-w-full items-center rounded-full border bg-card px-3.5 text-sm hover:bg-muted">
              <span className="truncate">{r.title}</span>
            </a>
          ))}
        </nav>
      )}
      {p.records.map((r) => (
        <div key={r.id} id={`note-${r.id}`} className="scroll-mt-4">
          <Note p={p} r={r} />
        </div>
      ))}
    </>
  );
}
