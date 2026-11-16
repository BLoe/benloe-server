import { Archive, Ellipsis, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, Field, FormDialog } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { archiveThread, newChat, renameThread, selectThread, type ChatState } from '@/lib/chat';
import { ago } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { ThreadSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export function RenameDialog({ thread, onClose }: { thread: { id: string; title: string } | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [forId, setForId] = useState<string | null>(null);
  if (thread && thread.id !== forId) {
    setForId(thread.id);
    setTitle(thread.title);
  }
  if (!thread && forId) setForId(null);
  return (
    <FormDialog
      open={!!thread}
      onOpenChange={(o) => !o && onClose()}
      title="Rename chat"
      submitLabel="Rename"
      canSubmit={title.trim().length > 0}
      onSubmit={() => {
        if (thread) void renameThread(thread.id, title.trim());
        onClose();
      }}
    >
      <Field label="Name">{(id) => <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
    </FormDialog>
  );
}

export function ThreadList({ chat }: { chat: ChatState }) {
  const now = useNow();
  const [renaming, setRenaming] = useState<ThreadSummary | null>(null);
  const threads = chat.threads;
  return (
    <div className="scroll-area flex-1 px-2 py-2">
      <Button variant="outline" className="mx-2 mb-2 w-[calc(100%-1rem)]" onClick={newChat}>
        <Plus />
        New chat
      </Button>
      {!threads ? (
        <div className="space-y-3 p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : threads.length === 0 ? (
        <EmptyState className="m-2" title="No chats yet" body="Start one and it will be listed here." />
      ) : (
        <ul>
          {threads.map((t) => (
            <li key={t.id} className={cn('flex items-center rounded-lg', t.id === chat.threadId && 'bg-secondary')}>
              <button type="button" onClick={() => selectThread(t.id)} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-lg px-3 py-1.5 text-left hover:bg-secondary/70">
                <span className="flex items-center gap-2">
                  {t.running && <span className="size-2 shrink-0 rounded-full bg-primary" style={{ animation: 'kevin-pulse 1.2s ease-in-out infinite' }} aria-label="Kevin is working" />}
                  <span className="truncate font-medium">{t.title}</span>
                  {t.origin === 'job' && <Badge variant="outline">Scheduled</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{ago(t.updated_at, now)}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="mr-1 text-muted-foreground" aria-label={`Options for ${t.title}`}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setRenaming(t)}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void archiveThread(t.id)}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <RenameDialog thread={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}
