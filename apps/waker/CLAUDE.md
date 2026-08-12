# Waker — working context

Operational notes for an agent picking this up cold. The [README](README.md) is
written for a *reader*; this is written for whoever has to *change* it. Where
they overlap, this file wins on specifics and the README wins on rationale.

**Live at https://waker.benloe.com.** Port 3012, PM2 `waker-api`, Caddy config at
`/srv/benloe/infra/caddy/waker.benloe.com`.

---

## 1. What this app is, and what it must not become

Waker is **organised by decision and time horizon, not by entity**. That is the
whole point of it existing alongside `sleeper-ui` (League Desk), which is a
perfectly good browser of the same league.

The rule that keeps it honest: **there is no players page, no teams page, no
matchup page.** A player is never the question, only the evidence. If a change
would add an entity browser, it is almost certainly the wrong change — the
information belongs on whichever horizon the *decision* about it lives on.

Four surfaces, ordered by how far out they reach:

| Route | Horizon | Answers |
|---|---|---|
| `/l/:id` | **Now** — days | What needs me before the next gate? |
| `/l/:id/tape` | **Tape** — usage | Who is the market wrong about? |
| `/l/:id/season` | **Season** — weeks | Does this week actually matter? |
| `/l/:id/horizon` | **Horizon** — years | What is this roster becoming? |

The primary object is a **decision card** (`src/lib/analysis/decisions.ts`). Two
invariants, both load-bearing:

1. **Every card is priced in points**, so the feed can be ranked honestly.
   `rankDecisions` puts season totals onto a weekly footing before comparing.
2. **Every card names the gate that kills it.** `isLive(clock, phase)` drops a
   start/sit card once lineups lock — not because it matters less, but because
   it is *impossible*, and showing it would tell someone to do something they
   cannot do.

If you add a card kind, it needs a `stake`, a `stakeUnit`, and a `clock`.

---

## 2. Layout

```
src/lib/            pure, no network, no Express — all heavily unit-tested
  analysis/         one module per question; each documents the DECISION it serves
    cycle.ts        where we are in the fantasy week (the clock everything hangs off)
    decisions.ts    the card model + the builders that produce cards
    divergence.ts   usage vs production — the buy-low/sell-high engine
    leverage.ts     start/sit weighted by whether you are favoured
    lineup.ts       best available lineup from a roster + roster_positions
    ledger.ts       surplus meets need -> named trades
    orientation.ts  win-now vs future, from dynasty-vs-redraft value
    playoffs.ts     seeded Monte Carlo odds + per-game leverage
    replacement.ts  value over replacement for THIS league's lineup shape
  sources/          third-party clients + parsers; each returns [] rather than throwing
    fantasycalc.ts  dynasty AND redraft value. Carries sleeperId — the bridge.
    keeptradecut.ts scrapes `var playersArray` out of the rankings HTML
    nflverse.ts     CSV parser + snap counts / weekly usage / injuries
    join.ts         KTC --mflId--> FantasyCalc --sleeperId--> Sleeper, + name join
    http.ts         shared fetch with hard timeouts
  sleeper.ts        Sleeper REST + GraphQL client (copied from sleeper-ui)
  projections.ts    indexes Sleeper's Rotowire projection feed

src/server/
  index.ts          wiring only: session, /me, /sources, /board, /feed, /cycle, static
  data.ts           ALL shared loaders. Import from here, never re-implement.
  market.ts         assembles + caches the third-party layer into one Market object
  feed.ts           builds the decision feed from everything the app knows
  routes/           feature routes: tape.ts, season.ts, ledger.ts
  cache.ts          TTL memory cache w/ stale-while-revalidate + disk layer
  session.ts        HMAC-signed cookie (copied from sleeper-ui)
  loginPolicy.ts    the twelve-manager allow-list
  tokenStore.ts     AES-256-GCM store — present but UNUSED (no write path yet)

src/web/            React 18 + Vite + Tailwind. Tokens in index.css, not Tailwind config.
  App.tsx           shell, thumb-index nav, league switcher, routing
  index.css         THE design system. All colour/type tokens live here.
  components.tsx    Sheet, Pos, Loading, ErrorNote, Empty
  TideStrip.tsx     the signature element
  Decisions.tsx     decision rows
  Board.tsx         the 2D roster scatter
  Tape.tsx          Sparkline + segments/trendWord/describeSeries
  Ledger.tsx        LedgerPanel (mounted inside Horizon, not its own page)
  pages/            Now, TapePage, Season, Horizon, SignIn

verify/             four harnesses + shared harness.mjs
fixtures/           frozen upstream data — regenerate with `npm run capture`
scripts/            capture-fixtures.ts
```

**Where to put a new thing:** pure logic → `src/lib/analysis/`. A new API surface
→ `src/server/routes/<name>.ts` exporting a router, mounted with one line in
`index.ts`. Never grow `index.ts` with feature logic; that refactor has already
been done once.

---

## 3. Traps. Read this section before debugging anything.

Every one of these has already cost real time here.

### Server

- **A module-level `const SECRET = process.env.JWT_SECRET` in a route file is
  silently broken.** ES imports hoist above `index.ts`'s `dotenv` call, so the
  secret reads as `undefined` and every session check fails open. **Read env per
  request** inside route modules. `index.ts` itself is fine because it calls
  `loadEnv` before its own use.
- **Feature routers must be mounted above the `app.get('*')` SPA fallback**,
  or the fallback swallows the request.
- **Secrets live in `/run/benloe-secrets/waker.env`**, the tmpfs file benloe-secrets
  renders for this app — its own set merged over `shared` — not this app's
  directory. `index.ts` calls `loadEnv({ path: '/run/benloe-secrets/waker.env' })`
  explicitly.

### Sleeper's data lies in specific ways

- **`league.status` says `in_season` in August.** The NFL state endpoint
  correctly reports `season_type: 'pre'` at week 0. **Trust `state.season_type`,
  never `league.status`.** Believing the league produced "Week 0 · games in
  progress" in midsummer.
- **`previous_league_id` does not identify a dynasty league.** A redraft league
  that ran last year links back too. Use `settings.type` — 0 redraft, 1 keeper,
  2 dynasty.
- **Projections publish `gp` as a flat 18 for every player** — the NFL calendar,
  not a health projection. A player appears in at most 17. Use `perWeek()` from
  `data.ts`, which caps at `NFL_GAMES = 17`.
- **`getMatchups` answers for weeks past the regular season.** Cap at
  `playoff_week_start - 1`; a non-empty response does not mean the week counts.
- **`playoff_week_start` can be `0`** for a league whose playoff schedule is
  unset, which is most leagues in the preseason — exactly when this page is
  opened. Guard it.

### nflverse

- **It files STANDARD-scoring fantasy points.** In a PPR league that understates
  every receiver and turns half the receiving corps into false buy signals.
  `feed.ts` and `routes/tape.ts` both blend by the league's own `rec` setting.
- **Week 18 is when playoff teams rest starters.** Reading it as usage produces
  a feed of "used more than he is scoring" at 2 points a game. Every window
  clamps at **17**.
- **A season's files only exist once that season starts.** In the preseason
  `resolveUsageSeason` falls back a year, and the season actually used is carried
  through to the UI so no chart silently claims the wrong year.
- **The snap join and the usage join do not cover the same players.** Some
  players have usage rows and no snap row at all. Handle a missing sparkline
  honestly rather than drawing a flat line at zero.

### The analysis

- **Quarterbacks cannot be ranked on snap share.** Every starter plays every
  snap, so usage percentiles collapse into a tie while production spreads
  normally — the method then reads every below-average QB as underused. It put
  four of them at the top of the buy list. `RANKABLE_POSITIONS` excludes them.
- **The percentile test fails at the tails**, and the tails are where the best
  calls live. A player at the 99th percentile of usage scoring at the 85th has a
  divergence of 0.14 while scoring eight a game below expectation. `verdictFor`
  qualifies a player on **either** the percentile or the points gap.
- **Do not weight roster orientation by dynasty value** — high dynasty value
  relative to redraft is precisely what makes a player read as "future", so it
  drags every roster toward "building". Weight by combined value.
- **Do not compute conditional playoff odds by forcing a result.** Awarding a
  win without points costs the team its tiebreaker; crediting flat expected
  points over-corrects, because the other teams' games that week still carry
  real variance. `gameLeverage` conditions instead: play the season once, file
  each run under which games it won, read off the share that also made the field.
- **`findTrades` measures the other manager's gain against their LAST starter at
  a position, not their best.** A "needy" position is one where a marginal slot
  cannot be filled; their best player there is already starting and never
  displaced.

### The browser harnesses

- **Both responsive layouts live in the DOM at once**, and `waitForSelector`
  waits for *visibility*. A bare `text=` can latch onto a hidden copy and hang.
  This cost a run: `text=usage` matched the nav gloss, hidden on mobile.
- **`waitUntil: 'networkidle'` never fires** on pages holding a simulation or a
  market fetch open. Use `domcontentloaded` + a selector.
- **Always an ephemeral port.** A stray server from an interrupted run holds a
  fixed one and the next run silently tests the *old* build.
- **Never `git add -A` from the repo root without checking.** Two scratch files
  were swept into a commit that way; a reviewer caught it, not me.

---

## 4. Data sources

None require a key. That is why they were chosen.

| Source | Gives | Join | TTL |
|---|---|---|---|
| Sleeper REST/GraphQL | league, rosters, schedule, projections | native | 30s–12h |
| FantasyCalc | dynasty **and** redraft value, tiers, ADP, 30d trend | `sleeperId` | 6h |
| KeepTradeCut | value, tier, 7d trend, liquidity, **pick values** | `mflId`→FC→Sleeper | 6h |
| nflverse `snap_counts` | weekly snap share | normalised name | 12h |
| nflverse `stats_player_week` | targets, target share, air-yards share, points | normalised name | 12h |
| nflverse `injuries` | report + practice status | normalised name | 3h |

**FantasyCalc is the bridge** — the only source carrying both an `mflId` and a
`sleeperId`. 377 of KTC's 500 rows join; the remainder are draft picks, kept
separately in `crosswalk.picks` because they have no Sleeper id and are the other
half of a dynasty trade.

**KTC has no API.** The rankings page ships the dataset inline as
`var playersArray = [...]`. That is an observed shape, not a contract. If it
changes, `parseKtcHtml` returns `[]` and the panels degrade — it never throws its
way onto a page. `verify/live.mjs` exists largely to notice when this breaks.

**The name join is deliberately conservative.** Two players sharing a normalised
name are dropped unless a position settles it, and even a unique name is refused
when its position contradicts. Attributing one man's snap share to another is a
silent, confident lie; a gap is merely a gap. Do not loosen this.

**Every source is best-effort.** A dead upstream removes its panel, never the
page. `market.ts` swallows failures at each boundary and reports coverage in
`market.health`; the UI states which sources answered rather than implying it
consulted all of them. Preserve that — implied coverage is the worst defect this
app can ship.

---

## 5. API

All league routes require a session cookie and 401 with `needsIdentity: true`.

| Route | Returns |
|---|---|
| `GET /api/health` | ok, source (live/fixtures), cache stats |
| `GET/POST/DELETE /api/session` | the per-visitor session |
| `GET /api/me` | user, NFL state, leagues (each with `kind`) |
| `GET /api/league/:id/sources` | coverage — used by the UI, not just debugging |
| `GET /api/league/:id/cycle` | where we are in the week |
| `GET /api/league/:id/feed` | ranked decision cards |
| `GET /api/league/:id/board` | every roster as plottable points + orientation |
| `GET /api/league/:id/tape` | divergence rows with weekly series |
| `GET /api/league/:id/season` | playoff odds, schedule, per-game leverage |
| `GET /api/league/:id/ledger` | standings, trade matches, pick values |
| `POST /api/cache/flush` | drops every memo |

---

## 6. Design system

Tokens live in **`src/web/index.css`**, not the Tailwind config. Use them; never
a raw hex.

The metaphor is a **tide table** — an almanac, not a newspaper and not a
dashboard. Consequences that are rules, not preferences:

- **Light, on chart paper** (`--paper #e9eeef`). Cool Admiralty blue-grey, not
  the warm cream every light UI reaches for. Its sibling app owns dark navy.
- **Ruled, not carded.** Hairlines and bands, square corners, **no shadows, no
  border radius**. Panels are `<Sheet>`; a decision is a row with a margin mark.
- **Every figure wears `.fig`** (IBM Plex Mono, tabular) so columns align down
  the page. Display is `.slab` (Zilla Slab); small caps labels are `.label`.
- **`--alarm` (chart magenta) is reserved** for things with a live clock. Nothing
  else may use it.

Fonts are self-hosted in `public/fonts/` — nine woff2 files, latin subset.

**Charts carry obligations**: a legend whenever there are 2+ series, an
`aria-label` describing the chart in words, hit targets larger than the marks,
and the same numbers reachable as a table. Never a dual-axis chart.

**Validate any new categorical palette** with the dataviz skill's
`scripts/validate_palette.js` against `--surface "#e9eeef"` — never by eye. The
positional palette needed magenta and green separated on the **lightness** axis
rather than by hue, because a deuteranope cannot use that hue difference at all.

---

## 7. Verifying

```
npm run typecheck    # tsc --noEmit — must be clean
npm test             # 409 unit tests, all pure, no network
npm run verify       # every route × 3 viewports; fails on console error /
                     #   failed request / horizontal overflow
npm run links        # every navigation path
npm run mobile       # iPhone profile: tap targets, overflow, tiny figures,
                     #   whether the tide strip is still legible
npm run live         # against PRODUCTION — no screenshots
npm run check        # typecheck + test + verify + links + mobile
```

**Read the screenshots with vision.** A green exit code means nothing rendered an
error; it does not mean the page is any good. Every visual bug in this app's
history was found by looking at `.verify/*.png`, not by a passing harness.

**`npm run live` is the one that matters most.** Fixture mode makes the other
three trustworthy and is also their blind spot — a frozen file cannot tell you
KTC changed its page shape this morning. It asserts every upstream still answers
and that the crosswalk has not collapsed, which would otherwise turn every value
in the app into `null` without erroring.

### Fixture mode

`WAKER_SOURCE=fixtures` reads frozen JSON from `fixtures/`. Captured from the
2026 dynasty league (`1312065694577209344`) with 2025 usage data
(`FIXTURE_SEASON` in `data.ts`). Regenerate with `npm run capture`.

Two overrides exist **in fixture mode only** — a settable "now" reachable from
the internet would let anyone fake a deadline:

- `?now=2025-09-14T15:00:00Z` pins the clock
- `?inSeason=1&week=2` forces an in-season render

That is the only way to screenshot a Sunday-lock page on a Tuesday.

---

## 8. Deploying

```
npm run build                      # browser bundle -> dist/, served by Caddy
pm2 restart waker-api              # the Node API on 3012
```

Caddy serves `dist/` directly and proxies `/api/*`. **Rebuild before restarting**
— PM2 only runs the server; the browser bundle is a separate artifact and a
restart alone will serve the old one.

Env comes from `/run/benloe-secrets/waker.env` via `ecosystem.config.cjs`, which
reads it by hand because PM2 has no access to the app's `node_modules`. Waker
needs only `JWT_SECRET` (shared set) and the `SLEEPER_LOGIN_*` pair (waker set);
a key that is in neither set is not in the file and cannot be read here.

---

## 9. Security posture

- **Read-only against every upstream.** There is no write path at all. `tokenStore.ts`
  exists (copied from sleeper-ui) but nothing uses it. Do not add a write path
  without asking — this app reads a real league that eleven other people share.
- **Sign-in takes a username only, never a password.** It resolves a Sleeper user
  and issues a signed session cookie. Waker reads only what Sleeper already
  publishes publicly.
- **`SLEEPER_LOGIN_ALLOW` gates who may sign in at all**, not just who may write —
  the twelve dynasty managers. This is a public hostname.
- **Secrets never in git.** Encrypted in benloe-secrets, rendered to
  `/run/benloe-secrets/waker.env` — this app's set only, so a compromise here
  reaches no other app's credentials. `.env.example` documents shape.

---

## 10. Known limits

Stated because a tool that overstates its confidence is worse than one that
admits a gap. These are in the README too, and should stay accurate in both.

- **The Tape reads last season until games are played.** In the preseason every
  usage signal is about the year before, so it will not reflect this year's
  trades or draft until week 1. The column head names the season it read.
- **`weeksPlayed` takes the maximum games played across the league**, so a week
  in progress counts as played the moment any single result posts.
- **The Ledger proposes only the best spare player at each position**, so deeper
  surplus is never offered, and that player is proposed to every team that needs
  him rather than to the best fit.
- **A week Sleeper does not return is dropped from the simulation entirely.** The
  odds panel says so when it happens.
- **Non-head-to-head leagues** (median scoring, multi-team matchup groups) have
  those weeks skipped rather than guessed at.
- **The in-season branch of The Tape has never been rendered in a browser.** It
  is unit-tested, but fixtures are frozen in the preseason and only `/cycle` has
  an `inSeason` override.
- **A cold `/season` request blocks the event loop for ~1.2–1.6s.** It is
  content-address memoised, so only the first request pays, but every other route
  stalls behind it.

---

## 11. Conventions

- **Comments explain WHY.** The reasoning behind a threshold, a fallback, or a
  refusal — not what the line does. Several modules carry long comments about
  *why a simpler approach was wrong*; those are the valuable ones, keep them.
- **Tests assert behaviour and document the case.** A test comment says why the
  case matters, not what the assertion checks. Cover zero data, one data point,
  and missing market values — those are where this app breaks.
- **Honest empty states, always.** "No snaps on file" beats a flat line at zero.
  "Only 2 games — thin evidence" beats a confident verdict on a two-game sample.
- **Every analysis function opens with the DECISION it serves.** If you cannot
  name one, it probably belongs somewhere else.
- Prose is plain and active. No filler, no salesmanship in UI copy.

## 12. History

Built 2026-08-02/03 in one session. Thirteen commits, all on `main` in
`github.com/BLoe/benloe-server`. The three feature surfaces (Tape, Season,
Ledger) were built by parallel subagents with adversarial reviewers, which is
where several of the trap entries above came from. `git log --oneline -- apps/waker`
reads as a decent narrative of why things are the way they are.
