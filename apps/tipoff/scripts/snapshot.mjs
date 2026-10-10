// Freezes three public 2026-27 projection sets, Yahoo + ESPN ADP and the
// FantasyPros expert consensus to public/players.json. Run before the draft,
// never during it: the board reads only that file.
//
//   ESPN         full line incl. FGM/FGA/FTM/FTA, injury status, outlook
//   CBS          full line incl. FGM/FGA/FTM/FTA
//   FantasyPros  counting stats + FG%/FT%, but no attempts; its attempts are
//                borrowed from the other two (see blend())
//   FP ADP       Yahoo and ESPN ADP, and Yahoo-style position eligibility
//   FP ECR       expert consensus rank for standard 9-cat (with TO, without FGM)
import { writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SEASON = 2027; // ESPN and CBS name a season by the year it ends
const STATS = ['gp', 'min', 'fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export const norm = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z]/g, '');

const text = (h) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const num = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
// Split on the opening tag: FantasyPros' ADP table never closes its rows.
const rows = (html) => html.split(/<tr[\s>]/).slice(1).map((r) => r.split(/<\/tr>|<\/table>/)[0]);
const cells = (row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
const round = (x) => Math.round(x * 100) / 100;

// ---------- ESPN ----------
const ESPN_POS = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' };
const ESPN_STAT = { pts: 0, blk: 1, stl: 2, ast: 3, reb: 6, to: 11, fgm: 13, fga: 14, ftm: 15, fta: 16, tpm: 17, min: 40, gp: 42 };

async function espn() {
  const base = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons';
  const teams = JSON.parse(await fetchText(`${base}/${SEASON}?view=proTeamSchedules_wl`));
  const TEAM = Object.fromEntries(teams.settings.proTeams.map((t) => [t.id, t.abbrev]));
  const filter = {
    players: {
      limit: 500,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${SEASON}`, `10${SEASON}`, `00${SEASON - 1}`] },
    },
  };
  const raw = JSON.parse(await fetchText(`${base}/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`, { 'X-Fantasy-Filter': JSON.stringify(filter) }));
  const line = (avg) => (avg && avg[ESPN_STAT.gp] ? Object.fromEntries(STATS.map((k) => [k, round(avg[ESPN_STAT[k]] ?? 0)])) : null);
  const out = new Map();
  for (const { player: p } of raw.players) {
    const stat = (id) => p.stats?.find((s) => s.id === id)?.averageStats;
    out.set(norm(p.fullName), {
      espnId: p.id,
      name: p.fullName,
      team: TEAM[p.proTeamId] ?? 'FA',
      pos: p.eligibleSlots.filter((s) => s in ESPN_POS).map((s) => ESPN_POS[s]),
      adpLive: p.ownership?.averageDraftPosition ? round(p.ownership.averageDraftPosition) : null,
      injury: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : null,
      outlook: p.seasonOutlook || '',
      line: line(stat(`10${SEASON}`)),
      last: line(stat(`00${SEASON - 1}`)),
    });
  }
  return out;
}

// ---------- CBS ----------
// Season totals; one page per position, 100 deep each, overlapping.
const CBS_COL = { gp: 1, min: 4, fgm: 6, fga: 7, ftm: 9, fta: 10, tpm: 12, pts: 15, reb: 17, ast: 19, stl: 21, to: 23, blk: 25 };

async function cbs() {
  const out = new Map();
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
    const html = await fetchText(`https://www.cbssports.com/fantasy/basketball/stats/${pos}/${SEASON}/season/projections/`);
    for (const r of rows(html)) {
      const c = cells(r);
      if (c.length < 26) continue;
      const name = text(c[0].match(/CellPlayerName--long[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1] ?? '');
      const gp = num(text(c[1]));
      if (!name || !gp) continue;
      const line = { gp: round(gp), cbs: true };
      for (const k of STATS) if (k !== 'gp') line[k] = round(num(text(c[CBS_COL[k]])) / gp);
      out.set(norm(name), { name, line });
    }
  }
  return out;
}

// ---------- FantasyPros ----------
async function fantasyProsProjections() {
  const html = await fetchText('https://www.fantasypros.com/nba/projections/overall.php');
  const out = new Map();
  // Player, PTS, REB, AST, BLK, STL, FG%, FT%, 3PM, GP, MIN, TO — season totals
  for (const r of rows(html)) {
    const c = cells(r);
    if (c.length < 12) continue;
    const name = c[0].match(/fp-player-name="([^"]+)"/)?.[1];
    const gp = num(text(c[9]));
    if (!name || !gp) continue;
    const pg = (i) => round(num(text(c[i])) / gp);
    out.set(norm(name), {
      name,
      line: { gp, min: pg(10), pts: pg(1), reb: pg(2), ast: pg(3), blk: pg(4), stl: pg(5), tpm: pg(8), to: pg(11), fgp: num(text(c[6])), ftp: num(text(c[7])) },
    });
  }
  return out;
}

// Yahoo-style eligibility, e.g. "(DAL - PF,SF,SG)". FantasyPros mirrors Yahoo's
// positions far more closely than ESPN does (ESPN has Flagg SF/PF only).
const fpLabel = (cell) => {
  const m = text(cell).match(/\(([A-Z]+) - ([A-Z,]+)\)/);
  return m ? { team: m[1], pos: m[2].split(',') } : null;
};

async function fantasyProsAdp() {
  const html = await fetchText('https://www.fantasypros.com/nba/adp/overall.php');
  const out = new Map();
  for (const r of rows(html)) {
    const c = cells(r);
    if (c.length < 5) continue;
    const name = c[1].match(/fp-player-name="([^"]+)"/)?.[1];
    if (!name) continue;
    const yahoo = num(text(c[2])) || null;
    const espnAdp = num(text(c[3])) || null;
    out.set(norm(name), { name, yahoo, espn: espnAdp, ...fpLabel(c[1]) });
  }
  return out;
}

async function fantasyProsEcr() {
  const html = await fetchText('https://www.fantasypros.com/nba/rankings/overall.php');
  const json = html.match(/ecrData = (\{[\s\S]*?\});\s*\n/)?.[1];
  if (!json) throw new Error('FantasyPros ECR: ecrData not found');
  const out = new Map();
  for (const p of JSON.parse(json).players) out.set(norm(p.player_name), { ecr: Number(p.rank_ecr), pos: p.player_positions.split(',') });
  return out;
}

// ---------- Blend ----------
// Plain mean per stat over the sources that have the player. Percentages are
// blended through makes and attempts, never averaged directly. FantasyPros
// has no attempts, so it contributes its FG%/FT% applied to the mean attempts
// of the sources that do.
function blend(lines) {
  const full = lines.filter((l) => l && 'fga' in l);
  const fp = lines.find((l) => l && 'fgp' in l);
  if (!full.length) return null; // shooting volume unknown; cannot value FGM or the percentages
  const avg = (k, ls) => ls.reduce((s, l) => s + l[k], 0) / ls.length;
  const all = full.concat(fp ? [fp] : []);
  const out = {};
  for (const k of ['min', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to']) out[k] = round(avg(k, all));
  // CBS projects ~78 games for nearly everyone, which says nothing about
  // health; it votes on games only when it is the only source.
  const gpVoters = all.filter((l) => !l.cbs);
  out.gp = round(avg('gp', gpVoters.length ? gpVoters : all));
  const fga = avg('fga', full);
  const fta = avg('fta', full);
  const fgPct = (full.reduce((s, l) => s + l.fgm, 0) + (fp ? fp.fgp * fga : 0)) / (full.reduce((s, l) => s + l.fga, 0) + (fp ? fga : 0));
  const ftPct = (full.reduce((s, l) => s + l.ftm, 0) + (fp ? fp.ftp * fta : 0)) / (full.reduce((s, l) => s + l.fta, 0) + (fp ? fta : 0));
  Object.assign(out, { fga: round(fga), fgm: round(fga * (fgPct || 0)), fta: round(fta), ftm: round(fta * (ftPct || 0)) });
  return out;
}

// FantasyPros' line made whole with the blended attempts, so it can be valued
// on its own for the source-disagreement column.
function completeFp(fp, blended) {
  if (!fp || !blended) return null;
  return { ...fp, fga: blended.fga, fgm: round(fp.fgp * blended.fga), fta: blended.fta, ftm: round(fp.ftp * blended.fta) };
}

function median(xs) {
  const v = xs.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
}

async function main() {
  const [E, C, F, A, R] = await Promise.all([espn(), cbs(), fantasyProsProjections(), fantasyProsAdp(), fantasyProsEcr()]);
  const keys = new Set([...E.keys(), ...C.keys(), ...F.keys()]);
  const players = [];
  for (const k of keys) {
    const e = E.get(k), c = C.get(k), f = F.get(k), a = A.get(k), r = R.get(k);
    const proj = blend([e?.line, c?.line, f?.line]);
    if (!proj || proj.min < 8) continue;
    const name = e?.name ?? f?.name ?? c?.name;
    players.push({
      id: e?.espnId ?? `x-${k}`,
      name,
      team: e?.team ?? a?.team ?? 'FA',
      pos: a?.pos ?? r?.pos ?? e?.pos ?? [],
      adpYahoo: a?.yahoo ?? null,
      adpEspn: e?.adpLive ?? a?.espn ?? null,
      ecr: r?.ecr ?? null,
      // Where the room will take him: the median of what we have. Yahoo's ADP
      // is from early September and thin (AJ Green at 46), ESPN's is live but
      // from another platform, ECR is experts. The median shrugs off any one.
      adp: median([a?.yahoo, e?.adpLive ?? a?.espn, r?.ecr]),
      injury: e?.injury ?? null,
      outlook: e?.outlook ?? '',
      proj,
      src: { espn: e?.line ?? null, cbs: c?.line ?? null, fp: completeFp(f?.line, proj) },
      last: e?.last ?? null,
    });
  }
  const counts = { espn: E.size, cbs: C.size, fantasypros: F.size, adp: A.size, ecr: R.size, players: players.length };
  const missing = [...A.values()].filter((a) => a.yahoo && a.yahoo <= 150 && !players.some((p) => norm(p.name) === norm(a.name))).map((a) => a.name);
  const out = new URL('../public/players.json', import.meta.url);
  writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), counts, players }));
  console.log(counts);
  if (missing.length) console.log('Yahoo top-150 with no projection:', missing.join(', '));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
