# Gavel

A live auction draft board for fantasy football, built for one person with two
monitors: the real draft on one, this on the other.

It is the Beersheets idea — tiered positional columns with a dollar value beside
every name — with the parts a sheet of paper cannot do: prices that move as the
room spends, a max bid that accounts for the roster slots you still have to
fill, and a running answer to "who can still outbid me".

## Using it

Everything is one keystroke sequence, no mouse:

```
type a name → Enter → type a price → Enter → type a team → Enter
```

`Esc` clears. `Ctrl+Z` undoes the last sale. Typing anywhere on the page starts
a nomination, so your hands never have to find the mouse.

Click a team in the Room panel once to mark it as yours; its budget, max bid and
open starting slots then sit at the top of the sidebar.

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
