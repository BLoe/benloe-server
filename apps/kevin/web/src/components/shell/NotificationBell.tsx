import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ago } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { markRead, useNotifications } from '@/lib/notifications';
import type { NotificationRow } from '@/lib/types';
import { cn } from '@/lib/utils';

export function NotificationItem({ n, now, onOpen }: { n: NotificationRow; now: Date; onOpen: (n: NotificationRow) => void }) {
  const unread = !n.read_at;
  return (
    <button type="button" onClick={() => onOpen(n)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary">
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn('block leading-snug', unread ? 'font-medium' : 'text-muted-foreground')}>
          {n.title}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        {n.body && <span className="mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-line text-muted-foreground">{n.body}</span>}
        <span className="mt-0.5 block text-xs text-muted-foreground/80">{ago(n.at, now)}</span>
      </span>
    </button>
  );
}

/** Opens a notification: marks it read and goes where it points. */
export function useOpenNotification(): (n: Pick<NotificationRow, 'id' | 'link' | 'read_at'>) => void {
  const navigate = useNavigate();
  return (n) => {
    if (!n.read_at) markRead([n.id]);
    if (n.link) void navigate(n.link);
  };
}

export function NotificationBell({ align = 'end' }: { align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const view = useNotifications();
  const now = useNow();
  const openNotification = useOpenNotification();
  const unread = view.data?.unread ?? 0;
  const items = view.data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="tabular absolute top-1 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[11px] leading-none font-semibold text-destructive-foreground lg:top-0 lg:right-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="flex max-h-[min(70dvh,32rem)] w-[22rem] flex-col overflow-hidden p-0">
        <div className="flex h-12 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
          <span className="font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead()}>
              <CheckCheck />
              Mark all read
            </Button>
          )}
        </div>
        <div className="scroll-area flex-1 divide-y">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{view.loading ? 'Loading…' : 'Nothing yet. Reminders and alerts from Kevin land here.'}</p>
          ) : (
            items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                now={now}
                onOpen={(x) => {
                  setOpen(false);
                  openNotification(x);
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
