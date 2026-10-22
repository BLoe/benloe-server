# Tipoff — notes from the 2026-27 draft

Written after the draft (held the night of 2026-10-10). `CLAUDE.md` covers how
the code works; this file covers what happened, what we learned, and what to
do differently next October.

## The league, as it stood

- 12-team Yahoo H2H weekly, 9 cats with **FGM in place of TO**: FGM, FG%, FT%,
  3PM, PTS, REB, AST, ST, BLK. Roster PG, SG, G, SF, PF, F, C, C, Util, Util,
  6 BN, 2 IL — 16 rounds, snake.
- Keepers: Cooper Flagg (3rd round), Kyshawn George (13th). Ben owned extra
  picks in rounds 3, 6 and 8 and none in 10-12.
- Ben's real picks, read off the Yahoo grid: #5, 20, 29, 44, 53, 62, 68, 77,
  90, 92, 101, then 164, 173, 188 (Flagg at #31, George at #149). After #101
  there were 55 live picks before #164: the defining feature of this draft.

## What the analysis said before the draft

- **FGM moves almost one-for-one with PTS** (r = 0.97 over the top 156), so
  volume scoring counts twice. FG% runs against 3PM and FT% and with REB and
  BLK. The categories split 6 (guard/wing) vs 3 (big).
- **Punting FG% was the most robust choice** across a simulation on the real
  pick grid, against two kinds of rival (ADP drafters and rivals as smart as
  us), with seasons played out under single-source projections. It finished
  1st-2nd in both rooms. Two-category punts (FG%+REB, FG%+FT%) were each best
  in one room and middling in the other. Not punting lost by 4-5 points in
  both. Punting FT%, AST or 3PM was clearly bad. Half-weighting FG% performed
  the same as punting it.
- Flagg went 6th overall in Yahoo ADP, so keeping him for a 3rd was the
  biggest edge Ben had. George (ADP ~135-143) kept in the 13th was close to
  break-even.

## Ben's team

Cade Cunningham (#5), LaMelo Ball (#20), Anthony Davis (#29), LeBron James
(#44), Desmond Bane (#53), De'Aaron Fox (#62), John Collins (#68), Paul George
(#77), Jalen Green (#90), Myles Turner (#92), Darius Acuff Jr. (#101), Nikola
Vucevic (#164), Bobby Portis (#173), Kingston Flemings (#188), plus keepers
Flagg and Kyshawn George.

Category rank among the 12 real rosters (blended projections): 3PM 1st; FGM,
PTS, AST, ST 2nd; BLK 4th; FT% 5th; REB 9th; FG% 11th (punted). Third of
twelve on average weekly win rate, in a top tier of five with a cliff after
it. Toughest matchup: Strategic Implementation Lead (SGA, Giannis, Tatum,
Trae) — it beats this build at FGM and points as well as on the boards.

In-season levers identified: trade guard depth (Fox, Bane, Green, Acuff,
Flemings) for a rebounder, preferably with a mid-table team rather than Big
Vic Energy, the closest rival that needs shooters; and stream a center against
the top four. Rerun `node scripts/season.mjs` after a few weeks of real stats
or before any trade.

## What happened during the draft, and what it taught

- **This room drafts centers 15-20 picks ahead of ADP.** Sengun, Mobley, Bam,
  Chet, Kessler, Naz Reid, Okongwu all went early. The model's "will he last"
  odds for centers were too optimistic every time. Next year: shade center
  survival down, or calibrate it from this year's results.
- **The "edge" column was partly an injury column.** Players the room left
  late were often late because of health (Embiid, Davis, Trae, Porzingis,
  Butler). The projections still gave them 55-65 games and the board only
  half-penalised missed games. Ben pushed back on stacking Davis with Embiid
  and took LeBron instead — the right call. Next year: build the cautious
  games estimate (lowest source, pulled toward last season when he missed a
  lot, full weight on games) into the board as a toggle before the draft, and
  use "when two players are within ~1 value, take the durable one" as the
  default rule.
- **Count C-slot games, not just C-eligible players.** Two C-only slots with
  daily lineups means a third and fourth center add real games; a bench guard
  mostly does not play. That logic should drive the late rounds from the
  start, not be worked out at #101.
- **The pick counter drifted by one or two several times** (a pick marked
  late, or Yahoo ahead of the board). The −/+ buttons fixed it each time.
  Worth adding: show "last 3 picks" beside the counter so a gap is obvious.
- **The server sync stopped once** — no requests at all from the browser for
  ~3 minutes until a hard refresh. The board kept working locally, which is
  the design. Advice given from a stale state was caught by checking the
  "pushed Ns ago" line; always check it.
- **CBS spells some players by legal first name** (Nicolas Claxton, Gregory
  Jackson, Ron Holland, Moe Wagner), which split each into a full entry and a
  ghost. Fixed with a nickname map in `snapshot.mjs`; watch for new ones when
  rookies arrive.
- **Advice that named the same pick twice** ("Kyrie/Kawhi at #29, Embiid at
  #29") confused things mid-draft. Pick-by-pick plans should name one target
  per pick and one fallback.
- **Screenshots were the most reliable input.** Yahoo's API returns 403 here.
  The draft grid (picks and keeper slots) and the final results both came in
  as uploads and were read without error.

## Before next year's draft

1. `npm run snapshot` a few hours before, never during.
2. Update `scripts/league.mjs`: sheet tabs for 2027, team renames, and the
   Yahoo pick grid (have Ben upload the grid screenshots).
3. Decide the punt again with `node scripts/strategy.mjs`, which needs the new
   pick grid; the category structure probably still favours guards.
4. Add the health toggle and center-survival correction above, then
   `npm test` and `node verify/verify.mjs`.
5. Have Ben refresh the board once and confirm the sync arrives before pick 1.
