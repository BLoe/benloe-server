/**
 * Freeze a league's board to disk.
 *
 * Run this BEFORE a draft. Afterwards the app needs no network for anything on
 * the critical path; the server never calls this on a request, and re-running it
 * mid-draft is pointless.
 *
 * Two ways to name a league, because only one of the two platforms is readable:
 *
 *   npm run snapshot -- 1389704095224315904 columbus   # Sleeper league id
 *   npm run snapshot -- leagues/yahoo.json             # a definition file
 *
 * Projections come from Sleeper either way. They are projections of NFL
 * players, not of a fantasy platform, so a league Gavel cannot read is still
 * priced from the same source under its own scoring rules.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getLeague,
  getUsers,
  getDrafts,
  getProjections,
  getByeWeeks,
  getAuctionHistory,
} from '../src/sources/sleeper.js';
import { leagueFromSleeper } from '../src/lib/seed.js';
import { buildBoard, projectionsFor } from '../src/lib/board.js';
import { buildPriceCurve, curveFromPrices, type PastAuction, type PriceCurve } from '../src/lib/history.js';
import { fetchMarketValues } from '../src/sources/fantasycalc.js';
import { valueBoard, type PlayerProjection } from '../src/lib/valuation.js';
import { startingDemand, type LeagueConfig } from '../src/lib/league.js';

const DATA_DIR = process.env.GAVEL_DATA_DIR || '/srv/benloe/data/gavel';

interface Seeded {
  cfg: LeagueConfig;
  teams: Array<{ teamId: string; name: string }>;
  draftStartTime: number | null;
  /** Completed auctions this league has run, for price calibration. */
  history: PastAuction[];
}

/** A league we can read: settings, managers and auction budget all come back. */
async function fromSleeper(leagueId: string, slug: string): Promise<Seeded> {
  const [league, users, drafts] = await Promise.all([
    getLeague(leagueId),
    getUsers(leagueId),
    getDrafts(leagueId),
  ]);
  const auction = drafts.find((d) => d.type === 'auction') ?? drafts[0] ?? null;
  // What this room has actually paid, walking previous_league_id. Best effort:
  // a league in its first season simply has none.
  const history = await getAuctionHistory(leagueId).catch(() => [] as PastAuction[]);

  return {
    cfg: leagueFromSleeper(league, auction?.settings ?? null, slug),
    teams: users.map((u) => ({
      teamId: u.user_id,
      name: u.metadata?.team_name || u.display_name,
    })),
    draftStartTime: auction?.start_time ?? null,
    history,
  };
}

/**
 * A league we cannot read, described by hand.
 *
 * Team names are placeholders on purpose — they are renamed in the app, which
 * is also where keeper salaries are entered. Nothing here needs to be right on
 * the first pass except the scoring map and the roster shape, because those two
 * are the only inputs to the money.
 */
async function fromFile(path: string): Promise<Seeded> {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const names: string[] = Array.isArray(raw.teamNames) ? raw.teamNames : [];
  const cfg: LeagueConfig = {
    id: raw.id,
    name: raw.name,
    platform: raw.platform ?? 'yahoo',
    platformLeagueId: raw.platformLeagueId ?? null,
    season: String(raw.season),
    teams: Number(raw.teams),
    budget: Number(raw.budget),
    minBid: Number(raw.minBid ?? 1),
    slots: raw.slots,
    scoring: raw.scoring,
  };
  /**
   * A league Gavel cannot read can still be calibrated, by hand.
   *
   * `history` in the definition file takes the same shape the Sleeper walk
   * produces: one entry per season, each a list of {position, price}. Player
   * ids are not needed — the curve only cares HOW MANY of each position went
   * and WHAT EACH RANK COST. So last year's results, typed or pasted from the
   * platform's own draft recap, calibrate the board as well as an API would.
   *
   * This matters more than it sounds: without it the fallback is a market
   * curve, and a market curve run through this pipeline inherits the pipeline's
   * own top-heaviness rather than correcting it.
   */
  const history: PastAuction[] = Array.isArray(raw.history)
    ? raw.history
        .map((season: any) => ({
          season: String(season?.season ?? 'past'),
          picks: (Array.isArray(season?.picks) ? season.picks : [])
            .map((p: any) => ({
              playerId: String(p?.playerId ?? ''),
              position: String(p?.position ?? ''),
              price: Number(p?.price),
            }))
            .filter((p: any) => p.position && Number.isFinite(p.price) && p.price > 0),
        }))
        .filter((s: PastAuction) => s.picks.length > 0)
    : [];

  return {
    cfg,
    teams: Array.from({ length: cfg.teams }, (_, i) => ({
      teamId: `t${i + 1}`,
      name: names[i] ?? `Team ${i + 1}`,
    })),
    draftStartTime: raw.draftStartTime ?? null,
    history,
  };
}

/**
 * A price curve derived from market values rather than from this league.
 *
 * The market's values are run through the SAME budget-clearing pipeline as the
 * model, so what comes back is a set of dollar prices in this league's own
 * shape — which is then used exactly as a season of history would be. Reusing
 * the pipeline is the point: there is one definition of how value becomes
 * money, and the market does not get a second one.
 */
async function marketCurve(
  cfg: LeagueConfig,
  projections: Awaited<ReturnType<typeof getProjections>>,
  byes: Record<string, number>
): Promise<PriceCurve | null> {
  const ppr = Number(cfg.scoring?.rec ?? 0);
  const market = await fetchMarketValues({ numTeams: cfg.teams, numQbs: cfg.slots.QB, ppr });
  if (market.length === 0) return null;

  const byId = new Map(market.map((m) => [m.sleeperId, m.redraftValue]));
  // Same player universe as the real board, so the two are commensurable.
  const shadow: PlayerProjection[] = [];
  for (const p of projectionsFor(projections, cfg, byes)) {
    const value = byId.get(p.id);
    if (value === undefined) continue;
    shadow.push({ ...p, points: value });
  }
  if (shadow.length < cfg.teams * 8) return null;

  const priced = valueBoard(shadow, cfg)
    .filter((v) => v.baseValue > 0)
    .map((v) => ({ position: v.position, price: v.baseValue }));
  // A market curve is already expressed in this league's own shape, so its
  // source starting requirement is this league's.
  return curveFromPrices(priced, ['market'], startingDemand(cfg));
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: npm run snapshot -- <sleeperLeagueId> <slug>');
    console.error('       npm run snapshot -- <path/to/league.json>');
    process.exit(1);
  }

  const seeded = target.endsWith('.json')
    ? await fromFile(target)
    : await fromSleeper(target, process.argv[3] || 'sleeper');
  const { cfg, teams, draftStartTime, history } = seeded;

  const [projections, byes] = await Promise.all([
    getProjections(cfg.season),
    getByeWeeks(cfg.season),
  ]);
  // A league's own auctions beat any market. Only when there are none does the
  // market get consulted, and the board records which of the two it used.
  let curve: PriceCurve | null = buildPriceCurve(history, cfg);
  let calibration = curve ? { source: 'league history', seasons: curve.seasons } : null;

  /*
   * Borrow another league's price curve.
   *
   * For a league whose own auctions cannot be read. What transfers is the
   * SHAPE — how steeply prices fall inside a position — because that is a
   * property of auctions in general, and every real one is less top-heavy than
   * a naive value model predicts. What does not transfer is how much each
   * position costs; `valueBoard` rescales each position back to this league's
   * own model spend before blending, so a 3-WR league does not inherit a 4-WR
   * league's receiver budget.
   */
  const borrow = process.env.GAVEL_CURVE_FROM;
  if (!curve && borrow) {
    const [lent, lender] = await Promise.all([
      getAuctionHistory(borrow).catch(() => [] as PastAuction[]),
      getLeague(borrow).catch(() => null),
    ]);
    // The lender's own roster shape matters: it is what tells the blend that
    // both leagues start one defence but a different number of receivers.
    const lenderCfg = lender ? leagueFromSleeper(lender, null, 'lender') : undefined;
    curve = buildPriceCurve(lent, cfg, lenderCfg);
    if (curve) calibration = { source: `borrowed curve from league ${borrow}`, seasons: curve.seasons };
  }

  if (!curve) {
    curve = await marketCurve(cfg, projections, byes).catch(() => null);
    if (curve) calibration = { source: 'market (FantasyCalc)', seasons: curve.seasons };
  }

  const { players, values } = buildBoard(projections, cfg, byes, { curve });

  await mkdir(DATA_DIR, { recursive: true });
  const out = join(DATA_DIR, `snapshot-${cfg.id}.json`);
  await writeFile(
    out,
    JSON.stringify(
      {
        capturedAt: Date.now(),
        league: cfg,
        draftStartTime,
        teams,
        values,
        // Stated on the board so it never implies a calibration it does not have.
        calibration: curve && calibration ? { ...calibration, counts: curve.counts } : null,
      },
      null,
      2
    )
  );

  const priced = values.filter((v) => v.baseValue > 0);
  const total = priced.reduce((sum, v) => sum + v.baseValue, 0);
  console.log(`league     ${cfg.name} (${cfg.platform})`);
  console.log(`teams      ${cfg.teams} x $${cfg.budget}`);
  console.log(`slots      ${JSON.stringify(cfg.slots)}`);
  console.log(`players    ${players.length} projected, ${priced.length} priced`);
  console.log(`allocated  $${total.toFixed(0)} of $${cfg.teams * cfg.budget}`);
  console.log(
    calibration
      ? `calibrated  ${calibration.source} [${calibration.seasons.join(', ')}] ${JSON.stringify(curve!.counts)}`
      : 'calibrated  NOTHING — uncalibrated model prices'
  );
  console.log(`wrote      ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
