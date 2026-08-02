# Secrets on this box

Written 2026-08-02, after an audit that found Cabinet was effectively
root-equivalent through several independent paths. Two things came out of it:
the privilege separation (see the `infra: stop the agent from being
root-equivalent` commit) and this service.

## The problem, stated honestly

Cabinet's agent can write Cabinet's own source and deploy it. That means **any
protection expressed as code inside the Cabinet process is a suggestion the
agent can edit** — an env scrub, a "do not import this" comment, a careful
module boundary. All of those were present in `domains/credentials.ts`, all of
them were well written, and none of them were enforceable against the process
that hosts them.

There is also a limit worth being blunt about, because overstating it is how
this kind of design rots:

> **You cannot stop an agent that can *use* a secret from *exercising* it.**

If Cabinet is allowed to sync your bank transactions, Cabinet can cause bank
API calls. No architecture changes that. What isolation buys is narrower and
still worth having:

- the agent cannot **exfiltrate key material** — paste it into a transcript,
  send it off-box, or retain it after access is revoked
- every use is **recorded outside the agent's reach**
- access is **revocable and bounded** by what the broker exposes, not by what
  the key can do
- the realistic failure modes — carelessness and prompt injection — need
  ambient access, and ambient access is gone

## The shape

`cabinet-secrets` (port 3011, uid `cabinet-secrets`) holds the encryption key
and the credential database. Cabinet never sees either.

```
  Ben ──TLS──► secrets.benloe.com ──► dashboard :3011  ─┐
                (artanis, owner-only)                    ├─► secrets.db  (0700, uid cabinet-secrets)
  Cabinet ──unix socket──► broker /run/cabinet-secrets/ ─┘   audit.log   (0600)
            (0660 root:claude-worker)                        key file    (/etc/benloe, 0640 root:cabinet-secrets)
```

**Why a unix socket and not localhost TCP.** Authentication is the filesystem.
The socket is `0660 cabinet-secrets:claude-worker`, so the set of processes
that can connect is exactly `{root, cabinet-secrets, claude-worker}`. There is
no token to leak or rotate, and the kernel enforces it rather than this code
being correct. A localhost port would have been reachable by every uid on the
box.

The socket's group comes from the **setgid bit** on `/run/cabinet-secrets`
(mode 2750). The broker runs unprivileged and cannot `chgrp` into a group it
does not belong to — and the fix for that is *not* to add `cabinet-secrets` to
the `claude-worker` group, which would grant access in the wrong direction.
`/run` is tmpfs, so the directory is recreated at boot by
`/etc/tmpfiles.d/cabinet-secrets.conf`.

**Why the key is in a file, not the environment.** Env vars are inherited by
every child process and readable from `/proc/<pid>/environ`. Cabinet needed a
startup scrub to work around exactly that, and the scrub lived in
agent-writable source. A file readable only by one uid has neither problem, and
rotation is `cp` rather than a config edit plus a privileged restart.

## Capabilities, not credentials

The broker exposes operations, never secrets. There is no `getSecret`, no
decrypt RPC, and no "just for debugging" variant.

| Endpoint | Returns |
|---|---|
| `GET /v1/health` | liveness, whether a key is loaded |
| `GET /v1/credentials` | **metadata only** — names, providers, timestamps |
| `GET /v1/plaid/status` | configured yes/no, environment |
| `POST /v1/plaid/request` | proxies an **allowlisted** Plaid path with `client_id`/`secret` injected server-side |
| `POST /v1/plaid/exchange` | swaps a Link `public_token`, stores the access token, returns only the **name** it was filed under |

Item access tokens are referenced by credential **name**. Cabinet says "use the
token filed under `plaid-item-3`"; the broker resolves it. A literal
`access_token` in a caller-supplied body is dropped rather than forwarded —
Cabinet possessing one would itself be the regression this design prevents, and
honouring it silently would hide that.

The path list is an **allowlist**. `/item/public_token/exchange` is deliberately
absent because its response contains an access token; it is special-cased so
the token is retained rather than returned. A new Plaid endpoint is unreachable
until someone decides how it should behave.

`test/no-secret-egress.test.ts` enforces the rule structurally: only `plaid.ts`
may reference the decrypt path, the outward-facing modules may not, no route
name may look secret-shaped, and the dashboard page may not render a value.
Comments are stripped before scanning, and the test is mutation-checked — it
fails when a leak is introduced and passes when it is reverted.

## The dashboard

`https://secrets.benloe.com` — artanis session, **owner only**. An `agent`-role
key authenticates fine at artanis and is refused here; that distinction is the
point.

This only became trustworthy on 2026-08-02. Before that, artanis ran as root
with agent-writable code and an agent-readable session database, so
"authenticate with artanis" would have meant "Cabinet can mint itself a session
and walk in". **Hardening artanis was a prerequisite for this dashboard, not a
separate piece of work.** Its Caddy config lives in `/etc/caddy/secure.d`
(root-owned) rather than the agent-writable `infra/caddy`, because whoever
controls that hostname could serve a look-alike page and capture secrets as
they are pasted.

Credentials are **write-only**. You can create, rotate (paste a new value) or
delete. There is no read-back, here or anywhere. If you need the current value,
you don't — rotate it at the provider and paste the new one.

## Operating it

Generate or rotate the key:

```sh
umask 077 && openssl rand -base64 32 > /etc/benloe/cabinet-secrets.key
chown root:cabinet-secrets /etc/benloe/cabinet-secrets.key && chmod 640 /etc/benloe/cabinet-secrets.key
pm2 restart cabinet-secrets
```

⚠ **Back this key up somewhere off-box.** Everything in `secrets.db` is
AES-256-GCM under it; lose it and every stored credential is unrecoverable
ciphertext. Rotating it does **not** re-encrypt existing rows — they will fail
authentication, and you re-paste them. That is a deliberate consequence of the
key never being derivable from anything on disk.

A malformed key does not take the service down: it logs the byte length (never
material) and runs metadata-only, with `keyLoaded: false` shown prominently on
the dashboard — which is exactly where you would go to fix it.

Audit log: `/var/lib/cabinet-secrets/audit.log`, one JSON line per credential
use, readable only by the broker uid and surfaced read-only on the dashboard.
It is a separate append-only file rather than a table in `secrets.db` on
purpose — a log the serving code can delete is one you have to trust that code
about.

## Known gaps

- **Cabinet's `PlaidClient` still uses the old in-process path.** It is inert
  today (no `CABINET_CRED_KEY`, so its local store cannot encrypt, and there
  are no stored credentials or items), so nothing is broken — but Plaid will
  not function until that client is pointed at the broker.
- **`JWT_SECRET` is shared across six apps.** Code execution in any one forges
  sessions everywhere, including the session this dashboard trusts. Those apps
  should verify via artanis's API instead of holding the secret.
- **Two services still run as root** (`gamenight-frontend`, `sleeper-ui`).
  Neither has agent-writable code, so neither is an escalation path — hygiene,
  not a hole.
