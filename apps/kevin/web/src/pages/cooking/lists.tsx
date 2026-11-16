import { BookOpen, ChefHat, GraduationCap, Plus, Search, ShoppingCart, Sparkles, UtensilsCrossed, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Chips, EmptyState, List, ListRow, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { openChat } from '@/lib/chat';
import { calendarDay, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { expiryLabel, midSentence } from '../pantry/logic';
import { filterRecipes, minutesLabel, recipeMeta, tonightList, type CookingOverview, type LogEntry, type RecipeSummary } from './logic';
import { addMissing, FavouriteMark, Stars } from './parts';

const card = 'divide-y overflow-hidden rounded-xl border bg-card';
export const TEACH_ME = 'Teach me something new: pick a technique I haven’t practised and a dish that would teach it, using what’s in my pantry where you can.';

function TonightRow({ r, onOpen }: { r: RecipeSummary; onOpen: (id: number) => void }) {
  const fit = r.pantry;
  const toList = fit.missing.filter((m) => !m.on_shopping_list).length;
  const meta = recipeMeta({ total_minutes: r.total_minutes, difficulty: r.difficulty });
  return (
    <li className="flex items-stretch" data-tonight={r.title}>
      <button type="button" onClick={() => onOpen(r.id)} className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 py-3 pr-2 pl-4 text-left hover:bg-muted active:bg-secondary">
        <span className="flex items-center gap-2 leading-snug font-medium">
          <span className="min-w-0 break-words">{r.title}</span>
          <FavouriteMark on={r.favourite} />
          <Stars value={r.rating} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {fit.can_make ? <Badge variant="success">Ready to cook</Badge> : <Badge>Missing {fit.missing_count} of {fit.ingredient_count}</Badge>}
          {meta && <span>{meta}</span>}
        </span>
        {fit.missing_count > 0 && <span className="text-sm break-words text-muted-foreground">Needs {fit.missing.map((m) => m.name.toLowerCase()).join(', ')}</span>}
        {fit.uses_expiring.length > 0 && (
          <span className="text-sm break-words text-warning">
            Uses {fit.uses_expiring.map((u) => `${u.name.toLowerCase()} (${expiryLabel(u.days_left, u.expires_on).toLowerCase()})`).join(', ')}
          </span>
        )}
      </button>
      {fit.missing_count > 0 && (
        <div className="flex shrink-0 items-center pr-2.5">
          {toList > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void addMissing(fit, r.id)} aria-label={`Add ${plural(toList, 'missing ingredient')} for ${r.title} to the shopping list`}>
              <ShoppingCart />
              Add {toList}
            </Button>
          ) : (
            <Badge variant="outline">On list</Badge>
          )}
        </div>
      )}
    </li>
  );
}

/** Tonight: saved recipes against the pantry, ready ones first, then fewest missing; those that use up expiring food say so. */
export function Tonight({ data, onOpen, onNew }: { data: CookingOverview; onOpen: (id: number) => void; onNew: () => void }) {
  const list = useMemo(() => tonightList(data), [data]);
  const ready = list.filter((r) => r.pantry.can_make);
  const rest = list.filter((r) => !r.pantry.can_make);
  if (!list.length) {
    return (
      <EmptyState
        icon={ChefHat}
        title={data.recipes.length ? 'No saved recipe lists its ingredients' : 'No recipes saved yet'}
        body="Tonight compares your saved recipes with what’s in the pantry. Until there are some, ask Kevin: he can suggest a dish from what you have."
        action={
          <>
            <Button onClick={() => openChat({ send: 'What can I make tonight?', newThread: true })}>Ask Kevin what to make</Button>
            <Button variant="outline" onClick={onNew}>
              <Plus />
              Save a recipe
            </Button>
          </>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Section title="Ready to cook" description={ready.length ? 'Everything these need is in the pantry.' : undefined}>
        {ready.length ? (
          <ul className={card}>
            {ready.map((r) => (
              <TonightRow key={r.id} r={r} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Nothing saved can be made from the pantry as it stands. The closest are below, or ask Kevin for an idea from what you have.</p>
        )}
      </Section>
      {rest.length > 0 && (
        <Section title="A few things short" description="Fewest missing first.">
          <ul className={card}>
            {rest.map((r) => (
              <TonightRow key={r.id} r={r} onOpen={onOpen} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Recipes: search, favourites, tag and technique filters. */
export function Recipes({ data, onOpen, onNew }: { data: CookingOverview; onOpen: (id: number) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [fav, setFav] = useState<'' | 'fav'>('');
  const [tag, setTag] = useState('');
  const [technique, setTechnique] = useState('');
  const shown = useMemo(() => filterRecipes(data.recipes, { q, tag, technique, favourite: fav === 'fav' }), [data.recipes, q, tag, technique, fav]);
  const filtered = !!(q || tag || technique || fav);

  if (!data.recipes.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No recipes saved yet"
        body="Paste a link or the text of a recipe to Kevin and he saves it with ingredients, steps and timers. Or write one in yourself."
        action={
          <>
            <Button onClick={() => openChat({ prefill: 'Save this recipe: ' })}>Give Kevin a recipe</Button>
            <Button variant="outline" onClick={onNew}>
              <Plus />
              Write one in
            </Button>
          </>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes and ingredients" aria-label="Search recipes" type="search" className="h-11 w-full rounded-lg border border-input bg-card pr-10 pl-9 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 lg:h-9 [&::-webkit-search-cancel-button]:hidden" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute top-0 right-0 grid size-11 place-items-center text-muted-foreground lg:size-9">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 @lg/page:flex-row @lg/page:items-center">
        <Chips
          className="mx-0 px-0"
          value={fav}
          onChange={setFav}
          options={[
            { value: '', label: `All ${data.recipes.length}` },
            { value: 'fav', label: 'Favourites' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2 @lg/page:flex">
        {data.tags.length > 0 && (
          <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag" className="h-10 min-w-0 rounded-full lg:h-8 lg:w-auto">
            <option value="">Any tag</option>
            {data.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        )}
        {data.techniques.length > 0 && (
          <Select value={technique} onChange={(e) => setTechnique(e.target.value)} aria-label="Filter by technique" className="h-10 min-w-0 rounded-full lg:h-8 lg:w-auto">
            <option value="">Any technique</option>
            {data.techniques.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        )}
        </div>
      </div>
      {shown.length ? (
        <ul className={card}>
          {shown.map((r) => {
            const sub = [recipeMeta({ total_minutes: r.total_minutes, difficulty: r.difficulty }), r.times_cooked ? `cooked ${r.times_cooked === 1 ? 'once' : `${r.times_cooked} times`}` : 'not cooked yet'].filter(Boolean).join(' · ');
            return (
              <li key={r.id} data-recipe={r.title}>
                <button type="button" onClick={() => onOpen(r.id)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 leading-snug font-medium">
                      <span className="min-w-0 break-words">{r.title}</span>
                      <FavouriteMark on={r.favourite} />
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{sub}</span>
                    {r.tags.length > 0 && <span className="mt-0.5 block truncate text-sm text-muted-foreground/80">{r.tags.join(' · ')}</span>}
                  </span>
                  <Stars value={r.rating} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          No recipe matches.
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setFav('');
                setTag('');
                setTechnique('');
              }}
              className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
            >
              Clear the filters
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** The cook log, newest first. The overview carries the last ten; the rest load when asked for. */
export function CookLog({ data, onOpen, onEdit, onLog }: { data: CookingOverview; onOpen: (id: number) => void; onEdit: (e: LogEntry) => void; onLog: () => void }) {
  const [all, setAll] = useState(false);
  const full = useView<{ entries: LogEntry[] }>('cooking/log', { limit: 500 }, { enabled: all });
  const entries = all && full.data ? full.data.entries : data.recent_meals;
  if (!data.meals_logged) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="No meals logged yet"
        body="Finish a recipe in cooking mode and it lands here, or log anything you cooked by name. Tell Kevin “I made the chili, 4 stars” and he does it for you."
        action={
          <Button onClick={onLog}>
            <Plus />
            Log a meal
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className={card}>
        {entries.map((e) => (
          <li key={e.id} className="flex items-stretch" data-meal={e.dish}>
            <button type="button" onClick={() => onEdit(e)} className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pr-2 pl-4 text-left hover:bg-muted active:bg-secondary">
              <span className="flex items-center gap-2 leading-snug font-medium">
                <span className="min-w-0 break-words">{e.dish}</span>
                <Stars value={e.rating} />
              </span>
              <span className="text-sm text-muted-foreground">
                {calendarDay(e.cooked_on, data.today)}
                {e.rating == null && ' · not rated'}
              </span>
              {e.notes && <span className="line-clamp-2 text-sm break-words text-muted-foreground">{e.notes}</span>}
            </button>
            {e.recipe_id != null && (
              <div className="flex shrink-0 items-center pr-2.5">
                <Button variant="ghost" size="sm" onClick={() => onOpen(e.recipe_id!)} aria-label={`Open the ${e.dish} recipe`}>
                  Recipe
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!all && data.meals_logged > data.recent_meals.length && (
        <Button variant="outline" className="self-start" onClick={() => setAll(true)}>
          Show all {data.meals_logged} meals
        </Button>
      )}
    </div>
  );
}

const small = (r: { difficulty: string | null; total_minutes: number | null }): string => [minutesLabel(r.total_minutes), r.difficulty].filter(Boolean).join(' · ');

/** Skills: what the cook log shows Ben has practised, what saved recipes would teach him, and what he has never cooked. */
export function SkillsTab({ data, onOpen }: { data: CookingOverview; onOpen: (id: number) => void }) {
  const s = data.skills;
  if (!s.practised.length && !s.untried.length && !s.never_cooked.length) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Nothing to go on yet"
        body="Recipes carry the techniques they exercise, and every meal you log counts them. Save a recipe or two and this fills in. Or ask Kevin to teach you something."
        action={
          <Button onClick={() => openChat({ send: TEACH_ME, newThread: true })}>
            <Sparkles />
            Teach me something new
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Section title="Practised" description="From the cook log.">
        {s.practised.length ? (
          <ul className={card}>
            {s.practised.map((p) => (
              <li key={p.technique} className="flex min-h-14 items-center gap-3 px-4 py-2.5" data-practised={p.technique}>
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug font-medium first-letter:uppercase">{p.technique}</span>
                  <span className="block text-sm break-words text-muted-foreground">{p.dishes.join(', ')}</span>
                </span>
                <span className="tabular shrink-0 text-right text-sm text-muted-foreground">
                  <span className="block text-[15px] font-semibold text-foreground">{p.times}×</span>
                  last {midSentence(calendarDay(p.last_on, data.today))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No techniques logged yet. They are counted each time you log a meal from a recipe.</p>
        )}
      </Section>

      {s.untried.length > 0 && (
        <Section title="Not tried yet" description="Techniques your saved recipes would teach.">
          <ul className={card}>
            {s.untried.map((u) => (
              <li key={u.technique} className="flex flex-col gap-1.5 px-4 py-3" data-untried={u.technique}>
                <span className="leading-snug font-medium first-letter:uppercase">{u.technique}</span>
                <span className="flex flex-wrap gap-1.5">
                  {u.recipes.map((r) => (
                    <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="flex min-h-10 max-w-full items-center gap-1.5 rounded-full border bg-card px-3.5 text-left text-sm hover:bg-muted lg:min-h-8">
                      <span className="truncate">{r.title}</span>
                      {small(r) && <span className="shrink-0 text-muted-foreground">{small(r)}</span>}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {s.never_cooked.length > 0 && (
        <Section title="Saved but never cooked">
          <List>
            {s.never_cooked.map((r) => (
              <ListRow key={r.id} onClick={() => onOpen(r.id)} title={r.title} subtitle={[small(r), r.new_techniques.length ? `new: ${r.new_techniques.join(', ')}` : ''].filter(Boolean).join(' · ') || undefined} />
            ))}
          </List>
        </Section>
      )}

      <Button variant="outline" className="self-start" onClick={() => openChat({ send: TEACH_ME, newThread: true })}>
        <Sparkles />
        Teach me something new
      </Button>
    </div>
  );
}
