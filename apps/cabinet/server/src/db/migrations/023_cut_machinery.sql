-- Cut the supervision machinery down to what is actually read.
--
-- Two tables here were the largest in the database by row count, and between
-- them held more rows than every table about Ben's life combined. Neither was
-- answering a question anyone still had.
--
-- 1. perf_span -> perf_turn. One row per turn instead of ~39. The per-phase
--    breakdown is what you want while investigating a specific slow turn, not
--    permanently for every turn forever; the four numbers below answer "was
--    that turn slow, and roughly where did it go" and nothing else was being
--    asked. 15,118 spans over ten days collapse to 387 rows.
--
-- 2. action_audit loses tier and decision. The tier classifier ran on every
--    tool call and its verdict was never read: production runs
--    autonomy:'full', where the gate audits and allows unconditionally. The
--    proof is in the data being dropped here — 445 actions classified Tier 0,
--    the tier that means "blocked", all of which ran. A column that records a
--    verdict nothing enforces is worse than no column, because it reads like
--    a control.
--
--    `result` stays. It held the classifier's reason for gate rows, but real
--    callers use it for something worth keeping — update_memory writes the
--    error text there when a write is refused, which is the only record that
--    the call happened and failed.
--
-- The action_audit ROWS are kept. What Cabinet did is the recoverability
-- story and is worth having; what a dead classifier thought about it is not.

-- ---------------------------------------------------------------- perf_turn
CREATE TABLE perf_turn (
  turn_id      TEXT PRIMARY KEY,
  chat_id      TEXT,
  session_kind TEXT,
  model        TEXT,
  -- Whole agent turn, spawn through result. The number Ben feels.
  total_ms     INTEGER,
  -- init -> first visible text delta. What "it's alive" looks like.
  ttf_text_ms  INTEGER,
  -- Assistant messages (API round trips) and tool calls in the turn. Two
  -- turns with the same total_ms but 3 vs 30 steps are different problems.
  steps        INTEGER NOT NULL DEFAULT 0,
  tool_calls   INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL
);

CREATE INDEX idx_perf_turn_started ON perf_turn(started_at);

-- Carry the existing spans forward rather than dropping ten days of history:
-- every column above is derivable from what perf_span already holds.
INSERT INTO perf_turn (turn_id, chat_id, session_kind, model, total_ms, ttf_text_ms, steps, tool_calls, started_at)
SELECT
  turn_id,
  MAX(chat_id),
  MAX(session_kind),
  MAX(model),
  MAX(CASE WHEN phase = 'turn_total' THEN CAST(ms AS INTEGER) END),
  MAX(CASE WHEN phase = 'ttf_text'   THEN CAST(ms AS INTEGER) END),
  SUM(CASE WHEN phase = 'step' THEN 1 ELSE 0 END),
  SUM(CASE WHEN phase = 'tool' THEN 1 ELSE 0 END),
  MIN(started_at)
FROM perf_span
GROUP BY turn_id;

DROP TABLE perf_span;

-- ------------------------------------------------------------- action_audit
-- SQLite cannot drop several columns in one statement cleanly across the
-- versions in play, so rebuild. Column order and names otherwise unchanged.
CREATE TABLE action_audit_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool         TEXT NOT NULL,
  args         TEXT,
  -- Free-text note about what happened, when there is one. Today only the
  -- update_memory refusal path writes it.
  result       TEXT,
  chat_id      TEXT,
  session_kind TEXT,
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The 'pre:' prefix goes too. It distinguished the PreToolUse hook's row from
-- the gate's row for the same call — a distinction that only existed because
-- both wrote. With the gate gone the hook is the sole writer and every call
-- produces exactly one row, so the prefix would now mean nothing.
INSERT INTO action_audit_new (id, tool, args, result, chat_id, session_kind, ts)
SELECT
  id,
  CASE WHEN tool LIKE 'pre:%' THEN substr(tool, 5) ELSE tool END,
  args,
  result,
  chat_id,
  session_kind,
  ts
FROM action_audit
-- Drop ONLY the gate's rows. The hook fires for every tool call and the gate
-- only for those not pre-approved, so the hook's rows are the complete set and
-- the gate's are a duplicate subset of the same events. Everything else —
-- heartbeat marks, usage alerts, refusals, maintenance warnings — is a real
-- event with no duplicate and is kept. Written as an exclusion rather than an
-- inclusion list on purpose: a marker nobody remembered would otherwise be
-- silently dropped by an inclusion list that failed to name it.
WHERE decision IS NULL
   OR decision NOT IN ('autonomous', 'allowed', 'allowed-notify', 'denied', 'denied-approval');

DROP TABLE action_audit;
ALTER TABLE action_audit_new RENAME TO action_audit;

CREATE INDEX idx_action_audit_ts ON action_audit(ts);
