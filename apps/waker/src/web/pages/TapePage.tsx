import { useMemo, useState } from 'react';
import { useApi } from '../api';
import { Empty, ErrorNote, Loading, Sheet } from '../components';
import { TapeRowView, VERDICT, type TapeRow } from '../Tape';

/**
 * THE TAPE — usage against production, ranked by what the gap is worth.
 *
 * The screen exists because points are a lagging measure and every other
 * fantasy app shows only points. A back who takes over a backfield gets the
 * snaps three weeks before he gets the touchdowns, and for those three weeks
 * his box score says he is the same player. This is the only page in Waker
 * where a player's own history is the subject rather than the evidence — and
 * even here the question is a decision: buy him, sell him, or claim him.
 *
 * Free agents sit in the same list as rostered players on purpose. The
 * calculation that says "trade for him" is the calculation that says "claim
 * him"; splitting them would be an artefact of ownership, not of the question.
 */

interface TapeResponse {
  rows: TapeRow[];
  considered: number;
  /** Played inside the window but has no snap count for it; left unranked. */
  withoutSnaps: number;
  weekFrom: number;
  weekTo: number;
  windowFrom: number;
  limit: number;
  inSeason: boolean;
  window: number;
  minGames: number;
  usageSeason: string;
  leagueSeason: string;
  pointsPerReception: number;
  hasRoster: boolean;
  coverage: {
    snaps: number;
    usage: number;
    joined: number;
    usageSeason: string;
  };
}

type Ownership = 'all' | 'mine' | 'free';
type PositionFilter = 'ALL' | 'RB' | 'WR' | 'TE';

const OWNERSHIP: Array<{ id: Ownership; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'free', label: 'Free agents' },
];

/**
 * Quarterbacks are absent, and it is not an oversight — see RANKABLE_POSITIONS
 * in divergence.ts. Every starting quarterback plays every snap, so their usage
 * percentiles tie at the top while production spreads normally, and the method
 * reads every below-average starter as under-producing. Offering a QB filter
 * that returned nothing would be worse than not offering it.
 */
const POSITIONS: PositionFilter[] = ['ALL', 'RB', 'WR', 'TE'];

/**
 * How many rows to draw before asking.
 *
 * The list is ranked, so the tail is the low-signal end by construction, and
 * two hundred and fifty sparklines is a lot of chart to render for rows nobody
 * scrolls to. The count of what is held back is always stated.
 */
const FIRST_PAGE = 60;

export default function TapePage({ league }: { league: { leagueId: string } }) {
  const [own, setOwn] = useState<Ownership>('all');
  const [pos, setPos] = useState<PositionFilter>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const tape = useApi<TapeResponse>(`/api/league/${league.leagueId}/tape`);

  const rows = useMemo(() => {
    const all = tape.data?.rows ?? [];
    return all.filter((r) => {
      if (own === 'mine' && !r.mine) return false;
      if (own === 'free' && r.rostered) return false;
      if (pos !== 'ALL' && r.position !== pos) return false;
      return true;
    });
  }, [tape.data, own, pos]);

  if (tape.loading) return <Loading label="Reading the tape" />;
  if (tape.error) return <ErrorNote message={tape.error} />;
  if (!tape.data) return null;

  const t = tape.data;
  const buys = rows.filter((r) => r.divergence.verdict === 'buy').length;
  const sells = rows.filter((r) => r.divergence.verdict === 'sell').length;

  return (
    <Sheet
      title="The tape"
      count={`${rows.length} of ${t.considered} ranked`}
      note={note(t)}
    >
      {/* One row of controls. Ownership is the first cut because it decides
          which verb applies — hold, offer, or claim. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 border-b border-[var(--rule)]">
        <Choice
          legend="Whose players to read"
          options={OWNERSHIP.map((o) => ({ id: o.id, label: o.label }))}
          value={own}
          onChange={setOwn}
        />
        <Choice
          legend="Position"
          options={POSITIONS.map((p) => ({ id: p, label: p === 'ALL' ? 'All' : p }))}
          value={pos}
          onChange={setPos}
        />

        {/* The key. The marks carry the verdict on their own, so this is a
            reminder rather than the only way in. */}
        <ul className="flex items-center gap-x-3 ml-auto">
          {(['buy', 'sell', 'fair'] as const).map((v) => (
            <li key={v} className="flex items-center gap-1">
              <span aria-hidden="true" className="fig" style={{ fontSize: 11, color: VERDICT[v].ink }}>
                {VERDICT[v].mark}
              </span>
              <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--graphite)' }}>
                {VERDICT[v].word.toUpperCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Column heading. Sticky, because the one thing this strip carries is
          which season the lines are drawn from — and a reader who has scrolled
          two hundred rows is exactly the reader who would otherwise assume it
          is this year. Each row prints its own units, so nothing else needs
          repeating here. */}
      {rows.length > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-[var(--rule)]"
          style={{ background: 'var(--band)' }}
        >
          <span className="label flex-1" style={{ minWidth: '10rem' }}>
            {buys} to buy · {sells} to sell
          </span>
          <span className="label ml-auto text-right">
            Snap share by week · {t.usageSeason} season, weeks {t.weekFrom}–{t.weekTo}
          </span>
        </div>
      )}

      {t.considered === 0 ? (
        <Empty title={nothing(t).title} hint={nothing(t).hint} />
      ) : rows.length === 0 ? (
        <Empty
          title="Nothing matches that filter."
          hint={emptyHint(own, pos, t)}
        />
      ) : (
        <>
          {(showAll ? rows : rows.slice(0, FIRST_PAGE)).map((row) => (
            <TapeRowView
              key={row.id}
              row={row}
              from={t.weekFrom}
              to={t.weekTo}
              windowFrom={t.windowFrom}
              season={t.usageSeason}
              open={open === row.id}
              onToggle={() => setOpen((o) => (o === row.id ? null : row.id))}
            />
          ))}

          {!showAll && rows.length > FIRST_PAGE && (
            <div className="px-4 py-3 border-t border-[var(--rule)]">
              <button type="button" onClick={() => setShowAll(true)} className="link">
                Show the other {rows.length - FIRST_PAGE}
              </button>
              <span className="fig ml-2" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
                smaller gaps, in the same order
              </span>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** A group of mutually exclusive buttons, in the Board's control idiom. */
function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex items-center gap-0">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className="fig px-2.5 py-1 border"
          style={{
            fontSize: 'var(--t-tick)',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            borderColor: value === o.id ? 'var(--ink)' : 'var(--rule)',
            background: value === o.id ? 'var(--ink)' : 'transparent',
            color: value === o.id ? 'var(--vellum)' : 'var(--graphite)',
          }}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Why there is nothing to rank.
 *
 * Three different causes, and saying the wrong one is worse than saying
 * nothing: an empty week one is not a dead source, and a dead source is not a
 * quiet week. The first version of this page blamed nflverse for all three,
 * which would have been a lie every year on the Tuesday after week one.
 */
export function nothing(t: {
  coverage: { usage: number; snaps: number };
  usageSeason: string;
  weekTo: number;
  windowFrom: number;
  minGames: number;
}): { title: string; hint: string } {
  if (!t.coverage.usage) {
    return {
      title: 'No usage on file.',
      hint: `nflverse published no weekly snap or target data for the ${t.usageSeason} season, so there is no tape to read. Nothing here is estimated in its place.`,
    };
  }

  const played = t.weekTo - t.windowFrom + 1;
  if (played < t.minGames) {
    return {
      title: 'Too early to read anything.',
      hint: `Only ${played === 1 ? 'one week' : `${played} weeks`} of the ${t.usageSeason} season sits inside the window, and ${t.minGames} games are the least a usage reading can be taken from. Come back after week ${t.windowFrom + t.minGames - 1}.`,
    };
  }

  return {
    title: 'Nothing could be ranked.',
    hint: `nflverse filed ${t.coverage.usage} usage histories and ${t.coverage.snaps} snap counts, but none of them joined to enough players at a position to rank against each other. Nothing here is estimated in its place.`,
  };
}

/**
 * What this page is reading, said plainly.
 *
 * The season is stated first because it is the thing a chart can most easily
 * lie about: out of season these lines are last year's usage, and a reader who
 * assumes otherwise draws exactly the wrong conclusion about a rookie.
 */
function note(t: TapeResponse): string {
  const parts: string[] = [];

  parts.push(
    t.inSeason
      ? `Usage from the ${t.usageSeason} season, judged on weeks ${t.windowFrom}–${t.weekTo}; the lines show every week from ${t.weekFrom}${
          t.windowFrom > t.weekFrom ? ' and the upright marks where the window starts' : ''
        }.`
      : `No games are being played, so this is the whole ${t.usageSeason} season, weeks ${t.weekFrom}–${t.weekTo}. Week 18 is left out: it is when playoff teams rest starters, and reading it as usage says nothing about a role.`
  );

  parts.push(
    'Usage and production are ranked against other players at the same position, then the gap is turned back into points. Quarterbacks are left out — every starter plays every snap, so their usage does not vary enough to rank.'
  );

  // The commonest question this page gets: why is a row marked "in line"
  // sitting near the top of a list about divergence.
  parts.push(
    'Rows are ordered by what the gap is worth. A row marked in line has usage and scoring at much the same rank — the points gap there comes from the shape of the position, not from a player the market has mispriced.'
  );

  if (t.pointsPerReception > 0) {
    parts.push(`Points are scored at ${t.pointsPerReception} per reception, as this league does.`);
  }

  parts.push(
    t.coverage.usage
      ? `Reading ${t.coverage.usage} usage histories and ${t.coverage.snaps} snap counts from nflverse.`
      : 'nflverse returned nothing, so no usage was read.'
  );

  // The two nflverse files are joined by name and they do not name quite the
  // same people. Ranking a man on target share alone put him at the bottom of
  // his position whatever his role, so those rows are left out — and left out
  // silently would be its own lie about how complete this list is.
  if (t.withoutSnaps > 0) {
    parts.push(
      `${t.withoutSnaps} player${t.withoutSnaps === 1 ? '' : 's'} played but had no snap count to read, so ${t.withoutSnaps === 1 ? 'he is' : 'they are'} absent rather than ranked on target share alone.`
    );
  }

  if (t.rows.length >= t.limit) {
    parts.push(`Capped at the ${t.limit} biggest gaps of ${t.considered} ranked.`);
  }

  return parts.join(' ');
}

function emptyHint(own: Ownership, pos: PositionFilter, t: TapeResponse): string {
  if (own === 'mine' && !t.hasRoster) {
    return 'You do not have a roster in this league, so nothing here is yours.';
  }
  if (own === 'mine') {
    return `None of your ${pos === 'ALL' ? 'players' : pos + 's'} are in the ${t.limit} biggest gaps. That is usually good news.`;
  }
  if (own === 'free') {
    return `No unrostered ${pos === 'ALL' ? 'player' : pos} made the list — in a deep league the wire is often genuinely empty.`;
  }
  return 'Try a wider filter.';
}
