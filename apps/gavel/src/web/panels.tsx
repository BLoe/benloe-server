/**
 * The board and its side panels.
 *
 * Read-in-a-glance is the governing constraint: this is on a second monitor
 * while the real draft runs on the first. So every panel answers exactly one
 * question, the answer is a figure in tabular mono, and nothing important is
 * hidden behind a hover or a click.
 */
import type { Position } from '../lib/league.js';
import type { PlayerValue } from '../lib/valuation.js';
import { adjustedValue, contenders, scarcity, type DraftState, type Pick } from '../lib/draft.js';
import type { LeaguePayload } from './store.js';
import type { TeamMeta } from '../lib/draft.js';
import { useState } from 'react';

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

export function Pos({ position }: { position: string }) {
  return (
    <span className="fig" style={{ color: POS_INK[position] ?? 'var(--muted)', fontWeight: 600 }}>
      {position}
    </span>
  );
}

/**
 * One positional column of the sheet, tier-ruled.
 *
 * Tiers are the reason a draft board beats a sorted list: they say whether
 * waiting costs nothing or costs you the last player of a kind. The rule
 * between tiers is drawn in brass and labelled with how many are left in the
 * tier above, because "three left in this tier" is the actual decision input.
 */
function Column({
  position,
  players,
  state,
  league,
  onPick,
}: {
  position: Position;
  players: PlayerValue[];
  state: DraftState;
  league: LeaguePayload;
  onPick: (player: PlayerValue) => void;
}) {
  const supply = scarcity(state, league.values)[position];
  const tight = supply.ratio < 1;

  const rows: JSX.Element[] = [];
  let lastTier: number | null = null;
  let shown = 0;

  for (const player of players) {
    if (shown >= 60) break;
    const gone = state.drafted.has(player.id);
    if (player.tier !== lastTier) {
      const left = players.filter((p) => p.tier === player.tier && !state.drafted.has(p.id)).length;
      // Tier 0 is the remainder below the drafted pool, not a tier.
      const isRest = player.tier === 0;
      rows.push(
        <div
          key={`t${player.tier}`}
          className="label flex items-center gap-2 px-2 pt-2 pb-1"
          style={{
            // The first tier gets a label but no rule; there is nothing above
            // it to separate from.
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
    const paid = gone ? state.picks.find((p) => p.playerId === player.id)?.price : undefined;

    rows.push(
      <button
        key={player.id}
        onClick={() => !gone && onPick(player)}
        disabled={gone}
        className={`w-full text-left px-2 py-[3px] flex items-baseline gap-2 ${gone ? 'gone' : 'hover:bg-raised'}`}
        style={{ cursor: gone ? 'default' : 'pointer' }}
      >
        <span
          className="fig w-8 text-right shrink-0"
          style={{ color: gone ? 'var(--dim)' : 'var(--brass)', fontWeight: 600 }}
        >
          {gone ? money(paid ?? 0) : money(price)}
        </span>
        <span className="truncate flex-1" style={{ textDecoration: gone ? 'line-through' : 'none' }}>
          {player.name}
        </span>
        <span className="fig shrink-0" style={{ color: 'var(--dim)', fontSize: 10 }}>
          {player.team ?? '--'}
          {player.byeWeek ? ` ·${player.byeWeek}` : ''}
        </span>
      </button>
    );
    shown += 1;
  }

  return (
    <div className="sheet flex flex-col min-h-0" style={{ flex: '1 1 0', minWidth: 0 }}>
      <div className="rule-b px-2 py-1 flex items-baseline gap-2" style={{ background: 'var(--raised)' }}>
        <Pos position={position} />
        <span className="fig ml-auto" style={{ color: tight ? 'var(--live)' : 'var(--dim)', fontSize: 11 }}>
          {supply.supply}/{supply.demand}
        </span>
      </div>
      <div className="overflow-y-auto flex-1">{rows}</div>
    </div>
  );
}

export function Board({
  league,
  state,
  onPick,
}: {
  league: LeaguePayload;
  state: DraftState;
  onPick: (player: PlayerValue) => void;
}) {
  // Values arrive sorted by VOR, so each column is already best-first; the
  // column itself caps how many rows it draws.
  const byPos = new Map<Position, PlayerValue[]>();
  for (const p of league.values) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position)!.push(p);
  }

  const columns = POS_ORDER.filter((pos) => (byPos.get(pos)?.length ?? 0) > 0);

  return (
    // `min-w-0` is load-bearing: without it this flex item refuses to shrink
    // below the columns' content width and pushes the sidebar off screen on a
    // 1280px panel — which is a perfectly ordinary second monitor.
    <div className="flex gap-2 min-h-0 flex-1 min-w-0">
      {columns.map((pos) => (
        <Column
          key={pos}
          position={pos}
          players={byPos.get(pos)!}
          state={state}
          league={league}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/** My wallet, my needs. The only panel about one team rather than the room. */
export function MyTeam({ league, state }: { league: LeaguePayload; state: DraftState }) {
  const me = state.teams.find((t) => t.teamId === league.myTeamId);
  if (!me) {
    return (
      <div className="sheet p-2">
        <div className="label">Your team</div>
        <div style={{ color: 'var(--muted)' }}>Pick your team below to track your budget.</div>
      </div>
    );
  }
  const needList = Object.entries(me.needs).filter(([, n]) => n > 0);
  return (
    <div className="sheet">
      <div className="rule-b px-2 py-1 label" style={{ background: 'var(--raised)' }}>
        {me.name}
      </div>
      <div className="grid grid-cols-3 text-center">
        <Stat label="Left" value={money(me.remaining)} big />
        <Stat label="Max bid" value={money(me.maxBid)} big accent />
        <Stat label="Slots" value={`${me.openSlots}`} big />
      </div>
      <div className="px-2 pb-2 flex flex-wrap gap-x-3 gap-y-1">
        {needList.length === 0 && me.flexOpen === 0 ? (
          <span style={{ color: 'var(--muted)' }}>Starting lineup complete.</span>
        ) : (
          <>
            {needList.map(([pos, n]) => (
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

function Stat({
  label,
  value,
  big,
  accent,
}: {
  label: string;
  value: string;
  big?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="px-2 py-1">
      <div className="label">{label}</div>
      <div
        className="fig"
        style={{
          fontSize: big ? 20 : 14,
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
 * Every team's wallet, sorted by who can still hurt you.
 *
 * Max bid rather than dollars remaining, because a team with $40 and four empty
 * slots can only bid $37, and mistaking one for the other is how people
 * overpay in the endgame.
 */
export function Teams({
  league,
  state,
  onSetMyTeam,
  onSaveTeams,
}: {
  league: LeaguePayload;
  state: DraftState;
  onSetMyTeam: (teamId: string) => void;
  onSaveTeams: (teams: TeamMeta[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamMeta[]>(league.teams);

  const startEdit = () => {
    setDraft(league.teams.map((t) => ({ ...t })));
    setEditing(true);
  };
  const save = () => {
    onSaveTeams(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="sheet flex flex-col min-h-0" data-testid="team-editor">
        <div className="rule-b px-2 py-1 label flex items-center" style={{ background: 'var(--raised)' }}>
          <span className="flex-1">Name · keeper $ · slots</span>
          <button onClick={save} style={{ color: 'var(--brass)' }}>
            save
          </button>
        </div>
        <div className="overflow-y-auto">
          {draft.map((t, i) => (
            <div key={t.teamId} className="flex gap-1 px-1 py-[2px]">
              <input
                aria-label={`Team ${i + 1} name`}
                value={t.name}
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...t, name: e.target.value };
                  setDraft(next);
                }}
                className="flex-1 min-w-0"
                style={{ padding: '2px 4px' }}
              />
              <input
                aria-label={`Team ${i + 1} keeper dollars`}
                value={t.committed ?? 0}
                inputMode="numeric"
                title="Dollars already committed to keepers"
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...t, committed: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 };
                  setDraft(next);
                }}
                className="fig w-10"
                style={{ padding: '2px 4px' }}
              />
              <input
                aria-label={`Team ${i + 1} keeper slots`}
                value={t.keeperSlots ?? 0}
                inputMode="numeric"
                title="Roster spots already used by keepers"
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...t, keeperSlots: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 };
                  setDraft(next);
                }}
                className="fig w-8"
                style={{ padding: '2px 4px' }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const teams = [...state.teams].sort((a, b) => b.maxBid - a.maxBid);
  return (
    <div className="sheet flex flex-col min-h-0">
      <div className="rule-b px-2 py-1 label flex" style={{ background: 'var(--raised)' }}>
        <span className="flex-1">Room</span>
        <span className="w-10 text-right">Max</span>
        <span className="w-10 text-right">Left</span>
        <span className="w-8 text-right">Slots</span>
        <button onClick={startEdit} className="w-8 text-right" title="Rename teams, enter keepers">
          edit
        </button>
      </div>
      <div className="overflow-y-auto">
        {teams.map((t) => {
          const mine = t.teamId === league.myTeamId;
          return (
            <button
              key={t.teamId}
              onClick={() => onSetMyTeam(t.teamId)}
              title="Click to mark as your team"
              className="w-full flex px-2 py-[3px] hover:bg-raised text-left"
              style={{ color: mine ? 'var(--brass)' : 'var(--ink)' }}
            >
              <span className="flex-1 truncate">
                {mine ? '▸ ' : ''}
                {t.name}
              </span>
              <span className="fig w-10 text-right" style={{ fontWeight: 600 }}>
                {money(t.maxBid)}
              </span>
              <span className="fig w-10 text-right" style={{ color: 'var(--muted)' }}>
                {money(t.remaining)}
              </span>
              <span className="fig w-8 text-right" style={{ color: 'var(--dim)' }}>
                {t.openSlots}
              </span>
              <span className="w-8" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The log, newest first, with the undo that matters during a fast auction. */
export function Log({
  league,
  state,
  onRemove,
}: {
  league: LeaguePayload;
  state: DraftState;
  onRemove: (seq: number) => void;
}) {
  const byId = new Map(league.values.map((v) => [v.id, v]));
  const teamName = new Map(league.teams.map((t) => [t.teamId, t.name]));
  const recent = [...state.picks].reverse().slice(0, 40);

  return (
    <div className="sheet flex flex-col min-h-0">
      <div className="rule-b px-2 py-1 label" style={{ background: 'var(--raised)' }}>
        Sold ({state.picks.length})
      </div>
      <div className="overflow-y-auto">
        {recent.length === 0 && (
          <div className="px-2 py-2" style={{ color: 'var(--dim)' }}>
            Nothing sold yet.
          </div>
        )}
        {recent.map((pick: Pick) => {
          const player = byId.get(pick.playerId);
          const value = player ? adjustedValue(player, state, league.config) : 0;
          const delta = pick.price - value;
          return (
            <div key={pick.seq} className="flex items-baseline gap-2 px-2 py-[3px] group">
              <span className="fig w-8 text-right" style={{ color: 'var(--brass)', fontWeight: 600 }}>
                {money(pick.price)}
              </span>
              <span className="truncate flex-1">{player?.name ?? pick.playerId}</span>
              <span
                className="fig shrink-0"
                title="Price against this board's value"
                style={{ color: delta > 2 ? 'var(--bad)' : delta < -2 ? 'var(--good)' : 'var(--dim)', fontSize: 10 }}
              >
                {delta >= 0 ? '+' : ''}
                {Math.round(delta)}
              </span>
              <span className="truncate shrink-0" style={{ color: 'var(--muted)', fontSize: 10, maxWidth: 90 }}>
                {teamName.get(pick.teamId) ?? '?'}
              </span>
              <button
                onClick={() => onRemove(pick.seq)}
                className="opacity-0 group-hover:opacity-100"
                style={{ color: 'var(--live)', fontSize: 10 }}
                title="Remove this pick"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the room's money is doing. Inflation is the number a paper sheet cannot
 * give you and the reason this tool exists in software.
 */
export function RoomBar({ state, league }: { state: DraftState; league: LeaguePayload }) {
  const pct = Math.round((state.inflation - 1) * 100);
  const hot = state.inflation > 1.03;
  const cold = state.inflation < 0.97;
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-baseline gap-2">
        <span className="label">Inflation</span>
        <span
          className="fig"
          style={{ fontSize: 18, fontWeight: 600, color: hot ? 'var(--bad)' : cold ? 'var(--good)' : 'var(--ink)' }}
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
        {hot && 'money left over — prices will run hot'}
        {cold && 'room overspent — bargains coming'}
        {!hot && !cold && 'priced to the board'}
      </div>
    </div>
  );
}

export { contenders };
