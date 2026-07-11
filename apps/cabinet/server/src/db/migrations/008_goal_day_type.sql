-- Day-type-aware goal targets (Phase D, build 3) — closes Phase B FINDING 1.
-- goalTarget() (gateway/surfaces.ts) previously fuzzy-LIKE-matched a title
-- and picked whichever same-domain row had the highest id, unconditionally
-- — the two calorie goals (training/rest) collided and only one was ever
-- reachable, regardless of what day it actually was.
--
-- NULL day_type = applies to all days (weight, protein, steps — the normal
-- case). 'training'/'rest' = a day-type-specific override. A nullable CHECK
-- column addition is safe in SQLite: existing rows get NULL, and CHECK only
-- rejects an explicit FALSE, not NULL, so the ALTER doesn't need a backfill
-- to satisfy it.
ALTER TABLE goal ADD COLUMN day_type TEXT CHECK(day_type IN ('training','rest'));

-- One-time backfill: tag the two existing calorie rows, created before this
-- column existed, matched on their exact titles (not id — id-ordering is
-- exactly the accident this build fixes). Not a general-purpose pattern —
-- future day-type goals set day_type directly via upsertGoal.
UPDATE goal SET day_type = 'training' WHERE lower(trim(title)) = 'calories, training day';
UPDATE goal SET day_type = 'rest' WHERE lower(trim(title)) = 'calories, rest day';
