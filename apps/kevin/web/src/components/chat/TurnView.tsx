import { ChevronRight, CornerDownRight, FileText, ShieldQuestion } from 'lucide-react';
import { memo, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { answerConfirm } from '@/lib/chat';
import { clock, cost, modelLabel, toolLabel } from '@/lib/format';
import { display, endNote, segments, workSummary, type Confirm, type Turn, type WorkPart } from '@/lib/transcript';
import { cn } from '@/lib/utils';
import { ToolRow } from './ToolRow';

type Attachment = { id: number; filename: string; mime: string };

export function UserBubble({ text, attachments, note }: { text: string; attachments?: Attachment[]; note?: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {!!attachments?.length && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {attachments.map((a) =>
            a.mime.startsWith('image/') ? (
              <a key={a.id} href={api.attachmentUrl(a.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                <img src={api.attachmentUrl(a.id)} alt={a.filename} loading="lazy" className="size-24 object-cover" />
              </a>
            ) : (
              <a key={a.id} href={api.attachmentUrl(a.id)} target="_blank" rel="noreferrer" className="flex h-9 max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.filename}</span>
              </a>
            ),
          )}
        </div>
      )}
      {text && <div className="max-w-[85%] rounded-2xl rounded-br-md bg-user-bubble px-3.5 py-2 break-words whitespace-pre-wrap">{text}</div>}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Kevin's note to himself between tool calls. Long ones fold to three lines. */
function StatusLine({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 3;
  return (
    <div
      className={cn('border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground', !open && !streaming && long && 'line-clamp-3 cursor-pointer')}
      onClick={long ? () => setOpen((o) => !o) : undefined}
      title={long && !open ? 'Show all' : undefined}
    >
      {text.trim()}
    </div>
  );
}

function WorkParts({ parts }: { parts: WorkPart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.kind === 'tool' ? <ToolRow key={p.item.id} item={p.item} /> : <StatusLine key={i} text={p.text} streaming={p.streaming} />))}
    </>
  );
}

/**
 * A run of tool calls and the lines Kevin wrote between them. While it is the
 * live end of a running turn only the step in progress shows; once Kevin has
 * moved on it is one summary line. Either way the full list is one tap away.
 */
function WorkGroup({ parts, live }: { parts: WorkPart[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const { steps, names, failed, declined } = workSummary(parts);
  // Lines with no tool call (a turn that ended mid-thought) have nothing to fold away.
  if (steps === 0) return <WorkParts parts={parts} />;
  const current = parts.at(-1)!;
  const earlier = live ? parts.length - 1 : parts.length;
  const label = live
    ? `${earlier} earlier step${earlier === 1 ? '' : 's'}`
    : `${steps} step${steps === 1 ? '' : 's'}: ${names.map(toolLabel).join(', ')}`;
  const trouble = [failed ? `${failed} failed` : '', declined ? `${declined} declined` : ''].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-1" data-work={live ? 'live' : 'done'}>
      {(!live || earlier > 0) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="-mx-1.5 flex min-h-9 w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 text-left text-sm text-muted-foreground hover:bg-secondary lg:min-h-7"
        >
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {trouble && <span className="shrink-0 text-xs text-destructive">{trouble}</span>}
        </button>
      )}
      {open && (
        <div className="ml-2 flex flex-col gap-1 border-l-2 pl-3">
          <WorkParts parts={live ? parts.slice(0, -1) : parts} />
        </div>
      )}
      {live && <WorkParts parts={[current]} />}
    </div>
  );
}

function ConfirmCard({ confirm }: { confirm: Confirm }) {
  const [sent, setSent] = useState(false);
  const [question, ...rest] = confirm.summary.split('\n');
  const detail = rest.join('\n').trim();
  const answer = (approved: boolean) => {
    setSent(true);
    void answerConfirm(confirm.confirmId, approved).finally(() => setSent(false));
  };
  return (
    <div role="group" aria-label="Kevin needs your OK" className="rounded-xl border border-warning/40 bg-warning-soft p-3">
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{question}</div>
          {detail && <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-card/70 p-2 font-mono text-xs break-words whitespace-pre-wrap">{detail}</pre>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1 lg:flex-none" disabled={sent} onClick={() => answer(true)}>
          Yes, go ahead
        </Button>
        <Button size="sm" variant="outline" className="flex-1 lg:flex-none" disabled={sent} onClick={() => answer(false)}>
          No, don’t
        </Button>
      </div>
    </div>
  );
}

function Working() {
  return (
    <div className="flex h-6 items-center gap-1" role="status" aria-label="Kevin is working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 rounded-full bg-muted-foreground" style={{ animation: 'kevin-pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.18}s` }} />
      ))}
    </div>
  );
}

function TurnViewImpl({ turn, confirms }: { turn: Turn; confirms: Confirm[] }) {
  const [showCost, setShowCost] = useState(false);
  const segs = segments(turn);
  const running = turn.status === 'running';
  const shown = display(segs);
  const note = endNote(turn);
  const last = segs.at(-1);
  // Dots whenever nothing on screen is visibly moving: before the first block, between blocks, after a tool.
  const idle = running && !confirms.length && !(last && last.kind !== 'tool' && last.kind !== 'folded' && last.streaming) && !(last?.kind === 'tool' && last.item.state === 'running');
  // The server writes its own sentence for these as the turn's text; the note would repeat it.
  const noteRedundant = turn.status === 'blocked' || turn.status === 'refused' || (turn.status === 'error' && segs.some((s) => s.kind === 'text' && s.text.startsWith('Something went wrong')));
  return (
    <article className="flex flex-col gap-3" data-turn={turn.id} data-status={turn.status}>
      <UserBubble text={turn.user.text} attachments={turn.user.attachments} />
      <div className="flex flex-col gap-2">
        {shown.map((s, i) => {
          if (s.kind === 'text') return <Markdown key={i} text={s.text} className={turn.status === 'blocked' || turn.status === 'refused' ? 'text-destructive' : undefined} />;
          if (s.kind === 'work') return <WorkGroup key={i} parts={s.parts} live={running && i === shown.length - 1} />;
          return (
            <div key={i} className="flex items-start justify-end gap-1.5 py-1 text-sm">
              <CornerDownRight className="mt-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-user-bubble px-3 py-1.5 break-words whitespace-pre-wrap" title="You added this while Kevin was working">
                {s.text || 'Files sent'}
              </div>
            </div>
          );
        })}
        {confirms.map((c) => (
          <ConfirmCard key={c.confirmId} confirm={c} />
        ))}
        {idle && <Working />}
        {note && !noteRedundant && (
          <div role={note.tone === 'error' ? 'alert' : undefined} className={cn('text-sm', note.tone === 'error' ? 'rounded-lg bg-destructive-soft px-3 py-2 text-destructive' : 'text-muted-foreground')}>
            {note.text}
          </div>
        )}
        {!running && (
          <button type="button" onClick={() => setShowCost((s) => !s)} className="group -mt-1 flex h-6 items-center gap-1.5 self-start text-xs text-muted-foreground/70 hover:text-muted-foreground" aria-label="Show what this turn cost">
            {turn.startedAt && <span>{clock(turn.startedAt)}</span>}
            <span className={cn('tabular', showCost ? 'inline' : 'hidden group-hover:inline')}>
              {cost(turn.costUsd)}
              {turn.model ? `, ${modelLabel(turn.model)}` : ''}
            </span>
          </button>
        )}
      </div>
    </article>
  );
}

export const TurnView = memo(TurnViewImpl);
