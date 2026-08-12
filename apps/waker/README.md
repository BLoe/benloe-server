# Waker

**waker.benloe.com** — a fantasy football decision desk for one dynasty league.

A second take on the same data its sibling [League Desk](../sleeper-ui) shows.
League Desk is a good browser of a Sleeper league. Waker is an argument about
what a fantasy app should be organised around.

---

## The reframe

Every fantasy app is a browser of **nouns**: league, team, matchup, player. A
manager's head is not organised that way. It is organised by **decisions with
clocks on them**.

> "Am I OK this week?" · "Who do I start?" · "Should I claim him?" ·
> "Am I contending or rebuilding?" · "Who's about to break out?"

A noun-browser makes you go *find* the decision. Waker's job is to surface the
decision while it is live and retire it when it is not — the name is the thesis.

Two structural consequences:

1. **No entity pages as the primary navigation.** There is no "players" page,
   because a player is never the question — only ever the evidence.
2. **The map is time.** Four surfaces, sorted by how far out they reach:
   **Now** (days) · **Tape** (usage) · **Season** (weeks) · **Horizon** (years).

The primary object is a **decision card**: a claim, its magnitude in points, the
evidence inline, and the gate that kills it.

```
⊘  STRANDED  QB                                          296
   Bo Nix cannot reach your lineup                      PTS / YR
   QB 2 on this roster, with 1 startable QB slot.
   He prices at 2,608 on the trade market and scores you nothing where he is.
```

Two properties make that a decision rather than a notification:

- **Everything is priced in points.** "Bo Nix is on your bench" is a shrug. Every
  card carries a stake so the list can be ranked honestly, with season totals put
  onto a weekly footing first — 300 points over a season is not thirty times more
  urgent than 10 points this Sunday.
- **Everything has a clock.** A start/sit question is not *less important* after
  lineups lock, it is **impossible**, and showing it would be telling someone to
  do something they cannot do. Cards name the gate they expire at and are dropped
  once it passes.

---

## Where the data comes from

All four upstreams were probed live before a line was written. Each is
best-effort and independently timed out: a dead source removes its panel, never
the page. The `/api/league/:id/sources` route reports coverage, and the UI states
which sources answered rather than implying it consulted all of them.

| Source | Gives | Join | TTL |
|---|---|---|---|
| **Sleeper** REST + GraphQL | league, rosters, schedule, projections | native | 30s–12h |
| **FantasyCalc** JSON | dynasty **and redraft** value, tiers, ADP, 30-day trend | `sleeperId` direct | 6h |
| **KeepTradeCut** | value, positional tier, 7-day trend, liquidity, **pick values** | `mflId` → FantasyCalc → `sleeperId` | 6h |
| **nflverse** `snap_counts` | weekly snap share — the leading indicator | normalised name | 12h |
| **nflverse** `stats_player_week` | targets, target share, air-yards share, points | normalised name | 12h |
| **nflverse** `injuries` | official report + practice status | normalised name | 3h |

FantasyCalc is the bridge: it is the only source carrying both an `mflId` and a
`sleeperId`, so KeepTradeCut reaches Sleeper through it. 377 of KTC's 500 rows
join; the rest are draft picks, which have no Sleeper id and are kept separately
because they are the other half of a dynasty trade.

**KeepTradeCut has no API.** The rankings page ships the whole dataset inline as
`var playersArray = [...]` before any JavaScript runs, so one GET plus a regex
gets all 500 entries. That is a shape observed, not a contract — if it changes,
the parse returns nothing and the panels that use it degrade. It never throws its
way onto a page, and `verify/live.mjs` exists largely to notice when it breaks.

### The name join is deliberately conservative

nflverse publishes neither Sleeper ids nor anything that maps to one, so usage
joins on a normalised name plus a position check. Two players sharing a
normalised name are **dropped** unless a position settles it, and even a unique
name is refused when its position contradicts. Attributing one man's snap share
to another is a silent, confident lie; a gap is merely a gap.

---

## What Waker computes that a basic app does not

Every function in `src/lib/analysis/` documents the decision it serves.

**Usage against production** (`divergence.ts`) — the buy-low / sell-high engine,
and the most valuable thing here. Fantasy points are a *lagging* measure: a back
who takes over a backfield gets the snaps in week 6 and the touchdowns in week 9,
and for those three weeks the box score says he is the same player. Usage moves
first. Both sides are converted to percentile ranks *within position* before
comparison — a 70% snap share and 14 points are not on the same scale, and a
tight end's 18% target share means something different from a receiver's.

**Value over replacement** (`replacement.ts`) — computed for *this* league. A
tight end projected for 9 a week is a shrug where the pool is deep and an asset
where the twelfth-best tight end projects for 4. Flex slots are distributed
across their eligible positions, because a 3-flex league drains the running back
pool far faster than a 0-flex one, and that is precisely what makes a position
scarce.

**Win-now versus future** (`orientation.ts`) — FantasyCalc publishes a dynasty
*and* a redraft value for the same player. Their ratio says *when* an asset pays.
Summed across a roster and set against the record, it produces the only genuinely
strategic read in dynasty: *you are 5-1 with a roster built for later.*

**Surplus meets need** (`ledger.ts`) — three startable quarterbacks and one
quarterback slot is dead value. Every manager knows this in the abstract and
almost none act on it, because finding the counterparty means opening eleven
rosters by hand.

**Leverage-aware start/sit** (`leverage.ts`) — maximising points and maximising
your chance of winning *this matchup* are different objectives. Worth knowing how
small the effect actually is, because it is easy to oversell: against a real
lineup it only flips the answer when two projections are within about a point
**and** you are a substantial underdog. It is a tie-breaker, not a revolution,
and the code says so where someone will read it.

**Playoff odds** (`playoffs.ts`) — a projected record is not odds. 5,000 seasons
played out from a fixed seed, so a refresh does not change the number, plus how
much each remaining game swings them.

**Where we are in the week** (`cycle.ts`) — the clock every decision hangs off.

---

## The almanac

The design borrows from a **tide table**, not a newspaper and not a dashboard. A
tide table answers one question: where are we in a repeating cycle, and what does
that let you do right now. You cannot leave harbour at low water; you cannot set
a lineup after Sunday one o'clock.

- **It is printed, so it is paper.** Waker is *light*, in a category that is
  uniformly dark and where its sibling already owns dark navy. Not the warm cream
  every light interface reaches for — the cool blue-grey of an Admiralty chart,
  with chart magenta for warnings and depth blue for soundings.
- **It is ruled, not carded.** Hairlines and bands, square corners, no shadows.
- **Figures are the point.** Zilla Slab display, IBM Plex Sans body, IBM Plex Mono
  on every number so columns align down the page. Nine faces, self-hosted.

The signature is the **tide strip**: the fantasy week drawn as a tide. Agency
floods after waivers clear, holds while the week is open, ebbs hard into Sunday
lock, and sits at slack water while the games decide themselves. It is navigation
and thesis at once.

Every categorical palette was validated with the dataviz checker, never by eye.
The positional colours needed magenta and green separated on the **lightness**
axis rather than by hue, because a deuteranope cannot use that hue difference at
all.

---

## Verification

Same bar as League Desk. `npm run check` runs the lot.

| Script | What it proves |
|---|---|
| `npm test` | 373 unit tests over every pure function |
| `npm run verify` | every route at 3 viewports; fails on console error, failed request, or horizontal overflow |
| `npm run links` | every path a person would take — a route under the wrong path renders perfectly and is unreachable |
| `npm run mobile` | iPhone profile: tap targets, sideways scroll, figures below 10px, whether the tide strip is still legible |
| `npm run live` | against production — that every upstream still answers and the crosswalk has not collapsed |

**Fixture mode is what makes the first four trustworthy and is also their blind
spot.** A frozen file cannot tell you KeepTradeCut changed its page shape this
morning. `live.mjs` takes no screenshots — the data moves — it asserts the
KTC → FantasyCalc → Sleeper join still resolves, which would otherwise turn every
value in the app into `null` without erroring.

Fixture mode can pin the clock (`?now=…`) and force a week (`?inSeason=1&week=2`),
which is the only way to screenshot a Sunday-lock page on a Tuesday. Both are
refused in live mode — a settable "now" reachable from the internet would let
anyone fake a deadline.

### Traps worth knowing before you touch this

- **Both responsive layouts are in the DOM at once.** `waitForSelector` waits for
  *visibility*, so a bare `text=` can latch onto a hidden copy and wait forever.
  This cost a run: `text=usage` matched the nav gloss, which is hidden on a phone.
- **`waitUntil: 'networkidle'` never fires** on pages that hold a request open
  while a market or a simulation resolves.
- **An ephemeral port, always.** A stray server from an interrupted run holds a
  fixed one and the next run then silently tests the *old* build.
- **A module-level `const SECRET = process.env.JWT_SECRET` in a route file is
  silently broken.** ES imports hoist above `index.ts`'s `dotenv` call, so the
  secret reads as `undefined` and every session check fails open. Read it per
  request.

---

## Things found by building this

Recorded because each one would have shipped silently.

- **Sleeper reports this league as `in_season` in August** while the NFL state
  correctly says `season_type: 'pre'` at week 0. Believing the league gave
  "Week 0 · games in progress" in midsummer. Trust the state.
- **`previous_league_id` does not identify a dynasty league** — a redraft league
  that ran last year links back too, so every league looked like dynasty.
  `settings.type` says it outright (0 redraft, 1 keeper, 2 dynasty).
- **Sleeper publishes `gp` as a flat 18 for every player** — the length of the NFL
  calendar, not a projection of who stays healthy. Dividing a season total by 18
  prices in a bye. 17 is the honest divisor.
- **PFR's weekly receiving table has no targets and no air yards.**
  `stats_player_week` has target share, air-yards share *and* the points those
  touches produced, so usage and outcome arrive together.
- **nflverse files standard-scoring points.** Reading that column in a PPR league
  understates every receiver and turns half the receiving corps into false buys.
- **Week 18 is when playoff teams rest starters.** Reading it as usage produced a
  feed of "being used more than he is scoring" at 2 points a game. The window
  stops at 17.
- **Quarterbacks cannot be ranked on snap share.** Every starter plays every snap,
  so their usage percentiles collapse into a tie while production spreads
  normally — and the method then reads every below-average quarterback as
  underused. It put four of them at the top of the buy list. That is an artefact
  of measuring a variable that does not vary; they are excluded.
- **The percentile test fails at the tails, and the tails are where the best calls
  live.** A receiver at the 99th percentile of usage scoring at the 85th has a
  divergence of 0.14 — under the threshold — while scoring eight a game less than
  his usage says. A player now qualifies on *either* the percentile or the points
  gap.
- **Weighting roster orientation by dynasty value double-counts.** High dynasty
  value relative to redraft is precisely what makes a player read as "future", so
  dynasty-weighting drags every roster toward "building".
- **The market can pair a surplus against a slot the other manager already fills**,
  producing a trade worth zero to them. Sending that is how you get ignored.

---

## Running it

```
npm run dev        # api on 3012, vite on 5312
npm run build      # browser bundle → dist/
npm run capture    # re-freeze fixtures from every upstream
npm run check      # typecheck, tests, verify, links, mobile
```

Deployed by PM2 (`waker-api`) behind Caddy. Secrets come from
`/run/benloe-secrets/waker.env`, the per-app render from benloe-secrets — Waker
needs only `JWT_SECRET` for session cookies (from the shared set, since other
apps must agree on it) and the `SLEEPER_LOGIN_*` pair for the twelve-manager
allow-list. No third-party source
requires a key, which is why they were chosen.

Waker is **read-only against every upstream**. It has no write path at all.

---

## Known limits

Recorded rather than hidden, because a tool that overstates its confidence is
worse than one that admits a gap.

- **The Tape reads last season until games are played.** nflverse publishes a
  season's files once that season starts, so in the preseason every usage signal
  is about the year before. The column head names the season it is reading; it
  will not reflect this year's trades or draft until week 1.
- **`weeksPlayed` takes the maximum games played across the league**, so a week
  in progress counts as played the moment any single team's result posts.
- **The Ledger proposes only the best spare player at each position**, so deeper
  surplus is never offered, and that one player is proposed to every team that
  needs him rather than to the best fit.
- **A week Sleeper does not return is dropped from the simulation entirely.**
  The odds panel says so when it happens.
- **Leagues that are not straight head-to-head** — median scoring, multi-team
  matchup groups — have those weeks skipped rather than guessed at.
- **The in-season branch of The Tape has never been rendered in a browser.** It
  is unit-tested, but the fixtures are frozen in the preseason and only the
  `/cycle` route has an `inSeason` override.
