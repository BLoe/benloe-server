# sleeper-ui — League Desk

A desktop dashboard for Sleeper fantasy football, at **https://sleeper.benloe.com**.

Sleeper's own desktop site is their mobile layout stretched wide. This is the
same data laid out for a laptop: everything on one screen, nothing behind a tap.

Read-only. It never writes to Sleeper.

## Identity

The site is public and multi-visitor. Each visitor enters their own Sleeper
username, which is resolved against Sleeper and stored in an HMAC-signed,
HttpOnly cookie (`src/server/session.ts`, signed with `JWT_SECRET`). There is no
password, because a Sleeper username and every REST endpoint this app reads are
already public — the session only answers *whose leagues am I looking at*.

`SLEEPER_USERNAME` is **not** an identity. It only pre-fills the sign-in box.

Every `/api/league/*` route requires a session, and "my team" highlighting comes
from that session's user id.

## Where the data comes from

Two upstreams, both reached from `src/lib/sleeper.ts`:

| Source | What it gives us | Auth |
|---|---|---|
| REST v1 (`api.sleeper.app`) | leagues, rosters, users, matchups, transactions, drafts, players | none |
| GraphQL (`sleeper.app/graphql`) | player news, outlooks, live NFL scores | none for public queries |
| GraphQL (`sleeper.app/graphql`) | **league chat** | bearer token required |

The REST API is [documented](https://docs.sleeper.com/) and rate limited to 1000
calls/minute. The GraphQL endpoint is undocumented but has introspection enabled;
it is what Sleeper's own apps use.

## League chat

A Sleeper league is itself the message parent — chat is `messages(parent_id: <league_id>)`,
with no separate channel to resolve. It is the one endpoint that requires signing in.

```bash
# /srv/benloe/.env
SLEEPER_TOKEN=<your token>
SLEEPER_ALLOW_POSTING=false   # true enables the composer
```

To get the token: sign in to sleeper.com in Chrome, open DevTools → Application →
Local Storage, and copy the session token value. Then `pm2 restart sleeper-ui`.

**Chat is the one section that cannot be per-visitor.** It rides a single token,
so it belongs to exactly one Sleeper account. `src/server/chatAccess.ts` resolves
the token's owner via the `me` query and serves chat only to the visitor whose
session matches; everyone else gets a 403 and an explanation. That check is pure
and unit tested, because on a public site getting it wrong would expose private
league conversations to strangers.

Without a token the rest of the dashboard works normally and the Chat section
explains what is missing. `GET /api/health` reports `chat.enabled` and `chat.canPost`.

**Posting is the only write in the app** and is off unless `SLEEPER_ALLOW_POSTING=true`.
It puts a real message in a real league in front of real people, so it does not
inherit the token's permission — it needs its own.

Chat polls every 15s while the tab is visible. In fixture mode it renders
`fixtures/chat.sample.json`, a synthetic feed with invented content — real chat
cannot be captured without a token, and the screenshot harness must not depend on one.

## Design notes

**Type scale.** Six steps with real distance between them (`--t-label` 12px through
`--t-hero` 30px, in `src/web/index.css`). The first version ran everything from
10–14px, which is five jobs inside four pixels, so nothing led. Nothing in the
interface is smaller than 12px.

**Position colours are two tokens, not one.** `--pos-*` are chart-mark colours,
validated as a categorical palette against the panel surface (OKLCH L 0.50–0.665,
chroma ≥ 0.10, all-pairs CVD and normal-vision separation clear). `--pos-*-ink`
are lightened variants that clear 4.5:1 as text. A mark and a label have different
contrast requirements; using one value for both failed on both counts.

**Charts** live in `src/web/charts.tsx` — plain SVG and HTML, no library. Each one
exists because a column of numbers was making the reader do arithmetic: the season
tape (result and margin per week, sqrt-scaled so ordinary weeks still read), the
points-for magnitude bar, the diverging schedule-luck gauge, weekly scoring bars
with the opponent as a tick on the same axis, and the matchup's edge-by-slot chart.

**Everything named is a link.** Teams, managers, players, matchups and weeks all
navigate. `PlayerLink` / `TeamLink` in `components.tsx` make that the default
rather than something each page remembers. `verify/links.mjs` clicks through every
one of those paths and fails if any dead-ends.

## Layout

```
src/lib/sleeper.ts      API client — the only place that does network I/O
src/lib/derive.ts       Pure transforms: raw payloads -> view models. No I/O, fully tested.
src/server/index.ts     Express on :3010. Serves /api, falls back to dist/ for the SPA.
src/server/cache.ts     TTL cache with stale-while-revalidate + disk layer for the player dump
src/web/                React + Vite dashboard
scripts/capture-fixtures.ts   Freezes real league data to fixtures/
src/web/charts.tsx      Charts — plain SVG/HTML, no chart library
verify/verify.mjs       Screenshots every route at three viewports, fails on any error
verify/links.mjs        Clicks every entity link and asserts it navigates somewhere real
verify/browse.mjs       Screenshots the live deployment for eyeballing at 1:1
test/derive.test.ts     42 tests, run against the frozen fixtures
```

## Working on it

```bash
npm run dev        # api on :3010 + vite on :5310
npm test           # derivation tests against real fixtures
npm run verify     # screenshot every route, check for console/network/layout errors
npm run links      # click through every entity link and assert it navigates
npm run capture    # re-freeze fixtures from live Sleeper
npm run build      # browser bundle -> dist/
```

### The verification loop

`npm run verify` boots the server with `SLEEPER_SOURCE=fixtures`, so the same run
always renders the same pixels. It walks every route at 1728px, 1440px and 390px,
writes PNGs to `.verify/`, and exits non-zero on a console error, a failed request,
or horizontal page overflow. Read the PNGs to review layout.

Fixture mode is not a full substitute for production. A league that has not kicked
off yet renders states the completed-2025 fixture never hits — that gap shipped a
real bug once, so `verify` now covers a preseason league too, and
`verify/prod-check.mjs` hits the deployed site against live data.

## Deployment

PM2 (`sleeper-ui`, port 3010) with Caddy serving `dist/` and proxying `/api`.

```bash
npm run build && pm2 restart sleeper-ui
```

Config: `ecosystem.config.cjs`, `infra/caddy/sleeper.benloe.com`. The Caddy log
file must exist and be owned by `caddy` before a reload will succeed.

## Notes

- The player dump is ~14.6MB. It is cached to disk for 12 hours and trimmed to a
  ~1.2MB index before anything reaches the browser.
- `ppts` in a roster's settings is the best score that lineup could have produced.
  Comparing it to `fpts` gives the lineup-efficiency column, which Sleeper does
  not surface anywhere.
- All-play record — what your record would be if you played everyone every week —
  is derived in `buildAllPlay` and drives the schedule-luck column.
