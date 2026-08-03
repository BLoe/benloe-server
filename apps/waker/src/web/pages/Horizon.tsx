import { useState } from 'react';
import { useApi } from '../api';
import { ErrorNote, Loading, Sheet } from '../components';
import { Board, BoardTable, type BoardPlayer, type ValueMode } from '../Board';

interface BoardTeam {
  rosterId: number;
  teamName: string;
  wins: number;
  losses: number;
  mine: boolean;
  orientation: {
    index: number;
    label: 'win-now' | 'balanced' | 'building';
    dynastyValue: number;
    redraftValue: number;
    unpriced: number;
  };
  players: BoardPlayer[];
}

interface BoardResponse {
  teams: BoardTeam[];
  myRosterId: number | null;
  coverage: { joined: number; fantasyCalc: number; ktc: number };
}

/**
 * HORIZON — what this roster is becoming.
 *
 * The board leads because the shape of a roster is the answer to most dynasty
 * questions, and it is the one thing a list cannot show.
 */
export default function Horizon({ league }: { league: { leagueId: string } }) {
  const [mode, setMode] = useState<ValueMode>('dynasty');
  const [rosterId, setRosterId] = useState<number | null>(null);
  const board = useApi<BoardResponse>(`/api/league/${league.leagueId}/board`);

  if (board.loading) return <Loading label="Plotting the board" />;
  if (board.error) return <ErrorNote message={board.error} />;
  if (!board.data?.teams.length) return null;

  const teams = board.data.teams;
  const selected =
    teams.find((t) => t.rosterId === (rosterId ?? board.data!.myRosterId)) ?? teams[0];

  return (
    <>
      <Sheet
        title="The board"
        count={`${selected.players.length} rostered`}
        note="Age runs left to right because time does; value runs bottom to top. Mark size is projected points, so a player who is expensive and produces reads heavier than one who is only expensive. A contender and a rebuild are different shapes."
      >
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--rule)]">
          <label className="flex items-center gap-2 min-w-0">
            <span className="label shrink-0">Roster</span>
            <select
              value={selected.rosterId}
              onChange={(e) => setRosterId(Number(e.target.value))}
              className="slab bg-transparent outline-none cursor-pointer min-w-0 truncate"
              style={{ fontSize: 'var(--t-body)' }}
            >
              {teams.map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.teamName}
                  {t.mine ? ' — you' : ''}
                </option>
              ))}
            </select>
          </label>

          <span
            className="fig ml-auto"
            style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)' }}
          >
            {selected.orientation.label.replace('-', ' ')} ·{' '}
            {Math.round(selected.orientation.dynastyValue / 1000)}k dynasty ·{' '}
            {Math.round(selected.orientation.redraftValue / 1000)}k redraft
          </span>
        </div>

        <Board players={selected.players} mode={mode} onModeChange={setMode} />
      </Sheet>

      <Sheet title="Where every roster sits" note="Built to win now on the right, built for later on the left. Bar length is total dynasty value, so a big rebuild and a thin one are visibly different things.">
        <OrientationRule teams={teams} />
      </Sheet>

      <Sheet title={`${selected.teamName} in full`}>
        <BoardTable players={selected.players} mode={mode} />
      </Sheet>
    </>
  );
}

/**
 * Every roster on one axis: built for later on the left, built for now on the
 * right. The single most useful league-wide picture in dynasty, because it says
 * who is buying and who is selling before anyone has said so out loud.
 */
function OrientationRule({ teams }: { teams: BoardTeam[] }) {
  const maxValue = Math.max(1, ...teams.map((t) => t.orientation.dynastyValue));
  const span = Math.max(0.12, ...teams.map((t) => Math.abs(t.orientation.index)));

  return (
    <div className="px-4 py-3">
      <div className="flex justify-between mb-2">
        <span className="label">Building</span>
        <span className="label">Win now</span>
      </div>

      <div className="space-y-1.5">
        {[...teams]
          .sort((a, b) => a.orientation.index - b.orientation.index)
          .map((t) => {
            // Position along the axis, 0-1, from the index.
            const at = 0.5 + (t.orientation.index / span) * 0.5;
            const width = (t.orientation.dynastyValue / maxValue) * 100;
            return (
              <div key={t.rosterId} className="flex items-center gap-3">
                <span
                  className="truncate shrink-0"
                  style={{
                    width: 168,
                    fontSize: 'var(--t-meta)',
                    fontWeight: t.mine ? 600 : 400,
                    color: t.mine ? 'var(--alarm)' : 'var(--ink)',
                  }}
                >
                  {t.teamName}
                </span>

                <div className="relative flex-1" style={{ height: 12 }}>
                  {/* Centre line: the balanced position. */}
                  <div
                    className="absolute inset-y-0"
                    style={{ left: '50%', width: 1, background: 'var(--rule-strong)' }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{
                      left: `${Math.max(0, Math.min(100, at * 100))}%`,
                      transform: 'translate(-50%, -50%)',
                      width: Math.max(6, (width / 100) * 26),
                      height: Math.max(6, (width / 100) * 26),
                      background: t.mine ? 'var(--alarm)' : 'var(--depth)',
                      opacity: t.mine ? 1 : 0.65,
                      borderRadius: 2,
                    }}
                    title={`${t.teamName}: ${t.orientation.label}, ${Math.round(t.orientation.dynastyValue / 1000)}k dynasty value`}
                  />
                </div>

                <span
                  className="fig shrink-0 text-right"
                  style={{ width: 52, fontSize: 'var(--t-meta)', color: 'var(--graphite)' }}
                >
                  {Math.round(t.orientation.dynastyValue / 1000)}k
                </span>
                <span
                  className="fig shrink-0 text-right"
                  style={{ width: 40, fontSize: 'var(--t-meta)', color: 'var(--faint)' }}
                >
                  {t.wins}-{t.losses}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
