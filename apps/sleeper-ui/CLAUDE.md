# League Desk (sleeper-ui) — working context

Operational notes for an agent picking this up cold. The [README](README.md) is
written for a *reader*; this is written for whoever has to *change* it. Where
they overlap, this file wins on specifics and the README wins on rationale.

**Live at https://sleeper.benloe.com.** Port 3010, PM2 `sleeper-ui`, Caddy config
at `/srv/benloe/infra/caddy/sleeper.benloe.com`.

Its sibling is [Waker](../waker) (`waker.benloe.com`), a second take on the same
league data organised by decision rather than entity. **Keep them visually and
conceptually distinct** — League Desk is the good browser, Waker is the argument.
If a change would make one look like the other, it is the wrong change.

---

## 1. What this app is

A desktop-first dashboard for a Sleeper fantasy league. Sleeper abandoned
desktop and buried fantasy under gambling features; this is the readable
replacement. It is a **browser of entities, and that is deliberate** — league,
teams, matchups, players, activity, chat.

Design language: a **broadcast control room**. Dark navy, Barlow / Barlow
Condensed, dense panels, green/amber/red status inks.

Ten routes:

| Route | Page |
|---|---|
| `/l/:id` | Overview — standings, charts, scoreboard |
| `/l/:id/matchups[/:week[/:matchupId]]` | Scoreboard → one matchup in full |
| `/l/:id/teams[/:rosterId]` | Roster: lineup, bench, taxi, IR, analysis |
| `/l/:id/projected` | Projected season from Rotowire projections |
| `/l/:id/players/:playerId` | Player: game log, history, news desk, AI brief |
| `/l/:id/activity` | Every manager action as one row |
| `/l/:id/chat` | League chat (read, and gated write) |

**Everything is a link.** Any manager name, player name, team, matchup or waiver
move navigates to the relevant page. That was an explicit requirement and it
should stay true of anything new.

---

## 2. Layout

```
src/lib/
  derive.ts      ~1650 lines. ALL pure derivation. No network, no Express.
                 The single most important file — read it before changing logic.
  sleeper.ts     Sleeper REST + GraphQL client. The only place doing network I/O.
  news.ts        multi-source player news merge (Sleeper + ESPN + outlook)

src/server/
  index.ts       ~1200 lines: routes, source-aware loaders, session, static
  brief.ts       the Claude-written player brief (paid, cached)
  cache.ts       TTL memory cache w/ stale-while-revalidate + disk layer
  session.ts     HMAC-SHA256 signed cookie, 90-day
  loginPolicy.ts the twelve-manager allow-list for Sleeper sign-in
  tokenStore.ts  AES-256-GCM store for Sleeper bearer tokens (scrypt from JWT_SECRET)
  chatAccess.ts  pure: who may see chat, and as whom

src/web/
  index.css      design tokens — colour and type live here, not Tailwind config
  App.tsx        shell, left rail, mobile bottom nav, routing
  components.tsx PlayerLink, TeamLink, TeamBadge, Panel, Stat, Pos, Avatar, Crumb
  charts.tsx     SeasonTape, MagnitudeBar, LuckGauge, EfficiencyMeter,
                 WeeklyBars, PositionalCompare
  api.ts         all response types + the useApi hook + formatters
  pages/         Dashboard, Matchups, Team, Projections, Player, Activity, Chat, SignIn

verify/          verify.mjs, links.mjs, mobile.mjs, live.mjs, browse.mjs, prod-check.mjs
fixtures/        three frozen leagues + player index + projections
```

**`derive.ts` is the centre of gravity.** Anything that transforms Sleeper's
shapes into something a page can render belongs there, pure and tested. The
server should fetch and cache; the page should render. If you find yourself
computing in a route handler or a component, it probably belongs in `derive.ts`.

---

## 3. Traps. Read this before debugging anything.

Every one of these has already cost real time here.

### Sleeper's data lies in specific ways

- **Sleeper publishes the whole schedule with all-zero scores before the season
  starts.** Naively deriving standings gave every team `0-0-11` with red losing
  streaks in the preseason. `weekWasPlayed()` guards this. It was invisible in
  fixtures and only appeared against live data.
- **"Week 1" is wrong for most of the year.** `state.season_type` reads `pre`
  with week 0 in August. `describePeriod()` produces "Preseason" instead. Do not
  trust `league.status` — it reports `in_season` in August.
- **Projections publish `gp` as a flat 18 for every player** — the NFL calendar,
  not a health projection. A player appears in at most 17. Dividing a season
  total by 18 prices in a bye. `projectLineup` divides by 17.
- **Transactions type both adds and drops as `free_agent`.** The Activity page
  showed drops labelled "Add" until the action was derived from *what actually
  moved* rather than from the type field.
- **A single waiver transaction can add multiple players**, so a "contest" is per
  player, not per transaction — hence `contests: WaiverContest[]`.
- **`leg` is 1 for the whole preseason**, so the same player can be won twice
  weeks apart, and `created` is submission time not processing time. Two of 175
  bids were genuinely ambiguous and are dropped rather than guessed.
- **FAAB belongs to the player who arrived, not the one dropped.** A waiver claim
  usually drops somebody to make room; attributing the bid to the drop reads as
  though cutting a player cost money. Only attach `faab` when `gained != null`.
- **Sleeper returns a GraphQL error for a wrong password and a null login for an
  unknown user.** Both mean "rejected"; `login()` catches `SleeperError` with
  status 200 and returns null. Without that, a bad password 502s.

### Server

- **`dotenv/config` reads this app's directory, not the rendered secrets file.**
  Secrets live in `/run/benloe-secrets/sleeper-ui.env`, the tmpfs file benloe-secrets
  writes for this app — its own secret set merged over `shared`. `index.ts` calls
  `loadEnv({ path: '/run/benloe-secrets/sleeper-ui.env' })` explicitly.
  Getting this wrong meant `JWT_SECRET` never loaded and sign-in failed
  everywhere.
- **The projection index must be memoised.** The raw payload is ~8MB of 9,400
  rows; re-parsing per request was most of the player page's response time
  (0.4s → 0.09s).

### Chat and tokens — the security-shaped one

- **`SLEEPER_TOKEN` is one specific person's session.** Once it was set, any
  visitor could read Ben's private league chat. `chatAccess.ts` now serves chat
  only to the visitor the token actually belongs to. **Do not regress this** —
  it is pure and fully tested precisely so it can't be.
- **Per-visitor sign-in is the normal path.** Each visitor signs in for
  themselves; their token is encrypted at rest (AES-256-GCM, scrypt-derived from
  `JWT_SECRET`).
- **Passwords are never stored, logged, or echoed in an error.** Forwarded to
  Sleeper once over TLS; only the returned token is kept.
- **Posting stays off unless `SLEEPER_ALLOW_POSTING=true`.** It writes a real
  message to a real league that eleven other people read.

### The AI brief costs money

- `~$0.09` per cold brief, ~20s, `claude-opus-5` with adaptive thinking and web
  search. Cached on disk 12h; concurrent requests for the same player share one
  call.
- **Fixture mode returns a canned brief and never calls the API.** The
  verification harness opens player pages on every pass — live calls there would
  be both a charge and a non-deterministic screenshot. This was caught after one
  harness run had already billed.
- It auto-loads on page open, which is what was asked for. Browsing all twelve
  rosters would cost roughly `$27`. If that becomes a problem, put it behind a
  button rather than shortening the cache.

### The browser harnesses

- **Both responsive layouts live in the DOM at once**, and `waitForSelector`
  waits for *visibility*. A bare `text=` latches onto a hidden copy and hangs.
  Use `:visible` or text only one layout carries.
- **`waitUntil: 'networkidle'` never fires** on the player page — the brief holds
  a request open for ~20s. Use `domcontentloaded` plus a selector.
- **Use the system Chrome** (`/usr/bin/google-chrome`): the bundled Chromium and
  the installed Playwright disagree about versions on this box.
- **Ephemeral ports.** A stray server from an interrupted run holds a fixed one
  and the next run silently tests the old build.

---

## 4. API

All league routes require a session cookie and 401 with `needsIdentity: true`.

| Route | Returns |
|---|---|
| `GET /api/health` | ok, source, chat availability, cache stats |
| `GET/POST/DELETE /api/session` | the per-visitor session (username only) |
| `GET/POST/DELETE /api/sleeper-login` | connect a Sleeper account for chat |
| `GET /api/me` | user, NFL state, leagues across two seasons |
| `GET /api/league/:id` | league info, period, standings, my roster id |
| `GET /api/league/:id/matchups/:week` | matchups with resolved lineups + projections |
| `GET /api/league/:id/roster/:rosterId` | lineup, depth, projections, compare, positions, ages |
| `GET /api/league/:id/projections` | projected season: teams + resolved schedule |
| `GET /api/league/:id/transactions` | activity rows, newest first |
| `GET /api/league/:id/player/:pid` | detail, game log, history, projection |
| `GET /api/league/:id/player/:pid/news` | merged multi-source news feed |
| `GET /api/league/:id/player/:pid/brief` | the Claude brief (`?refresh=1` forces) |
| `GET/POST /api/league/:id/chat` | league chat |
| `GET /api/players` | slim player index for client-side search |
| `POST /api/cache/flush` | drops every memo |

---

## 5. Data sources

- **Sleeper REST v1** (`api.sleeper.app/v1`) — documented, read-only, no auth,
  1000 req/min. Everything structural.
- **Sleeper GraphQL** (`sleeper.app/graphql`) — undocumented but **introspection
  is enabled** (snake_case, Elixir/Absinthe: 238 queries, 349 mutations). This is
  what makes chat, news and outlook possible. Discovering it reshaped the whole
  project away from scraping or a browser extension.
  - `login`, `me`, `messages(parent_id: <leagueId>)`, `create_message`,
    `get_player_news`, `get_player_outlook`, `scores`
  - **A league *is* the message parent** — it carries `last_message_id` etc.
    There is no separate channel to resolve.
- **Sleeper projections** (`api.sleeper.app/projections/nfl/<season>[/<week>]`) —
  undocumented, Rotowire-sourced, 5–9MB. Omit the week for season totals, which
  is what matters in the preseason. Disk-cached 6h *and* memoised.
- **ESPN news** — the public news feed tags each article with the athletes it
  mentions, which is the only way to filter by player; the documented
  per-athlete endpoint returns nothing.

Everything is read-only apart from the gated chat post.

---

## 6. Design system

Tokens live in **`src/web/index.css`**. Use them; never a raw hex.

- **Broadcast control room**: `--ground #0A0E13`, panels `#111820`, hairline
  `--line`, ink `#E8EDF2`. Status: `--win` green, `--loss` red, `--live` amber.
- **Type**: Barlow Condensed for display (`.headline`, `.entity`), Barlow for
  body, six-step scale `--t-label` 12px → `--t-hero` 30px. Self-hosted in
  `public/fonts/`.
- **Positional palette is validated, not eyeballed.** Separate `--pos-*` (chart
  marks) and `--pos-*-ink` (text, which must clear 4.5:1). The original set
  failed the checker and needed lightness re-stepping.
- **Age bands** use a sequential ramp (one hue, light→dark) because age is
  *ordered* — three categorical hues would be the wrong encoding.

**Validate any new categorical palette** with the dataviz skill's
`scripts/validate_palette.js` against the dark surface. Never by eye.

Charts live in `charts.tsx` and carry the usual obligations: a legend for 2+
series, an `aria-label`, hit targets larger than marks, and the numbers reachable
as text. Never a dual-axis chart.

---

## 7. Verifying

```
npm run typecheck    # tsc --noEmit — must be clean
npm test             # 245 unit tests, all pure, no network
npm run verify       # 39 screenshots, 3 viewports; fails on console error /
                     #   failed request / horizontal overflow
npm run links        # 11 click-through navigation checks
npm run mobile       # iPhone 13 profile: bottom nav, switchers, overlap, tap targets
```

Also present: `verify/live.mjs` (the views whose whole point is live data — news
desk, AI brief, weekly projections) and `verify/prod-check.mjs` (a quick smoke
test against the deployed site).

**Read the screenshots with vision.** A green exit code means nothing errored; it
does not mean the page is any good. Every visual bug in this app's history was
found by looking at `.verify/*.png`.

**Fixtures alone are not enough.** Two of the worst bugs — preseason standings
and the chat token leak — appeared *only* against live production. Run
`verify/live.mjs` after anything touching data shapes.

### Fixture mode

`SLEEPER_SOURCE=fixtures` reads `fixtures/`. Three leagues are frozen, and the
choice matters:

| League id | Fixture | Why it exists |
|---|---|---|
| `1180168833027727360` | `dynasty-2025` | a complete season — the richest fixture |
| `1254603551611559936` | `auction-2025` | a different league shape |
| `1312065694577209344` | `dynasty-2026` | **preseason**: schedule published, nothing played |

The 2026 one is the important one. A league that has not kicked off renders
states the completed season never reaches, and that gap shipped a real bug once.
It is also the only fixture with projections captured.

Regenerate with `npm run capture`.

---

## 8. Deploying

```
npm run build                  # browser bundle -> dist/, served by Caddy
pm2 restart sleeper-ui         # the Node API on 3010
```

Caddy serves `dist/` directly and proxies `/api/*`. **Rebuild before restarting** —
PM2 only runs the server; the bundle is a separate artifact and a restart alone
serves the old one.

Env is read by `ecosystem.config.cjs`, which parses
`/run/benloe-secrets/sleeper-ui.env` by hand because PM2 has no access to this
app's `node_modules`. Adding a key means adding it to the `sleeper-ui` set (or
`shared`, if another app must agree on the value) — nothing here can pull a key
that is not rendered into that file.

`max_memory_restart: 600M` — the player index is ~14MB of JSON held in memory.

If Caddy fails to reload, check `/var/log/caddy/sleeper.benloe.com.log` exists
and is owned by `caddy:caddy`. A missing log file fails the whole config.

---

## 9. Security posture

- **Read-only against Sleeper apart from the gated chat post.**
- **Sign-in takes a username only** and issues a signed cookie. Connecting a
  Sleeper *account* (for chat) is a separate, optional step that does take a
  password — forwarded once, never stored.
- **`SLEEPER_LOGIN_ALLOW` restricts who may connect an account** to the twelve
  dynasty managers. This is a public hostname asking for a Sleeper password, so
  it should be easy to narrow or close (`SLEEPER_LOGIN_ENABLED=false`).
- **Chat is served only to the account a token belongs to.** See `chatAccess.ts`.
- **Secrets never in git.** Encrypted in benloe-secrets, rendered to
  `/run/benloe-secrets/sleeper-ui.env` — this app's set only, so a compromise here
  reaches no other app's credentials. `.env.example` documents shape.
- `ANTHROPIC_API_KEY` is optional — without it the news desk still works and the
  brief panel says it is unavailable.

---

## 10. Conventions

- **Comments explain WHY.** The reasoning behind a threshold, a fallback, or a
  refusal — not what the line does. Several modules carry long comments about why
  a simpler approach was wrong; those are the valuable ones, keep them.
- **Tests assert behaviour and document the case.** A test comment says why the
  case matters. Cover zero data, one data point, and the preseason — that is
  where this app breaks.
- **Everything is a link.** Any entity name should navigate.
- **Honest empty states.** Say what is missing and why, never imply coverage.
- Prose is plain and active. No filler in UI copy.

## 11. History

Built 2026-08-01/02. The arc, readable in `git log --oneline -- apps/sleeper-ui`:
a dashboard, then chat, then per-visitor sessions after the token leak, then a
design pass with real vision review, then projections and the projected season,
then the player news desk with the Claude brief, then the roster rebuild around
decisions (lineup check, positional strength, age curve), then taxi/IR as
first-class panels.

Notable: the roster view was rebuilt once already. It used to be six stacked
position panels; it is now a lineup card beside a depth list with three analysis
panels underneath. Do not revert toward the old shape without a reason — the
complaint that drove it was that you could never see your lineup as a unit.
