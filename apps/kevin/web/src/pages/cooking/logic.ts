// The Cooking page's pure parts: the shapes the cooking views return, the
// "tonight" order, recipe filtering, and the recipe form's draft <-> the input
// `cooking_recipe_save` takes.
import { matchesText, parseQuantity } from '../pantry/logic';

export interface Have {
  name: string;
  amount: string;
  match: 'exact' | 'similar' | 'always_on_hand';
  pantry_item_id: number | null;
  pantry_name: string | null;
  pantry_amount: string | null;
  location: string | null;
  expires_on: string | null;
  days_left: number | null;
  expiring_soon: boolean;
}
export interface Missing {
  name: string;
  quantity: number | null;
  unit: string | null;
  amount: string;
  on_shopping_list: boolean;
}
export interface PantryFit {
  ingredient_count: number;
  have_count: number;
  missing_count: number;
  can_make: boolean;
  have: Have[];
  missing: Missing[];
  uses_expiring: { name: string; expires_on: string; days_left: number }[];
}

export interface RecipeSummary {
  id: number;
  title: string;
  source: string | null;
  url: string | null;
  servings: number | null;
  total_minutes: number | null;
  difficulty: string | null;
  tags: string[];
  techniques: string[];
  rating: number | null;
  favourite: boolean;
  notes: string | null;
  ingredient_count: number;
  step_count: number;
  times_cooked: number;
  last_cooked_on: string | null;
  pantry: PantryFit;
}

export interface RecipeIngredient {
  position: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  amount: string;
  in_pantry: boolean;
  match: 'exact' | 'similar' | 'always_on_hand' | null;
  pantry_item: { id: number; name: string | null; amount: string | null; location: string | null; expires_on: string | null; days_left: number | null } | null;
  on_shopping_list: boolean;
}
export interface RecipeStep {
  position: number;
  text: string;
  timer_seconds: number | null;
}
export interface LogEntry {
  id: number;
  cooked_on: string;
  recipe_id: number | null;
  dish: string;
  rating: number | null;
  notes: string | null;
  techniques: string[];
}
export interface RecipeFull extends RecipeSummary {
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  log: LogEntry[];
}

export interface Skills {
  practised: { technique: string; times: number; last_on: string; dishes: string[] }[];
  untried: { technique: string; recipes: { id: number; title: string; difficulty: string | null; total_minutes: number | null }[] }[];
  never_cooked: { id: number; title: string; difficulty: string | null; total_minutes: number | null; techniques: string[]; new_techniques: string[] }[];
}

export interface CookingOverview {
  today: string;
  recipes: RecipeSummary[];
  can_make_order: number[];
  tags: string[];
  techniques: string[];
  recent_meals: LogEntry[];
  meals_logged: number;
  skills: Skills;
}

/** What `cooking_log_meal` answers with. */
export interface MealResult {
  saved?: 'logged' | 'updated';
  entry?: LogEntry;
  times_cooked?: number;
  pantry?: { changed: { name: string; did: string; now: string; note?: string }[]; not_applied?: { name: string; reason: string }[] };
  deleted?: { id: number; dish: string };
}

// ---- reading --------------------------------------------------------------------

/** "45 min", "1 hr", "1 hr 20 min". */
export function minutesLabel(min: number | null | undefined): string {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "35 min · medium · serves 4" from whatever the recipe has. */
export function recipeMeta(r: Pick<RecipeSummary, 'total_minutes' | 'difficulty'> & { servings?: number | null }): string {
  return [minutesLabel(r.total_minutes), r.difficulty, r.servings ? `serves ${r.servings}` : ''].filter(Boolean).join(' · ');
}

/** Recipes in the server's "what can I make" order, leaving out those with no ingredients listed (nothing to judge them by). */
export function tonightList(o: Pick<CookingOverview, 'recipes' | 'can_make_order'>): RecipeSummary[] {
  const byId = new Map(o.recipes.map((r) => [r.id, r]));
  return o.can_make_order.map((id) => byId.get(id)).filter((r): r is RecipeSummary => !!r && r.ingredient_count > 0);
}

/** The shopping-list rows for what a recipe still needs: missing ingredients not already on the list. */
export function missingToAdd(fit: Pick<PantryFit, 'missing'>, recipeId: number): { name: string; quantity?: number; unit?: string; recipe_id: number }[] {
  return fit.missing
    .filter((m) => !m.on_shopping_list)
    .map((m) => ({ name: m.name, ...(m.quantity != null && m.quantity > 0 ? { quantity: m.quantity } : {}), ...(m.unit ? { unit: m.unit } : {}), recipe_id: recipeId }));
}

export interface RecipeFilter {
  q?: string;
  tag?: string;
  technique?: string;
  favourite?: boolean;
}

/** Search runs over the title, tags, techniques, source and ingredient names. */
export function filterRecipes(recipes: RecipeSummary[], f: RecipeFilter): RecipeSummary[] {
  return recipes.filter(
    (r) =>
      (!f.favourite || r.favourite) &&
      (!f.tag || r.tags.includes(f.tag)) &&
      (!f.technique || r.techniques.includes(f.technique)) &&
      (!f.q || matchesText([r.title, r.source ?? '', ...r.tags, ...r.techniques, ...r.pantry.have.map((h) => h.name), ...r.pantry.missing.map((m) => m.name)].join(' '), f.q)),
  );
}

// ---- timers as text -------------------------------------------------------------

/** 90 -> "1:30", 3725 -> "1:02:05". Rounds up, so a running timer never shows 0:00 early. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 600 -> "10 min", 90 -> "1 min 30 s", 45 -> "45 s", 5400 -> "1 hr 30 min". */
export function timerLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean).join(' ') || '0 s';
}

/** The form's timer box: "10" and "1.5" are minutes, "1:30" is min:sec, "1:05:00" is h:min:sec. null when it is not a time. */
export function parseTimer(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number);
    const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
    return secs >= 1 && secs <= 86_400 ? secs : null;
  }
  const min = parseQuantity(s);
  if (min == null) return null;
  const secs = Math.round(min * 60);
  return secs >= 1 && secs <= 86_400 ? secs : null;
}

/** Seconds back into what `parseTimer` reads: 600 -> "10", 90 -> "1:30". */
export function timerText(seconds: number | null): string {
  if (!seconds) return '';
  return seconds % 60 === 0 ? String(seconds / 60) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---- the recipe form ------------------------------------------------------------

export interface IngredientDraft {
  key: number;
  quantity: string;
  unit: string;
  name: string;
  note: string;
}
export interface StepDraft {
  key: number;
  text: string;
  timer: string;
}
export interface RecipeDraft {
  title: string;
  source: string;
  url: string;
  servings: string;
  minutes: string;
  difficulty: string;
  ingredients: IngredientDraft[];
  steps: StepDraft[];
  tags: string;
  techniques: string;
  notes: string;
}

let nextKey = 1;
export const blankIngredient = (): IngredientDraft => ({ key: nextKey++, quantity: '', unit: '', name: '', note: '' });
export const blankStep = (): StepDraft => ({ key: nextKey++, text: '', timer: '' });

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export function draftOfRecipe(r: RecipeFull | null): RecipeDraft {
  if (!r) return { title: '', source: '', url: '', servings: '', minutes: '', difficulty: '', ingredients: [blankIngredient(), blankIngredient(), blankIngredient()], steps: [blankStep(), blankStep()], tags: '', techniques: '', notes: '' };
  return {
    title: r.title,
    source: r.source ?? '',
    url: r.url ?? '',
    servings: r.servings ? String(r.servings) : '',
    minutes: r.total_minutes ? String(r.total_minutes) : '',
    difficulty: r.difficulty ?? '',
    ingredients: r.ingredients.map((i) => ({ key: nextKey++, quantity: i.quantity == null ? '' : num(i.quantity), unit: i.unit ?? '', name: i.name, note: i.note ?? '' })),
    steps: r.steps.map((s) => ({ key: nextKey++, text: s.text, timer: timerText(s.timer_seconds) })),
    tags: r.tags.join(', '),
    techniques: r.techniques.join(', '),
    notes: r.notes ?? '',
  };
}

/** "Weeknight, mexican ,, Weeknight" -> ["weeknight", "mexican"] */
export function labelsOf(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
}

const wholeNumber = (text: string, min: number, max: number): number | null | 'bad' => {
  const s = text.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : 'bad';
};

/**
 * The `cooking_recipe_save` input for a filled-in form, or what is wrong
 * with it. Blank ingredient and step rows are dropped. With `id` every field
 * is sent, so clearing one clears it.
 */
export function recipeInput(d: RecipeDraft, id?: number): { input: Record<string, unknown> } | { error: string } {
  const title = d.title.trim();
  if (!title) return { error: 'Give the recipe a title.' };
  const servings = wholeNumber(d.servings, 1, 100);
  if (servings === 'bad') return { error: 'Servings should be a whole number.' };
  const minutes = wholeNumber(d.minutes, 1, 2880);
  if (minutes === 'bad') return { error: 'Total time should be whole minutes, like 45.' };

  const ingredients: Record<string, unknown>[] = [];
  for (const i of d.ingredients) {
    const name = i.name.trim();
    if (!name && !i.quantity.trim() && !i.unit.trim() && !i.note.trim()) continue;
    if (!name) return { error: `Ingredient ${ingredients.length + 1} has an amount but no name.` };
    const q = i.quantity.trim() ? parseQuantity(i.quantity) : null;
    if (i.quantity.trim() && (q == null || q <= 0)) return { error: `The amount of ${name} should be a number, like 2 or 1/2. Leave it empty for “to taste”.` };
    ingredients.push({ name, quantity: q, unit: i.unit.trim() || null, note: i.note.trim() || null });
  }
  const steps: Record<string, unknown>[] = [];
  for (const s of d.steps) {
    const text = s.text.trim();
    if (!text && !s.timer.trim()) continue;
    if (!text) return { error: `Step ${steps.length + 1} has a timer but no text.` };
    const t = s.timer.trim() ? parseTimer(s.timer) : null;
    if (s.timer.trim() && t == null) return { error: `Step ${steps.length + 1}’s timer should be minutes (10) or min:sec (1:30).` };
    steps.push({ text, timer_seconds: t });
  }
  const tags = labelsOf(d.tags);
  const techniques = labelsOf(d.techniques);
  if (tags.length > 20) return { error: 'Twenty tags at most.' };
  if (techniques.length > 12) return { error: 'Twelve techniques at most.' };

  return {
    input: {
      ...(id != null ? { id } : {}),
      title,
      source: d.source.trim() || null,
      url: d.url.trim() || null,
      servings,
      total_minutes: minutes,
      difficulty: d.difficulty || null,
      ingredients,
      steps,
      tags,
      techniques,
      notes: d.notes.trim() || null,
    },
  };
}

/** Moves the row at `index` one place up (-1) or down (+1). */
export function moveRow<T>(rows: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= rows.length) return rows;
  const out = [...rows];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}
