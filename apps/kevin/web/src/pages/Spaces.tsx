import { Plus, Shapes } from 'lucide-react';
import { useState } from 'react';
import { AskKevin, EmptyState, List, ListRow, Page, PageHeader, ViewState } from '@/components/page';
import { SpaceIcon } from '@/components/SpaceIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { countsLabel, layoutLabel, type NavPayload } from '@/lib/spaces';
import { useView } from '@/lib/useView';
import { SpaceForm } from './space/SpaceForm';

/** /spaces — every space, pinned or not, and the way to make one by hand. */
export default function SpacesPage() {
  const view = useView<NavPayload>('spaces/nav');
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Spaces"
        description="A page for anything you want to keep track of: a trip, the car, a reading list."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New space
          </Button>
        }
      />
      <ViewState
        view={view}
        isEmpty={(d) => d.spaces.length === 0}
        empty={
          <EmptyState
            icon={Shapes}
            title="No spaces yet"
            body="The quickest way to make one is to tell Kevin what you want to keep track of. He sets up the page and fills it in."
            action={
              <>
                <AskKevin prompt="I want to keep track of " prefill variant="default">
                  Tell Kevin
                </AskKevin>
                <Button variant="outline" onClick={() => setCreating(true)}>
                  Set one up by hand
                </Button>
              </>
            }
          />
        }
      >
        {(d) => (
          <>
            <List>
              {d.spaces.map((s) => (
                <ListRow
                  key={s.id}
                  to={s.link}
                  leading={<SpaceIcon name={s.icon} className="size-5" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {s.name}
                      {s.counts.due_soon > 0 && <Badge variant="warning">{s.counts.due_soon} due soon</Badge>}
                    </span>
                  }
                  subtitle={[s.description || layoutLabel[s.layout], s.pinned ? null : 'Not in the nav'].filter(Boolean).join('. ')}
                  meta={countsLabel({ ...s.counts, due_soon: 0 })}
                />
              ))}
            </List>
            <AskKevin prompt="I want to keep track of " prefill className="self-start">
              Start something new with Kevin
            </AskKevin>
          </>
        )}
      </ViewState>
      {creating && <SpaceForm space={null} onClose={() => setCreating(false)} />}
    </Page>
  );
}
