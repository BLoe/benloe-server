import { useApi, signed } from './api';
import { Empty, ErrorNote, Loading, Pos, Sheet } from './components';

/**
 * THE LEDGER — surplus meets need, turned into named trades.
 *
 * A roster page tells you who you have. It cannot tell you that your third
 * quarterback scores nothing for you all season and is worth a starting running
 * back to the manager in eighth place, because that fact lives between two
 * rosters rather than on either one.
 *
 * So this reads as a ledger and not as a roster: two facing columns, what is
 * spare on the left of the argument and who needs it on the right, with both
 * sides' gain in the same unit and both market prices printed beside them. The
 * other manager's gain is given the same weight as yours on purpose. A proposal
 * that is only good for you is not a trade, it is a message that gets ignored,
 * and a page that hid their side would generate those all day.
 */

interface PricedPlayer {
  playerId: string;
  name: string;
  position: string | null;
  points: number;
  value: number | null;
  redraft: number | null;
  team: string | null;
  age: number | null;
}

interface StandingRow {
  position: string;
  startable: number;
  slots: number;
  spare: number;
  starterVor: number;
  needy: boolean;
  replacement: number | null;
  surplus: PricedPlayer[];
}

type Price = 'unpriced' | 'even' | 'you-pay' | 'you-gain';

interface MatchRow {
  rosterId: number;
  teamName: string;
  position: string;
  give: PricedPlayer;
  getPosition: string | null;
  get: PricedPlayer | null;
  theirGain: number;
  yourGain: number;
  theirCurrent: { name: string; points: number } | null;
  yourCurrent: { name: string; points: number } | null;
  theirBaseline: number;
  yourBaseline: number | null;
  giveValue: number | null;
  getValue: number | null;
  price: Price;
  valueGap: number | null;
}

interface PickYear {
  year: string;
  picks: Array<{ name: string; value: number; overallRank: number }>;
}

interface LedgerResponse {
  myRosterId: number;
  teamName: string;
  numTeams: number;
  standings: StandingRow[];
  matches: MatchRow[];
  picks: PickYear[];
  noFitReason: string | null;
  projectionsOut: boolean;
  coverage: {
    counted: number;
    unavailable: number;
    unprojected: number;
    priced: number;
    dismissed: number;
    pool: number;
    poolProjected: number;
    picks: number;
    market: { fantasyCalc: number; ktc: number; joined: number };
  };
}

export function LedgerPanel({ league }: { league: { leagueId: string } }) {
  const ledger = useApi<LedgerResponse>(`/api/league/${league.leagueId}/ledger`);

  if (ledger.loading) return <Loading label="Reading the ledger" />;
  if (ledger.error) return <ErrorNote message={ledger.error} />;
  if (!ledger.data) return null;

  const d = ledger.data;

  // With no projections there is no replacement level, so nobody clears it and
  // every position on every roster reads as thin. That is a fact about a dead
  // upstream, not about a roster, and the page must not spend three panels
  // implying otherwise.
  if (d.projectionsOut) {
    return (
      <Sheet title="Where you are deep, where you are thin">
        <Empty
          title="No projections, so no ledger."
          hint="The projection feed returned nothing for any player in the league, and surplus is defined against it. Nothing can be said about depth, and no trade can be proposed, until it answers again."
        />
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        title="Where you are deep, where you are thin"
        count={`${d.coverage.counted} active`}
        note={depthNote(d)}
      >
        <DepthTable rows={d.standings} />
      </Sheet>

      <Sheet
        title="Who wants what you have"
        count={d.matches.length ? `${d.matches.length} fit${d.matches.length === 1 ? '' : 's'}` : undefined}
        note={d.matches.length ? MATCH_NOTE : undefined}
      >
        <Matches matches={d.matches} reason={d.noFitReason} dismissed={d.coverage.dismissed} />
      </Sheet>

      <Sheet
        title="What a pick is worth"
        count={d.coverage.picks ? `${d.coverage.picks} priced` : undefined}
        note={d.picks.length ? PICK_NOTE : undefined}
      >
        <Picks years={d.picks} />
      </Sheet>
    </>
  );
}

/**
 * What the trade list is and is not claiming.
 *
 * Two caveats have to be here rather than left for the reader to discover. The
 * gain is measured against the best player the other manager already has at the
 * position, so a team who is only thin at a second slot shows a smaller gain
 * than the deal is really worth — the number is a floor, not an estimate. And a
 * spare player is offered to every team who could use him, so the rows are
 * alternatives rather than a list of trades to make.
 */
const MATCH_NOTE =
  'Their gain is measured the same way yours is: points per week over the best they already have at that slot, or over a freely available player where that is higher. It is a floor — a team thin only at a second slot gains more than the figure shown. The same spare player is offered to everyone who could use him, so these are alternatives, not a shopping list.';

/**
 * The pick prices are KeepTradeCut's and the player prices are FantasyCalc's.
 *
 * These are different scales and saying otherwise would be the most expensive
 * lie on the page: in this league's own data Drake London prices at 5,719 on
 * FantasyCalc and 7,387 on KeepTradeCut, against a 2026 early first at 6,203.
 * Read across the two and you conclude the pick beats the player, when on a
 * single scale it does not.
 */
const PICK_NOTE =
  'KeepTradeCut, which is the only source here that prices picks at all. These are on KeepTradeCut’s scale and the player values above are on FantasyCalc’s, so rank picks against each other with them — not a pick against a player.';

/** What the depth table is and is not counting. Said, never implied. */
function depthNote(d: LedgerResponse): string {
  const parts = [
    'Startable means projected above replacement level — what a freely available player at that position gives you. A fourth receiver below that line is a bench body, not surplus.',
  ];
  if (d.coverage.unavailable) {
    parts.push(
      `${d.coverage.unavailable} of your players sit on the taxi squad or on IR and are not counted: they cannot fill a slot.`
    );
  }
  if (d.coverage.unprojected) {
    parts.push(
      `${d.coverage.unprojected} have no projection on file and count as zero, which will read as thinner than you are.`
    );
  }
  if (d.coverage.priced < d.coverage.counted) {
    parts.push(`${d.coverage.counted - d.coverage.priced} carry no market price.`);
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ *
 * Depth
 * ------------------------------------------------------------------ */

function DepthTable({ rows }: { rows: StandingRow[] }) {
  if (!rows.length) {
    return (
      <Empty
        title="No lineup to read."
        hint="This league's roster positions did not load, so there is nothing to measure depth against."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <TallyLegend />
      {/* A minimum width so a narrow screen scrolls the table sideways rather
          than crushing the spare column into one word per line. */}
      <table className="w-full" style={{ fontSize: 'var(--t-meta)', minWidth: 760 }}>
        <thead>
          <tr className="border-b border-[var(--rule)]">
            <th className="label text-left px-4 py-1.5">Pos</th>
            <th className="label text-right px-2 py-1.5">Startable</th>
            <th className="label text-right px-2 py-1.5">Slots</th>
            <th className="label text-left px-2 py-1.5">Tally</th>
            <th className="label text-right px-2 py-1.5">Repl / wk</th>
            <th className="label text-left px-4 py-1.5">Spare, and what they add</th>
          </tr>
        </thead>
        <tbody className="banded">
          {rows.map((row) => (
            <tr key={row.position} className="align-top">
              <td className="px-4 py-2">
                <Pos pos={row.position} />
              </td>
              <td className="fig px-2 py-2 text-right">{row.startable}</td>
              <td className="fig px-2 py-2 text-right" style={{ color: 'var(--graphite)' }}>
                {row.slots}
              </td>
              <td className="px-2 py-2">
                <Tally startable={row.startable} slots={row.slots} spare={row.spare} />
              </td>
              <td className="fig px-2 py-2 text-right" style={{ color: 'var(--graphite)' }}>
                {row.replacement == null ? '—' : row.replacement.toFixed(1)}
              </td>
              <td className="px-4 py-2">
                <SpareCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How wide the tally is allowed to get before it starts counting in words. */
const TALLY_CAP = 8;

const TALLY_KEY = [
  { fill: 'var(--depth)', label: 'in a slot' },
  { fill: 'var(--pos-flex)', label: 'in a flex' },
  { fill: 'var(--gain)', label: 'spare' },
  { fill: null, label: 'unfilled' },
];

function TallyLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-[var(--rule)]">
      {TALLY_KEY.map((k) => (
        <li key={k.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 12,
              display: 'block',
              background: k.fill ?? 'transparent',
              border: k.fill ? 'none' : '1px solid var(--loss)',
            }}
          />
          <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--graphite)' }}>
            {k.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The tally: one mark per startable player, coloured by where he actually ends
 * up — a fixed slot, a flex, or nowhere. It carries no number the columns either
 * side do not already carry; it is there so a page of positions can be compared
 * by shape rather than by reading six figures.
 *
 * The middle band matters. A fourth receiver who is only startable because the
 * lineup has three flexes is not spare, and colouring him the same as a genuine
 * surplus player is how a page talks a manager into trading a starter.
 */
function Tally({ startable, slots, spare }: { startable: number; slots: number; spare: number }) {
  const filled = Math.min(startable, slots);
  const flexed = Math.max(0, startable - slots - spare);
  const unfilled = Math.max(0, slots - startable);

  const marks: Array<string | null> = [
    ...Array<string>(filled).fill('var(--depth)'),
    ...Array<string>(flexed).fill('var(--pos-flex)'),
    ...Array<string>(spare).fill('var(--gain)'),
    ...Array<null>(unfilled).fill(null),
  ];
  // Cap the drawing, not the count. A roster with nine startable receivers is a
  // real thing and would otherwise push the table sideways.
  const shown = marks.slice(0, TALLY_CAP);

  // Every mark is decorative on its own, so the row is described once, in full,
  // rather than read out as a run of blank cells. The count is the uncapped one:
  // the drawing is allowed to elide, the description is not.
  const description =
    [
      filled && `${filled} in a slot`,
      flexed && `${flexed} in a flex`,
      spare && `${spare} spare`,
      unfilled && `${unfilled} unfilled`,
    ]
      .filter(Boolean)
      .join(', ') || 'nobody startable and no slot to fill';

  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={description}>
      {shown.map((fill, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            width: 7,
            height: 12,
            display: 'block',
            background: fill ?? 'transparent',
            border: fill ? 'none' : '1px solid var(--loss)',
          }}
        />
      ))}
      {marks.length > TALLY_CAP && (
        <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
          +{marks.length - TALLY_CAP}
        </span>
      )}
    </span>
  );
}

function SpareCell({ row }: { row: StandingRow }) {
  if (row.needy) {
    return (
      <span style={{ color: 'var(--loss)' }}>
        Thin — {row.slots - row.startable} slot{row.slots - row.startable === 1 ? '' : 's'} you cannot
        fill above replacement.
      </span>
    );
  }
  if (!row.surplus.length) {
    return (
      <span style={{ color: 'var(--faint)' }}>
        Nothing spare — the lineup and the flexes absorb everyone startable.
      </span>
    );
  }

  return (
    <ul className="space-y-1">
      {row.surplus.map((p) => {
        const over = row.replacement == null ? null : p.points - row.replacement;
        return (
          <li key={p.playerId} className="flex flex-wrap items-baseline gap-x-2">
            <span style={{ fontWeight: 500 }}>{p.name}</span>
            <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
              {p.team ?? 'FA'}
              {p.age != null && ` · ${p.age}y`}
            </span>
            <span className="fig" style={{ color: 'var(--graphite)' }}>
              {p.points.toFixed(1)}/wk
            </span>
            {over != null && (
              <span
                className="fig"
                style={{ fontSize: 'var(--t-tick)', color: over > 0.5 ? 'var(--gain)' : 'var(--faint)' }}
                title="Points per week above a freely available player at this position"
              >
                {signed(over)} over repl
              </span>
            )}
            <span className="fig ml-auto shrink-0" style={{ color: 'var(--graphite)' }}>
              {p.value == null ? (
                'unpriced'
              ) : (
                <>
                  {p.value.toLocaleString()}
                  <span style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}> dyn</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * The trades
 * ------------------------------------------------------------------ */

function Matches({
  matches,
  reason,
  dismissed,
}: {
  matches: MatchRow[];
  reason: string | null;
  dismissed: number;
}) {
  if (!matches.length) {
    return (
      <Empty
        title="Nothing to propose."
        hint={reason ?? 'No surplus met a need anywhere in the league.'}
      />
    );
  }

  return (
    <div>
      {matches.map((m) => (
        <MatchRowView key={`${m.rosterId}-${m.give.playerId}-${m.get?.playerId ?? 'none'}`} match={m} />
      ))}
      {dismissed > 0 && (
        <p
          className="px-4 py-2.5 border-t border-[var(--rule)]"
          style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}
        >
          {dismissed} further fit{dismissed === 1 ? ' was' : 's were'} found and dropped: the other
          roster already starts somebody who projects as well, so the deal gains them nothing.
        </p>
      )}
    </div>
  );
}

/** How the market prices the swap, in words the reader can argue with. */
const PRICE_WORD: Record<Price, string> = {
  unpriced: 'nothing set against it yet',
  even: 'an even price',
  'you-pay': 'you pay up',
  'you-gain': 'value your way',
};

function MatchRowView({ match: m }: { match: MatchRow }) {
  return (
    <article
      className="grid gap-x-3 px-4 py-3 border-b border-[var(--rule)] last:border-b-0"
      style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
    >
      <span
        aria-hidden="true"
        className="fig select-none pt-0.5"
        style={{ fontSize: 'var(--t-lede)', color: 'var(--rule-strong)', width: 16 }}
      >
        ⇌
      </span>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="label">Talk to</span>
          <span className="slab" style={{ fontSize: 'var(--t-body)' }}>
            {m.teamName}
          </span>
          <span className="label">thin at</span>
          <Pos pos={m.position} />
        </div>

        <h3 className="slab mt-1" style={{ fontSize: 'var(--t-lede)', lineHeight: 1.3 }}>
          Send {m.give.name}
          {m.get ? ` for ${m.get.name}` : ' for value or picks'}
        </h3>

        <div className="mt-1.5 space-y-0.5" style={{ maxWidth: '68ch' }}>
          <Line>
            <Bar
              current={m.theirCurrent}
              baseline={m.theirBaseline}
              position={m.position}
              who="They"
            />{' '}
            {m.give.name} projects {m.give.points.toFixed(1)}, so the slot improves by{' '}
            {m.theirGain.toFixed(1)} a week.
          </Line>

          {m.get && m.getPosition ? (
            <Line>
              Back the other way, {m.get.name} at {m.get.points.toFixed(1)} fills your {m.getPosition}
              .{' '}
              <Bar
                current={m.yourCurrent}
                baseline={m.yourBaseline ?? 0}
                position={m.getPosition}
                who="You"
              />{' '}
              You gain {m.yourGain.toFixed(1)} a week.
            </Line>
          ) : (
            <Line>
              They have nothing spare that fills a hole of yours, so this one comes back as picks or
              as a player you rate rather than as a straight swap.
            </Line>
          )}

          <Line>
            Market: {m.give.name} {price(m.giveValue)}
            {m.get ? `, ${m.get.name} ${price(m.getValue)}` : ''} — {PRICE_WORD[m.price]}
            {m.valueGap != null && m.price !== 'even'
              ? ` by ${Math.abs(m.valueGap).toLocaleString()}`
              : ''}
            .
          </Line>
        </div>
      </div>

      {/* Both gains, same column, same unit. Theirs is not smaller than yours. */}
      <div className="shrink-0 text-right" style={{ minWidth: 104 }}>
        <Gain label="You" value={m.yourGain} />
        <div className="mt-2">
          <Gain label={short(m.teamName)} value={m.theirGain} />
        </div>
        <div className="label mt-1.5" style={{ letterSpacing: '.1em' }}>
          PTS / WK
        </div>
      </div>
    </article>
  );
}

/**
 * The bar a gain is measured against, said out loud.
 *
 * Without it the sentence is three numbers that do not add up: "they start
 * somebody at 2.8, yours projects 10.0, the slot improves by 4.3". The missing
 * term is that a manager who is thin can add a freely available player for
 * nothing, so replacement level — not the body on their bench — is the bar
 * whenever it is higher. A reader who catches this page out on arithmetic is
 * right to stop believing the rest of it.
 */
function Bar({
  current,
  baseline,
  position,
  who,
}: {
  current: { name: string; points: number } | null;
  baseline: number;
  position: string;
  who: 'They' | 'You';
}) {
  const start = who === 'They' ? 'They start' : 'You start';
  const above = current != null && baseline <= current.points + 0.05;

  if (current && above) {
    return (
      <>
        {start} {current.name} at {current.points.toFixed(1)} a week, the best {position} on the
        roster, which is the bar.
      </>
    );
  }
  return (
    <>
      {current
        ? `${start} ${current.name} at ${current.points.toFixed(1)} a week, but a freely available ${position} gives ${baseline.toFixed(1)}`
        : `${start} nobody at ${position}, and a freely available one gives ${baseline.toFixed(1)}`}
      , so that is the bar.
    </>
  );
}

function Gain({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="label truncate" style={{ maxWidth: 104 }}>
        {label}
      </div>
      <div
        className="fig leading-none"
        style={{
          fontSize: 'var(--t-figure)',
          fontWeight: 600,
          color: value > 0 ? 'var(--gain)' : 'var(--faint)',
        }}
      >
        {signed(value)}
      </div>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)', lineHeight: 1.5 }}>{children}</p>
  );
}

const price = (v: number | null) => (v == null ? 'has no price on file' : `at ${v.toLocaleString()}`);

/** Team names run long; the figure column has room for a word or two. */
const short = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name);

/* ------------------------------------------------------------------ *
 * Picks
 * ------------------------------------------------------------------ */

function Picks({ years }: { years: PickYear[] }) {
  if (!years.length) {
    return (
      <Empty
        title="No pick prices."
        hint="KeepTradeCut did not answer, so draft picks are unpriced. It is the only source here that carries them — the player values above are unaffected."
      />
    );
  }

  return (
    <div className="grid gap-x-6 gap-y-4 px-4 py-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      {years.map((y) => (
        <div key={y.year}>
          <div className="label mb-1 pb-1 border-b border-[var(--rule)]">{y.year}</div>
          <table className="w-full" style={{ fontSize: 'var(--t-meta)' }}>
            <thead className="sr-only">
              <tr>
                <th>Pick</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {y.picks.map((p) => (
                <tr key={p.name}>
                  {/* The year is already the column heading, so it is dropped
                      from every row rather than repeated twelve times. */}
                  <td className="py-0.5 truncate">{p.name.replace(/^\d{4}\s+/, '')}</td>
                  <td className="fig py-0.5 text-right" style={{ color: 'var(--graphite)' }}>
                    {p.value.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
