# Tipoff — working context

The fantasy **NBA** snake-draft board for Ben's 12-team Yahoo keeper league.
Live at https://tipoff.benloe.com. Static: Caddy serves `public/` directly
(`infra/caddy/tipoff.benloe.com`); no PM2 process, no server, no secrets.

It pairs with the Yahoo draft room, like Gavel does with Sleeper's: no clock, no
rival rosters, no chat. It owns value in THIS league's categories, tiers,
positional scarcity, and "will he last to my next pick".

## The league, as stated by Ben (Yahoo's API returns 403 here)

- 12 teams, snake, 16 rounds (18 roster spots minus 2 IL).
- H2H weekly, 9 cats: **FGM**, FG%, FT%, 3PM, PTS, REB, AST, ST, BLK — TO is
  replaced by FGM. Nobody else's rankings model this; that is the point.
- Roster: PG, SG, G, SF, PF, F, C, C, Util, Util, 6 BN, 2 IL. Two C-only slots.
- Ben ("Ben Loe" in the sheet; "Are We There Yet?" in 2025) owns extra picks in
  rounds 3, 6, 8 and none in 10-12. Keepers: Flagg (a 3rd), Kyshawn George (13th).
- Keepers and last year's draft live in the league's Google Sheet
  (`scripts/league.mjs` has the id). Read via the public gviz CSV endpoint.

## Data, frozen before the draft

```
npm run snapshot   # ESPN + CBS + FantasyPros projections, ADP, ECR -> public/players.json
node scripts/league.mjs   # sheet -> public/league.json (keepers, 2025 draft)
npm test           # pure model + draft-state tests
node verify/verify.mjs    # drives a draft on the LIVE site; read .verify/*.png
npm run analyze    # punt simulation + where this league disagrees with ADP
```

Both JSON files are gitignored: one is other sites' data, the other is the
league's. Re-run both scripts to rebuild them.

### Traps

- **Hashtag Basketball** gates everything past its top 30 (team/position
  filters are disabled server-side for free users). Not a source. Don't
  work around a paywall.
- **ESPN projections** are `stats[id=10{season}]`, season named by its END year
  (2026-27 = 2027). Stat ids are in `snapshot.mjs`.
- **CBS projects ~78 games for everyone.** It votes on per-game stats but not
  on games played.
- **FantasyPros projections have no attempts.** Their FG%/FT% are applied to
  the other sources' attempts. Percentages are always blended through
  makes/attempts, never averaged.
- **FantasyPros' ADP table never closes its `<tr>`s.** Split on the opening tag.
- **Yahoo ADP there is from early September and thin** (AJ Green at 46).
  `adp` is the median of Yahoo ADP, ESPN's live ADP and expert rank.
- **ADP assumes no keepers.** `keeperAdjustedAdp` moves everyone behind a
  keeper up a slot; the pick counter skips keeper picks once the draft order
  is set, so it matches Yahoo's numbering.
- **Picks are traded all over this league.** Draft setup takes Ben's own pick
  numbers and the keeper-filled picks typed from the Yahoo lobby (`34` or
  `3.10`); typed numbers override the order-derived schedule. Rival-to-rival
  trades need no modelling: they change who picks, never when. Nothing here
  reads Yahoo — its API returns 403.
- **Positions are FantasyPros' (Yahoo-style)**, e.g. Flagg PF/SF/SG. ESPN's
  own eligibility is narrower and wrong for Yahoo.
- **Tiers use a gap relative to the gaps around it**, not one global cutoff —
  a global cutoff made every star a tier of one (the same trap Gavel hit).
- **Slot matching prefers the two C slots** so a PF/C shows at C, not PF.

## Value model

`public/model.js`, shared by the page, the tests and the analysis.
Per-game z-scores over the top 156 (12 x 13), two passes so the pool is
self-consistent. FG%/FT% are volume-weighted (`(pct - league pct) x attempts`).
Value = sum of z over un-punted cats, the positive part scaled half by
projected games (`gpWeight 0.5`: weekly H2H punishes absence less than roto).
**Fit** re-weights toward the roster's three weakest live categories (x1.35)
and away from its two strongest (x0.75), against the room's average pick.

## What the simulation said (October 2026 data)

FGM correlates 0.97 with PTS, so volume scoring counts twice; FG% runs against
3PM/FT% and with REB/BLK. Punting FG% came out on top against both rivals-by-ADP
and rivals-by-our-value; punting FT% finished below no punt against both;
punting AST/3PM was clearly bad. The board defaults to punt FG%, one click to
change.
