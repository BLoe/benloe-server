import { Archive, Ellipsis, MessageCircle, Pencil, Pin, PinOff, Plus, SearchX, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, Page, PageHeader } from '@/components/page';
import { SpaceIcon } from '@/components/SpaceIcon';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { act } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { localDay, plural } from '@/lib/format';
import type { Layout, Space, SpaceRecord } from '@/lib/spaces';
import { Board, Checklist, Notes, Rows, Table } from './space/layouts';
import type { LayoutProps } from './space/parts';
import { RecordSheet } from './space/RecordSheet';
import { SpaceForm } from './space/SpaceForm';
import { useSpace } from './space/useSpace';

const layouts: Record<Layout, (p: LayoutProps) => React.ReactNode> = { list: Rows, checklist: Checklist, table: Table, board: Board, notes: Notes };

const emptyText: Record<Layout, string> = {
  list: 'Add the first item above, or tell Kevin what belongs here.',
  checklist: 'Add the first thing to tick off above, or tell Kevin what needs doing.',
  table: 'Add the first row above, or tell Kevin what to record.',
  board: 'Add the first card above, or tell Kevin what to track.',
  notes: 'Write the first note, or ask Kevin to draft one.',
};

function SpaceMenu({ space, onEdit, onDelete }: { space: Space; onEdit: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  const save = (patch: object, success: string) => act('space_save', { space: space.slug, ...patch }, { success });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Space options">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit space
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save({ pinned: !space.pinned }, space.pinned ? 'Removed from the nav' : 'Pinned to the nav')}>
          {space.pinned ? <PinOff /> : <Pin />}
          {space.pinned ? 'Unpin from nav' : 'Pin to nav'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void save({ archived: true }, 'Archived. Restore it from Settings.').then((r) => {
              if (r.ok) void navigate('/spaces');
            })
          }
        >
          <Archive />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 />
          Delete space
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** /s/:slug — the one page that renders every space, by its layout. */
export default function SpacePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { view, records, update } = useSpace(slug);
  const [editing, setEditing] = useState<{ record: SpaceRecord | null; preset?: Record<string, unknown> } | null>(null);
  const [form, setForm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (view.data === undefined) {
    return <Page>{view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows />}</Page>;
  }
  const space = view.data.space;
  if (!space) {
    return (
      <Page>
        <EmptyState
          icon={SearchX}
          title="There’s no space here"
          body="It may have been deleted or renamed."
          action={
            <Button asChild variant="outline">
              <Link to="/spaces">See all spaces</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const today = view.data.today ?? localDay();
  const Layout = layouts[space.layout] ?? Rows;
  const props: LayoutProps = {
    space,
    records,
    today,
    onOpen: (record) => setEditing({ record }),
    onToggle: (r) => void update([{ id: r.id, done: !r.done }]),
    onAdd: (title, data) => void update([{ title, ...(data ? { data } : {}) }]),
    onNew: (preset) => setEditing({ record: null, preset }),
    onMove: (r, data) => void update([{ id: r.id, data }]),
  };

  return (
    <Page wide={space.layout === 'table' || space.layout === 'board'} className="gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <SpaceIcon name={space.icon} className="size-6 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{space.name}</span>
          </span>
        }
        description={space.archived ? 'Archived. Restore it from Settings to add to it again.' : space.description}
        actions={
          <>
            <Button variant="outline" onClick={() => openChat({ prefill: `In ${space.name}: ` })}>
              <MessageCircle />
              Ask Kevin
            </Button>
            <Button onClick={() => setEditing({ record: null })}>
              <Plus />
              {space.layout === 'notes' ? 'New note' : 'Add'}
            </Button>
            <SpaceMenu space={space} onEdit={() => setForm(true)} onDelete={() => setDeleting(true)} />
          </>
        }
      />

      <Layout {...props} />
      {records.length === 0 && <EmptyState icon={undefined} title="Nothing here yet" body={emptyText[space.layout]} />}

      {editing && <RecordSheet key={editing.record?.id ?? 'new'} space={space} record={editing.record} preset={editing.preset} onSave={update} onClose={() => setEditing(null)} />}
      {form && <SpaceForm space={space} onClose={() => setForm(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${space.name}”?`}
        body={`The space and its ${plural(space.counts.total, 'item')} are removed for good. To keep them but put the space away, archive it instead.`}
        confirmLabel="Delete space"
        onConfirm={() =>
          void act('space_delete', { space: space.slug }, { success: 'Space deleted' }).then((r) => {
            if (r.ok) void navigate('/spaces');
          })
        }
      />
    </Page>
  );
}
