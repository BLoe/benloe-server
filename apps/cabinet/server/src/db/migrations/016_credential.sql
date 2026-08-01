-- Integration credentials, encrypted at rest (2026-08-01).
--
-- Cabinet is about to grow real integrations — Plaid item tokens, insurance
-- portal logins, carrier and API keys. Until now the only place to put such a
-- thing was the .env file or, worse, a journal_entry. Neither works: .env
-- can't be edited from the UI and doesn't record when a token was last used or
-- rotated, and anything in a normal table is one `SELECT *` away from being
-- rendered into agent chat context, which the charter forbids outright.
--
-- So the rule this table encodes: the DATABASE holds only ciphertext, and the
-- key lives exclusively in the CABINET_CRED_KEY environment variable, which
-- the agent process cannot read. A stolen cabinet.db (backup tarball, a
-- careless scp, a public-repo accident) is inert on its own. And when the env
-- var is absent the store still functions in a degraded read-metadata-only
-- mode — you can see THAT a Plaid token exists and when it was last used
-- without being able to decrypt it. Knowing what's configured is an
-- operational question; reading the secret is not.
--
-- ## Why ciphertext, iv and auth_tag are three columns and not one blob
-- AES-256-GCM needs all three back, and they have genuinely different
-- lifecycles and rules:
--
--   iv        — a fresh 12-byte nonce per WRITE. It is not secret, but it must
--               never repeat under the same key: two encryptions sharing an IV
--               leak the XOR of their plaintexts and, worse for GCM, let an
--               attacker forge tags. Giving it its own column makes "new IV on
--               every write" a visible, testable property of the write path
--               instead of an offset convention buried in a parser.
--   auth_tag  — the 16-byte GCM authentication tag. This is what makes the
--               ciphertext TAMPER-EVIDENT: flip one bit of either column and
--               decryption throws rather than returning plausible garbage. It
--               is a separate value with a separate job (integrity, not
--               confidentiality), and keeping it separate means a migration or
--               a bad write that loses it fails loudly at decrypt time instead
--               of silently truncating the ciphertext.
--   ciphertext— the encrypted secret itself, same length as the plaintext.
--
-- The alternative — one packed `iv || tag || ciphertext` blob — saves two
-- columns and costs a hand-rolled framing format that every future reader has
-- to agree on byte-for-byte. That is precisely the kind of implicit contract
-- that breaks quietly. Three columns, no parsing.
--
-- BLOB rather than base64 TEXT for the same defensive reason: a BLOB comes
-- back from better-sqlite3 as a Buffer, which does not string-concatenate into
-- a log line or a prompt by accident the way a base64 TEXT column does.
--
-- ## Why the name is UNIQUE
-- `name` is the lookup key integration code uses ('plaid', 'aetna-portal'),
-- so it must be stable and singular. It is also the AAD (additional
-- authenticated data) the domain layer binds each ciphertext to, so a row's
-- ciphertext cannot be copied onto another row's name without failing
-- authentication. UNIQUE is what makes an upsert mean "rotate this secret"
-- rather than "accumulate a second copy of it".
CREATE TABLE credential (
  id INTEGER PRIMARY KEY,
  -- Stable lookup key AND the GCM AAD. Lowercase slug by convention; the
  -- domain layer enforces the shape.
  name TEXT NOT NULL UNIQUE,
  -- Who the secret is for: 'plaid', 'aetna', 'anthropic'. Metadata, safe to
  -- show in the UI and to the agent — this is the column that answers "is
  -- banking hooked up yet" without anyone decrypting anything.
  provider TEXT,
  -- Human note: which account, which environment, where it was issued. MUST
  -- NOT contain the secret; it is returned by the metadata list.
  description TEXT,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Last time integration code actually decrypted this to use it. The point is
  -- to make a dead credential visible: a Plaid token nothing has touched in
  -- three months is either an integration that quietly broke or a secret that
  -- should be revoked. Both are worth seeing without decrypting anything.
  last_used_at TEXT,
  -- Set when an existing name is overwritten with a new secret, i.e. rotation.
  -- NULL means "never rotated since creation", which is itself the answer to
  -- "how old is this key really" — created_at alone can't tell you, because a
  -- rotated row keeps its original created_at on purpose.
  rotated_at TEXT
);

CREATE INDEX idx_credential_provider ON credential(provider);
