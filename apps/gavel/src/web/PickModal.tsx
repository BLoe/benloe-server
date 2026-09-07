/**
 * Marking a player drafted.
 *
 * This is the ONLY way a pick is entered, and it is the whole interaction
 * budget of the app: click a name on the board, type a price, type enough of a
 * manager's name to pick them out, Enter. Two fields, one of them prefilled.
 *
 * It replaced a three-field bar across the top of the screen, which was both
 * slower and — the real problem — indistinguishable from the draft room Gavel
 * is meant to sit beside. Gavel is a tracking tool. The act of tracking should
 * be a click on the thing being tracked, not a form somewhere else.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerValue } from '../lib/valuation.js';
import type { DraftState, Pick, TeamMeta } from '../lib/draft.js';
import type { LeagueConfig } from '../lib/league.js';
import { adjustedValue } from '../lib/draft.js';
import { Pos, money } from './panels.js';

export interface PickTarget {
  player: PlayerValue;
  /** Present when the player is already drafted — the modal becomes an edit. */
  existing?: Pick;
}

export function PickModal({
  target,
  teams,
  state,
  config,
  keeper,
  onSubmit,
  onRemove,
  onClose,
}: {
  target: PickTarget;
  teams: TeamMeta[];
  state: DraftState;
  config: LeagueConfig;
  /** Entering keepers rather than live picks. Same fields, different wording. */
  keeper?: boolean;
  onSubmit: (playerId: string, teamId: string, price: number) => void;
  onRemove: (seq: number) => void;
  onClose: () => void;
}) {
  const { player, existing } = target;
  const suggested = Math.round(adjustedValue(player, state, config));

  const [price, setPrice] = useState(String(existing ? existing.price : suggested));
  const [teamQuery, setTeamQuery] = useState(
    existing ? (teams.find((t) => t.teamId === existing.teamId)?.name ?? '') : ''
  );
  const [cursor, setCursor] = useState(0);

  const priceRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);

  // Price is focused and selected on open, so typing a number replaces the
  // suggestion outright and Enter alone accepts it.
  useEffect(() => {
    priceRef.current?.focus();
    priceRef.current?.select();
  }, []);

  const matches = useMemo(() => {
    const q = teamQuery.toLowerCase().trim();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teamQuery, teams]);

  const chosen = matches[cursor] ?? matches[0];

  const submit = () => {
    const amount = Math.round(Number(price));
    if (!chosen || !Number.isFinite(amount) || amount < 0) return;
    onSubmit(player.id, chosen.teamId, amount);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(10,8,6,0.72)', paddingTop: '12vh' }}
      onMouseDown={onClose}
    >
      <div
        className="sheet"
        style={{ width: 460, borderColor: 'var(--brass)' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${keeper ? 'Keep' : 'Mark'} ${player.name} ${keeper ? 'at' : 'drafted'}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {/* Who, and what the board thinks they are worth. */}
        <div className="px-4 pt-3 pb-2 rule-b">
          <div className="flex items-baseline gap-2">
            <Pos position={player.position} />
            <span className="slab" style={{ fontSize: 22 }}>
              {player.name}
            </span>
            <span className="fig" style={{ color: 'var(--dim)' }}>
              {player.team ?? '--'}
              {player.byeWeek ? ` · bye ${player.byeWeek}` : ''}
            </span>
          </div>
          <div className="flex items-baseline gap-5 mt-1">
            <span className="flex items-baseline gap-2">
              <span className="label">Board</span>
              <span className="fig" style={{ color: 'var(--brass)', fontWeight: 600, fontSize: 15 }}>
                {money(suggested)}
              </span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="label">Tier</span>
              <span className="fig">{player.tier === 0 ? 'below the pool' : player.tier}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="label">{player.position} rank</span>
              <span className="fig">{player.posRank}</span>
            </span>
          </div>
        </div>

        <div className="flex items-stretch rule-b">
          <label className="flex items-center flex-1">
            <span className="label px-3">Price</span>
            <input
              ref={priceRef}
              aria-label="Price"
              value={price}
              inputMode="numeric"
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  teamRef.current?.focus();
                  teamRef.current?.select();
                }
              }}
              className="border-0 w-full"
              style={{ background: 'transparent', fontSize: 20, padding: '10px 4px' }}
            />
          </label>
        </div>

        <div className="relative">
          <label className="flex items-center">
            <span className="label px-3">To</span>
            <input
              ref={teamRef}
              aria-label="Team"
              value={teamQuery}
              placeholder={keeper ? 'type the keeping manager' : 'type a manager'}
              onChange={(e) => {
                setTeamQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, matches.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              className="border-0 w-full"
              style={{ background: 'transparent', fontSize: 20, padding: '10px 4px' }}
            />
          </label>

          {/* Always visible: with twelve managers the list IS the picker, and
              hiding it behind a keystroke costs more than it saves. */}
          <div className="max-h-52 overflow-y-auto rule-b" style={{ borderTop: '1px solid var(--rule)' }}>
            {matches.length === 0 && (
              <div className="px-3 py-2" style={{ color: 'var(--dim)' }}>
                No manager matches that.
              </div>
            )}
            {matches.map((t, i) => (
              <button
                key={t.teamId}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const amount = Math.round(Number(price));
                  if (Number.isFinite(amount) && amount >= 0) onSubmit(player.id, t.teamId, amount);
                }}
                className="w-full text-left px-3 py-1"
                style={{
                  background: i === cursor ? 'var(--raised)' : 'transparent',
                  color: i === cursor ? 'var(--brass)' : 'var(--ink)',
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>
            <kbd>enter</kbd> save · <kbd>esc</kbd> cancel
          </span>
          {existing && (
            <button
              onClick={() => onRemove(existing.seq)}
              className="ml-auto px-2 py-1"
              style={{ color: 'var(--live)' }}
            >
              Undraft
            </button>
          )}
          <button
            onClick={submit}
            className={existing ? 'px-3 py-1' : 'ml-auto px-3 py-1'}
            style={{ background: 'var(--brass)', color: '#14110e', fontWeight: 600 }}
          >
            {existing ? 'Update' : keeper ? 'Save keeper' : 'Mark drafted'}
          </button>
        </div>
      </div>
    </div>
  );
}
