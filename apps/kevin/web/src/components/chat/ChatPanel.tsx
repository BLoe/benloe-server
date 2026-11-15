import { Archive, ChevronDown, Ellipsis, History, PanelRightClose, Pencil, SquarePen } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addFiles, archiveThread, closeChat, newChat, setDocked, showThreads, useChat } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Composer } from './Composer';
import { RenameDialog } from './ThreadList';
import { ThreadList } from './ThreadList';
import { Transcript } from './Transcript';

/** The whole chat: header, transcript or thread list, composer. `mode` only changes how it is dismissed. */
export function ChatPanel({ mode }: { mode: 'docked' | 'sheet' }) {
  const chat = useChat();
  const [renaming, setRenaming] = useState(false);
  const [dropping, setDropping] = useState(false);
  const listing = chat.view === 'threads';
  const title = listing ? 'Chats' : (chat.thread?.title ?? (chat.threadId ? 'Chat' : 'New chat'));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
  };

  return (
    <section
      aria-label="Chat with Kevin"
      className={cn('relative flex h-full min-h-0 flex-col bg-background', dropping && 'ring-2 ring-primary ring-inset')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <header className={cn('flex h-13 shrink-0 items-center gap-0.5 border-b px-1.5', mode === 'sheet' && 'pt-safe h-auto min-h-13')}>
        {mode === 'sheet' && (
          <Button variant="ghost" size="icon" onClick={closeChat} aria-label="Close chat">
            <ChevronDown className="size-5" />
          </Button>
        )}
        <Button variant={listing ? 'secondary' : 'ghost'} size="icon" onClick={() => showThreads(!listing)} aria-label={listing ? 'Back to the chat' : 'All chats'} aria-pressed={listing}>
          <History className="size-[18px]" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate px-1.5 font-semibold">{title}</h2>
        {!listing && chat.threadId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Chat options">
                <Ellipsis className="size-[18px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void archiveThread(chat.threadId!)}>
                <Archive />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="ghost" size="icon" onClick={newChat} aria-label="New chat">
          <SquarePen className="size-[18px]" />
        </Button>
        {mode === 'docked' && (
          <Button variant="ghost" size="icon" onClick={() => setDocked(false)} aria-label="Hide chat">
            <PanelRightClose className="size-[18px]" />
          </Button>
        )}
      </header>
      {listing ? (
        <ThreadList chat={chat} />
      ) : (
        <>
          <Transcript chat={chat} />
          <Composer chat={chat} />
        </>
      )}
      <RenameDialog thread={renaming && chat.threadId ? { id: chat.threadId, title: chat.thread?.title ?? '' } : null} onClose={() => setRenaming(false)} />
    </section>
  );
}
