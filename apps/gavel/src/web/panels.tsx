/**
 * The board and its panels.
 *
 * Gavel sits BESIDE a real draft room, so it deliberately does not reproduce
 * what that room already shows: no rival budgets, no rival rosters, no
 * scoreboard. What it owns is the part the draft room does not have — rankings,
 * tiers, a price that responds to how the room has spent, and a record of who
 * has gone.
 *
 * Read-in-a-glance is the governing constraint: this is on a second monitor
 * while the draft happens on the first.
 */
import { useState } from 'react';
import type { Position } from '../lib/league.js';
import type { PlayerValue } from '../lib/valuation.js';
import { adjustedValue, scarcity, type DraftState } from '../lib/draft.js';
import type { LeaguePayload } from './store.js';

const POS_ORDER: Position[] = ['RB', 'WR', 'QB', 'TE', 'DEF'];
const POS_INK: Record<string, string> = {
  QB: 'var(--qb)',
  RB: 'var(--rb)',
  WR: 'var(--wr)',
  TE: 'var(--te)',
  DEF: 'var(--def)',
  K: 'var(--def)',
};

export const money = (n: number) => `$${Math.round(n)}`;

/**
 * Colour a price by what was paid against what the board projected.
 *
 * Blue under, red over. The comparison is always against `baseValue` — the
 * pre-draft projection — and never against the live inflated price, so a
 * purchase does not silently change colour as the room spends. Within a couple
 * of dollars it is neither, because projections are not that precise.
 */
export function priceInk(paid: number, projected: number, mine = false): string {
  const delta = paid - projected;
  if (delta > 2) return mine ? '#7a1d16' : 'var(--over)';
  if (delta < -2) return mine ? '#123a63' : 'var(--under)';
  return mine ? 'var(--mine-ink)' : 'var(--taken-ink)';
}

export function Pos({ position }: { position: string }) {
  return (
    <span className="fig" style={{ color: POS_INK[position] ?? 'var(--muted)', fontWeight: 600 }}>
      {position}
    </span>
  );
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');

/**
 * One positional column, tier-ruled.
 *
 * Tiers are the reason a board beats a sorted list: they say whether waiting
 * costs nothing or costs you the last player of a kind. The rule between tiers
 * is drawn in brass and labelled with how many remain above it.
 */
function Column({
  position,
  players,
  state,
  league,
  filter,
  onSelect,
}: {
  position: Position;
  players: PlayerValue[];
  state: DraftState;
  league: LeaguePayload;
  filter: string;
  onSelect: (player: PlayerValue) => void;
}) {
  const supply = scarcity(state, league.values, league.config)[position];
  const tight = supply.ratio < 1;
  const q = normalise(filter).trim();

  const visible = q
    ? players.filter((p) => normalise(p.name).includes(q) || normalise(p.team ?? '') === q)
    : players;

  const rows: JSX.Element[] = [];
  let lastTier: number | null = null;
  let shown = 0;

  for (const player of visible) {
    if (shown >= 70) break;
    const gone = state.drafted.has(player.id);

    // Tier rules are structure, not decoration; a filtered view has no
    // structure to speak of, so they are suppressed there.
    if (!q && player.tier !== lastTier) {
      const left = players.filter((p) => p.tier === player.tier && !state.drafted.has(p.id)).length;
      const isRest = player.tier === 0;
      rows.push(
        <div
          key={`t${player.tier}`}
          className="label flex items-center gap-2 px-2 pt-2 pb-1"
          style={{
            borderTop: lastTier === null ? 'none' : '1px solid var(--brass)',
            paddingTop: lastTier === null ? 4 : undefined,
            opacity: 0.75,
          }}
        >
          <span>{isRest ? 'Below the pool' : `Tier ${player.tier}`}</span>
          {!isRest && (
            <span className="fig" style={{ color: 'var(--dim)' }}>
              {left} left
            </span>
          )}
        </div>
      );
      lastTier = player.tier;
    }

    const price = adjustedValue(player, state, league.config);
    const pick = gone ? state.picks.find((p) => p.playerId === player.id) : undefined;
    const paid = pick?.price ?? 0;
    const delta = paid - player.baseValue;
    const isMine = !!pick?.mine;

    rows.push(
      <button
        key={player.id}
        onClick={() => onSelect(player)}
        title={
          gone
            ? `${money(paid)} vs $${Math.round(player.baseValue)} projected — ${isMine ? 'yours' : 'someone else'}`
            : 'Mark drafted'
        }
        className={`w-full text-left px-2 py-[3px] flex items-baseline gap-2 ${
          isMine ? 'mine' : gone ? 'taken' : 'hover:bg-raised'
        }`}
      >
        <span
          className="fig w-8 text-right shrink-0"
          style={{
            color: gone ? priceInk(paid, player.baseValue, isMine) : 'var(--brass)',
            fontWeight: 600,
          }}
        >
          {gone ? money(paid) : money(price)}
        </span>
        <span className="truncate flex-1" style={{ fontWeight: isMine ? 600 : 400 }}>
          {player.name}
        </span>
        {gone ? (
          <>
            {/* The delta, so colour is never the only signal. */}
            <span
              className="fig shrink-0"
              style={{ color: priceInk(paid, player.baseValue, isMine), fontSize: 10 }}
            >
              {delta >= 0 ? '+' : ''}
              {Math.round(delta)}
            </span>
            {pick?.keeper && (
              <span className="fig shrink-0" title="Kept, not drafted" style={{ fontSize: 9 }}>
                K
              </span>
            )}
          </>
        ) : (
          <span className="fig shrink-0" style={{ color: 'var(--dim)', fontSize: 10 }}>
            {player.team ?? '--'}
            {player.byeWeek ? ` ·${player.byeWeek}` : ''}
          </span>
        )}
      </button>
    );
    shown += 1;
  }

  const left = players.filter((p) => !state.drafted.has(p.id) && p.baseValue > 0).length;

  return (
    <div className="sheet flex flex-col min-h-0" style={{ flex: '1 1 0', minWidth: 0 }}>
      <div className="rule-b px-2 py-1 flex items-baseline gap-2" style={{ background: 'var(--raised)' }}>
        <Pos position={position} />
        <span className="fig" style={{ color: 'var(--dim)', fontSize: 11 }}>
          {left} left
        </span>
        <span
          className="fig ml-auto"
          title="Above-replacement players left, against starting jobs still unfilled"
          style={{ color: tight ? 'var(--live)' : 'var(--dim)', fontSize: 11 }}
        >
          {supply.supply}/{supply.demand}
        </span>
      </div>
      <div className="overflow-y-auto flex-1">
        {rows.length === 0 && (
          <div className="px-2 py-2" style={{ color: 'var(--dim)' }}>
            No match.
          </div>
        )}
        {rows}
      </div>
    </div>
  );
}

export function Board({
  league,
  state,
  filter,
  onSelect,
}: {
  league: LeaguePayload;
  state: DraftState;
  filter: string;
  onSelect: (player: PlayerValue) => void;
}) {
  // Values arrive sorted by VOR, so each column is already best-first.
  const byPos = new Map<Position, PlayerValue[]>();
  for (const p of league.values) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position)!.push(p);
  }
  const columns = POS_ORDER.filter((pos) => (byPos.get(pos)?.length ?? 0) > 0);

  return (
    // `min-w-0` is load-bearing: without it this flex item refuses to shrink
    // below its content width and pushes the sidebar off a 1280px screen.
    <div className="flex gap-2 min-h-0 flex-1 min-w-0" data-testid="board">
      {columns.map((pos) => (
        <Column
          key={pos}
          position={pos}
          players={byPos.get(pos)!}
          state={state}
          league={league}
          filter={filter}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * The record of who has gone — the panel this app is actually for.
 *
 * Newest first, with what the board thought they were worth beside what was
 * paid, because the running answer to "is this room paying up or getting
 * value" is the thing a draft room will not tell you.
 */
export function Drafted({
  league,
  state,
  onSelect,
}: {
  league: LeaguePayload;
  state: DraftState;
  onSelect: (player: PlayerValue) => void;
}) {
  const [query, setQuery] = useState('');
  const byId = new Map(league.values.map((v) => [v.id, v]));
  const q = normalise(query).trim();

  const rows = [...state.picks].reverse().filter((pick) => {
    if (!q) return true;
    return normalise(byId.get(pick.playerId)?.name ?? '').includes(q);
  });

  return (
    <div className="sheet flex flex-col min-h-0 flex-1">
      <div className="rule-b px-2 py-1 flex items-center gap-2" style={{ background: 'var(--raised)' }}>
        <span className="label">Drafted</span>
        <span className="fig" style={{ color: 'var(--brass)', fontWeight: 600 }}>
          {state.picks.length}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find"
          aria-label="Search drafted players"
          className="ml-auto w-20"
          style={{ padding: '1px 5px', fontSize: 11 }}
        />
      </div>
      <div className="overflow-y-auto flex-1">
        {state.picks.length === 0 && (
          <div className="px-2 py-2" style={{ color: 'var(--dim)' }}>
            Nobody drafted yet. Click a player on the board.
          </div>
        )}
        {rows.map((pick) => {
          const player = byId.get(pick.playerId);
          // Against the pre-draft projection, exactly as the board does it. Two
          // different deltas for the same pick would be worse than none.
          const projected = player?.baseValue ?? 0;
          const delta = pick.price - projected;
          const ink = priceInk(pick.price, projected, pick.mine);
          return (
            <button
              key={pick.seq}
              onClick={() => player && onSelect(player)}
              title={`${money(pick.price)} vs $${Math.round(projected)} projected — click to edit or undo`}
              className={`w-full flex items-baseline gap-2 px-2 py-[3px] text-left ${
                pick.mine ? 'mine' : 'hover:bg-raised'
              }`}
            >
              <span className="fig w-8 text-right shrink-0" style={{ color: ink, fontWeight: 600 }}>
                {money(pick.price)}
              </span>
              <span className="truncate flex-1">{player?.name ?? pick.playerId}</span>
              {pick.keeper && (
                <span className="fig shrink-0" title="Kept, not drafted" style={{ color: 'var(--brass)', fontSize: 9 }}>
                  K
                </span>
              )}
              <span className="fig shrink-0" style={{ color: ink, fontSize: 10 }}>
                {delta >= 0 ? '+' : ''}
                {Math.round(delta)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Your own wallet and your own holes.
 *
 * The one team whose budget is worth repeating here, because "what can I still
 * spend" has to survive a glance and the draft room buries it.
 */
export function MyTeam({ state }: { state: DraftState }) {
  const me = state.me;
  const needs = Object.entries(me.needs).filter(([, n]) => n > 0);
  return (
    <div className="sheet">
      <div className="flex">
        <Stat label="Left" value={money(me.remaining)} />
        <Stat label="Max bid" value={money(me.maxBid)} accent />
        <Stat label="Slots" value={`${me.openSlots}`} />
      </div>
      <div className="px-2 pb-2 flex flex-wrap gap-x-3 gap-y-1" style={{ fontSize: 12 }}>
        {needs.length === 0 && me.flexOpen === 0 ? (
          <span style={{ color: 'var(--muted)' }}>Starting lineup complete.</span>
        ) : (
          <>
            {needs.map(([pos, n]) => (
              <span key={pos} className="flex items-baseline gap-1">
                <Pos position={pos} />
                <span className="fig">{n}</span>
              </span>
            ))}
            {me.flexOpen > 0 && (
              <span className="flex items-baseline gap-1">
                <span className="label">FLEX</span>
                <span className="fig">{me.flexOpen}</span>
              </span>
            )}
            {me.benchOpen > 0 && (
              <span className="flex items-baseline gap-1" style={{ color: 'var(--dim)' }}>
                <span className="label">BN</span>
                <span className="fig">{me.benchOpen}</span>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-2 py-1 flex-1">
      <div className="label">{label}</div>
      <div
        className="fig"
        style={{
          fontSize: 19,
          lineHeight: 1.1,
          color: accent ? 'var(--brass)' : 'var(--ink)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The ticker: the last few sales, newest first, always on screen.
 *
 * It replaced a green confirmation that appeared for two seconds and then
 * vanished. During a live auction that is exactly backwards — the moment you
 * need to check what was just entered is a minute later, when the next lot is
 * already up and you are half sure you fat-fingered the price.
 *
 * Clipped, never scrolled: the Drafted panel already holds the complete record
 * and is searchable, so a scrollbar here only sent you looking in the wrong
 * place. Whatever fits, fits; the rest fades out at the right edge.
 */
export function Ticker({
  league,
  state,
  onSelect,
}: {
  league: LeaguePayload;
  state: DraftState;
  onSelect: (player: PlayerValue) => void;
}) {
  const byId = new Map(league.values.map((v) => [v.id, v]));
  const recent = [...state.picks].reverse().slice(0, 14);

  return (
    <div
      className="sheet shrink-0 flex items-center gap-0 overflow-hidden relative"
      style={{ height: 30 }}
      aria-label="Recent picks"
    >
      <span className="label px-2 shrink-0" style={{ borderRight: '1px solid var(--rule)' }}>
        Last
      </span>
      {recent.length === 0 && (
        <span className="px-3 shrink-0" style={{ color: 'var(--dim)' }}>
          Nothing sold yet.
        </span>
      )}
      {recent.map((pick) => {
        const player = byId.get(pick.playerId);
        const projected = player?.baseValue ?? 0;
        return (
          <button
            key={pick.seq}
            onClick={() => player && onSelect(player)}
            title={`${money(pick.price)} vs $${Math.round(projected)} projected — click to correct`}
            className={`flex items-baseline gap-2 px-3 shrink-0 h-full ${
              pick.mine ? 'mine' : 'hover:bg-raised'
            }`}
            style={{ borderRight: '1px solid var(--rule)' }}
          >
            <span
              className="fig"
              style={{ color: priceInk(pick.price, projected, pick.mine), fontWeight: 600 }}
            >
              {money(pick.price)}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{player?.name ?? pick.playerId}</span>
            {pick.keeper && (
              <span className="fig" title="Kept, not drafted" style={{ fontSize: 9 }}>
                K
              </span>
            )}
            {pick.mine && (
              <span className="label" style={{ color: 'var(--mine-ink)' }}>
                you
              </span>
            )}
          </button>
        );
      })}

      {/* The fade IS the ellipsis: it says "there is more" without pretending
          to be a control. Never intercepts a click on the entry beneath it. */}
      {recent.length > 0 && (
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 h-full"
          style={{
            width: 48,
            pointerEvents: 'none',
            background: 'linear-gradient(to right, transparent, var(--panel))',
          }}
        />
      )}
    </div>
  );
}

/**
 * What the room's money is doing. Inflation is the number a draft room cannot
 * give you, and the reason the prices on this board move at all.
 */
export function RoomBar({ state }: { state: DraftState }) {
  const pct = Math.round((state.inflation - 1) * 100);
  const hot = state.inflation > 1.03;
  const cold = state.inflation < 0.97;
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-baseline gap-2">
        <span className="label">Inflation</span>
        <span
          className="fig"
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: hot ? 'var(--bad)' : cold ? 'var(--good)' : 'var(--ink)',
          }}
        >
          {pct >= 0 ? '+' : ''}
          {pct}%
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="label">Room</span>
        <span className="fig" style={{ fontSize: 15 }}>
          {money(state.moneyLeft)}
        </span>
        <span style={{ color: 'var(--dim)' }}>/ {state.slotsLeft} slots</span>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 11 }}>
        {hot && 'money left over — prices running hot'}
        {cold && 'room overspent — bargains coming'}
        {!hot && !cold && 'priced to the board'}
      </div>
    </div>
  );
}
