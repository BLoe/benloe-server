-- Granular turn latency instrumentation (2026-08-01).
--
-- token_usage answered "what did this turn cost"; nothing answered "where did
-- the wall clock go". Every span a turn emits lands here, so a slow turn can
-- be decomposed after the fact instead of guessed at: queue wait vs. lesson
-- recall vs. SDK subprocess spawn vs. model time-to-first-token vs. the tool
-- calls themselves.
--
-- Deliberately one flat table rather than a span tree: Cabinet's turns are a
-- flat sequence of phases and tool calls, and a parent_id would buy nothing
-- that (turn_id, seq) doesn't already give. Rows are cheap (~100 bytes) and
-- pruned by the maintenance job.
CREATE TABLE perf_span (
  id INTEGER PRIMARY KEY,
  -- The turn's messageId (runtime/agent.ts) — every span of one turn shares it.
  turn_id TEXT NOT NULL,
  chat_id TEXT,
  session_kind TEXT,
  model TEXT,
  -- Phase vocabulary, kept open on purpose (new probes shouldn't need a
  -- migration): queue_wait, recall, profile_gap, prompt_assemble, sdk_spawn,
  -- ttf_thinking, ttf_text, step, tool, gate, hook_pre, hook_post,
  -- turn_total, request_total.
  phase TEXT NOT NULL,
  -- Tool name, memory file, or whatever names this instance of the phase.
  label TEXT,
  ms REAL NOT NULL,
  -- Ordering within the turn; monotonic per turn_id.
  seq INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Free-form JSON: token counts, step index, error flags.
  meta TEXT
);

CREATE INDEX idx_perf_span_turn ON perf_span(turn_id, seq);
CREATE INDEX idx_perf_span_phase ON perf_span(phase, started_at);
CREATE INDEX idx_perf_span_started ON perf_span(started_at);
