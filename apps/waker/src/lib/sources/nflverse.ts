/**
 * nflverse — the play-level truth behind the box score.
 *
 * Fantasy points are an *outcome*. Snap share is an *input*, and inputs move
 * first: a back whose snaps go 35% to 70% is about to score more, and his
 * points will not say so for another two weeks. Everything expensive in Waker
 * — buy-low, sell-high, waiver priority — is built on that lag.
 *
 * The data ships as CSVs on GitHub releases. They are a few MB, published
 * weekly, and are disk-cached for hours rather than fetched per request.
 *
 * The join is the weak point: nflverse keys on `pfr_player_id` / `gsis_id`, and
 * Sleeper keys on its own ids. There is no published crosswalk, so matching
 * falls back to normalised name plus position plus team. `normaliseName` strips
 * punctuation and generational suffixes because "A.J. Brown" and "AJ Brown" and
 * "Marvin Harrison Jr." all show up across these feeds.
 */
import { fetchText } from './http.js';

const RELEASE = 'https://github.com/nflverse/nflverse-data/releases/download';

/* ------------------------------------------------------------------ *
 * CSV
 *
 * Hand-rolled rather than a dependency: these files are machine-generated and
 * regular, and a parser small enough to read is easier to trust than a package.
 * It does handle quoted fields, because team names and injury notes contain
 * commas.
 * ------------------------------------------------------------------ */

export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitRows(text);
  if (!rows.length) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // A trailing newline yields one empty row; a truncated download yields a
    // short one. Neither should become a half-populated record.
    if (cells.length !== header.length) continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = cells[c];
    out.push(rec);
  }
  return out;
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

/** Lowercase, strip punctuation and suffixes so "A.J. Brown" matches "AJ Brown". */
export function normaliseName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === '' || v === 'NA') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ *
 * Snap counts — the leading indicator
 * ------------------------------------------------------------------ */

export interface SnapWeek {
  week: number;
  /** Share of the offense's snaps, 0-1. The number that matters. */
  offensePct: number;
  offenseSnaps: number;
  opponent: string | null;
}

export interface SnapRow {
  name: string;
  key: string;
  position: string | null;
  team: string | null;
  weeks: SnapWeek[];
}

export function parseSnapCounts(csv: string): SnapRow[] {
  const byPlayer = new Map<string, SnapRow>();

  for (const r of parseCsv(csv)) {
    if (r.game_type && r.game_type !== 'REG') continue;
    const week = num(r.week);
    const pct = num(r.offense_pct);
    if (week == null) continue;

    // A player can be listed with zero offensive snaps in a game he only played
    // special teams. That is real information — it is not the same as absent —
    // so a null pct becomes 0 rather than being dropped.
    const key = normaliseName(r.player);
    let row = byPlayer.get(key);
    if (!row) {
      row = { name: r.player, key, position: r.position || null, team: r.team || null, weeks: [] };
      byPlayer.set(key, row);
    }
    row.team = r.team || row.team;
    row.weeks.push({
      week,
      offensePct: pct ?? 0,
      offenseSnaps: num(r.offense_snaps) ?? 0,
      opponent: r.opponent || null,
    });
  }

  for (const row of byPlayer.values()) row.weeks.sort((a, b) => a.week - b.week);
  return [...byPlayer.values()];
}

export async function fetchSnapCounts(season: string): Promise<SnapRow[]> {
  return parseSnapCounts(await fetchText(`${RELEASE}/snap_counts/snap_counts_${season}.csv`, 60_000));
}

/* ------------------------------------------------------------------ *
 * Weekly usage — targets, share, and the points they produced
 *
 * `stats_player_week` is the right file for this and the advanced-stats one is
 * not: PFR's weekly receiving table carries broken tackles and drops but no
 * targets and no air yards, which are the two numbers that actually describe a
 * role. This file has target share and air-yards share already computed
 * against the player's own offense, plus the fantasy points those touches
 * produced — so usage and outcome arrive together and the divergence between
 * them is a subtraction rather than a second join.
 * ------------------------------------------------------------------ */

export interface UsageWeek {
  week: number;
  opponent: string | null;
  carries: number;
  targets: number;
  receptions: number;
  /** Share of the team's targets, 0-1. Role, independent of game script. */
  targetShare: number | null;
  /** Share of the team's air yards, 0-1. Separates a deep threat from a checkdown. */
  airYardsShare: number | null;
  /** Standard-scoring fantasy points, so usage and outcome sit side by side. */
  points: number;
  pointsPpr: number;
}

export interface UsageRow {
  name: string;
  key: string;
  /** nflverse's gsis id, kept for anyone who can use it. */
  gsisId: string | null;
  position: string | null;
  team: string | null;
  weeks: UsageWeek[];
}

export function parseUsage(csv: string): UsageRow[] {
  const byPlayer = new Map<string, UsageRow>();

  for (const r of parseCsv(csv)) {
    if (r.season_type && r.season_type !== 'REG') continue;
    const week = num(r.week);
    if (week == null) continue;

    const name = r.player_display_name || r.player_name;
    const key = normaliseName(name);
    if (!key) continue;

    let row = byPlayer.get(key);
    if (!row) {
      row = {
        name,
        key,
        gsisId: r.player_id || null,
        position: r.position || null,
        team: r.team || null,
        weeks: [],
      };
      byPlayer.set(key, row);
    }
    row.team = r.team || row.team;
    row.weeks.push({
      week,
      opponent: r.opponent_team || null,
      carries: num(r.carries) ?? 0,
      targets: num(r.targets) ?? 0,
      receptions: num(r.receptions) ?? 0,
      targetShare: num(r.target_share),
      airYardsShare: num(r.air_yards_share),
      points: num(r.fantasy_points) ?? 0,
      pointsPpr: num(r.fantasy_points_ppr) ?? 0,
    });
  }

  for (const row of byPlayer.values()) row.weeks.sort((a, b) => a.week - b.week);
  return [...byPlayer.values()];
}

export async function fetchUsage(season: string): Promise<UsageRow[]> {
  return parseUsage(
    await fetchText(`${RELEASE}/stats_player/stats_player_week_${season}.csv`, 90_000)
  );
}

/* ------------------------------------------------------------------ *
 * Injuries — the official report, which is more precise than a status chip
 * ------------------------------------------------------------------ */

export interface InjuryRow {
  key: string;
  name: string;
  team: string | null;
  week: number;
  position: string | null;
  /** Out / Doubtful / Questionable, as filed. */
  status: string | null;
  injury: string | null;
  /** DNP / Limited / Full — the practice week, which leads the game status. */
  practice: string | null;
}

export function parseInjuries(csv: string): InjuryRow[] {
  const out: InjuryRow[] = [];
  for (const r of parseCsv(csv)) {
    const week = num(r.week);
    if (week == null) continue;
    const name = r.full_name || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
    if (!name) continue;
    out.push({
      key: normaliseName(name),
      name,
      team: r.team || null,
      week,
      position: r.position || null,
      status: r.report_status || null,
      injury: r.report_primary_injury || null,
      practice: r.practice_status || null,
    });
  }
  return out;
}

export async function fetchInjuries(season: string): Promise<InjuryRow[]> {
  return parseInjuries(await fetchText(`${RELEASE}/injuries/injuries_${season}.csv`, 60_000));
}
