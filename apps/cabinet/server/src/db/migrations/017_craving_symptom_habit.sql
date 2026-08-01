-- Phase 0's three missing consumers (2026-08-01).
--
-- Audit finding the night before Phase 0 starts: the goals, the experiments
-- and the plan all existed, and none of them could be measured. Three separate
-- instances of the same failure PLATFORM.md already records — a mechanism
-- built, and no caller ever wired to it.

-- 1. CRAVING EVENTS.
--
-- TUNING E1 is "a 3:30pm protein snack reduces late-evening craving events,"
-- measured by "craving pings + unplanned intake after 8pm, snack-days vs
-- skip-days." There was nowhere to put a craving event, so E1 could not have
-- produced a verdict at any point in the next fourteen days.
--
-- PLAYBOOK P4 additionally wants a RANKING: "log the event + what worked."
-- That is why `redirect` and `outcome` are separate columns. The redirect is
-- what Cabinet offered (the stocked counter-snack, seltzer, the 15-minute
-- delay, a pivot into tonight's block); the outcome is what actually then
-- happened. One column cannot answer "which move works on Ben," and answering
-- that is the entire point of logging the event.
--
-- `outcome` is constrained but deliberately NOT binary. "Held" and "ate the
-- planned snack" are both successes — RHYTHM budgets an evening snack on
-- purpose — and collapsing them would teach Cabinet that eating on plan is a
-- failure, which is the exact all-or-nothing frame that cost Ben 40 lb.
CREATE TABLE craving_event (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  local_day TEXT NOT NULL,
  intensity INTEGER,
  -- 'boredom', 'weed', 'stress', 'saw-food', 'social', 'skipped-snack', 'unknown'
  trigger TEXT,
  context TEXT,
  redirect TEXT,
  outcome TEXT CHECK(outcome IN ('held', 'planned_snack', 'unplanned_intake', 'ordered_out')),
  minutes_to_resolve INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_craving_day ON craving_event(local_day);
CREATE INDEX idx_craving_outcome ON craving_event(outcome, local_day);

-- 2. SYMPTOMS.
--
-- The ankle is Ben's single hardest physical constraint and plans/health.md
-- doses walking against it — but the ONLY ankle data in the system as of
-- tonight is the step count added hours ago, which is load. Load with no
-- response variable is uncalibratable by construction: you can watch the dose
-- go up and never learn what it cost.
--
-- Generic rather than an ankle table, because Ben has a second live symptom
-- with exactly the same problem: a 3/10 sore throat since Mother's Day that
-- tracks with smoking. substance_log now records nicotine with a route, so
-- throat severity beside it is a real differential rather than a memory.
--
-- One row per (day, symptom) so a day's reading is idempotent — re-reporting
-- corrects rather than duplicates. Morning and evening readings of the same
-- joint are different symptom keys ('ankle_ache_am' / 'ankle_ache_pm'), which
-- keeps the unique constraint honest without a composite-context key that
-- would silently allow duplicates whenever the context string varied.
CREATE TABLE symptom_log (
  id INTEGER PRIMARY KEY,
  local_day TEXT NOT NULL,
  symptom TEXT NOT NULL,
  severity INTEGER,
  context TEXT,
  notes TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (local_day, symptom)
);

CREATE INDEX idx_symptom_day ON symptom_log(local_day);
CREATE INDEX idx_symptom_name ON symptom_log(symptom, local_day);

-- 3. HABIT EVENTS: uniqueness.
--
-- habit_event shipped in 001_init and has never had a single writer, so all
-- seven Phase 0 goals were unscoreable. Writers land in domains/adherence.ts
-- alongside this migration; what the TABLE was missing is the constraint that
-- makes marking idempotent. Without it, a goal marked twice in one day (an
-- agent retry, Ben confirming twice, a resumed turn re-running) inflates
-- adherence — and adherence inflation is the one measurement error that would
-- make Cabinet confidently wrong about whether the plan is working.
--
-- SQLite cannot add a constraint to an existing table, so this is the
-- standard rebuild. The table is empty (verified: zero writers ever), so
-- there is no data-loss risk in the copy.
CREATE TABLE habit_event_new (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goal(id) ON DELETE CASCADE,
  local_day TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 1,
  UNIQUE (goal_id, local_day)
);

INSERT OR IGNORE INTO habit_event_new (id, goal_id, local_day, done)
  SELECT id, goal_id, local_day, done FROM habit_event;

DROP TABLE habit_event;
ALTER TABLE habit_event_new RENAME TO habit_event;

CREATE INDEX idx_habit_goal_day ON habit_event(goal_id, local_day);
