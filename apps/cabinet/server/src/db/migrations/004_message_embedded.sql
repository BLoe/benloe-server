-- Conversation indexing (§ mentorship Phase 3, item 3 keystone): the flag
-- column EMBEDDABLE_TABLES' backfill loop needs to track per-message embed
-- state, same pattern journal_entry already has. Existing rows default to 0
-- — a known, accepted one-time bulk-embed on the first backfill run after
-- this lands, not a future-only trigger.
ALTER TABLE message ADD COLUMN embedded INTEGER NOT NULL DEFAULT 0;
