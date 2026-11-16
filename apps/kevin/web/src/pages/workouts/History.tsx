// Past sessions, newest first, a page at a time. A row opens the session.
import { History as HistoryIcon, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, List, ListRow, LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { openChat } from '@/lib/chat';
import { calendarDay } from '@/lib/format';
import { useView } from '@/lib/useView';
import { StatusBadge } from './parts';
import { SessionSheet, sessionFacts } from './SessionSheet';
import type { SessionsView } from './types';

type Go = (tab: string, params?: Record<string, string>) => void;

const PAGE = 20;

export function History({ offset, today, go }: { offset: number; today: string; go: Go }) {
  const view = useView<SessionsView>('workouts/sessions', { limit: PAGE, offset });
  const [open, setOpen] = useState<number | null>(null);
  const data = view.data;
  if (!data) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={6} />;
  const page = (to: number) => go('history', to > 0 ? { offset: String(to) } : undefined);

  if (!data.total) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No sessions yet"
        body="Every workout you log shows up here, whether you tap it in on the Today tab or tell Kevin what you did."
        action={
          <>
            <Button onClick={() => go('today')}>Go to today</Button>
            <Button variant="outline" onClick={() => openChat({ prefill: 'Log a workout: ' })}>
              <MessageCircle />
              Tell Kevin
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <List>
        {data.sessions.map((s) => (
          <ListRow
            key={s.id}
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {s.title}
                {s.status !== 'completed' && <StatusBadge status={s.status} />}
              </span>
            }
            subtitle={
              s.status === 'skipped'
                ? (s.notes ?? 'Nothing logged')
                : [s.exercises.map((e) => `${e.exercise} ${e.summary}`).join(' · '), sessionFacts({ ...s, set_count: 0, volume_lbs: 0 })].filter(Boolean).join(' — ') || 'No sets logged'
            }
            meta={calendarDay(s.date, today)}
            muted={s.status === 'skipped'}
            onClick={() => setOpen(s.id)}
          />
        ))}
      </List>
      {data.total > PAGE && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={offset <= 0} onClick={() => page(Math.max(0, offset - PAGE))}>
            Newer
          </Button>
          <span className="tabular text-sm text-muted-foreground">
            {offset + 1}–{Math.min(data.total, offset + data.sessions.length)} of {data.total}
          </span>
          <Button variant="outline" disabled={offset + PAGE >= data.total} onClick={() => page(offset + PAGE)}>
            Older
          </Button>
        </div>
      )}
      {open != null && (
        <SessionSheet
          id={open}
          today={today}
          onClose={() => setOpen(null)}
          onOpenDay={(date) => {
            setOpen(null);
            go('today', date === today ? undefined : { date });
          }}
        />
      )}
    </div>
  );
}
