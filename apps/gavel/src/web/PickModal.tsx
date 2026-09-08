/**
 * Marking a player drafted.
 *
 * The whole interaction budget of this app: click a name, confirm or retype the
 * price, say whether it was you. Two keystrokes when the price is right.
 *
 * WHY THERE IS NO MANAGER PICKER. There was one — a type-ahead over twelve
 * names — and after a live draft it was the slowest thing here by a distance:
 * scrolling for a name mid-nomination while the auctioneer moved on. It also
 * turned out to record something the board never used. Who else owns a player
 * changes nothing you can act on, and the draft room shows it anyway. One bit —
 * yours or not — drives every number on the board.
 */
import { useEffect, useRef, useState } from 'react';
import type { PlayerValue } from '../lib/valuation.js';
import type { DraftState, Pick } from '../lib/draft.js';
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
  state,
  config,
  keeper,
  onSubmit,
  onRemove,
  onClose,
}: {
  target: PickTarget;
  state: DraftState;
  config: LeagueConfig;
  /** Entering keepers rather than live picks. Same fields, different wording. */
  keeper?: boolean;
  onSubmit: (playerId: string, price: number, mine: boolean) => void;
  onRemove: (seq: number) => void;
  onClose: () => void;
}) {
  const { player, existing } = target;
  const suggested = Math.round(adjustedValue(player, state, config));
  const [price, setPrice] = useState(String(existing ? existing.price : suggested));
  const priceRef = useRef<HTMLInputElement>(null);

  // Focused and selected on open, so typing a number replaces the suggestion
  // outright and Enter alone accepts it.
  useEffect(() => {
    priceRef.current?.focus();
    priceRef.current?.select();
  }, []);

  const submit = (mine: boolean) => {
    const amount = Math.round(Number(price));
    if (!Number.isFinite(amount) || amount < 0) return;
    onSubmit(player.id, amount, mine);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(10,8,6,0.72)', paddingTop: '14vh' }}
      onMouseDown={onClose}
    >
      <div
        className="sheet"
        style={{ width: 440, borderColor: 'var(--brass)' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${keeper ? 'Keep' : 'Draft'} ${player.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          // "M" is free here: the price box only accepts digits, so a letter
          // can be a shortcut without stealing anything.
          if (e.key.toLowerCase() === 'm') {
            e.preventDefault();
            submit(true);
          }
        }}
      >
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
            <span className="flex items-baseline gap-2">
              <span className="label">Your max</span>
              <span
                className="fig"
                style={{ color: state.me.maxBid < suggested ? 'var(--over)' : 'var(--ink)' }}
              >
                {money(state.me.maxBid)}
              </span>
            </span>
          </div>
        </div>

        <label className="flex items-center rule-b">
          <span className="label px-3">Price</span>
          <input
            ref={priceRef}
            aria-label="Price"
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              // Enter is the common case by an order of magnitude: eleven of
              // twelve players go to someone else.
              if (e.key === 'Enter') {
                e.preventDefault();
                submit(false);
              }
            }}
            className="border-0 w-full"
            style={{ background: 'transparent', fontSize: 22, padding: '10px 4px' }}
          />
        </label>

        <div className="flex gap-2 p-3">
          <button
            onClick={() => submit(true)}
            className="flex-1 py-3"
            style={{ background: 'var(--mine)', color: '#0d1400', fontWeight: 700, fontSize: 16 }}
          >
            Me <kbd style={{ borderColor: '#0d1400', color: '#0d1400' }}>m</kbd>
          </button>
          <button
            onClick={() => submit(false)}
            className="flex-1 py-3"
            style={{ background: 'var(--brass)', color: '#14110e', fontWeight: 700, fontSize: 16 }}
          >
            Other <kbd style={{ borderColor: '#14110e', color: '#14110e' }}>enter</kbd>
          </button>
        </div>

        {existing && (
          <div className="flex items-center px-3 pb-3">
            <span style={{ color: 'var(--dim)', fontSize: 11 }}>
              Already drafted {existing.mine ? 'by you' : 'by someone else'}
              {keeper || existing.keeper ? ' (keeper)' : ''}.
            </span>
            <button
              onClick={() => onRemove(existing.seq)}
              className="ml-auto px-2 py-1"
              style={{ color: 'var(--live)' }}
            >
              Undraft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
