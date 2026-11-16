import { Apple, MessageCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, Page, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { openChat } from '@/lib/chat';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { removeItem } from './pantry/actions';
import { InStock, OutOfStock, UseSoon, type ItemHandlers } from './pantry/items';
import type { ItemDraft, PantryItem, PantryOverview, ShoppingItem } from './pantry/logic';
import { PhotoButton } from './pantry/parts';
import { Shopping } from './pantry/Shopping';
import { ItemSheet, ShoppingSheet, UseSheet } from './pantry/sheets';

const TABS = ['stock', 'soon', 'out', 'list'] as const;
type Tab = (typeof TABS)[number];

function Count({ n, tone }: { n: number; tone?: 'warning' }) {
  if (!n) return null;
  return <span className={cn('tabular ml-1.5 rounded-full px-1.5 py-px text-xs', tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-secondary text-muted-foreground')}>{n}</span>;
}

/** /pantry — what is in the house, what to use up, what ran out, and the shopping list. One call to pantry/overview. */
export default function PantryPage() {
  const view = useView<PantryOverview>('pantry/overview');
  // The tab lives in the URL so Home's cards, Kevin's links and the back button can land on it.
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'stock';
  const [sheet, setSheet] = useState<{ item: PantryItem | null; preset?: Partial<ItemDraft> } | null>(null);
  const [using, setUsing] = useState<PantryItem | null>(null);
  const [removing, setRemoving] = useState<PantryItem | null>(null);
  const [listItem, setListItem] = useState<ShoppingItem | null>(null);

  const data = view.data;
  const header = (
    <PageHeader
      title="Pantry"
      description="What’s in the fridge, freezer and cupboards."
      actions={
        data && (
          <>
            <PhotoButton />
            <Button onClick={() => setSheet({ item: null })}>
              <Plus />
              Add item
            </Button>
          </>
        )
      }
    />
  );

  if (!data) {
    return (
      <Page>
        {header}
        {view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={6} />}
      </Page>
    );
  }

  const h: ItemHandlers = { onOpen: (item) => setSheet({ item }), onUse: setUsing, onRemove: setRemoving };
  const c = data.counts;
  const nothingYet = c.in_stock === 0 && c.out_of_stock === 0;

  return (
    <Page className="gap-5">
      {header}
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'stock' ? {} : { tab: t }, { replace: true })} className="gap-4">
        <TabsList>
          <TabsTrigger value="stock">
            In stock
            <Count n={c.in_stock} />
          </TabsTrigger>
          <TabsTrigger value="soon">
            Use soon
            <Count n={c.expired + c.expiring_soon} tone="warning" />
          </TabsTrigger>
          <TabsTrigger value="out">
            Out
            <Count n={c.out_of_stock} />
          </TabsTrigger>
          <TabsTrigger value="list">
            Shopping list
            <Count n={c.to_buy} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          {c.in_stock === 0 ? (
            <EmptyState
              icon={Apple}
              title={nothingYet ? 'Nothing in the pantry yet' : 'Nothing in stock'}
              body="Add a few things by hand, snap the fridge or a receipt and Kevin reads it, or just tell him what you have."
              action={
                <>
                  <Button onClick={() => setSheet({ item: null })}>
                    <Plus />
                    Add item
                  </Button>
                  <PhotoButton />
                  <Button variant="outline" onClick={() => openChat({ prefill: 'Here’s what I have in the kitchen: ' })}>
                    <MessageCircle />
                    Tell Kevin
                  </Button>
                </>
              }
            />
          ) : (
            <InStock data={data} h={h} onNew={(name) => setSheet({ item: null, preset: name.trim() ? { name: name.trim() } : undefined })} />
          )}
        </TabsContent>
        <TabsContent value="soon">
          <UseSoon data={data} h={h} onAsk={() => openChat({ send: 'What can I cook that uses up what’s about to expire?', newThread: true })} />
        </TabsContent>
        <TabsContent value="out">
          <OutOfStock data={data} h={h} />
        </TabsContent>
        <TabsContent value="list">
          <Shopping data={data} onOpen={setListItem} />
        </TabsContent>
      </Tabs>

      {sheet && (
        <ItemSheet
          key={sheet.item?.id ?? 'new'}
          item={sheet.item}
          preset={sheet.preset}
          today={data.today}
          onClose={() => setSheet(null)}
          onRemove={(item) => {
            setSheet(null);
            setRemoving(item);
          }}
        />
      )}
      {using && <UseSheet key={using.id} item={using} onClose={() => setUsing(null)} />}
      {listItem && <ShoppingSheet key={listItem.id} item={listItem} onClose={() => setListItem(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ''}?`}
        body="The item is deleted, as if it was never here. If it just ran out, mark it “Ran out” instead so it stays under Out of stock."
        confirmLabel="Remove"
        onConfirm={() => removing && void removeItem(removing)}
      />
    </Page>
  );
}
