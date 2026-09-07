# Gavel — working context

Operational notes for an agent picking this up cold. The [README](README.md) is
for a *reader*; this is for whoever has to *change* it.

**Live at https://gavel.benloe.com.** Port 3013, PM2 `gavel-api`, Caddy config at
`/srv/benloe/infra/caddy/gavel.benloe.com`.

---

## 1. What this app is

A live **auction** draft TRACKER for one person, driven entirely by hand. It is
open on a second monitor while the real draft runs on the first.

It **pairs with** a real draft room rather than imitating one. Everything that
room already shows is deliberately absent: no rival budgets, no rival rosters,
no clock, no nomination queue. What Gavel owns is the ranking, the tiers, a
price that responds to how the room has actually spent, and the record of who
has gone. A feature that reproduces the draft room is the wrong feature — an
earlier version had a three-field entry bar across the top and read as a worse
Sleeper.

**Marking a player drafted is a click on that player**, which opens one dialog:
price (prefilled with the board value and selected) and a manager type-ahead.
Clicking an already-drafted player reopens the same dialog to correct or
undraft. There is no other way to record a pick, and there should not be.

**A keeper is a pick.** Player, price, team — entered through the same click and
the same dialog, under a conspicuous mode toggled from the header. It gets a
`keeper` flag so it can be labelled, and nothing else about it is special: the
salary comes out of that manager's budget and the roster spot out of their
slots because it is in the same pick log everything else folds over.

  An earlier version modelled keepers as `committed` dollars and `keeperSlots`
  on the manager record. That was wrong twice over: two sets of numbers to keep
  in agreement, and the kept player stayed on the board as though available.
  Do not reintroduce it. `TeamMeta` is a team id and a name, and that is all.

Its siblings over the same sport are League Desk (`sleeper-ui`, entity browser)
and Waker (`waker`, decision feed). Gavel is neither: it exists for the ninety
minutes of a draft and is organised around **one keystroke sequence and one
number**. Keep it that way — a feature that is useful the day after the draft
probably belongs in one of the other two.

### The rule that defines it

> **Nothing on the critical path may touch the network.**

Projections and prices are frozen to disk by `scripts/snapshot.ts` *before* a
draft and served from SQLite. The browser applies a pick to the screen and to
`localStorage` before it POSTs, and retries in the background if the POST fails.
A Sleeper outage, a Caddy reload or a dropped wifi connection at 8:45pm cannot
affect the board.

This is why there is no "refresh projections" button, no live draft-API
connection, and no server-side render of derived state. Do not add any of them.

---

## 2. Layout

```
src/lib/                pure, no network, no Express — all unit-tested
  league.ts             league config: roster shape, scoring map, derived counts
  scoring.ts            stat line x league scoring -> points
  valuation.ts          points -> VOR -> auction dollars (the value engine)
  draft.ts              live state: budgets, max bids, inflation, needs, scarcity
  seed.ts               platform settings -> LeagueConfig
  board.ts              projection rows + config -> a priced board (platform-free)
  engine.test.ts        31 tests; each names the mistake it prevents

src/sources/sleeper.ts  the ONLY upstream, read only by the snapshot script

src/server/
  index.ts              wiring only. Routes, static, snapshot import at boot.
  db.ts                 SQLite. Picks are append-only; undo sets `voided`.
  auth.ts               artanis delegation + owner gate

src/web/
  index.css             THE design system. Colour and type live here.
  store.ts              local-first pick queue + sync. Derives state in-browser.
  search.ts             entry-bar player ranking
  panels.tsx            Board, Drafted, MyTeam, TeamPickerDialog, RoomBar
  PickModal.tsx         the ONLY way a pick is entered (the hot path)
  App.tsx               shell, filter, dialog wiring

scripts/snapshot.ts     freeze a league's board to /srv/benloe/data/gavel/
verify/verify.mjs       browser harness: drives a real draft from the keyboard
```

**Where the money math lives:** `valuation.ts` sets opening prices,
`draft.ts` moves them. Nothing else may compute a dollar figure.

---

## 3. Traps. Read this before debugging anything.

Every one of these cost real time here.

### Sleeper's data misleads in specific ways

- **`pts_std` / `pts_half_ppr` / `pts_ppr` all assume FOUR-point passing
  touchdowns.** The Columbus league pays six. Josh Allen reads 361.5 by
  Sleeper's column and 405.5 under the league's own rules — a 44-point error on
  every quarterback, in the same direction. **Never read a canned points
  column**; always `scoreStats(row.stats, cfg.scoring)`.
- **`gp` is 18 for every player** — the calendar including the bye, not a health
  projection. `NFL_GAMES` is 17 and `perGame` clamps to it.
- **`league.settings.draft_rounds` is vestigial for an auction** (it read 3 for a
  16-round league). The auction's own `draft.settings` carries `budget`,
  `rounds` and the slot counts.
- **`max_keepers` can be set on a league with no keepers.** Columbus reads
  `max_keepers: 1` and has none. Ask; do not infer.

### The value engine

- **A position with no starting slot has a replacement level of zero, so every
  point a player scores counts as surplus.** Neither league starts a kicker, and
  pricing kickers anyway handed them ~$700 of a $2,400 room — Brandon Aubrey
  priced above Puka Nacua. `rosteredPositions()` filters them out. This was
  invisible in unit tests and obvious the moment the engine ran on real data.
- **Tiers must be computed over the DRAFTED POOL, not the whole position, and
  the threshold must be a QUANTILE of the gaps rather than a multiple of their
  mean.** Both mistakes produced the same symptom from opposite directions:
  averaged over two hundred backs the threshold vanished, and averaged over the
  pool it was still smaller than every gap at the top, so the best players each
  landed in a tier of one — backwards, since the top of the board is where
  tiers carry the most information. Players outside the pool get **tier 0**,
  rendered as "Below the pool"; counting how many remain there is meaningless.
- **Flex is allocated against real projections**, greedily, not by a rule of
  thumb. In a four-receiver league that pulls flex toward receivers and moves
  replacement level with it.
- **Prices must sum to the budget.** If they do not, inflation is meaningless.
  There is a test for this; keep it.

### The browser

- **`text=` matches rendered text, never a placeholder attribute.** Waiting on
  `text=Nominate` timed out for fifteen seconds against a perfectly healthy
  board. Use `getByPlaceholder`.
- **A flex item will not shrink below its content width without `min-w-0`.**
  The board pushed the sidebar 98px off screen at 1280x800 — an ordinary second
  monitor — while looking perfect at 1600.
- **Always an ephemeral port in the harness.** A stray server on a fixed port
  makes the next run silently test the old build.
- **An optimistic pick carries a temporary NEGATIVE `seq` until the server
  answers, and it must be reconciled when it does.** Without that, undrafting a
  synced player skipped the DELETE entirely: the row vanished from the screen
  and came back on the next reload. Its sibling: removing a not-yet-synced pick
  has to drop it from the retry queue too, or the next flush puts it back. Both
  were caught only by the harness's reload check — neither shows up in a session
  that never refreshes.
- **Never `pkill -f` on a pattern like `tsx src/server/index.ts`.** Waker and
  sleeper-ui run the identical command line. (It matched this session's own
  shell instead, which is the only reason nothing broke.)

---

## 4. Value model, stated plainly

Because it will be replaced and the replacement needs the same contract.

1. **Points** — `stats x league scoring`, per league. No canned columns.
2. **Replacement** — the best player at a position with no starting job
   league-wide, after flex is allocated greedily by projection.
3. **VOR** — points minus that baseline.
4. **Dollars** — every drafted player costs at least `minBid`, so
   `teams x slots x minBid` is committed before bidding; the rest is split in
   proportion to positive VOR across the top `teams x slots` players.
5. **Inflation** — `money left / value left`, recomputed on every pick. Only
   the surplus above `minBid` inflates; a dollar player stays a dollar player.

**The contract for better rankings is a points number per player.** Swap the
projection source in `scripts/snapshot.ts` and everything downstream holds.

Known limits, stated because a tool that overstates its confidence is worse than
one that admits a gap:

- Projections are Sleeper's (Rotowire). They are ordinary, not good.
- Bench players are priced at the minimum, because replacement is set at the
  last starter. Real auctions do pay $2-4 for upside bench backs.
- No injury, bye-week stacking, or schedule adjustment enters the price.
- Tier breaks come from points gaps only, not from any measure of uncertainty.

---

## 5. Verifying

```
npm run typecheck    # must be clean
npm test             # 32 unit tests, pure, no network
npm run verify       # drives a real draft in a browser from the keyboard
npm run check        # all three
```

`npm run verify` starts the real server against a throwaway database and a copy
of the real snapshot, then enters picks with the keyboard and asserts that the
numbers a person would bid against actually move. **Read the screenshots in
`.verify/` with vision** — a green exit code means nothing errored, not that the
board is any good. Every visual bug so far was found by looking.

`GAVEL_TEST_USER` bypasses artanis. It is unreachable when
`NODE_ENV=production`, which the PM2 config sets.

---

## 6. Leagues, and before a draft

A league is either **read from Sleeper** or **described in a file**. Yahoo's API
returned 403 through both the connector and the local MCP service, and it did
not matter: a league's identity is its scoring map and roster shape, and
projections are of NFL players rather than of a platform. `leagues/yahoo.json`
carries the stated rules and the same engine prices it.

```
npm run snapshot -- 1389704095224315904 columbus   # Sleeper league id + slug
npm run snapshot -- leagues/yahoo.json             # a definition file
pm2 delete gavel-api && pm2 start ecosystem.config.cjs   # if GAVEL_LEAGUES changed
```

**`pm2 restart --update-env` does NOT re-read the ecosystem file.** Adding a
league to `GAVEL_LEAGUES` and restarting looks like it worked and silently
serves the old list.

Team names are renamed in the app (Your team -> Rename managers), and keepers
are entered as picks in keeper mode. Neither belongs in the definition file: no
platform reports a keeper's auction salary reliably, and keeper money moves
every price in the league.

Re-running the snapshot mid-draft is pointless and the server never does it on a
request. Run it a few hours before, not during.

---

## 7. Deploying

```
npm run build          # browser bundle -> dist/
pm2 restart gavel-api
```

Unlike its siblings, **Caddy does not serve `dist/` off disk** — it reverse
proxies everything to the Node app, so during a draft there is one process to
check rather than two. Rebuild before restarting; PM2 only runs the server.

Gavel's benloe-secrets set is **deliberately empty**: auth is delegated to
artanis and every upstream is public. There is nothing here to leak.
