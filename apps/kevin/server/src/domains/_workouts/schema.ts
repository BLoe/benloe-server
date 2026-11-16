// Workouts tables. The CREATE TABLE text (comments inside the parentheses
// included) is placed in Kevin's system prompt, so it is written to be read.
// The workouts_set_log view is not shown there; the domain's promptNote
// describes it.
import type { Migration } from '../../db.js';

export const migrations: Migration[] = [
  {
    id: 'workouts-001',
    sql: `
    CREATE TABLE workouts_exercises (
      -- The exercise catalogue. A row is created automatically the first time a name is used in a plan or a logged set.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                          -- display name: 'Bench Press'
      name_key TEXT NOT NULL UNIQUE,               -- the name lowercased, punctuation removed, final plural s dropped: 'bench press', 'pull up'
      aliases TEXT NOT NULL DEFAULT '[]',          -- JSON array of other keys that mean this exercise: ["bench","flat bench"]
      category TEXT NOT NULL DEFAULT 'strength',   -- strength | cardio | mobility | sport
      muscle_group TEXT,                           -- chest | back | shoulders | arms | core | legs | glutes | full_body. legs and glutes progress in 10 lb steps, the rest in 5
      notes TEXT,                                  -- form cues, equipment, injuries to work around
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE workouts_plans (
      -- A training plan. At most one row has is_active = 1; its days are the weekly schedule.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      goal TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      active_from TEXT,                            -- YYYY-MM-DD the plan last took effect
      active_until TEXT,                           -- YYYY-MM-DD another plan replaced it (exclusive); NULL while active or never used
      archived_at TEXT,                            -- set when Ben retires the plan; archived plans leave the plan list
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX workouts_plans_one_active ON workouts_plans(is_active) WHERE is_active = 1;

    CREATE TABLE workouts_plan_days (
      -- One training day of a plan, pinned to a weekday. A weekday with no row is a rest day.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES workouts_plans(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0=Sunday ... 6=Saturday, the same number as strftime('%w', date)
      name TEXT NOT NULL,                          -- 'Push', 'Legs', 'Run'
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (plan_id, weekday)
    );

    CREATE TABLE workouts_plan_exercises (
      -- What a plan day prescribes, in order. Strength rows use sets/reps/weight; cardio rows use duration and/or distance.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_day_id INTEGER NOT NULL REFERENCES workouts_plan_days(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,                   -- 1-based order within the day
      exercise_id INTEGER NOT NULL REFERENCES workouts_exercises(id),
      target_sets INTEGER,
      target_reps_min INTEGER,                     -- bottom of the rep range; equal to target_reps_max for a fixed count
      target_reps_max INTEGER,                     -- top of the rep range; hitting it on every set earns a weight increase
      target_weight_lbs REAL,                      -- starting weight; once there is history the last session decides
      target_duration_seconds INTEGER,
      target_distance_miles REAL,
      target_rpe REAL,                             -- intended effort, 1-10
      rest_seconds INTEGER,                        -- rest between sets
      notes TEXT
    );
    CREATE INDEX workouts_plan_exercises_day ON workouts_plan_exercises(plan_day_id, position);

    CREATE TABLE workouts_sessions (
      -- One workout on one date: done, under way, planned ahead, or skipped.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,                          -- YYYY-MM-DD in Ben's timezone
      plan_day_id INTEGER REFERENCES workouts_plan_days(id) ON DELETE SET NULL,   -- the plan day this session fulfils; NULL for an unplanned session
      title TEXT NOT NULL,                         -- copied from the plan day's name, or describes an unplanned session ('Kickball game')
      status TEXT NOT NULL DEFAULT 'in_progress',  -- planned (scheduled, nothing logged) | in_progress | completed | skipped
      notes TEXT,
      duration_minutes INTEGER,
      perceived_effort REAL,                       -- how hard the whole session felt, 1-10
      moved_from_date TEXT,                        -- set when this is a plan day done or planned off its usual weekday: the date it was moved from, which then counts as rest
      started_at TEXT,                             -- UTC ISO, when logging began
      completed_at TEXT,                           -- UTC ISO
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX workouts_sessions_date ON workouts_sessions(date);
    CREATE INDEX workouts_sessions_plan_day ON workouts_sessions(plan_day_id);

    CREATE TABLE workouts_sets (
      -- One set (strength) or one bout (cardio, sport) within a session. For reading, the view workouts_set_log joins this to its session and exercise.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES workouts_sessions(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES workouts_exercises(id),
      set_number INTEGER NOT NULL,                 -- 1-based, per exercise within the session, warmups included
      reps INTEGER,
      weight_lbs REAL,                             -- NULL for bodyweight
      duration_seconds INTEGER,                    -- cardio, holds, games
      distance_miles REAL,
      rpe REAL,                                    -- effort of this set, 1-10
      is_warmup INTEGER NOT NULL DEFAULT 0,        -- 1 = warmup: left out of progression, records and volume
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX workouts_sets_session ON workouts_sets(session_id);
    CREATE INDEX workouts_sets_exercise ON workouts_sets(exercise_id);

    -- Every logged set with its session and exercise. e1rm_lbs is the Epley
    -- estimate, weight * (1 + reps / 30), with a single counted at its weight.
    CREATE VIEW workouts_set_log AS
      SELECT st.id AS set_id, se.id AS session_id, se.date, se.title AS session_title, se.status AS session_status,
             e.id AS exercise_id, e.name AS exercise, e.category, e.muscle_group,
             st.set_number, st.is_warmup, st.reps, st.weight_lbs, st.duration_seconds, st.distance_miles, st.rpe, st.notes,
             CASE WHEN st.weight_lbs > 0 AND st.reps > 0
                  THEN ROUND(CASE WHEN st.reps = 1 THEN st.weight_lbs ELSE st.weight_lbs * (1 + st.reps / 30.0) END, 1)
             END AS e1rm_lbs
      FROM workouts_sets st
      JOIN workouts_sessions se ON se.id = st.session_id
      JOIN workouts_exercises e ON e.id = st.exercise_id;
    `,
  },
  {
    id: 'workouts-002',
    sql: `
    CREATE TABLE workouts_plan_periods (
      -- Every stretch of dates during which a plan was the active one. A plan that is switched away
      -- from and back has two rows; workouts_plans.active_from/active_until describe only the latest.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES workouts_plans(id) ON DELETE CASCADE,
      from_date TEXT NOT NULL,                     -- YYYY-MM-DD, inclusive
      until_date TEXT                              -- YYYY-MM-DD, exclusive; NULL = still active
    );
    CREATE INDEX workouts_plan_periods_from ON workouts_plan_periods(from_date);
    INSERT INTO workouts_plan_periods (plan_id, from_date, until_date)
      SELECT id, active_from, active_until FROM workouts_plans WHERE active_from IS NOT NULL;
    `,
  },
];
