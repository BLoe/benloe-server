import { ArrowLeft, Check, ChefHat, CircleDashed, Ellipsis, ExternalLink, Heart, MessageCircle, Pencil, SearchX, ShoppingCart, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState, ErrorState, List, ListRow, LoadingRows, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { act } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { calendarDay, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { expiryLabel, midSentence, wherePhrase } from '../pantry/logic';
import { CookMode } from './CookMode';
import { recipeMeta, timerLabel, type LogEntry, type RecipeFull, type RecipeIngredient } from './logic';
import { MealSheet } from './MealSheet';
import { addMissing, StarInput, Stars, usePantryRefresh } from './parts';
import { RecipeForm } from './RecipeForm';

const safeHref = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

function IngredientRow({ i }: { i: RecipeIngredient }) {
  const p = i.pantry_item;
  const soon = p?.days_left != null && p.days_left <= 3;
  return (
    <li className="flex items-start gap-3 px-4 py-2.5" data-ingredient={i.name} data-have={i.in_pantry}>
      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', i.in_pantry ? 'bg-success-soft text-accent-foreground' : 'text-warning')} aria-hidden>
        {i.in_pantry ? <Check className="size-3.5" strokeWidth={3} /> : <CircleDashed className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="leading-snug">
          {i.amount && <span className="tabular font-semibold">{i.amount} </span>}
          {i.name}
          {i.note && <span className="text-muted-foreground">, {i.note}</span>}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {i.match === 'always_on_hand' && <span>Always on hand</span>}
          {p && (
            <span>
              Have {p.amount || 'some'}
              {wherePhrase(p.location) && ` ${wherePhrase(p.location)}`}
              {i.match === 'similar' && p.name ? ` (${p.name})` : ''}
            </span>
          )}
          {p?.days_left != null && soon && <Badge variant={p.days_left < 0 ? 'danger' : 'warning'}>{expiryLabel(p.days_left, p.expires_on)}</Badge>}
          {!i.in_pantry && <span className="font-medium text-warning">Missing</span>}
          {!i.in_pantry && i.on_shopping_list && <Badge variant="outline">On the shopping list</Badge>}
        </span>
      </span>
    </li>
  );
}

/**
 * One recipe in full: what it needs against what is in the pantry, the steps,
 * Ben's notes and rating, and its cook history. "Start cooking" opens cooking
 * mode over it.
 */
export function RecipeDetail({ id, today, cooking, onBack, onCook, onGone }: { id: number; today: string; cooking: boolean; onBack: () => void; onCook: (open: boolean) => void; onGone: () => void }) {
  const view = useView<{ recipe: RecipeFull | null }>('cooking/recipe', { id });
  usePantryRefresh(view.refetch);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [logging, setLogging] = useState(false);
  const [entry, setEntry] = useState<LogEntry | null>(null);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 self-start text-muted-foreground">
      <ArrowLeft />
      All recipes
    </Button>
  );
  if (view.data === undefined) {
    return (
      <>
        {back}
        {view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={6} />}
      </>
    );
  }
  const r = view.data.recipe;
  if (!r) {
    return (
      <>
        {back}
        <EmptyState icon={SearchX} title="There’s no recipe here" body="It may have been deleted." />
      </>
    );
  }

  const fit = r.pantry;
  const toList = fit.missing.filter((m) => !m.on_shopping_list).length;
  const href = safeHref(r.url);
  const meta = recipeMeta(r);
  const save = (patch: Record<string, unknown>, success?: string) => act('cooking_recipe_save', { id: r.id, ...patch }, success ? { success } : {});

  return (
    <>
      {back}
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[26px] leading-tight font-semibold tracking-tight break-words lg:text-[28px]">{r.title}</h1>
          <Button variant="outline" size="icon" aria-pressed={r.favourite} aria-label={r.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void save({ favourite: !r.favourite })}>
            <Heart className={cn(r.favourite && 'fill-destructive text-destructive')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Recipe options">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil />
                Edit recipe
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openChat({ prefill: `About the ${r.title} recipe: ` })}>
                <MessageCircle />
                Ask Kevin about it
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                <Trash2 />
                Delete recipe
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {(meta || r.source || href) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            {meta && <span>{meta}</span>}
            {(r.source || href) && meta && <span aria-hidden>·</span>}
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                {r.source || 'Source'}
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              r.source && <span>{r.source}</span>
            )}
          </p>
        )}
        {(r.tags.length > 0 || r.techniques.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {r.techniques.map((t) => (
              <Badge key={`t-${t}`} variant="success">
                {t}
              </Badge>
            ))}
            {r.tags.map((t) => (
              <Badge key={`g-${t}`}>{t}</Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StarInput value={r.rating} onChange={(rating) => void save({ rating })} />
          <span className="text-sm text-muted-foreground">{r.times_cooked ? `Cooked ${r.times_cooked === 1 ? 'once' : `${r.times_cooked} times`}, last ${midSentence(calendarDay(r.last_cooked_on, today))}` : 'Not cooked yet'}</span>
        </div>
        <div className="flex flex-col gap-2 @md/page:flex-row">
          <Button size="lg" disabled={r.steps.length === 0} onClick={() => onCook(true)} className="@md/page:flex-1">
            <ChefHat />
            {r.steps.length ? 'Start cooking' : 'No steps to cook from yet'}
          </Button>
          {fit.missing_count > 0 && (
            <Button size="lg" variant="outline" disabled={toList === 0} onClick={() => void addMissing(fit, r.id)} className="@md/page:flex-1">
              <ShoppingCart />
              {toList ? `Add ${toList} missing to shopping list` : 'Missing items are on the list'}
            </Button>
          )}
        </div>
      </header>

      <Section title="Ingredients" description={r.ingredients.length ? (fit.can_make ? 'Everything is in the pantry.' : `${fit.have_count} of ${fit.ingredient_count} in the pantry.`) : undefined}>
        {r.ingredients.length ? (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {r.ingredients.map((i) => (
              <IngredientRow key={i.position} i={i} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No ingredients listed. Edit the recipe to add them, or ask Kevin to fill them in.</p>
        )}
      </Section>

      <Section title="Steps">
        {r.steps.length ? (
          <ol className="divide-y overflow-hidden rounded-xl border bg-card">
            {r.steps.map((s) => (
              <li key={s.position} className="flex gap-3 px-4 py-3">
                <span className="tabular w-5 shrink-0 text-right font-semibold text-primary">{s.position}</span>
                <span className="min-w-0 flex-1">
                  <span className="leading-relaxed break-words whitespace-pre-line">{s.text}</span>
                  {s.timer_seconds && (
                    <span className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Timer className="size-3.5" />
                      {timerLabel(s.timer_seconds)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No steps written down.</p>
        )}
      </Section>

      {r.notes && (
        <Section title="Notes">
          <p className="rounded-xl border bg-card px-4 py-3 leading-relaxed break-words whitespace-pre-line">{r.notes}</p>
        </Section>
      )}

      <Section
        title="Cook history"
        action={
          <Button variant="outline" size="sm" onClick={() => setLogging(true)}>
            <Check />I made this
          </Button>
        }
      >
        {r.log.length ? (
          <List>
            {r.log.map((e) => (
              <ListRow key={e.id} onClick={() => setEntry(e)} title={calendarDay(e.cooked_on, today)} subtitle={e.notes ?? undefined} meta={<Stars value={e.rating} />} />
            ))}
          </List>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Not cooked yet. Logging it takes the ingredients out of the pantry and counts its techniques towards Skills.</p>
        )}
      </Section>

      {cooking && r.steps.length > 0 && <CookMode recipe={r} today={today} onClose={() => onCook(false)} />}
      {editing && <RecipeForm recipe={r} onClose={() => setEditing(false)} />}
      {logging && <MealSheet recipe={r} today={today} onClose={() => setLogging(false)} />}
      {entry && <MealSheet key={entry.id} entry={entry} today={today} onClose={() => setEntry(null)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${r.title}”?`}
        body={`The recipe, its ingredients and steps are removed for good.${r.log.length ? ` The ${plural(r.log.length, 'meal')} you logged from it ${r.log.length === 1 ? 'stays' : 'stay'} in the cook log.` : ''}`}
        confirmLabel="Delete recipe"
        onConfirm={() =>
          void act('cooking_recipe_delete', { id: r.id }, { success: 'Recipe deleted' }).then((res) => {
            if (res.ok) onGone();
          })
        }
      />
    </>
  );
}
