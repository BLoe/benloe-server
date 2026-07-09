-- Hard constraints for planning (§ mentorship Phase B, onboarding interview):
-- dietary restrictions/allergies and physical/load-bearing movement limits.
-- Deliberately structured, not narrative (domains/health.md, domains/
-- nutrition.md) — those files get wholesale-rewritten by weekly-review under
-- a line budget, an acceptable risk for soft preferences and an unacceptable
-- one for "don't suggest shellfish" or "no loaded spinal flexion." One
-- kind-discriminated table, not two — same precedent as body_metric.metric
-- (open discriminator, shared narrow columns all meaningfully populated by
-- every kind, not a sparse table with per-kind-optional columns).
CREATE TABLE hard_constraint (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('dietary','physical')),
  subject TEXT,              -- allergen/substance, or the restricted movement/load pattern; NULL only on an is_none_confirmation row
  severity TEXT,             -- freeform, vocabulary differs by kind (allergy/intolerance vs contraindicated/caution) — unconstrained, matches body_metric.source
  note TEXT,                 -- the actual safety elaboration: conditionality, what's still safe, clearance detail — richness lives here, not in new columns
  is_none_confirmation INTEGER NOT NULL DEFAULT 0,  -- explicit "asked, confirmed none" — distinguishes never-asked (no rows) from confirmed-empty (this row)
  active INTEGER NOT NULL DEFAULT 1,  -- retire (allergy outgrown, PT clearance) without deleting history — same pattern as goal.active
  source TEXT,                -- provenance: 'onboarding-interview', 'chat-correction', etc. — same pattern as body_metric.source
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (is_none_confirmation = 1 OR subject IS NOT NULL)
);
CREATE INDEX idx_hard_constraint_kind ON hard_constraint(kind, active);
