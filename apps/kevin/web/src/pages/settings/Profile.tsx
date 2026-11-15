import { ArrowLeft, ChevronRight, Ellipsis, History, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState, Field, FormDialog, Markdown, Section, ViewState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { act, useAct } from '@/lib/act';
import { ago, dateTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { byLabel, previewText, profileInput, roughWords, type ProfileSection, type ProfileVersion, type ProfileView } from '@/lib/profile';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';

function SectionSheet({ section, onClose }: { section: ProfileSection | null; onClose: () => void }) {
  const [title, setTitle] = useState(section?.title ?? '');
  const [body, setBody] = useState(section?.body ?? '');
  const { run, pending } = useAct();
  const save = async () => {
    const input = profileInput(section, title, body);
    if (!input) return onClose();
    const r = await run('profile_update', input, { success: section ? 'Section saved' : 'Section added' });
    if (r.ok) onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={section ? 'Edit section' : 'Add section'}
      description={section ? 'The version you replace is kept in this section’s history.' : 'A part of who you are that Kevin should always have in mind: family, health background, work, the people in your life.'}
      submitLabel={section ? 'Save section' : 'Add section'}
      pending={pending}
      canSubmit={title.trim().length > 0 && body.trim().length > 0}
      onSubmit={() => void save()}
    >
      <Field label="Title">{(id) => <Input id={id} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Family" autoFocus={!section} />}</Field>
      <Field label="Text" hint="Plain writing. Markdown works for lists and headings.">
        {(id) => <Textarea id={id} value={body} maxLength={20_000} rows={14} className="min-h-[45dvh] lg:min-h-80" onChange={(e) => setBody(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function HistorySheet({ section, onClose }: { section: ProfileSection; onClose: () => void }) {
  const view = useView<ProfileVersion[]>('system/profile_history', { key: section.key });
  const [open, setOpen] = useState<ProfileVersion | null>(null);
  const { run, pending } = useAct();
  const now = useNow();
  const restore = async (v: ProfileVersion) => {
    const r = await run('profile_update', { section: section.key, body: v.body }, { success: 'Version restored' });
    if (r.ok) onClose();
  };
  const versions = view.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{open ? `${section.title}, earlier version` : `History of ${section.title}`}</DialogTitle>
          <DialogDescription>
            {open ? `Replaced ${dateTime(open.replaced_at, now)} by ${byLabel(open.replaced_by)}.` : 'Each time this section changed, the text it had before was kept.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <>
            <DialogBody>
              {open.title !== section.title && <p className="mb-2 text-sm text-muted-foreground">It was titled “{open.title}” then.</p>}
              <div className="rounded-lg border bg-card p-3.5">
                <Markdown text={open.body} />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)}>
                <ArrowLeft />
                All versions
              </Button>
              <Button disabled={pending || open.body.trim() === section.body.trim()} onClick={() => void restore(open)}>
                {open.body.trim() === section.body.trim() ? 'Same as the current text' : 'Restore this version'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogBody className="pb-5">
            {view.data === undefined ? (
              view.error ? <p className="text-sm text-destructive">{view.error}</p> : <Skeleton className="h-14" />
            ) : versions.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">This section has not changed since it was written.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => setOpen(v)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted active:bg-secondary">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">Until {dateTime(v.replaced_at, now)}</span>
                        <span className="block text-sm text-muted-foreground">Replaced by {byLabel(v.replaced_by)}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionItem({ s, now, onEdit, onHistory, onDelete }: { s: ProfileSection; now: Date; onEdit: () => void; onHistory: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-start">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-14 min-w-0 flex-1 items-start gap-2 py-3 pr-1 pl-3 text-left">
          <ChevronRight className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-snug">{s.title}</span>
            {!open && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{previewText(s.body)}</span>}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="mt-2 mr-2 shrink-0 text-muted-foreground" aria-label={`Options for ${s.title}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History />
              History{s.versions > 0 ? ` (${s.versions})` : ''}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="pr-4 pb-4 pl-9">
          <Markdown text={s.body} />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil />
              Edit
            </Button>
            <span className="text-xs text-muted-foreground">
              Last updated {ago(s.updated_at, now)} by {byLabel(s.updated_by)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/** "About you": the prose profile Kevin reads in every conversation. Its text appears nowhere else in the app. */
export function Profile() {
  const view = useView<ProfileView>('system/profile');
  const now = useNow();
  const [editing, setEditing] = useState<ProfileSection | 'new' | null>(null);
  const [history, setHistory] = useState<ProfileSection | null>(null);
  const [deleting, setDeleting] = useState<ProfileSection | null>(null);
  return (
    <Section
      title="About you"
      description="Who you are, in your words and Kevin’s. He reads all of it at the start of every conversation."
      action={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus />
          Add section
        </Button>
      }
    >
      <ViewState
        view={view}
        rows={2}
        isEmpty={(d) => d.sections.length === 0}
        empty={
          <EmptyState
            icon={UserRound}
            title="Nothing written yet"
            body="Kevin builds this up as he gets to know you. You can also write a section yourself: family, health background, work, the people in your life."
            action={<Button onClick={() => setEditing('new')}>Add section</Button>}
          />
        }
      >
        {(d) => {
          const sections = [...d.sections].sort((a, b) => a.position - b.position);
          return (
            <>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {sections.map((s) => (
                  <SectionItem key={s.key} s={s} now={now} onEdit={() => setEditing(s)} onHistory={() => setHistory(s)} onDelete={() => setDeleting(s)} />
                ))}
              </ul>
              <p className="px-1 text-xs text-muted-foreground">In all, {roughWords(sections)} that Kevin reads every time.</p>
            </>
          );
        }}
      </ViewState>

      {editing && <SectionSheet key={editing === 'new' ? 'new' : editing.key} section={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {history && <HistorySheet section={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ''}”?`}
        body="Kevin will no longer have this in mind. The text is not shown anywhere after this."
        confirmLabel="Delete section"
        onConfirm={() => {
          if (deleting) void act('profile_update', { section: deleting.key, delete: true }, { success: 'Section deleted' });
          setDeleting(null);
        }}
      />
    </Section>
  );
}
