-- Reverts migration 008 (Phase D, build 4). The day-type calorie split was
-- an artifact of fake Phase B onboarding data; Ben's actual routine (heavy
-- lifts 2x/week, cardio every day) collapses the training/rest binary and
-- his nutrition model is a single calorie target. day_type is unread by any
-- code as of this build — dropping it rather than leaving it dormant, since
-- SQLite (bundled version 3.53.2) supports ALTER TABLE ... DROP COLUMN
-- cleanly for a plain, unindexed, non-FK column like this one.
ALTER TABLE goal DROP COLUMN day_type;
