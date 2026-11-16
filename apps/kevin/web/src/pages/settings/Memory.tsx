import { Brain, Ellipsis, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog, EmptyState, Field, FormDialog, List, ListRow, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { act, useAct } from '@/lib/act';
import { clock, shortDate } from '@/lib/format';
import { logLine } from '@/lib/profile';
import type { Fact, MemoryHit, MemoryLogRow } from '@/lib/types';
import { useView } from '@/lib/useView';
import { Profile } from './Profile';

function FactDialog({ fact, categories, onClose }: { fact: Fact | null; categories: string[]; onClose: () => void }) {
  const [text, setText] = useState(fact?.text ?? '');
  const [category, setCategory] = useState(fact?.category ?? 'general');
  const { run, pending } = useAct();
  const save = async () => {
    const input = { text: text.trim(), category: category.trim().toLowerCase() || 'general' };
    const r = fact ? await run('fact_update', { id: fact.id, ...input }, { success: 'Fact saved' }) : await run('remember', input, { success: 'Kevin will remember that' });
    if (r.ok) onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={fact ? 'Edit fact' : 'Add a fact'}
      description="Facts are in front of Kevin in every conversation. One per entry, as a full sentence."
      submitLabel={fact ? 'Save fact' : 'Add fact'}
      pending={pending}
      canSubmit={text.trim().length >= 3}
      onSubmit={() => void save()}
    >
      <Field label="Fact">{(id) => <Textarea id={id} value={text} maxLength={500} rows={3} onChange={(e) => setText(e.target.value)} placeholder="Ben is allergic to shellfish." autoFocus />}</Field>
      <Field label="Category" hint="For grouping: food, health, fitness, money, family, preferences…">
        {(id) => (
          <>
            <Input id={id} value={category} maxLength={40} list={`${id}-list`} autoCapitalize="off" onChange={(e) => setCategory(e.target.value)} />
            <datalist id={`${id}-list`}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </FormDialog>
  );
}

function Facts() {
  const view = useView<Fact[]>('system/facts');
  const [editing, setEditing] = useState<Fact | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Fact | null>(null);
  const categories = [...new Set((view.data ?? []).map((f) => f.category))].sort();
  return (
    <Section
      title="Facts"
      description="Single things Kevin must always keep in mind: an allergy, a preference, a goal."
      action={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus />
          Add fact
        </Button>
      }
    >
      <ViewState view={view} empty={<EmptyState icon={Brain} title="No facts yet" body="Add one here, or tell Kevin something worth keeping: an allergy, a goal, how you like things done." action={<Button onClick={() => setEditing('new')}>Add fact</Button>} />}>
        {(facts) => (
          <List>
            {facts.map((f) => (
              <ListRow
                key={f.id}
                wrap
                title={<span className="font-normal">{f.text}</span>}
                subtitle={<Badge className="mt-1">{f.category}</Badge>}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Fact options">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setEditing(f)}>
                        <Pencil />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setDeleting(f)}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
          </List>
        )}
      </ViewState>
      {editing && <FactDialog key={editing === 'new' ? 'new' : editing.id} fact={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this fact?"
        body={deleting?.text}
        confirmLabel="Delete fact"
        onConfirm={() => {
          if (deleting) void act('fact_update', { id: deleting.id, delete: true }, { success: 'Fact deleted' });
          setDeleting(null);
        }}
      />
    </Section>
  );
}

const kindLabel: Record<string, string> = {
  'log-summary': 'Conversation', 'log-event': 'Change', 'log-note': 'Note', document: 'Document', attachment: 'Upload', recipe: 'Recipe',
  'space-record': 'Space item', profile: 'About you',
  summary: 'Conversation', event: 'Change', note: 'Note',
};

function MemorySearch() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  // Search as he types, but not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const view = useView<MemoryHit[]>('system/memory_search', { q }, { enabled: q.length >= 2 });
  return (
    <Section title="The log and search" description="Everything else: past conversations, what changed day by day, notes, and the text of documents. Kevin looks things up here when he needs them.">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you want to find?" aria-label="Search memory" className="pl-9" enterKeyHint="search" />
      </div>
      {q.length >= 2 && (
        <ViewState view={view} rows={2} empty={<p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Nothing in memory matches “{q}”.</p>}>
          {(hits) => (
            <List>
              {hits.map((h) => (
                <ListRow
                  key={`${h.kind}:${h.ref}`}
                  wrap
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words">{h.title || kindLabel[h.kind] || h.kind}</span>
                      <Badge variant="outline">{kindLabel[h.kind] ?? h.kind}</Badge>
                    </span>
                  }
                  subtitle={<span className="break-words">{h.snippet}</span>}
                  meta={h.at ? shortDate(h.at) : undefined}
                />
              ))}
            </List>
          )}
        </ViewState>
      )}
    </Section>
  );
}

function TodayLog() {
  const view = useView<MemoryLogRow[]>('system/memory_log');
  return (
    <Section title={<span className="text-[15px]">Today</span>} description="What changed today, as Kevin recorded it.">
      <ViewState view={view} rows={2} empty={<p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Nothing logged yet today.</p>}>
        {(rows) => (
          <List>
            {rows.map((r) => (
              <ListRow key={r.id} wrap title={<span className="text-[14px] font-normal break-words">{logLine(r.text)}</span>} subtitle={`${clock(r.at)}, ${(kindLabel[r.kind] ?? r.kind).toLowerCase()}`} />
            ))}
          </List>
        )}
      </ViewState>
    </Section>
  );
}

export function Memory() {
  return (
    <div className="flex flex-col gap-8">
      <Profile />
      <Facts />
      <div className="flex flex-col gap-4">
        <MemorySearch />
        <TodayLog />
      </div>
    </div>
  );
}
