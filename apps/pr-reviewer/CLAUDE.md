# pr-reviewer — context for a fresh session

A systemd timer that reviews open PRs on `BLoe/benloe-server` and posts the
findings back to GitHub. No server, no port, no PM2 entry — it is a oneshot
that runs, works, and exits.

## The shape

`src/poll.mjs` (entry) → for each open PR whose **head SHA** has not been
reviewed → detached git worktree at that SHA → headless `claude -p` orchestrator
→ pr-review-toolkit subagents in parallel → structured JSON → posted as a
GitHub review.

Zero runtime dependencies. `node --test`, `node:crypto`, `fetch`. That is
deliberate — everything here is generic code with a clear contract, so a
dependency would be someone else's maintenance burden for no leverage.

## Things that will bite you

- **Auth is the `benloe-pr-reviewer` GitHub App, never `gh` and never
  `cabinet-benloe`.** The `gh` CLI token on this box expires and needs a human
  to re-auth; an unattended timer cannot depend on that. `src/github.mjs` mints
  a fresh installation token each poll from
  `PR_REVIEWER_{APP_ID,INSTALLATION_ID,PRIVATE_KEY_B64}` in
  `/run/benloe-secrets/pr-reviewer.env`. That identity has `contents:read` (to
  fetch) and `pull_requests:write` (to post), and deliberately **no
  `contents:write`** — it cannot push or merge.

  **The reviewer gets its own secret set on purpose** — benloe-secrets renders
  one file per app, and the `pr-reviewer` set holds those three keys and nothing
  else. The other apps' renders under `/run/benloe-secrets` are in the unit's
  `InaccessiblePaths`, so a review that is talked into reading every secret on
  the box gets ENOENT from the kernel rather than a file. Scoping is now the
  shape of the data — the reviewer cannot reach the Mailgun key because that key
  is in the `cabinet` set, not because anything here refuses to read it. Keep
  `PR_REVIEWER_ENV_FILE` pointed at this app's own render.

  `reviewerCredentials()` has **no fallback** to `GITHUB_APP_*`. A fallback
  would let a typo silently promote the reviewer to the write-capable
  `cabinet-benloe` identity with everything still appearing to work.
  `readEnvKeys` returns **only** the keys it is asked for — keep it that way.

- **The git working area is the reviewer's own bare mirror**
  (`/var/lib/pr-reviewer/repo.git`, `ensureMirror`), never `/srv/benloe`. That
  is the live production checkout every service deploys from; fetching or
  adding worktrees there mutates production to read a diff. The systemd
  sandbox enforces it — `ProtectSystem=strict` with `/srv/benloe` absent from
  `ReadWritePaths`. **Re-adding it would silently restore the old mistake.**
  When the two first met, every review died on `cannot open '.git/FETCH_HEAD':
  Read-only file system` and the app was down for four hours.

  Fetching is over HTTPS with the installation token, not the SSH deploy key:
  the key can push and lives in `/root/.ssh`, which the sandbox makes
  inaccessible. The token rides in `GIT_CONFIG_*` env vars (out of `ps`), and
  `agentEnv()` strips them before the review agent is spawned.

- **Reviews are keyed on head SHA, not PR number.** New commits earn a new
  review; an untouched branch is never re-reviewed. State lives at
  `/var/lib/pr-reviewer/state.json`, outside the repo.

- **A failed review posts a failure comment and does NOT mark the SHA
  reviewed**, so the next poll retries. Silence would be indistinguishable
  from "found nothing", which is the one outcome a reviewer must never fake.

- **Inline comments are validated against the diff** (`src/diff.mjs`). GitHub
  rejects the *entire* review if any inline comment cites a line outside the
  patch, and an LLM will occasionally cite a line it read from the whole file.
  Unanchorable findings are demoted into the review body, never dropped.

- **APPROVE when clean, COMMENT otherwise, REQUEST_CHANGES never**
  (`REVIEW_EVENT` in `src/format.mjs`). Acceptance has to be a machine-readable
  state because the merge policy is "PRs go through review until the reviewer
  accepts" — a human inferring it from prose is not a gate. Suggestions do not
  block; critical and important do.

  Blocking stays impossible on purpose: a stochastic reviewer that can request
  changes will eventually wedge the queue on one confident false positive,
  unattended, and the human override is itself friction. COMMENT carries the
  same findings without the deadlock.

  Approving is only possible because the reviewer is a **separate identity from
  the author** — GitHub refuses to let an account approve its own PR.

- **Only allowlisted authors get reviewed** (`src/authors.mjs`). This is the
  primary prompt-injection control, and it is a *capacity* limit rather than a
  *rate* one: Opus 5 is the most injection-robust model measured (~0.13% per
  attempt), but an unattended five-minute timer on a public repo hands an
  attacker unlimited free retries, and a rate times unlimited attempts is a
  certainty. Refusing to read strangers' PRs caps attempts at zero. Do not
  remove the prompt fence or the sandbox because this exists — a trusted
  author's diff is still written by an agent that reads web pages and email.

- **The agent is read-only by allowlist** (`ALLOWED_TOOLS` in `src/review.mjs`).
  No Write, no Edit, no mutating git, no network fetch. It reviews branches
  written by agents; a denylist would be the wrong default.

- **Concurrency is systemd's job.** `Type=oneshot` means a second instance will
  not start while one is running. Do not add a lockfile; it would be a second
  mechanism for a solved problem.

- **It costs rate limit.** Every review is real Opus turns against Ben's
  account. `PR_REVIEWER_MAX_PER_RUN` (default 2) is the cap that stops five
  PRs opened at once from draining a day's budget in one tick.

- **`poll.mjs` runs `main()` only when executed directly**, so it can be
  imported. Keep it that way: `test/wiring.test.mjs` imports every `src/`
  module purely to prove their imports resolve. An ESM link error (a name
  imported that was never exported) surfaces only on load — `node --check`
  passes, every leaf-module test passes, and the service dies on the next
  tick. That shipped on 2026-08-10 and took the reviewer down.

## Install / change

Units live in `infra/systemd/` (source of truth) and are **copied** to
`/etc/systemd/system/`, same convention as `apt-delayed-upgrade.*`. After
editing either unit:

```
install -o root -g root -m 644 \
  /srv/benloe/infra/systemd/pr-reviewer.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl restart pr-reviewer.timer
```

Run one pass by hand: `systemctl start pr-reviewer.service`, then
`tail -f /srv/benloe/logs/pr-reviewer.log`.

Tune the review prompt without touching a real PR:

```
PR_REVIEWER_DRY_RUN=1 PR_REVIEWER_ONLY_PR=12 node src/poll.mjs
```

A dry run ignores the ledger on purpose, so the same SHA can be re-reviewed as
many times as it takes to get `prompts/orchestrator.md` right.

## Tuning the review itself

`prompts/orchestrator.md` is the whole review policy — which subagents get
dispatched, what counts as critical vs important, and the instruction to verify
each finding against real code before reporting it. Changing review behavior
means changing that file, not the JS. The consolidation step is deliberately
**subtractive**: a reviewer that cries wolf gets ignored, and an ignored
reviewer is worse than none.
