import { Ban, Check, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { memo, useState } from 'react';
import { duration, toolLabel } from '@/lib/format';
import type { ToolItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The one thing worth showing from a tool's input before it is expanded. */
export function inputSummary(input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const values = Object.values(input as Record<string, unknown>);
  const first = values.find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (first) return first.replace(/\s+/g, ' ').trim();
  const scalar = values.find((v) => typeof v === 'number' || typeof v === 'boolean');
  return scalar === undefined ? '' : String(scalar);
}

const stateIcon = {
  running: <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />,
  ok: <Check className="size-3.5 text-primary" />,
  error: <X className="size-3.5 text-destructive" />,
  denied: <Ban className="size-3.5 text-warning" />,
};
const stateWord = { running: 'running', ok: 'done', error: 'failed', denied: 'declined' };

function ToolRowImpl({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = inputSummary(item.input);
  const hasInput = item.input != null && typeof item.input === 'object' && Object.keys(item.input).length > 0;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1.5 flex min-h-9 w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 text-left text-muted-foreground hover:bg-secondary lg:min-h-7"
      >
        <span className="grid size-4 shrink-0 place-items-center">{stateIcon[item.state]}</span>
        <span className={cn('shrink-0 font-medium', item.state === 'error' ? 'text-destructive' : 'text-foreground/80')}>{toolLabel(item.name)}</span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <span className="sr-only">{stateWord[item.state]}</span>
        {item.ms != null && item.state !== 'running' && <span className="tabular shrink-0 text-xs">{duration(item.ms)}</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1 mb-2 ml-2 space-y-2 border-l-2 pl-3">
          {hasInput && (
            <div>
              <div className="mb-0.5 text-xs text-muted-foreground">Input</div>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">{JSON.stringify(item.input, null, 2)}</pre>
            </div>
          )}
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">{item.state === 'running' ? 'Running…' : `Result (${stateWord[item.state]})`}</div>
            {item.preview ? (
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">
                {item.preview}
                {item.preview.length >= 600 ? '…' : ''}
              </pre>
            ) : (
              item.state !== 'running' && <div className="text-xs text-muted-foreground">No result text was kept for this step.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const ToolRow = memo(ToolRowImpl);
