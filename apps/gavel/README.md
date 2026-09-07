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

Click a player. Type the price, Enter, type enough of the manager's name, Enter.

```
click → price → Enter → manager → Enter
```

The price box opens prefilled with the board value and selected, so if the
player went for what he was worth, two Enters are the whole pick.

Click an already-drafted player — on the board or in the Drafted list — to
correct the price, move him to another manager, or undraft him. `Ctrl+Z` undoes
the last one. The filter box at the top narrows the columns to find a name fast;
it never records anything.

**Managers** sets who is in the league, which team is yours, and what any
keepers cost them.

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
