-- Substance log (2026-08-01).
--
-- CHARTER puts weed in scope as a first-class tracked variable, and
-- plans/health.md makes cannabis and alcohol Phase 0 experiment surfaces
-- (TUNING E2: does shifting weed to post-dinner reduce unplanned snacking and
-- improve sleep?). Until now there was no table for any of it — the day this
-- was written, Ben's intake went into a journal_entry as prose, which cannot
-- be joined against health_daily.sleep_minutes or food_log timestamps. An
-- experiment you can't query isn't an experiment.
--
-- Why route is a column and not a note: it is the clinically load-bearing
-- field. Ben has had a 3/10 sore throat since Mother's Day that tracks with
-- smoking; separating smoked from vaped from edible is the whole differential.
-- It is also the E2 mechanism — an 11am edible and an 11pm joint are the same
-- `substance` and completely different interventions.
--
-- Dose is deliberately (REAL, unit TEXT) rather than a normalized mg. Cannabis
-- edibles are labelled in mg THC, flower is grams, alcohol is standard drinks,
-- caffeine is mg. Forcing one unit would mean lying in three of the four
-- cases. Analysis normalizes at read time, where the assumptions are visible.
--
-- taken_at + local_day mirrors food_log exactly: the timestamp answers "how
-- long before bed," the local day answers "on which day," and a 1am edible
-- belongs to the night before, not the morning after. localDay() owns that
-- decision in one place (domains/units.ts).
CREATE TABLE substance_log (
  id INTEGER PRIMARY KEY,
  taken_at TEXT NOT NULL,
  local_day TEXT NOT NULL,
  substance TEXT NOT NULL CHECK(substance IN ('cannabis', 'alcohol', 'caffeine', 'nicotine', 'other')),
  route TEXT CHECK(route IN ('smoked', 'vaped', 'edible', 'drink', 'oral', 'other')),
  dose REAL,
  unit TEXT,
  -- Free text: "10mg gummy", "cold brew", "IPA", "half a joint". Keeps the
  -- specific product recoverable without a products table Ben would have to
  -- maintain.
  product TEXT,
  -- Where/why: 'post-dinner', 'darts', 'social', 'wake-up'. This is the
  -- column E2 actually reads — timing relative to the day's structure.
  context TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_substance_log_day ON substance_log(local_day);
CREATE INDEX idx_substance_log_substance_day ON substance_log(substance, local_day);
