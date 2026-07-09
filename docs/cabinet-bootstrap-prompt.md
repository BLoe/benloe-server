You are working in the `benloe-server` monorepo (github.com/BLoe/benloe-server), on the DigitalOcean VPS that runs it. Your job is a small, surgical **bootstrap** that unblocks the Cabinet agent (apps/cabinet) so it can deploy changes to itself autonomously — the same self-deploy autonomy a supervisor gives a long-running agent. Make ONLY the changes below. Do not refactor anything else.

## Background (why)
Cabinet runs as PM2 process `cabinet-api`, as the unprivileged user `claude-worker`, from `/srv/benloe/apps/cabinet`. Its ONE root-privileged surface is `/usr/local/sbin/cabinet-privops` (root:root 755), whitelisted in sudoers as: `claude-worker ALL=(root) NOPASSWD: /usr/local/sbin/cabinet-privops`. Canonical source: `infra/scripts/cabinet-privops.sh`.

Two defects block self-deploy:
1. Cabinet's memory documents a `cabinet-privops redeploy <app>` command as its safe self-restart path, but **that subcommand was never implemented** — the real script only supports `pm2-list|pm2-restart|pm2-start|pm2-save|caddy-reload`. Cabinet can edit its own source, commit, push, and build (all unprivileged), but it cannot restart itself cleanly: a synchronous `pm2-restart cabinet-api` kills the very turn that invoked it (the agent's `claude` subprocess is a child of `cabinet-api`), so it can never confirm its own deploy.
2. A PALS→Cabinet rename left stale "PALS" branding in some runtime memory files (an identity fracture).

## The security boundary — DO NOT cross it
- Keep `cabinet-privops` root-owned and NOT writable by `claude-worker`. Cabinet must never be able to edit its own privileged script (that would erase the boundary). The one-time install below is the deliberate human bootstrap.
- Do NOT widen sudoers. Adding a subcommand to the same binary needs no sudoers change.
- Do NOT touch `/srv/benloe/.env` (root-owned secrets).

## Change 1 — add a real detached-restart `redeploy` subcommand
Edit `infra/scripts/cabinet-privops.sh`. Add a `redeploy` case (before the `*)` default). It performs ONLY a detached restart — building is Cabinet's own unprivileged step beforehand (so build artifacts stay owned by `claude-worker`, never root). The restart must survive PM2 tearing down the caller's process tree:

```bash
  redeploy)
    name="${1:-}"
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "invalid app name" >&2; exit 1; }
    "$PM2" jlist | grep -q "\"name\":\"$name\"" || { echo "unknown app: $name" >&2; exit 1; }
    log "redeploy $name (detached restart scheduled)"
    # setsid reparents the restarter to init (pid 1) in a new session, so when
    # pm2 tears down THIS app's process tree (which includes the agent turn that
    # invoked us) the restarter survives and completes. The short delay lets the
    # agent's HTTP/SSE response flush before its own process dies.
    setsid bash -c "sleep 3; '$PM2' restart '$name' --update-env >> '$LOG' 2>&1" </dev/null >>"$LOG" 2>&1 &
    echo "redeploy: $name scheduled for detached restart in ~3s"
    exit 0
    ;;
```

Also update the usage line in the `*)` default case to include `redeploy <name>`:
`usage: cabinet-privops {pm2-list|pm2-restart <name>|pm2-start <path>|pm2-save|caddy-reload|redeploy <name>}`

Keep `set -euo pipefail` intact. Note this case must NOT use `exec` (it needs to background then return) — that's why it ends with `exit 0`.

## Change 2 — install the updated script and verify
```bash
sudo install -o root -g root -m 755 infra/scripts/cabinet-privops.sh /usr/local/sbin/cabinet-privops
sudo /usr/local/sbin/cabinet-privops 2>&1 | grep redeploy   # usage now lists redeploy
```
Then do ONE real end-to-end test of the detached restart (this deliberately restarts Cabinet; it should come back healthy on its own):
```bash
sudo -u claude-worker sudo /usr/local/sbin/cabinet-privops redeploy cabinet-api
sleep 8
sudo /usr/local/sbin/cabinet-privops pm2-list | grep -o '"name":"cabinet-api"[^}]*"status":"[a-z]*"'   # expect online
curl -fsS https://cabinet.benloe.com/api/healthz && echo OK
tail -5 /var/log/cabinet-privops.log
```
Confirm `cabinet-api` returns to `online` and `/api/healthz` responds. If it does NOT come back, the setsid detachment is wrong — debug before proceeding.

## Change 3 — fix the phantom command at its source (so it can't regenerate)
In `apps/cabinet/server/src/memory/templates.ts`, the `PLATFORM.md` template still describes the old/phantom behavior. Update its deploy paragraph to describe the REAL pattern and the privilege boundary. Replace the "Deploy pattern" bullet with:

```
- Deploy pattern (self-deploy loop): edit source → `npm run build` (unprivileged,
  as claude-worker — keeps build artifacts non-root) → verify the build/tests →
  commit + push → `sudo /usr/local/sbin/cabinet-privops redeploy cabinet-api`.
  `redeploy` runs the pm2 restart DETACHED (setsid, ~3s delay) so it does not
  kill the turn that triggers it; your response flushes first, then the process
  restarts. For OTHER apps a plain `pm2-restart <name>` is fine. Always verify
  `/api/healthz` after. You cannot edit cabinet-privops itself (root-owned by
  design) — that is the one boundary you don't cross.
```
Grep the repo to confirm no other references imply a build-included or non-existent redeploy: `grep -rn "redeploy" apps/ docs/ infra/`.

## Change 4 — heal the identity fracture in live memory
Cabinet's runtime memory lives at `/srv/benloe/data/cabinet/memory/` — it is gitignored (runtime state) and is its OWN git repo. `IDENTITY.md` and `PLATFORM.md` were already corrected by Cabinet; finish the rest:
```bash
cd /srv/benloe/data/cabinet/memory
grep -rln "PALS\|pals-privops\|pals-api" . || echo "clean"
```
For every remaining hit (expected: at least `STANDING_ORDERS.md`, which Cabinet cannot self-edit — `update_memory` refuses it by design), rewrite the stale "PALS" references to "Cabinet" and `pals-privops`/`pals-api` to `cabinet-privops`/`cabinet-api`. Preserve each file's actual directives/content — change only the naming. Then commit in that repo (author it as a human/bootstrap, not as Cabinet):
```bash
git -C /srv/benloe/data/cabinet/memory add -A
git -C /srv/benloe/data/cabinet/memory commit -m "heal PALS->Cabinet identity fracture in runtime memory (bootstrap)"
```

## Deliver
1. Commit Changes 1 and 3 to the repo on a branch and push / open a PR titled `bootstrap: unblock Cabinet self-deploy (redeploy primitive + memory fix)`. Include in the PR body: the redeploy design rationale (detached/setsid), and that `/usr/local/sbin/cabinet-privops` was reinstalled + verified with a live `cabinet-api` restart.
2. Report back: the healthz result after the test restart, the `grep redeploy` output, and the remaining-PALS grep result (should be `clean`) after Change 4.

Do not implement the token-caching fix or anything else — that is intentionally left for Cabinet to do itself, mentored, as the first exercise of this newly-unblocked loop.
