-- Meal-plan spine (Phase C, build 2). Deliberately no parent `meal_plan`
-- entity — a "plan" is just the set of entries over a date range; the
-- shopping-list generator (build 4) takes a date range, not a plan id. Add a
-- parent only if dogfooding proves we need named/multiple concurrent plans.
CREATE TABLE meal_plan_entry (
  id INTEGER PRIMARY KEY,
  local_day TEXT NOT NULL,                  -- date this meal is planned for (YYYY-MM-DD)
  meal TEXT CHECK(meal IN ('breakfast','lunch','dinner','snack')),
  recipe_id INTEGER REFERENCES recipe(id),  -- either a recipe reference...
  ad_hoc_description TEXT,                  -- ...or a free-text ad-hoc planned meal
  servings REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','eaten','skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((recipe_id IS NOT NULL) OR (ad_hoc_description IS NOT NULL))
);
CREATE INDEX idx_meal_plan_entry_day ON meal_plan_entry(local_day);
CREATE INDEX idx_meal_plan_entry_day_status ON meal_plan_entry(local_day, status);
