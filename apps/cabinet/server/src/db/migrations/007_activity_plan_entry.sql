-- Activity-plan spine (Phase D, build 1). Mirrors meal_plan_entry's shape
-- and its no-parent-entity call — a "plan" is just entries over a date
-- range, same YAGNI reasoning as Phase C.
CREATE TABLE activity_plan_entry (
  id INTEGER PRIMARY KEY,
  local_day TEXT NOT NULL,                    -- date this activity is planned for (YYYY-MM-DD)
  kind TEXT NOT NULL CHECK(kind IN ('strength','cardio','mobility','sport','rest')),
  title TEXT,                                 -- e.g. 'Lower body — trainer', 'Easy run'
  notes TEXT,
  is_anchor INTEGER NOT NULL DEFAULT 0,       -- 1 = fixed/immovable (trainer session); planning works AROUND anchors
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','done','skipped')),
  workout_id INTEGER REFERENCES workout(id),  -- linked once actually performed+logged (nullable until done)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_plan_entry_day ON activity_plan_entry(local_day);
CREATE INDEX idx_activity_plan_entry_day_kind ON activity_plan_entry(local_day, kind);
