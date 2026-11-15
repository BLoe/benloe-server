import { FileSpreadsheet, Undo2, Upload } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAct } from '@/lib/act';
import { plural, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useView } from '@/lib/useView';
import { dayLabel } from './logic';
import { useMoney } from './shared';
import type { ImportBatch, ImportsView } from './types';

/** Recent CSV imports, each undoable: undoing deletes the transactions that import added. */
export function Imports() {
  const { openImport, go, today } = useMoney();
  const view = useView<ImportsView>('money/imports', { limit: 50 });
  const now = useNow();
  const [undoing, setUndoing] = useState<ImportBatch | null>(null);
  const { run, pending } = useAct();
  return (
    <Section
      title="Recent imports"
      action={
        <Button size="sm" onClick={openImport}>
          <Upload />
          Import a CSV
        </Button>
      }
    >
      <ViewState
        view={view}
        isEmpty={(v) => v.batches.length === 0}
        empty={
          <EmptyState
            icon={FileSpreadsheet}
            title="Nothing imported yet"
            body="Download the transactions CSV from your bank or card website and import it here. Importing the same file twice adds nothing."
            action={<Button onClick={openImport}>Import a CSV</Button>}
          />
        }
      >
        {(v) => (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {v.batches.map((b) => (
              <li key={b.id} className="flex items-stretch">
                <button
                  type="button"
                  disabled={!!b.undone_at}
                  onClick={() => go('transactions', { batch: String(b.id) })}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-muted enabled:active:bg-secondary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={b.undone_at ? 'truncate text-muted-foreground line-through' : 'truncate font-medium'}>{b.filename}</span>
                      {b.undone_at && <Badge variant="outline">Undone</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {b.account} · {relativeTime(b.imported_at, now)}
                    </span>
                    <span className="tabular mt-0.5 block text-sm text-muted-foreground">
                      {b.inserted_count.toLocaleString('en-US')} added
                      {b.date_from && b.date_to ? `, ${dayLabel(b.date_from, today)} to ${dayLabel(b.date_to, today)}` : ''}
                      {b.duplicate_count ? `, ${plural(b.duplicate_count, 'duplicate')}` : ''}
                      {b.skipped_count ? `, ${b.skipped_count} skipped` : ''}
                      {!b.undone_at && b.remaining_count !== b.inserted_count ? `, ${b.remaining_count} still here` : ''}
                    </span>
                  </span>
                </button>
                {!b.undone_at && (
                  <div className="flex shrink-0 items-center pr-2.5">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => setUndoing(b)}>
                      <Undo2 />
                      Undo
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </ViewState>
      <ConfirmDialog
        open={!!undoing}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={`Undo the import of ${undoing?.filename ?? ''}?`}
        body={undoing ? `This deletes the ${plural(undoing.remaining_count, 'transaction')} it added to ${undoing.account}, including any you have recategorized since. The account's balance is left as it is.` : ''}
        confirmLabel="Undo import"
        onConfirm={() => {
          const b = undoing;
          setUndoing(null);
          if (b) void run('money_transactions_update', { undo_import: b.id }, { success: `Import undone: ${plural(b.remaining_count, 'transaction')} removed` });
        }}
      />
    </Section>
  );
}
