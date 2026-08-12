# pr-reviewer

A systemd timer that reviews open pull requests on `BLoe/benloe-server` and
posts organized findings back to GitHub.

Every five minutes it asks GitHub for open PRs. Any PR whose head commit has
not been reviewed gets checked out into a throwaway git worktree, handed to a
headless Claude orchestrator that dispatches the
[`pr-review-toolkit`](https://github.com/anthropics/claude-code) specialist
subagents in parallel, and the consolidated result is posted as a review —
inline comments where a finding can be anchored to a line in the diff, and a
summary body with the verdict and counts.

The review **approves** only when it finds nothing critical or important **and
nothing in its own output was malformed or empty**; otherwise it posts a plain
`COMMENT`. It never requests changes — it can accept a PR but cannot block one.

## Operating it

| | |
|---|---|
| Run one pass now | `systemctl start pr-reviewer.service` |
| Logs | `/srv/benloe/logs/pr-reviewer.log` |
| Schedule | `systemctl list-timers pr-reviewer.timer` |
| State | `/var/lib/pr-reviewer/state.json` (reviewed head SHAs) |
| Dry run | `PR_REVIEWER_DRY_RUN=1 PR_REVIEWER_ONLY_PR=<n> node src/poll.mjs` |
| Tests | `npm test` |

## Configuration

All optional; the defaults are what runs in production.

| Variable | Default | Purpose |
|---|---|---|
| `PR_REVIEWER_REPO` | `BLoe/benloe-server` | Repository to watch |
| `PR_REVIEWER_MODEL` | `opus` | Model for the orchestrator and subagents |
| `PR_REVIEWER_MAX_PER_RUN` | `2` | Reviews per poll — the rate-limit guard |
| `PR_REVIEWER_TIMEOUT_MS` | `1200000` | Per-review wall clock (20 min) |
| `PR_REVIEWER_RUN_BUDGET_MS` | `1500000` | Start no new review after this (25 min) |
| `PR_REVIEWER_MIRROR` | `/var/lib/pr-reviewer/repo.git` | The reviewer's own bare mirror — never `/srv/benloe` |
| `PR_REVIEWER_ENV_FILE` | `/run/benloe-secrets/pr-reviewer.env` | The reviewer's own secret set — never another app's render |
| `PR_REVIEWER_ALLOWED_AUTHORS` | `BLoe,cabinet-benloe[bot],benloe-carpenter[bot]` | Logins whose PRs get reviewed — the injection control |
| `PR_REVIEWER_INCLUDE_DRAFTS` | unset | Set `1` to review draft PRs too |
| `PR_REVIEWER_DRY_RUN` | unset | Set `1` to print instead of post |
| `PR_REVIEWER_ONLY_PR` | unset | Restrict a run to one PR number |

Authentication uses the **`benloe-pr-reviewer`** GitHub App via
`PR_REVIEWER_{APP_ID,INSTALLATION_ID,PRIVATE_KEY_B64}` in
`/run/benloe-secrets/pr-reviewer.env` — the reviewer's own secret set, holding
those three keys and nothing else. benloe-secrets renders one such file per app
and the other apps' renders are in the unit's `InaccessiblePaths`, so this
service cannot read any other secret on the box.
That identity holds `contents:read` (to clone and fetch the diff),
`pull_requests:write` (to post the review), and deliberately **no
`contents:write`** — so it cannot push or merge. There is deliberately no fallback to the write-capable
`cabinet-benloe` app; missing credentials fail loudly rather than silently
escalating. A fresh installation token is minted on every poll, so no
human-expiring credential is in the loop.

See `CLAUDE.md` for design rationale and the traps.
