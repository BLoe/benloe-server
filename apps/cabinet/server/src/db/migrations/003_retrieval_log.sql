-- Retrieval instrumentation only (§ mentorship Phase 3, item 3) — no scoring,
-- no relevance labels. Faithfully capture every KNN retrieval now so that
-- once the corpus has grown enough to mean something, logged queries can be
-- replayed against candidate scorers and a real recall@k delta computed.
-- Dedicated table, not action_audit: same reasoning that already split
-- token_usage out from action_audit — high-volume quantitative telemetry
-- vs. governance/decision audit are different concerns with different shapes.
CREATE TABLE retrieval_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  caller TEXT NOT NULL CHECK(caller IN ('recallLessons', 'search_episodic', 'search_documents')),
  query_text TEXT NOT NULL,
  k INTEGER NOT NULL,
  results TEXT NOT NULL,       -- JSON: [{id, distance, kind}]
  result_count INTEGER NOT NULL
);
