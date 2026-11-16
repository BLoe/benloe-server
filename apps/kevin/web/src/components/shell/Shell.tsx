import { Ellipsis, MessageCircle, PanelRightOpen } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { LoadingRows } from '@/components/page/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { appPath } from '@/lib/links';
import { getPage, openChat, setDocked, setPage, startChat, useChat } from '@/lib/chat';
import { subscribe } from '@/lib/events';
import { useIsDesktop, useVisualViewport } from '@/lib/hooks';
import { markRead } from '@/lib/notifications';
import { registerServiceWorker } from '@/lib/push';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { SpaceIcon } from '@/components/SpaceIcon';
import { tabEntries, useNav, type Nav, type NavEntry } from '@/lib/nav';
import { builtinIcon, builtins, home, systemPages, type PageDef } from '@/pages/registry';
import { NotificationBell } from './NotificationBell';
import { PageErrorBoundary } from './PageErrorBoundary';
import { Toaster } from './Toaster';

function Wordmark() {
  return (
    <NavLink to="/" className="flex h-11 items-center gap-2 rounded-md text-[17px] font-semibold tracking-tight lg:h-9">
      <img src="/icons/icon-192.png" alt="" className="size-6 rounded-md" />
      Kevin
    </NavLink>
  );
}

function NavIcon({ entry, className }: { entry: NavEntry; className?: string }) {
  const Builtin = entry.kind === 'builtin' ? builtinIcon(entry.path) : undefined;
  return Builtin ? <Builtin className={className} strokeWidth={1.75} /> : <SpaceIcon name={entry.icon} className={className} />;
}

function DueBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="tabular ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning" aria-label={`${count} due soon`}>
      {count}
    </span>
  );
}

const sideLink = ({ isActive }: { isActive: boolean }) =>
  cn('flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium', isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground');

function SideNav({ nav }: { nav: Nav }) {
  const fixed = (p: PageDef) => (
    <NavLink key={p.path} to={p.path} end={p.path === '/'} className={sideLink}>
      <p.icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      {p.label}
    </NavLink>
  );
  return (
    <nav aria-label="Pages" className="hidden w-56 shrink-0 flex-col border-r py-3 lg:flex">
      <div className="mb-4 flex h-9 shrink-0 items-center justify-between pr-3 pl-5">
        <Wordmark />
        <NotificationBell align="start" />
      </div>
      <div className="scroll-area flex min-h-0 flex-1 flex-col gap-0.5 px-3">
        {fixed(home)}
        {nav.entries.map((e) => (
          <NavLink key={e.path} to={e.path} className={sideLink}>
            <NavIcon entry={e} className="size-[18px] shrink-0" />
            <span className="truncate">{e.label}</span>
            <DueBadge count={e.badge} />
          </NavLink>
        ))}
      </div>
      <div className="mx-3 flex shrink-0 flex-col gap-0.5 border-t pt-3">{systemPages.map(fixed)}</div>
    </nav>
  );
}

const moreLink = ({ isActive }: { isActive: boolean }) => cn('flex h-13 items-center gap-3.5 rounded-lg px-3 text-base font-medium', isActive ? 'bg-accent text-accent-foreground' : 'active:bg-secondary');

function MoreSheet({ open, onOpenChange, rest }: { open: boolean; onOpenChange: (o: boolean) => void; rest: NavEntry[] }) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>More</DialogTitle>
          <DialogDescription className="sr-only">The rest of Kevin’s pages</DialogDescription>
        </DialogHeader>
        <DialogBody className="px-3 pb-4">
          {rest.map((e) => (
            <NavLink key={e.path} to={e.path} onClick={close} className={moreLink}>
              <NavIcon entry={e} className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{e.label}</span>
              <DueBadge count={e.badge} />
            </NavLink>
          ))}
          {rest.length > 0 && <div className="mx-3 my-2 border-t" />}
          {systemPages.map((p) => (
            <NavLink key={p.path} to={p.path} onClick={close} className={moreLink}>
              <p.icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              {p.label}
            </NavLink>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The phone's bar: Home, the first three entries of the nav, More, and the
 * chat button. Chat sits in the bar rather than floating over the page, so it
 * never covers a row's switch or menu.
 */
function TabBar({ nav, running }: { nav: Nav; running: boolean }) {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const { tabs, rest } = tabEntries(nav.entries);
  const onTab = pathname === '/' || tabs.some((t) => pathname === t.path || pathname.startsWith(`${t.path}/`));
  const item = 'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium';
  const tone = ({ isActive }: { isActive: boolean }) => cn(item, isActive ? 'text-primary' : 'text-muted-foreground');
  return (
    <nav aria-label="Pages" className="pb-safe shrink-0 border-t bg-card lg:hidden">
      <div className="flex items-center pr-2 pl-1">
        <NavLink to="/" end className={tone}>
          <home.icon className="size-[22px]" strokeWidth={1.75} />
          Home
        </NavLink>
        {tabs.map((e) => (
          <NavLink key={e.path} to={e.path} className={tone}>
            <span className="relative">
              <NavIcon entry={e} className="size-[22px]" />
              {!!e.badge && <span className="absolute -top-0.5 -right-1.5 size-2 rounded-full bg-warning" aria-label={`${e.badge} due soon`} />}
            </span>
            <span className="max-w-full truncate">{e.label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={cn(item, !onTab ? 'text-primary' : 'text-muted-foreground')}>
          <span className="relative">
            <Ellipsis className="size-[22px]" strokeWidth={1.75} />
            {rest.some((e) => e.badge) && <span className="absolute -top-0.5 -right-1.5 size-2 rounded-full bg-warning" aria-label="Something behind More is due soon" />}
          </span>
          More
        </button>
        <button type="button" onClick={() => openChat()} aria-label="Chat with Kevin" className="relative ml-1.5 grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm active:bg-primary/85">
          <MessageCircle className="size-[22px]" />
          {running && <span className="absolute top-0 right-0 size-3 rounded-full border-2 border-card bg-warning" style={{ animation: 'kevin-pulse 1.2s ease-in-out infinite' }} aria-label="Kevin is working" />}
        </button>
      </div>
      <MoreSheet open={more} onOpenChange={setMore} rest={rest} />
    </nav>
  );
}

/** The phone's chat: a sheet over everything, sized to the area the keyboard leaves free. */
function ChatSheet() {
  const vv = useVisualViewport();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chat with Kevin"
      className="fixed inset-x-0 top-0 z-40 h-dvh animate-[kevin-sheet-up_240ms_cubic-bezier(0.2,0.8,0.2,1)] bg-background"
      style={vv ? { height: vv.height, top: vv.top } : undefined}
    >
      <ChatPanel mode="sheet" />
    </div>
  );
}

export function Shell() {
  const desktop = useIsDesktop();
  const chat = useChat();
  const location = useLocation();
  const navigate = useNavigate();
  const main = useRef<HTMLElement>(null);
  const running = !!chat.thread?.running;
  const nav = useNav(builtins);

  useEffect(() => {
    startChat();
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith('/chat/')) setPage(location.pathname);
    main.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // A notification that arrives while the app is open shows as a toast.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'notification') return;
        toast.info(e.title, { body: e.body, link: e.link, onClick: () => markRead([e.id]) });
      }),
    [],
  );

  // A tapped push notification asks the open window to go to its link.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; link?: string; notificationId?: number | null } | null;
      const path = d?.type === 'navigate' ? appPath(d.link) : null;
      if (path === null) return;
      if (typeof d?.notificationId === 'number') markRead([d.notificationId]);
      void navigate(path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <div className="flex h-dvh">
      <SideNav nav={nav} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="pt-safe shrink-0 border-b bg-card lg:hidden">
          <div className="flex h-12 items-center justify-between pr-1.5 pl-4">
            <Wordmark />
            <NotificationBell />
          </div>
        </header>
        {/* A container: pages size their columns to this region (@lg/page:, @2xl/page:), because the docked chat makes it much narrower than the window. */}
        <main ref={main} className="scroll-area @container/page min-h-0 flex-1">
          <PageErrorBoundary resetKey={location.pathname}>
            <Suspense
              fallback={
                <div className="mx-auto max-w-3xl px-4 pt-8 lg:px-8">
                  <LoadingRows />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </PageErrorBoundary>
        </main>
        <TabBar nav={nav} running={running} />
        {/* Desktop, chat collapsed: a button on the page's top edge brings it back. */}
        {desktop && !chat.docked && (
          <Button onClick={() => setDocked(true)} variant="outline" className="absolute top-3 right-4 h-9 px-3">
            <PanelRightOpen />
            Chat
            {running && <span className="size-2 rounded-full bg-warning" style={{ animation: 'kevin-pulse 1.2s ease-in-out infinite' }} aria-label="Kevin is working" />}
          </Button>
        )}
      </div>
      {desktop && chat.docked && (
        <aside className="w-[400px] shrink-0 border-l xl:w-[440px]">
          <ChatPanel mode="docked" />
        </aside>
      )}
      {!desktop && chat.sheet && <ChatSheet />}
      <Toaster />
    </div>
  );
}

/** /chat/:threadId — opens that thread in the chat and returns to the page underneath. */
export function ChatRoute() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (threadId) openChat({ threadId });
    // getPage() is the last real page: the chat opens over it rather than over Home.
    void navigate(getPage(), { replace: true });
  }, [threadId, navigate]);
  return null;
}
