-- Web push subscriptions (2026-08-01).
--
-- One row per browser/device Ben has granted notification permission on. The
-- endpoint is the push service's URL for that device and is the natural key —
-- re-subscribing the same browser yields the same endpoint, so ON CONFLICT
-- refreshes rather than duplicates.
--
-- p256dh/auth are the client's own encryption keys, not secrets of ours: they
-- let Cabinet encrypt a payload that ONLY that device can read (RFC 8291), so
-- the push service relays ciphertext it cannot decrypt. Without them a push
-- can still be delivered, but only as a contentless wake-up.
--
-- failures/last_error exist because push endpoints die silently — a browser
-- profile is deleted, a device is wiped — and the service answers 404/410.
-- Those are pruned on sight; anything else is counted, so a subscription that
-- is merely flaky isn't discarded on one bad night.
CREATE TABLE push_subscription (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- Who it belongs to; Cabinet is single-principal today but the notification
  -- surface is exactly where that assumption would bite later.
  email TEXT,
  -- Free text from the browser, for telling "my phone" from "the desk mac"
  -- in the UI without fingerprinting anything.
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_push_subscription_email ON push_subscription(email);

-- Delivery log: what was sent, when, and whether it landed. Small and pruned
-- by the maintenance job. Exists so "did the 3:30 ping actually fire" is a
-- query rather than a guess — the same reason perf_span exists.
CREATE TABLE push_delivery (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  title TEXT,
  body TEXT,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX idx_push_delivery_ts ON push_delivery(ts);
