-- 022: account rate-limit telemetry + the autonomous build queue.
--
-- WHY THIS EXISTS. Cabinet's only capacity gauge before this was a hardcoded
-- token threshold in scheduler/jobs.ts that nobody derived from the actual
-- plan -- an invented denominator, the same failure class as scoring intake
-- against a 2200 kcal target that was never set. The Agent SDK exposes the
-- real windows (five_hour / seven_day / per-model) via rate_limit_event
-- messages on the turn stream and via a usage control method. This is where
-- those land so that both the agent and the scheduler read one source.
--
-- Utilization is a PERCENTAGE (0-100), as the SDK reports it. resets_at is
-- ISO 8601 UTC, verbatim from the provider -- never recomputed locally.

-- Current known state, one row per window. Upserted; last writer wins.
CREATE TABLE rate_limit_state (
  window_key  TEXT PRIMARY KEY,          -- five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage | ...
  utilization REAL,                      -- 0-100, NULL when the provider did not report one
  resets_at   TEXT,                      -- ISO 8601, NULL when unknown
  status      TEXT,                      -- allowed | allowed_warning | rejected
  source      TEXT NOT NULL,             -- event | poll
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only history. Cheap, and it turns "am I near the ceiling" into a
-- trend rather than a single reading -- which is what makes the idle worker's
-- gate tunable later against evidence instead of taste.
CREATE TABLE rate_limit_sample (
  id          INTEGER PRIMARY KEY,
  window_key  TEXT NOT NULL,
  utilization REAL,
  resets_at   TEXT,
  status      TEXT,
  source      TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rate_limit_sample_window ON rate_limit_sample(window_key, observed_at);

-- Explicit opt-in for autonomous work.
--
-- The task table is Ben's life list: haircut, book the PCP, pay the medical
-- bills. Cabinet must never "work" one of those unattended. Eligibility is
-- therefore opt-in and defaults to 0 -- a task becomes agent-workable only
-- because someone said so, never because it looked like code.
ALTER TABLE task ADD COLUMN agent_eligible INTEGER NOT NULL DEFAULT 0;

-- What the idle worker actually did, per attempt. Separate from action_audit
-- because the useful unit here is the ATTEMPT (picked task, outcome, commit),
-- not the individual tool call.
CREATE TABLE build_run (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER REFERENCES task(id),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  outcome     TEXT,                      -- completed | progressed | blocked | error | skipped
  summary     TEXT,
  commit_sha  TEXT,
  utilization REAL,                      -- worst window utilization at launch, for post-hoc gate tuning
  chat_id     TEXT
);
CREATE INDEX idx_build_run_started ON build_run(started_at);
