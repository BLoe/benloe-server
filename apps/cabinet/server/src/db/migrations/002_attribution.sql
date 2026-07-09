-- Identity attribution. Cabinet stays single-user (all Ben's data); these
-- columns only record WHO is speaking so Cabinet knows it's Ben vs an agent
-- like Benji, and so a thread reads as a legible conversation. Not tenancy —
-- no scoping is keyed off these.
ALTER TABLE message ADD COLUMN author TEXT;   -- principal on a user message (email); NULL = Cabinet/system
ALTER TABLE thread ADD COLUMN created_by TEXT; -- principal who opened the thread
