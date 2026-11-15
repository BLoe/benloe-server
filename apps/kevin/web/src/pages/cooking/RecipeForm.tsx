import { ArrowDown, ArrowUp, Plus, Timer, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Field, FormDialog } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { act } from '@/lib/act';
import { blankIngredient, blankStep, draftOfRecipe, moveRow, recipeInput, type IngredientDraft, type RecipeDraft, type RecipeFull, type StepDraft } from './logic';

// Enter in a row's box would submit the whole form mid-recipe; it should do nothing there.
const noEnter = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
};

const iconButton = 'grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 lg:size-8';

/** Write a recipe in by hand, or edit a saved one. Ingredients and steps are rows; blank rows are ignored. */
export function RecipeForm({ recipe, onClose, onSaved }: { recipe: RecipeFull | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const [d, setD] = useState<RecipeDraft>(() => draftOfRecipe(recipe));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RecipeDraft>) => setD((x) => ({ ...x, ...patch }));
  const setIng = (key: number, patch: Partial<IngredientDraft>) => set({ ingredients: d.ingredients.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const setStep = (key: number, patch: Partial<StepDraft>) => set({ steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

  const save = async () => {
    const r = recipeInput(d, recipe?.id);
    if ('error' in r) return setError(r.error);
    setError(null);
    setSaving(true);
    const res = await act<{ id: number }>('cooking_recipe_save', r.input, { success: recipe ? 'Recipe saved' : 'Recipe added' });
    setSaving(false);
    if (!res.ok) return;
    onSaved?.(res.result.id);
    onClose();
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={recipe ? 'Edit recipe' : 'New recipe'} submitLabel={recipe ? 'Save' : 'Save recipe'} pending={saving} canSubmit={d.title.trim().length > 0} onSubmit={() => void save()}>
      <Field label="Title">{(id) => <Input id={id} value={d.title} maxLength={200} autoFocus={!recipe} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Source">{(id) => <Input id={id} value={d.source} maxLength={200} placeholder="Mom, NYT Cooking" onChange={(e) => set({ source: e.target.value })} />}</Field>
        <Field label="Link">{(id) => <Input id={id} value={d.url} type="url" inputMode="url" autoCapitalize="none" maxLength={1000} placeholder="https://" onChange={(e) => set({ url: e.target.value })} />}</Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Serves">{(id) => <Input id={id} value={d.servings} inputMode="numeric" className="tabular" onChange={(e) => set({ servings: e.target.value })} />}</Field>
        <Field label="Minutes">{(id) => <Input id={id} value={d.minutes} inputMode="numeric" className="tabular" onChange={(e) => set({ minutes: e.target.value })} />}</Field>
        <Field label="Difficulty">
          {(id) => (
            <Select id={id} value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="">—</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2" onKeyDown={noEnter}>
        <legend className="mb-1.5 text-sm font-medium">Ingredients</legend>
        <p className="-mt-1 text-sm text-muted-foreground">Amount, unit, then the bare ingredient as it would be in the pantry. Preparation goes in the note.</p>
        {d.ingredients.map((i, n) => (
          <div key={i.key} className="flex flex-col gap-1.5 rounded-lg border p-2" data-ingredient-row>
            <div className="flex items-center gap-1.5">
              <Input value={i.quantity} onChange={(e) => setIng(i.key, { quantity: e.target.value })} inputMode="decimal" placeholder={n === 0 ? '1/2' : undefined} aria-label={`Ingredient ${n + 1} amount`} className="tabular w-16 shrink-0 px-2" />
              <Input value={i.unit} onChange={(e) => setIng(i.key, { unit: e.target.value })} placeholder={n === 0 ? 'cup' : undefined} autoCapitalize="none" maxLength={30} aria-label={`Ingredient ${n + 1} unit`} className="w-[4.5rem] shrink-0 px-2" />
              <Input value={i.name} onChange={(e) => setIng(i.key, { name: e.target.value })} placeholder={n === 0 ? 'yellow onion' : undefined} autoCapitalize="none" maxLength={120} aria-label={`Ingredient ${n + 1} name`} className="min-w-0 flex-1" />
            </div>
            <div className="flex items-center gap-1.5">
              <Input value={i.note} onChange={(e) => setIng(i.key, { note: e.target.value })} placeholder={n === 0 ? 'Note: diced, or shallots' : 'Note'} maxLength={200} aria-label={`Ingredient ${n + 1} note`} className="min-w-0 flex-1" />
              <button type="button" onClick={() => set({ ingredients: d.ingredients.filter((x) => x.key !== i.key) })} aria-label={`Remove ingredient ${n + 1}`} className={iconButton}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        ))}
        <Button variant="outline" className="self-start" onClick={() => set({ ingredients: [...d.ingredients, blankIngredient()] })}>
          <Plus />
          Add ingredient
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2" onKeyDown={noEnter}>
        <legend className="mb-1.5 text-sm font-medium">Steps</legend>
        <p className="-mt-1 text-sm text-muted-foreground">One action per step: cooking mode shows them one at a time. A timer is minutes (10) or min:sec (1:30).</p>
        {d.steps.map((s, n) => (
          <div key={s.key} className="flex flex-col gap-1.5 rounded-lg border p-2" data-step-row>
            <div className="flex gap-2">
              <span className="tabular mt-2.5 w-5 shrink-0 text-right text-sm font-semibold text-muted-foreground">{n + 1}</span>
              <Textarea value={s.text} onChange={(e) => setStep(s.key, { text: e.target.value })} rows={2} maxLength={2000} aria-label={`Step ${n + 1}`} className="min-h-16 flex-1" />
            </div>
            <div className="flex items-center gap-1 pl-7">
              <Timer className="size-4 shrink-0 text-muted-foreground" />
              <Input value={s.timer} onChange={(e) => setStep(s.key, { timer: e.target.value })} inputMode="text" placeholder="Timer, min" aria-label={`Step ${n + 1} timer in minutes`} className="tabular w-28 px-2" />
              <span className="flex-1" />
              <button type="button" disabled={n === 0} onClick={() => set({ steps: moveRow(d.steps, n, -1) })} aria-label={`Move step ${n + 1} up`} className={iconButton}>
                <ArrowUp className="size-4" />
              </button>
              <button type="button" disabled={n === d.steps.length - 1} onClick={() => set({ steps: moveRow(d.steps, n, 1) })} aria-label={`Move step ${n + 1} down`} className={iconButton}>
                <ArrowDown className="size-4" />
              </button>
              <button type="button" onClick={() => set({ steps: d.steps.filter((x) => x.key !== s.key) })} aria-label={`Remove step ${n + 1}`} className={iconButton}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        ))}
        <Button variant="outline" className="self-start" onClick={() => set({ steps: [...d.steps, blankStep()] })}>
          <Plus />
          Add step
        </Button>
      </fieldset>

      <Field label="Tags" hint="Comma-separated: weeknight, vegetarian, meal prep.">
        {(id) => <Input id={id} value={d.tags} autoCapitalize="none" onChange={(e) => set({ tags: e.target.value })} />}
      </Field>
      <Field label="Techniques" hint="The skills it exercises: searing, braising, knife work. They drive the Skills tab.">
        {(id) => <Input id={id} value={d.techniques} autoCapitalize="none" onChange={(e) => set({ techniques: e.target.value })} />}
      </Field>
      <Field label="Notes">{(id) => <Textarea id={id} value={d.notes} rows={3} maxLength={4000} placeholder="Your adjustments: double the garlic" onChange={(e) => set({ notes: e.target.value })} />}</Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}
