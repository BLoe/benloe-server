# Gavel

A live auction draft board for fantasy football, built for one person with two
monitors: the real draft on one, this on the other.

It is the Beersheets idea — tiered positional columns with a dollar value beside
every name — with the parts a sheet of paper cannot do: prices that move as the
room spends, a max bid that accounts for the roster slots you still have to
fill, and a running answer to "who can still outbid me".

It is a **tracker**, not a draft room. It shows nothing your real draft room
already shows — no rival budgets, no rosters, no clock. It shows what that room
cannot: the ranking, the tiers, a price that moves as the room spends, and the
record of who has gone.

## Using it

Click a player, check the price, and say whether you got him.

```
click → price → m (mine)  or  enter (someone else)
```

The price box opens prefilled with the board value and selected, so if he went
for what he was worth it is one keystroke.

Players you drafted are **lime** on the board; everyone else's are barred out in
black. Gavel does not track which of the other eleven managers bought a player —
it makes no difference to any decision you have to make, and your draft room
shows it.

A sold player is barred out in black on the board — still fully readable, with
what was paid, how far that was from projection, and who bought him. The price
reads **blue under projection, red over**, in the ticker and the Drafted list
too. Every comparison is against the pre-draft projection, so a purchase never
changes colour as the room spends.

The ticker under the header keeps the last fourteen sales on screen — price,
player, manager — so you can check what you just entered a minute after you
entered it.

Click an already-drafted player — on the board, in the ticker, or in the
Drafted list — to correct the price, move him to another manager, or undraft
him. `Ctrl+Z` undoes
the last one. The filter box at the top narrows the columns to find a name fast;
it never records anything.

## Keepers

**Keepers** in the header turns on keeper entry. Click each kept player and
record what he costs his manager, exactly as you would a live purchase — a
keeper is a pick. He comes off the board marked `K`, his salary comes out of
that manager's budget, and his roster spot out of their slots.

Do this before the draft starts. Cheap keepers leave more money in the room
chasing fewer players, and the board's prices will say so.

## What the numbers mean

- **Board** — what this player is worth in *this* league, at *this* moment,
  adjusted for how the room has actually been spending.
- **Inflation** — money left divided by value left. Above zero the room has cash
  to burn and prices will run hot; below zero it overspent early and there are
  bargains coming.
- **Max bid** — the most a team can bid and still fill its roster at $1 a slot.
  It is not the same as dollars remaining, and the difference is how people
  overpay in the endgame.
- **n/m** at the top of a column — above-replacement players left, against
  starting jobs still unfilled. Below 1 means there are not enough to go round.

Prices come from each league's own scoring rules applied to projected stat
lines, converted to dollars by clearing the room's whole budget against value
over replacement. They are not imported from anywhere.

## It works when things break

Picks are applied to the screen and saved locally before they are sent
anywhere, and retried in the background if the server does not answer. Nothing
you type during a draft waits on the network, and the board makes no upstream
call at all once a draft has begun.
