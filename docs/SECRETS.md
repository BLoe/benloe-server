# Secrets on this box

Every credential this server uses lives in one encrypted document, held by the
`benloe-secrets` service (port 3011, uid `benloe-secrets`), edited in a browser
at `https://secrets.benloe.com`, and rendered to tmpfs where services read it.
No plaintext copy exists on disk, and none exists in the git working tree.

## What this actually buys

Overstating this is how the design rots, so state the limit first:

> **You cannot stop a process allowed to *use* a secret from *exercising* it.**

If Cabinet is allowed to sync your bank transactions, Cabinet can cause bank API
calls. No architecture changes that. And most consumers on this box run as root,
so this is **not confidentiality from root**: root can read the key file and the
rendered env alike.

What it does buy, all of it real:

- **No plaintext secrets in a git working tree.** `/srv/benloe/.env` was a file
  the agent could read, `cat` into a transcript, or commit by accident. It is
  gone.
- **One durable copy, behind one uid.** The ciphertext in
  `/var/lib/benloe-secrets/secrets.db` and the key in
  `/etc/benloe/benloe-secrets.key` are openable by `benloe-secrets` and root —
  not by `claude-worker`, which is what the agent's shells run as.
- **Nothing durable in plaintext.** The rendered files live on `/run`, which is
  tmpfs. They never touch a disk and never survive a reboot.
- **An audit log outside the thing it describes,** and a version history, so a
  bad edit is one click from undone.
- **Real, kernel-enforced scoping for `pr-reviewer`** — see below. That one is
  genuine isolation rather than hygiene, and it holds even though the consumer
  is root.

## The shape

```
  Ben ──TLS──► secrets.benloe.com ──► dashboard :3011 ──┐
                (artanis, owner-only)                    │   secrets.db  (uid benloe-secrets, AES-256-GCM)
                                                         ├──► audit.log   (0600)
  boot ──► benloe-secrets-render.service (oneshot) ──────┘   key file    (/etc/benloe/benloe-secrets.key, 0640 root:benloe-secrets)
                          │
                          ▼
              /run/benloe-secrets/env              0400  — the full set
              /run/benloe-secrets/pr-reviewer.env  0400  — three keys
                          │
                          ▼
              services read a path with dotenv, as they always did
```

**Why a file and not an API.** Thirteen services get their configuration by
handing a path to `dotenv`. An RPC would mean rewriting every one of them, and
every future one, for nothing: the values land in the consumer's memory either
way. What needed fixing was the durable plaintext copy, so the shape stays "a
file at a path" and the file moves to RAM.

**Why the key is in a file, not the environment.** Env vars are inherited by
every child process and readable from that process's `/proc/<pid>/environ`. A
file readable by one uid has neither problem, and rotation is a `cp` rather than
a config edit.

**Why the service runs unprivileged.** PM2 starts it through a root-owned
`setpriv` shim (`/usr/local/lib/benloe/node-as-benloe-secrets`) that drops to the
`benloe-secrets` uid before node evaluates a line, so the key is never held by a
root process. `src/index.ts` also refuses to start if its uid is 0 — a future
config mistake should fail loudly rather than quietly hand the key back to root.

## Rendering, and the boot ordering

On every save, and once at boot, the document is parsed and written out
atomically (temp file, `rename`) at mode 0400: the full `env`, plus one file per
declared scope.

The boot pass is `benloe-secrets-render.service`, a systemd oneshot ordered
`After=systemd-tmpfiles-setup.service` and `Before=pm2-root.service`. **That
ordering is the whole point of the unit.** `/run` is tmpfs, so after a reboot the
rendered files do not exist; PM2 then resurrects thirteen services at once, each
reading a path under `/run/benloe-secrets`. A renderer that was itself a PM2 app
would be racing its own consumers, and the failure mode is a couple of services
starting with no credentials — which surfaces days later as an application bug in
whichever integration lost the race.

`systemd-tmpfiles` creates `/run/benloe-secrets` (0700 `benloe-secrets`) from
`/etc/tmpfiles.d/benloe-secrets.conf`, because the unprivileged service cannot
`mkdir` in `/run` itself. That directory's ownership *is* the access control.

Unit and tmpfiles sources of truth live in `infra/systemd/`; they are **copied**
to `/etc/systemd/system/` and `/etc/tmpfiles.d/`. After editing, copy across and
`systemctl daemon-reload`.

## Scoping

A consumer that handles untrusted input should not be able to read every
credential on the server merely because it happens to run as root. Rather than
invent a per-caller protocol, each scope gets its own rendered file containing
only the keys it names, and that consumer's unit is fenced off from the full file
with systemd's `InaccessiblePaths`. The kernel's mount namespace enforces it, not
this code being correct.

Scopes are declared in `src/materialize.ts` as key prefixes:

| Scope | File | Keys |
|---|---|---|
| `pr-reviewer` | `/run/benloe-secrets/pr-reviewer.env` | `PR_REVIEWER_*` |

`pr-reviewer` reads PR titles, bodies and diffs from a public repository —
attacker-controlled text — and publishes its output back to that same public PR.
It sees three keys and nothing else, so the worst case of a prompt injection is
the loss of an identity that already holds only `pull_requests:write`.

Adding a scope is: a prefix list in `SCOPES`, then `InaccessiblePaths=` on the
consumer's unit. Doing only the first half renders a file that isolates nothing.

## The dashboard

`https://secrets.benloe.com` — artanis session, **owner only**. An `agent`-role
key authenticates fine at artanis and is refused here; that distinction is the
point. The owner email comes from `/etc/benloe/benloe-secrets.conf`.

One textarea, one document, one save. There is no per-key CRUD and no naming
scheme, because the thing being managed is a set of environment variables that
are edited together and consumed together — this is the "plaintext mode" every
secrets product offers and every operator actually uses.

Values **are** readable here, by the owner, in a browser. That is a change in
posture from a write-only store and it is deliberate: a document you cannot read
is a document you cannot edit, and editing is the whole interaction.

Every save keeps the previous version, and history is listed with a restore
button. For a textarea holding every credential on the box, the realistic
accident is not a leak — it is a paste that silently drops twenty lines. The
answer to that is history, not a confirmation dialog.

Its Caddy config lives in `/etc/caddy/secure.d` (root-owned) rather than the
agent-writable `infra/caddy`, because whoever controls that hostname could serve
a look-alike page and capture secrets as they are pasted.

## Bootstrap

`/etc/benloe/benloe-secrets.conf` is the one configuration file left outside the
store. This service cannot read its own store to discover who owns it, so the
owner email lives there — root-owned, tiny, and permanent by design.

## Operating it

Generate or rotate the key:

```sh
umask 077 && openssl rand -base64 32 > /etc/benloe/benloe-secrets.key
chown root:benloe-secrets /etc/benloe/benloe-secrets.key && chmod 640 /etc/benloe/benloe-secrets.key
pm2 restart benloe-secrets
```

⚠ **Back this key up somewhere off-box.** The document is AES-256-GCM under it;
lose it and every credential on the server is unrecoverable ciphertext. Rotating
does **not** re-encrypt existing versions — they will fail authentication, and
you re-paste the document. That is the deliberate consequence of the key never
being derivable from anything on disk.

A malformed key does not take the service down: it logs the byte length (never
material) and runs without encryption, showing `keyLoaded: false` prominently on
the dashboard — which is exactly where you would go to fix it.

Re-render without editing (after a manual restore, say):

```sh
/usr/local/lib/benloe/node-as-benloe-secrets /srv/benloe/apps/benloe-secrets/dist/render-cli.js
systemctl start benloe-secrets-render.service   # equivalent, and what boot runs
```

Audit log: `/var/lib/benloe-secrets/audit.log`, one JSON line per event, mode
0600, surfaced read-only on the dashboard. It records who changed what, when, and
how big the result was — never the document, a value, or a fragment of one. It is
a separate append-only file rather than a table in `secrets.db` on purpose: a log
the serving code can rewrite is one you have to trust that code about, and it
survives the database being restored from a backup.

## Known gaps

- **Root is root.** Any service running as root can read
  `/run/benloe-secrets/env`. The scope files fence off specific consumers; they
  do not make the box multi-tenant, and nothing here should be read as claiming
  otherwise.
- **One scope exists.** `pr-reviewer` is the only consumer with real isolation.
  Every other service gets the full set because nobody has done the work of
  deciding what each one actually needs.
- **Consumers keep values in memory.** Rendering to tmpfs bounds the durable
  copy, not the live one. A process that has loaded a credential holds it until
  it restarts, and a rotation is not effective until every consumer has.
