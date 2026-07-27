# Kickball — No New Friends

Batting orders and defensive lineups for a Central Park adult kickball team.

**Live:** https://kickball.benloe.com

| Surface | URL | Access |
|---|---|---|
| Manager dashboard | `/` | Artanis login, limited to the emails in settings |
| Rating game | `/rate` | Public (optional shared code) |
| Published lineup | `/l/:slug` | Public, link only |

## How it works

**Ratings.** The team plays a comparison game: pick a stat, show two players, tap
whoever is better. Those answers are fitted per stat with a regularized
[Bradley-Terry](src/../api/src/engine/ratings.ts) model — a maximum-likelihood fit over
all comparisons at once, rather than Elo. Elo is order-dependent, needs far more
data, and has no notion of its own confidence. The L2 prior does real work here:
without it a player who wins every comparison runs off to infinity, and with it a
player with two comparisons stays near average until there is evidence.

The uncertainty that falls out of the fit drives which matchup gets shown next.
A comparison is worth the most when the two players are genuinely close and at
least one is poorly established — exactly the Fisher information the answer would
contribute — adjusted so no single pair or stat gets ground down.

**Batting order.** A Monte Carlo simulator turns ratings into per-plate-appearance
outcome probabilities and plays six innings thousands of times; a local search
rearranges the order to maximize runs, weighted toward the early innings. The
search runs at cheap precision and then the finalists are re-judged at high
precision on a random stream the search never saw, so a lineup that merely got
lucky during the search cannot win.

**Defense.** Simulated annealing over the full 6×10 grid. Every move preserves
the hard constraints, so any reachable lineup is a legal one: ten distinct
fielders per inning, the league minimum of women or non-binary players, no one at
a position they opted out of, and hand-locked assignments untouched. The
objective weighs, in order: playing time (across the season, as a rate, so
missing a week earns nobody extra innings), skill at the position, staying in one
spot, and not sitting two innings running.

Third base is the **striker** and right-center is the **roamer**; both are modeled
as real positions with their own stat weightings.

## Layout

```
api/    Express + TypeScript on port 3009, better-sqlite3, hand-written SQL migrations
  src/engine/    Pure optimizers with no database dependency — the unit-tested core
  src/services/  Bridges stored data and the engines
web/    React 19 + Vite + Tailwind v4
```

Database at `/srv/benloe/data/kickball.db`. Secrets come from `/srv/benloe/.env`.

## Working on it

```bash
# Unit tests — rating fit, simulator, optimizer constraints, DB wiring
cd api && npm test

# Integration tests — runs its own API on :3010 with a throwaway database,
# so it never touches the real roster
npx playwright test --config apps/kickball/playwright.config.ts   # from /srv/benloe

# Deploy
cd api && npm run build
cd ../web && npm run build
pm2 restart kickball-api
```

Adding a stat means re-collecting comparisons for it, so settle the stat list
before the team starts rating.

`KICKBALL_TEST_USER` stands in for an Artanis session in the integration tests.
It is ignored whenever `NODE_ENV=production`, which the PM2 config always sets.
