import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

export interface FoodEntry {
  description: string;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  confidence?: 'high' | 'medium' | 'low';
  source?: 'text' | 'photo' | 'recipe' | 'restaurant';
  photo_path?: string;
  /** links this entry back to the recipe it was logged from (consumePlanEntry, domains/mealplan.ts) — the column existed since 001_init but nothing wrote it until build 5. */
  recipe_id?: number;
  when?: Date;
}

export interface DailyTotals {
  local_day: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  entries: number;
}

export function logFood(db: Database.Database, e: FoodEntry): { id: number; totals: DailyTotals } {
  const when = e.when ?? new Date();
  const day = localDay(when);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO food_log (eaten_at, local_day, meal, description, kcal, protein_g, carbs_g, fat_g, fiber_g, confidence, source, photo_path, recipe_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      when.toISOString(), day, e.meal ?? null, e.description,
      e.kcal ?? null, e.protein_g ?? null, e.carbs_g ?? null, e.fat_g ?? null, e.fiber_g ?? null,
      e.confidence ?? 'medium', e.source ?? 'text', e.photo_path ?? null, e.recipe_id ?? null,
    );
  return { id: Number(lastInsertRowid), totals: dailyTotals(db, day) };
}

export function dailyTotals(db: Database.Database, day: string = localDay()): DailyTotals {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(kcal),0) kcal, COALESCE(SUM(protein_g),0) protein_g,
              COALESCE(SUM(carbs_g),0) carbs_g, COALESCE(SUM(fat_g),0) fat_g,
              COALESCE(SUM(fiber_g),0) fiber_g, COUNT(*) entries
       FROM food_log WHERE local_day = ?`,
    )
    .get(day) as Omit<DailyTotals, 'local_day'>;
  return { local_day: day, ...row };
}

export function updatePantry(
  db: Database.Database,
  item: { name: string; location?: 'pantry' | 'fridge' | 'freezer'; quantityDelta?: number; quantity?: number; unit?: string; expires_on?: string; is_staple?: boolean },
): { id: number; quantity: number | null } {
  const existing = db
    .prepare('SELECT id, quantity FROM pantry_item WHERE lower(name) = lower(?) AND (location = ? OR ? IS NULL)')
    .get(item.name, item.location ?? null, item.location ?? null) as { id: number; quantity: number | null } | undefined;
  if (existing) {
    const q =
      item.quantity !== undefined
        ? item.quantity
        : item.quantityDelta !== undefined
          ? Math.max(0, (existing.quantity ?? 0) + item.quantityDelta)
          : existing.quantity;
    db.prepare(
      "UPDATE pantry_item SET quantity = ?, unit = COALESCE(?, unit), expires_on = COALESCE(?, expires_on), is_staple = COALESCE(?, is_staple), updated_at = datetime('now') WHERE id = ?",
    ).run(q, item.unit ?? null, item.expires_on ?? null, item.is_staple === undefined ? null : Number(item.is_staple), existing.id);
    return { id: existing.id, quantity: q };
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO pantry_item (name, location, quantity, unit, purchased_on, expires_on, is_staple) VALUES (?,?,?,?,?,?,?)')
    .run(item.name, item.location ?? 'pantry', item.quantity ?? item.quantityDelta ?? null, item.unit ?? null, localDay(), item.expires_on ?? null, Number(item.is_staple ?? 0));
  return { id: Number(lastInsertRowid), quantity: item.quantity ?? item.quantityDelta ?? null };
}

export function addRecipe(
  db: Database.Database,
  r: { title: string; instructions?: string; servings?: number; kcal_per_serving?: number; protein_g?: number; carbs_g?: number; fat_g?: number; tags?: string[]; ingredients?: { name: string; quantity?: number; unit?: string }[] },
): number {
  const insert = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO recipe (title, instructions, servings, kcal_per_serving, protein_g, carbs_g, fat_g, tags) VALUES (?,?,?,?,?,?,?,?)')
      .run(r.title, r.instructions ?? null, r.servings ?? null, r.kcal_per_serving ?? null, r.protein_g ?? null, r.carbs_g ?? null, r.fat_g ?? null, JSON.stringify(r.tags ?? []));
    const id = Number(lastInsertRowid);
    for (const ing of r.ingredients ?? []) {
      db.prepare('INSERT INTO recipe_ingredient (recipe_id, name, quantity, unit) VALUES (?,?,?,?)').run(id, ing.name, ing.quantity ?? null, ing.unit ?? null);
    }
    return id;
  });
  return insert();
}
