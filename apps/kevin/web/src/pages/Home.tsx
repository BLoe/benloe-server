import { ArrowUp, BellOff, Camera, CheckCheck, Clock, Dumbbell, LoaderCircle, ShoppingCart, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { NotificationItem, useOpenNotification } from '@/components/shell/NotificationBell';
import { List, ListRow, Page, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appPath } from '@/lib/links';
import { api } from '@/lib/api';
import { openChat, uploadFile } from '@/lib/chat';
import { dateTime, greeting, longDate } from '@/lib/format';
import { useMe, useNow } from '@/lib/hooks';
import { markRead, useNotifications } from '@/lib/notifications';
import { toast } from '@/lib/toast';
import { humanizeTrigger } from '@/lib/trigger';
import type { Agenda, DomainInfo, HomeCard } from '@/lib/types';
import { useView } from '@/lib/useView';

function AskBox() {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return openChat();
    openChat({ send: text, newThread: true });
    setText('');
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-input bg-card py-1.5 pr-1.5 pl-4 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Kevin, or tell him what changed" aria-label="Message Kevin" enterKeyHint="send" className="h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80" />
      <button type="submit" aria-label="Send to Kevin" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <ArrowUp className="size-[18px]" strokeWidth={2.5} />
      </button>
    </form>
  );
}

function QuickAction({ icon: Icon, label, onClick, busy }: { icon: LucideIcon; label: string; onClick: () => void; busy?: string | null }) {
  return (
    <button type="button" onClick={onClick} disabled={!!busy} className="flex min-h-[4.5rem] flex-col items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left text-sm font-medium hover:bg-muted active:bg-secondary disabled:opacity-70 @2xl/page:min-h-0 @2xl/page:flex-row @2xl/page:items-center @2xl/page:justify-start @2xl/page:gap-2.5 @2xl/page:py-2.5">
      {busy ? <LoaderCircle className="size-5 animate-spin text-primary" /> : <Icon className="size-5 text-primary" strokeWidth={1.75} />}
      <span className="leading-tight">{busy ?? label}</span>
    </button>
  );
}

function QuickActions() {
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Uploading…');
    try {
      const upload = await uploadFile(file, (p) => setBusy(p >= 1 ? 'Kevin is looking…' : `Uploading ${Math.round(p * 100)}%`));
      openChat({ send: 'Here’s my fridge — update the pantry', attachments: [upload], newThread: true });
    } catch (e) {
      toast.error('Photo not uploaded', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-2 @2xl/page:grid-cols-4">
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onPhoto(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <QuickAction icon={Camera} label="Snap fridge photo" busy={busy} onClick={() => camera.current?.click()} />
      <QuickAction icon={Dumbbell} label="Log a workout" onClick={() => openChat({ prefill: 'Log a workout: ', newThread: true })} />
      <QuickAction icon={ShoppingCart} label="Add to shopping list" onClick={() => openChat({ prefill: 'Add to the shopping list: ', newThread: true })} />
      <QuickAction icon={Sparkles} label="Start something new" onClick={() => openChat({ prefill: 'I want to keep track of ', newThread: true })} />
    </div>
  );
}

/** One domain's `home` view. A domain whose view fails or is empty simply shows nothing. */
function DomainCards({ domain }: { domain: string }) {
  const view = useView<{ cards?: HomeCard[] }>(`${domain}/home`);
  const cards = Array.isArray(view.data?.cards) ? view.data.cards : [];
  return (
    <>
      {cards.map((c, i) => {
        const body = (
          <Card className={appPath(c.link) !== null ? 'h-full transition-colors hover:bg-muted' : 'h-full'}>
            <CardHeader>
              <CardTitle>{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-[14px] text-muted-foreground">
                {(c.lines ?? []).map((line, j) => (
                  <li key={j} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
        const to = appPath(c.link);
        return to !== null ? (
          <Link key={`${domain}-${i}`} to={to} className="block rounded-xl">
            {body}
          </Link>
        ) : (
          <div key={`${domain}-${i}`}>{body}</div>
        );
      })}
    </>
  );
}

function useDomainsWithHome(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    api.get<DomainInfo[]>('/domains').then(
      (ds) => live && setNames(ds.filter((d) => d.views.includes('home')).map((d) => d.name)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return names;
}

const actionWord = { notify: 'Reminder', check: 'Check', agent_turn: 'Kevin runs a task' } as const;

export default function HomePage() {
  const me = useMe();
  const now = useNow(60_000);
  const tz = me?.timezone;
  const domains = useDomainsWithHome();
  const agenda = useView<Agenda>('system/agenda');
  const notifications = useNotifications(6);
  const openNotification = useOpenNotification();
  const upcoming = agenda.data?.upcoming ?? [];
  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unread ?? 0;

  return (
    <Page>
      <header>
        <p className="text-muted-foreground">{longDate(now, tz)}</p>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight lg:text-[28px]">{greeting(now, tz)}, Ben</h1>
      </header>

      <div className="flex flex-col gap-3">
        <AskBox />
        <QuickActions />
      </div>

      {domains.length > 0 && (
        <div className="grid gap-3 empty:hidden @lg/page:grid-cols-2">
          {domains.map((d) => (
            <DomainCards key={d} domain={d} />
          ))}
        </div>
      )}

      <Section
        title="Coming up"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/jobs">All schedules</Link>
          </Button>
        }
      >
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">{agenda.loading ? 'Loading…' : (agenda.error ?? 'Nothing is scheduled for the next 24 hours.')}</p>
        ) : (
          <List>
            {upcoming.map((s) => (
              <ListRow key={s.id} to="/jobs" leading={<Clock />} title={s.name} subtitle={`${actionWord[s.action] ?? s.action}. ${humanizeTrigger(s.trigger_type, s.trigger_value, now)}`} meta={dateTime(s.next_run_at, now)} />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Recent notifications"
        action={
          unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead()}>
              <CheckCheck />
              Mark all read
            </Button>
          )
        }
      >
        {items.length === 0 ? (
          <p className="flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
            <BellOff className="size-4 shrink-0" />
            {notifications.loading ? 'Loading…' : (notifications.error ?? 'No notifications yet. Reminders and alerts from Kevin show up here.')}
          </p>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {items.map((n) => (
              <NotificationItem key={n.id} n={n} now={now} onOpen={openNotification} />
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
}
