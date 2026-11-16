import { ArchiveRestore } from 'lucide-react';
import { List, ListRow, Section, ViewState } from '@/components/page';
import { SpaceIcon } from '@/components/SpaceIcon';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { act } from '@/lib/act';
import { countsLabel, type NavPayload, type Space } from '@/lib/spaces';
import { useView } from '@/lib/useView';
import { builtinIcon } from '@/pages/registry';

export function Navigation() {
  const nav = useView<NavPayload>('spaces/nav');
  const all = useView<{ spaces: Space[] }>('spaces/list', { archived: true });
  const archived = (all.data?.spaces ?? []).filter((s) => s.archived);
  return (
    <div className="flex flex-col gap-7">
      <Section title="Built-in pages" description="Hide the ones you don’t use. A hidden page keeps its data, and Kevin stops carrying that area’s tools and tables in every message, which makes each one cheaper. Turn it back on any time.">
        <ViewState view={nav} rows={6}>
          {(d) => {
            const hidden = d.builtin.filter((b) => b.hidden).map((b) => b.path);
            const toggle = (path: string, show: boolean) => void act('nav_update', { hidden_pages: show ? hidden.filter((p) => p !== path) : [...hidden, path] });
            return (
              <List>
                {d.builtin.map((b) => {
                  const Icon = builtinIcon(b.path);
                  return <ListRow key={b.path} leading={Icon ? <Icon strokeWidth={1.75} /> : undefined} title={b.name} muted={b.hidden} trailing={<Switch checked={!b.hidden} aria-label={`Show ${b.name}`} onCheckedChange={(on) => toggle(b.path, on)} />} />;
                })}
              </List>
            );
          }}
        </ViewState>
      </Section>

      <Section title="Spaces" description="Pinned spaces show in the nav; the rest are under All spaces.">
        <ViewState view={nav} rows={2} isEmpty={(d) => d.spaces.length === 0} empty={<p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No spaces yet. Tell Kevin what you want to keep track of and he makes one.</p>}>
          {(d) => (
            <List>
              {d.spaces.map((s) => (
                <ListRow
                  key={s.id}
                  leading={<SpaceIcon name={s.icon} className="size-5" />}
                  title={s.name}
                  subtitle={countsLabel(s.counts)}
                  trailing={<Switch checked={s.pinned} aria-label={`Pin ${s.name} to the nav`} onCheckedChange={(pinned) => void act('space_save', { space: s.slug, pinned })} />}
                />
              ))}
            </List>
          )}
        </ViewState>
      </Section>

      {archived.length > 0 && (
        <Section title="Archived spaces" description="Put away, with everything in them kept.">
          <List>
            {archived.map((s) => (
              <ListRow
                key={s.id}
                muted
                leading={<SpaceIcon name={s.icon} className="size-5" />}
                title={s.name}
                subtitle={countsLabel(s.counts)}
                trailing={
                  <Button variant="outline" size="sm" onClick={() => void act('space_save', { space: s.slug, archived: false }, { success: `${s.name} restored` })}>
                    <ArchiveRestore />
                    Restore
                  </Button>
                }
              />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}
