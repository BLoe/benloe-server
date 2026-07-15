-- Threads → Chat (2026-07-15, Ben's rename): the conversation surface is now
-- "Chat" everywhere — UI, API, code, and schema. Prior migrations keep the
-- old vocabulary (applied history is immutable); this one moves the live
-- schema. SQLite's RENAME TO rewrites foreign-key references (message's
-- REFERENCES thread(id)) automatically on modern versions.
ALTER TABLE thread RENAME TO chat;
ALTER TABLE message RENAME COLUMN thread_id TO chat_id;
DROP INDEX idx_message_thread;
CREATE INDEX idx_message_chat ON message(chat_id, created_at);
ALTER TABLE approval RENAME COLUMN thread_id TO chat_id;
ALTER TABLE action_audit RENAME COLUMN thread_id TO chat_id;
ALTER TABLE token_usage RENAME COLUMN thread_id TO chat_id;
