-- Editable application settings (2026-08-02).
--
-- Migration 016 gave secrets a home Ben can manage from a browser. This gives
-- the OTHER half of configuration the same treatment, and it exists because of
-- a specific mistake worth recording.
--
-- The Plaid integration shipped with three new values wired through
-- ecosystem.config.js and read out of /srv/benloe/.env at boot:
--
--   CABINET_CRED_KEY       — the AES master key. Genuinely secret.
--   PLAID_ENV              — the literal string 'sandbox' or 'production'.
--   CABINET_PUBLIC_ORIGIN  — a public URL that is also printed in the page's
--                            own help text and registered with a third party.
--
-- Only the first of those is a secret. The other two were put in .env by
-- pattern-matching ("it's config, config goes in .env") rather than by
-- deciding, and the cost landed directly on Ben: changing the word 'sandbox'
-- to 'production' required an SSH session, a root-owned file edit, and a
-- process restart — for a value that is neither sensitive nor even private.
-- The whole point of the credentials dashboard was that Ben stops logging into
-- the VPS to manage configuration, and two thirds of the first thing it was
-- built for still required exactly that.
--
-- So: non-secret configuration lives HERE, in plaintext, editable over HTTP
-- behind the owner auth wall. Secret configuration lives in `credential`,
-- encrypted. The bootstrap key alone stays in .env, because a key that
-- decrypts the store cannot live in the store, and it must stay unreadable by
-- the agent's own shell or the guarantee it provides is decorative.
--
-- ## Why plaintext, deliberately
-- Nothing in this table may ever be secret. That is not a limitation to route
-- around later — it is the invariant that makes the table safe to render into
-- a settings page, log, diff, or support conversation without a second
-- thought. A future value that needs hiding is a `credential` row, not a
-- setting with a flag on it. The moment this table grows an `is_secret`
-- column, every reader has to start checking it, and the ones that forget are
-- the leak.
--
-- ## Why a table and not a JSON blob in one row
-- Per-key rows give per-key `updated_at`, which answers "when did this change
-- and did that coincide with the syncs breaking?" — the only question anyone
-- ever actually asks of a settings store during an incident. A blob answers it
-- for the whole document at once, which is to say not at all.
--
-- ## Precedence, and why the DB wins
-- Readers resolve: DB row → environment variable → built-in default. The DB
-- deliberately outranks the environment, because the alternative produces the
-- worst failure a settings page can have: Ben edits a value, gets a success
-- toast, and nothing changes because an env var he cannot see from the browser
-- is silently winning. A setting that is present in .env AND edited here now
-- takes the edited value, and the page says so.

CREATE TABLE app_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
