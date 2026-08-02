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

## League chat and Sleeper sign-in

A Sleeper league is itself the message parent — chat is `messages(parent_id: <league_id>)`,
with no separate channel to resolve. It is the one endpoint that requires signing in.

Visitors connect their own account from the Chat page: the password goes straight
to Sleeper's `login` query over TLS, and only the token it returns is kept. That
token is encrypted with AES-256-GCM (`src/server/tokenStore.ts`, key derived from
`JWT_SECRET` via scrypt) and stored per Sleeper user id. The password is never
written to disk, never logged, and never echoed back in an error.

`src/server/chatAccess.ts` decides who may read chat, and is pure and unit tested:
a visitor's own token always wins; the optional server-wide `SLEEPER_TOKEN` is
honoured only for the account it actually belongs to. On a public page, lending
one person's token to another visitor would expose their private conversations.

**This is a public page that asks for a Sleeper password.** Production restricts
who may use that form to the managers in the dynasty league:

```bash
SLEEPER_LOGIN_ENABLED=true
SLEEPER_LOGIN_ALLOW=anhunter,benloe,bluehozer,...   # Sleeper usernames, not display names
```

`src/server/loginPolicy.ts` holds that decision, pure and tested — an empty
allowlist means *anyone* may enter credentials, so it is the one setting worth
getting wrong-proof. Sleeper usernames are the lowercase handle (`benloe`), which
is not always the display name (`BenLoe`); resolve them via
`GET /v1/user/<user_id>` for each league member, since the league payload only
carries display names.

Someone outside the list sees an explanation on the Chat page rather than a
sign-in form that would always fail. The rest of the dashboard works normally for
their own leagues.

Posting is still the only write in the app and needs `SLEEPER_ALLOW_POSTING=true`
on top of a connected account.

Chat polls every 15s while the tab is visible. In fixture mode it renders
`fixtures/chat.sample.json`, a synthetic feed with invented content — real chat
cannot be captured without a token, and the screenshot harness must not need one.

## Where the season is

"Week 1" is wrong for most of the year. Sleeper's state carries a `season_type`,
and in August it reads `pre` with week 0 — a dynasty league is very much alive
then. `describePeriod` turns state plus league status into a label the header can
show: Preseason, Offseason, Week 9, Playoffs · Week 15, Final, or `2025 final`
when looking back at a past season. It also returns the week to load matchups
for, or null when nothing is scheduled, so the dashboard stops asking for week 1
in the preseason.

## League activity

Sleeper's transaction feed is shaped for machines: a `type` that says *how* a move
was made rather than *what happened*, with adds and drops as maps of player id to
roster id. Read literally it produces nonsense — a drop rendered under an "add"
label, because both are `type: free_agent`.

`buildActivityRows` in `src/lib/derive.ts` turns each transaction into **one row
per manager**, with the action derived from what actually moved (Added, Dropped,
Added & dropped, Trade) and the method kept separate (Waivers, Free agency,
Trade). A two-team trade becomes two rows, one from each side, so every row
answers a single question: what did this manager gain, and what did it cost.

**Waiver bid history.** Sleeper shows only the winning bid. The feed also carries
every *failed* claim, with its amount and a note explaining why it lost — so each
contested claim gets a collapsible list of all bids. It is often the most
interesting thing on the page: Kyle Monangai drew nine bids in week 1, and the
two highest ($13 and $12) failed on roster limits, so $11 won.

One caveat handled explicitly: `leg` is 1 for the entire preseason, so a player
can genuinely be won twice, weeks apart, and `created` is submission time rather
than processing time — so the runs cannot be separated. Those targets (2 of 175 in
a real season) are omitted rather than shown with two winners.

## Projections, player history and news

**Projections** come from `api.sleeper.app/projections/nfl/<season>[/<week>]` —
undocumented, Rotowire-sourced, and the only predicted points Sleeper exposes.
Omitting the week gives season-long totals, which is what matters in the
preseason. `scoringKey` picks `pts_std` / `pts_half_ppr` / `pts_ppr` from the
league's own `rec` value, so a non-PPR league is not shown PPR numbers.

The payloads are 5–9MB of ~9,400 entries, most carrying nothing but an ADP.
They are disk-cached for six hours *and* the trimmed index is memoised in
memory — re-parsing and re-walking the array per request was most of the player
page's response time (0.4s → 0.09s).

One trap: Sleeper publishes `gp` as a flat **18** for every player. That is the
length of the NFL calendar, not a projection of who stays healthy — a player
appears in at most 17 of those weeks. Dividing a season total by 18 prices in a
bye, so `projectLineup` divides by 17 instead and the per-week figure means
"in a week he actually plays".

The projections also come pre-scored by Sleeper, so league-specific bonuses
(this one has `bonus_rec_te`, 100-yard bonuses, and so on) are not reflected.
The numbers are comparable across players in this league; they are not exactly
what the league would award.

### Projected season

`/projected` puts every roster into its best lineup by projection, turns that
into an expected weekly score, and resolves the real published schedule against
it. Two decisions matter:

- **Results are probabilities, not outcomes.** A lineup projected for 120
  routinely puts up 90 or 150. Treating the projection as certainty produced a
  14-0 top team, which is nonsense. `winProbability` compares two expected
  scores through a normal CDF with a spread of roughly a quarter of the expected
  score (floored at 12), so records come out fractional — 9.8-4.2, not 10-4.
  The spread is a heuristic, not fitted to this league; it exists so the model
  expresses uncertainty rather than pretending there is none.
- **Standings order by expected wins, not points.** A team can project fewer
  points per week and still rank higher on a soft schedule. The panel says so,
  because the two columns otherwise look mis-sorted.

Taxi and IR players are never selected, and a flex never steals the only player
at a dedicated position.

**Player history** (`buildPlayerHistory`) reconstructs a player's whole journey
through a league from the draft picks plus every transaction: drafted round 1
pick 7, claimed for $17, dropped, traded here. One subtlety worth keeping: a
waiver claim usually drops somebody to make room, and the bid belongs to the
player who *arrived* — attributing it to the drop reads as though cutting a
player cost money.

**News** carries far more than a headline. `metadata.description` is a full
multi-paragraph write-up and `metadata.url` links the source article; the first
version rendered only the title, which said almost nothing. `get_player_outlook`
is a separate, longer season write-up and returns the same `PlayerNews` shape —
the prose is in `metadata.description`, not a `text` field.

### The news desk

`src/lib/news.ts` merges every source that will answer without a key. Sleeper's
own feed is the spine; ESPN's public news endpoint tags each article with the
athletes it mentions, which is the only way to filter it by player — the
documented per-athlete endpoint returns nothing. Every source is fetched in
parallel with its own timeout and degrades to nothing rather than failing the
page.

Outlets syndicate each other constantly, so `mergeNews` folds near-identical
headlines into one card and lists the sources together. The dedupe key is the
first six significant words with punctuation, case, and digits stripped —
digits go because "Week 3 outlook" and "Week 4 outlook" from the same wire are
the same story to a reader.

### The AI brief

The player page asks Claude (`claude-opus-5`, adaptive thinking, web search
enabled) to read the gathered coverage and write a short analyst brief. The
system prompt forbids inventing statistics, injuries, depth-chart positions, or
transactions, and the response carries the sources it used — the panel labels
it as generated, because it is a summary of other people's reporting.

It costs real money: roughly **$0.09 per cold brief**, about 20 seconds. Results
are cached on disk for twelve hours and concurrent requests for the same player
share one call, so opening a page in two tabs pays once. **Fixture mode returns
a canned brief and never calls the API** — the verification harness opens player
pages on every pass, and live calls there would be both a charge and a
non-deterministic screenshot.

Set `ANTHROPIC_API_KEY` in `/srv/benloe/.env`. Without it the news desk still
works and the brief panel says it is unavailable.

## Rosters

`buildDepthChart` groups a roster by position rather than by lineup status. A
dynasty manager asks "how deep am I at running back", and the answer is spread
across the starting lineup, the flex, the bench and the taxi squad. Each position
gets one panel showing all of them, with a badge for where each player sits: a
green rail and slot badge for a starter, amber for a flex starter (starting, but
filling in elsewhere), grey for bench, taxi and IR. A flex RB stays with the other
RBs, because that is what the question is about.

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

**Mobile is a separate layout, not a squeezed one.** Three surfaces render a
phone layout and a desktop layout rather than scaling one: standings and activity
become cards (their tables put the columns that matter — the season tape, Added
and Dropped — off-screen), and matchup lineups stack under a slot label instead of
truncating every name to three characters. Navigation is a fixed bottom bar,
because five sections do not fit across 390px without dropping below the type
floor. League and team pickers become native selects.

Note for the harness: responsive duplication means a bare `text=` or `nth=0`
selector can latch onto the hidden copy. Scope to `:visible` or to unique text.

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
verify/mobile.mjs       Phone-profile screenshots plus bottom-nav, switcher and overlap checks
verify/browse.mjs       Screenshots the live deployment for eyeballing at 1:1
test/derive.test.ts     42 tests, run against the frozen fixtures
```

## Working on it

```bash
npm run dev        # api on :3010 + vite on :5310
npm test           # derivation tests against real fixtures
npm run verify     # screenshot every route, check for console/network/layout errors
npm run links      # click through every entity link and assert it navigates
npm run mobile     # phone-profile screenshots + navigation and tap-target checks
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
`verify/live.mjs` screenshots the pages whose whole point is live data — the
news desk, the AI brief, and weekly projections, none of which fixtures carry.

Two selector traps, both of which have cost time here: the mobile and desktop
layouts are *both* in the DOM, so a bare `text=` can latch onto a hidden copy
and wait forever — use `:visible` or text only one layout carries. And the
player page holds a request open for ~20s while the brief generates, so
`waitUntil: 'networkidle'` never settles there; wait on a selector instead.

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
