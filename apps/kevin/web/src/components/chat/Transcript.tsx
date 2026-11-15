import { ArrowDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/page/states';
import { Skeleton } from '@/components/ui/skeleton';
import { openChat, selectThread, type ChatState } from '@/lib/chat';
import type { Confirm } from '@/lib/transcript';
import { TurnView, UserBubble } from './TurnView';

const STARTERS = ['What can I make tonight?', 'Log a workout', 'Add to the shopping list', 'What’s coming up this week?'];
const NONE: Confirm[] = [];

function NewChat() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-4 px-4 pb-4">
      <div>
        <p className="text-lg font-semibold">What do you need?</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Kevin can see the page you’re on and change what’s on it.</p>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => openChat(s.endsWith('?') ? { send: s } : { prefill: `${s}: ` })}
            className="min-h-10 rounded-full border bg-card px-3.5 text-left text-sm hover:bg-muted"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Transcript({ chat }: { chat: ChatState }) {
  const { thread } = chat;
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);

  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stuck.current = near;
    setAway(!near);
  };

  // Follow the stream only while Ben is at the bottom; scrolling up to read holds his place.
  useLayoutEffect(() => {
    if (stuck.current) toBottom();
  }, [thread]);
  // A different thread, or his own message going out, always lands at the bottom.
  const pendingCount = thread?.pending.length ?? 0;
  useEffect(() => {
    stuck.current = true;
    toBottom();
  }, [chat.threadId, pendingCount]);

  if (!chat.threadId || (thread && !thread.turns.length && !thread.pending.length && !chat.loading)) return <NewChat />;
  if (!thread) {
    return (
      <div className="flex-1 space-y-4 p-4">
        {chat.loadError ? (
          <ErrorState message={chat.loadError} onRetry={() => selectThread(chat.threadId!)} />
        ) : (
          <>
            <Skeleton className="ml-auto h-9 w-2/3 rounded-2xl" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/5" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="scroll-area flex-1 px-4 py-4" aria-live="polite">
        <div className="flex flex-col gap-6">
          {thread.turns.map((t) => {
            const confirms = thread.confirms.filter((c) => c.turnId === t.id);
            return <TurnView key={t.id} turn={t} confirms={confirms.length ? confirms : NONE} />;
          })}
          {thread.pending.map((p, i) => (
            <UserBubble key={i} text={p.text} attachments={p.attachments} note={thread.running ? 'Kevin will read this at his next step' : 'Sending…'} />
          ))}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          aria-label="Jump to the latest message"
          className="absolute bottom-3 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-card shadow-md"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
