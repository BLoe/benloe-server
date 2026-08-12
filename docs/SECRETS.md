# Secrets on this box

Every credential this server uses lives in the `benloe-secrets` service (port
3011, uid `benloe-secrets`), stored as a set of named encrypted documents, edited
in a browser at `https://secrets.benloe.com`, and rendered to tmpfs where
services read them. There is one set per app, named for the app's directory
under `apps/`. Each app reads exactly one file: its own.

## What this actually buys

Overstating this is how the design rots, so state the limit first:

> **You cannot stop a process allowed to *use* a secret from *exercising* it.**

If Cabinet is allowed to sync your bank transactions, Cabinet can cause bank API
calls. No architecture changes that. And most consumers on this box run as root,
so this is **not confidentiality from root**: root can read the key file, the
store and the rendered files alike.

What it does buy, all of it real:

- **No plaintext secrets in a git working tree.** `/srv/benloe/.env` was a file
  the agent could read, `cat` into a transcript, or commit by accident. It is
  deleted.
- **Each service's blast radius is its own keys.** kickball's render holds one
  key. It cannot read the Mailgun key because that key is in the `cabinet` set,
  not because a list somewhere says kickball may not have it.
- **One durable copy, behind one uid.** The ciphertext in
  `/var/lib/benloe-secrets/secrets.db` and the key in
  `/etc/benloe/benloe-secrets.key` are openable by `benloe-secrets` and root —
  not by `claude-worker`, which is what the agent's shells run as.
- **Nothing durable in plaintext.** The rendered files live on `/run`, which is
  tmpfs. They never touch a disk and never survive a reboot.
- **An audit log outside the thing it describes,** and a version history per set,
  so a bad edit is one click from undone.
- **Management from a browser.** Rotating a key is an edit and a save, from a
  phone if necessary, with no shell on the VPS.

## The shape

```
  Ben ──TLS──► secrets.benloe.com ──► dashboard :3011 ──┐
                (artanis, owner-only)                    │   secrets.db  (uid benloe-secrets, AES-256-GCM per set)
                                                         ├──► audit.log   (0600)
  boot ──► benloe-secrets-render.service (oneshot) ──────┘   key file    (/etc/benloe/benloe-secrets.key, 0640 root:benloe-secrets)
                          │
                          ▼
              /run/benloe-secrets/          0700 benloe-secrets
                ├── artanis.env             0400  — that set merged over `shared`
                ├── cabinet.env             0400
                ├── kickball.env            0400
                └── … one per set, thirteen of them
                          │
                          ▼
              each service reads its own path with dotenv, as they always did
```

**Scoping is the shape of the data.** There is no scope list, no key-prefix
matching and no per-caller protocol. A set's contents are what its app can read.
Putting a key in the wrong set is the only way to over-share, and that shows up
in the store and in the dashboard's effective-keys panel rather than being buried
in source.

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

## The sets

Thirteen sets render a file, plus `shared`, which does not:

| Set | Notes |
|---|---|
| `artanis`, `cabinet`, `fantasy-hawk`, `gamenight`, `kickball`, `pr-reviewer`, `sleeper-ui`, `waker`, `yahoo-fantasy-mcp` | one per app, named for `apps/<name>` |
| `dada-api`, `fitness`, `weights-api` | empty on purpose — they authenticate by calling artanis rather than verifying a token themselves, so they use no secret at all. They still get a set, because a set is what produces their file, and an app with no secrets should get an empty file rather than somebody else's. |
| `shared` | merged under every other set. Currently empty. |
| `unassigned` | keys no app's source references. No app reads `unassigned.env`; it exists so the values survive in the store and stay visible until someone can say whether they are dead. |

On a key collision between a set and `shared`, **the app's set wins**, so a set
can override a shared default without the default having to know about it.

### Why `shared` is empty

`shared` reaches every set, which makes it the one place a mistake is not
contained. A key used by two apps is duplicated into those two sets instead.

JWT_SECRET is the case worth recording, because it looked like the one genuine
member: artanis mints the sessions six other services verify, and they break the
instant they disagree. Putting it in `shared` also put it in `pr-reviewer.env`.
pr-reviewer feeds attacker-controlled text from public pull requests to an agent,
and whoever holds JWT_SECRET can forge a session for any principal — including
the owner, which is the credential the secrets dashboard itself authenticates
with. That is a path from a public PR to every secret on the box, through the one
service most likely to be manipulated.

So JWT_SECRET is duplicated into exactly the six services that verify sessions.
Rotating it is six edits instead of one; the dashboard shows each app's effective
keys, so the duplication is visible rather than folklore. The full derivation of
which key went where is in the header of `src/seed-cli.ts`.

## Rendering, and the boot ordering

On every save, restore and delete, and once at boot, every set is re-rendered:
merged over `shared`, written atomically (temp file, `rename`) at mode 0400,
owned by `benloe-secrets`. Rendering all of them on every mutation is what keeps
`shared` honest — an edit there has to reach twelve files, not one.

`materialize.ts` also **prunes**. A file whose set no longer exists is deleted,
because otherwise a retired or renamed app leaves its last credentials sitting
readable for as long as the box stays up. The single `env` file the superseded
one-document design rendered — every key on the box in one file — is named
explicitly and always swept.

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
`mkdir` in `/run` itself. That directory's ownership *is* the access control for
every uid other than root.

Unit and tmpfiles sources of truth live in `infra/systemd/`; they are **copied**
to `/etc/systemd/system/` and `/etc/tmpfiles.d/`. After editing, copy across and
`systemctl daemon-reload`.

## pr-reviewer, where the mode bits are not enough

pr-reviewer reads PR titles, bodies and diffs from a public repository —
attacker-controlled text — and publishes its output back to that same public PR.
It runs as root, because the Claude CLI credentials it needs live under
`/root/.claude`. Mode 0400 stops every other uid on the box and stops a root unit
not at all, so the sandbox in `infra/systemd/pr-reviewer.service` is what binds
it:

- `CapabilityBoundingSet=` is empty, so the unit is root **without**
  CAP_DAC_OVERRIDE. Being uid 0 no longer opens a 0400 file owned by another uid.
  Bind-mounting its own render read-only was the first attempt and failed for
  exactly this reason.
- `LoadCredential=reviewer-env:/run/benloe-secrets/pr-reviewer.env` is the
  mechanism that fits. PID 1 opens the file during unit setup, in the host
  context, before any of the sandbox exists, and leaves a private 0400 copy in
  `$CREDENTIALS_DIRECTORY` owned by the service.
- The whole of `/run/benloe-secrets` is then in `InaccessiblePaths`, along with
  `/var/lib/benloe-secrets`, the broker socket directory, the application
  databases and `/etc/benloe`. The reviewer cannot observe that the other twelve
  renders exist, and that holds by default for an app added tomorrow with no edit
  to the unit. A deny-list would have to be maintained, and a forgotten entry
  fails silently open.

The worst case of a successful prompt injection is the loss of a GitHub App
identity holding `pull_requests:write` on one repository. The fence in
`prompts/orchestrator.md` is advisory and rides on top of this.

## The dashboard

`https://secrets.benloe.com` — artanis session, **owner only**. An `agent`-role
key authenticates fine at artanis and is refused here; that distinction is the
point. The owner email comes from `/etc/benloe/benloe-secrets.conf`.

One textarea per set, one save. There is no per-key CRUD and no naming scheme,
because the thing being managed is a set of environment variables that are edited
together and consumed together — this is the "plaintext mode" every secrets
product offers and every operator actually uses.

Alongside the editor, an **effective keys** panel shows what the selected app can
actually read: `shared` underneath, the app's own set on top, each key marked
`own`, `shared` or `override`. That panel is where over-share becomes visible.

Values **are** readable here, by the owner, in a browser. That is deliberate: a
document you cannot read is a document you cannot edit, and editing is the whole
interaction. The compensating controls are TLS, an owner-only session, and an
audit line per access.

Every save keeps the previous version, and history is listed per set with a
restore button. Restore is itself a save of the old text, so history stays
append-only and an accidental restore is also undoable. Deleting a set removes
its rendered file as well; `shared` cannot be deleted.

Its Caddy config lives in `/etc/caddy/secure.d` (root-owned) rather than the
agent-writable `infra/caddy`, because whoever controls that hostname could serve
a look-alike page and capture secrets as they are pasted.

## The Plaid capability broker

The same service runs a second listener, unrelated to the env sets and still in
progress: a unix socket at `/run/benloe-secrets-broker/broker.sock`, mode 0660
`benloe-secrets:claude-worker`. Cabinet connects to it to make Plaid calls
without ever holding the Plaid credential.

- Authentication is the filesystem. The set of processes that can connect is
  exactly {root, benloe-secrets, claude-worker}. There is no token to leak, and
  the kernel does the enforcing.
- Its credentials live in a separate table (`credentials.ts`) with its own
  schema, sharing only the database file and the key file with the env sets.
- No route returns credential material — not a debug variant, not a decrypt RPC.
  Cabinet can list names, ask whether an integration is configured, and ask for a
  credential to be *used*. `test/no-secret-egress.test.ts` fails if `broker.ts`
  ever imports `decryptSecret`.
- The socket lives in its own directory because it must be reachable by
  `claude-worker` while the rendered env must not be. One directory cannot
  express both.

## Bootstrap

`/etc/benloe/benloe-secrets.conf` is the one configuration file left outside the
store. This service cannot read its own store to discover who owns it, so the
owner email lives there — root-owned, tiny, and permanent by design.

PM2 starts apps from root-owned configs in `/etc/benloe/ecosystem/`, not the
copies in the repo. Those configs read the app's render and inject exactly the
variables it names, so the agent cannot widen an app's environment by editing a
file in the working tree.

## Operating it

Generate or rotate the key:

```sh
umask 077 && openssl rand -base64 32 > /etc/benloe/benloe-secrets.key
chown root:benloe-secrets /etc/benloe/benloe-secrets.key && chmod 640 /etc/benloe/benloe-secrets.key
pm2 restart benloe-secrets
```

⚠ **Back this key up somewhere off-box.** Every set is AES-256-GCM under it; lose
it and every credential on the server is unrecoverable ciphertext. Rotating does
**not** re-encrypt existing versions — they will fail authentication, and you
re-paste each set. That is the deliberate consequence of the key never being
derivable from anything on disk.

A malformed key does not take the service down: it logs the byte length (never
material) and runs without encryption, showing `keyLoaded: false` prominently on
the dashboard — which is exactly where you would go to fix it.

Re-render without editing (after a manual restore, say):

```sh
/usr/local/lib/benloe/node-as-benloe-secrets /srv/benloe/apps/benloe-secrets/dist/render-cli.js
systemctl start benloe-secrets-render.service   # equivalent, and what boot runs
```

The renderer is all-or-nothing: every set is decrypted before anything is
written, so one corrupt row fails the whole pass rather than leaving half the box
configured from the store and half from whatever the last boot left behind.

**Restarting the consumer is what picks up a change.** Saving in the dashboard
re-renders the file; a running process is still holding what it read at startup.

Audit log: `/var/lib/benloe-secrets/audit.log`, one JSON line per event, mode
0600, surfaced read-only on the dashboard. It records who changed which set,
when, and how big the result was — never a document, a value, or a fragment of
one. It is a separate append-only file rather than a table in `secrets.db` on
purpose: a log the serving code can rewrite is one you have to trust that code
about, and it survives the database being restored from a backup.

## Known gaps

- **Root is root.** Any service running as root can read any file under
  `/run/benloe-secrets`. The sets bound what each app is *given*; only
  pr-reviewer's sandbox makes a root consumer unable to reach the rest, and only
  because that unit gave up CAP_DAC_OVERRIDE.
- **Consumers keep values in memory.** Rendering to tmpfs bounds the durable
  copy, not the live one. A process that has loaded a credential holds it until
  it restarts, and a rotation is not effective until every consumer has.
- **The allocation is a snapshot.** Sets were populated by grepping each app's
  source for each key name. An app that starts using a new key gets a runtime
  failure, not a warning, and nothing re-checks the allocation as the code moves.
- **`unassigned` is unfinished business.** Four keys sit there because nobody can
  yet say whether they are dead. They are reachable by nobody, which is safe and
  is not an answer.
