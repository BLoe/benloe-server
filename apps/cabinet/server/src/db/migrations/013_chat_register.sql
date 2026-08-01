-- Sticky per-chat register (2026-08-01), driving effort selection.
--
-- Lives on the chat rather than being recomputed per turn on purpose: effort
-- is a request-level setting, so changing it mid-conversation both invalidates
-- the prompt cache (cache_read is Cabinet's largest token line) and changes
-- the SessionSpec, which respawns the CLI subprocess. A chat settles into desk
-- or counsel and stays there unless the evidence is sustained.
--
-- register: NULL means "not yet classified" — treated as counsel, the safe
-- default (shallow-when-it-mattered is the expensive failure; slow-when-it-
-- didn't costs seconds).
--
-- desk_streak: consecutive desk-shaped messages. A single "278.4" dropped into
-- a planning conversation must NOT downgrade the whole chat — measured on
-- 2026-08-01, per-message switching flipped the register on all three turns of
-- a real session and respawned the subprocess every time, paying latency to
-- save latency. Two in a row is the entry price for desk; one counsel signal
-- leaves immediately.
ALTER TABLE chat ADD COLUMN register TEXT;
ALTER TABLE chat ADD COLUMN desk_streak INTEGER NOT NULL DEFAULT 0;
