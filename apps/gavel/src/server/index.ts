/**
 * Gavel API.
 *
 * Wiring only. Two rules govern everything in this file:
 *
 *  1. NO NETWORK CALL IS MADE ON ANY REQUEST PATH. Every projection and price
 *     was frozen into the database by `scripts/snapshot.ts` before the draft.
 *     An upstream outage during an auction cannot reach this process.
 *  2. The write path is one INSERT. Derived state — budgets, inflation, max
 *     bids, needs — is computed in the browser from the pick log, so a pick
 *     lands on screen at keystroke speed and a slow server never stalls the
 *     board.
 */
import express from 'express';
import compression from 'compression';
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  openDb,
  getLeagues,
  getLeague,
  upsertLeague,
  listPicks,
  addPick,
  voidPick,
  voidLastPick,
  editPick,
  type Db,
} from './db.js';
import { currentUser, isOwner, requireOwner } from './auth.js';

// gavel's own set. Authentication is delegated to artanis, so this app holds no
// session key at all — there is nothing here to leak.
loadEnv({ path: '/run/benloe-secrets/gavel.env' });

const PORT = Number(process.env.PORT || 3013);
const DATA_DIR = process.env.GAVEL_DATA_DIR || '/srv/benloe/data/gavel';
const DB_PATH = join(DATA_DIR, 'gavel.db');

const db: Db = openDb(DB_PATH);
const app = express();
app.use(compression());
app.use(express.json({ limit: '256kb' }));

/**
 * Load any snapshot files that are on disk but not yet in the database.
 *
 * Runs once at boot, never on a request. This is how a board produced by
 * `npm run snapshot` becomes available to the app.
 */
async function importSnapshots(): Promise<void> {
  const slugs = (process.env.GAVEL_LEAGUES || 'columbus').split(',').map((s) => s.trim());
  for (const slug of slugs) {
    if (!slug) continue;
    const path = join(DATA_DIR, `snapshot-${slug}.json`);
    if (!existsSync(path)) continue;
    try {
      const snap = JSON.parse(await readFile(path, 'utf8'));
      upsertLeague(db, {
        id: slug,
        name: snap.league.name,
        config: snap.league,
        values: snap.values,
        capturedAt: snap.capturedAt,
        draftStartTime: snap.draftStartTime ?? null,
        calibration: snap.calibration ?? null,
      });
      console.log(`[gavel] loaded snapshot ${slug}: ${snap.values.length} players`);
    } catch (err) {
      console.error(`[gavel] snapshot ${slug} failed to load:`, err);
    }
  }
}

const requireAuth = requireOwner();

app.get('/api/health', (_req, res) => {
  const leagues = getLeagues(db);
  res.json({
    ok: true,
    leagues: leagues.map((l) => ({
      id: l.id,
      name: l.name,
      players: l.values.length,
      picks: listPicks(db, l.id).length,
      capturedAt: l.capturedAt,
    })),
    auth: 'artanis',
  });
});

app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  res.json({
    authed: !!user && isOwner(user),
    signedIn: !!user,
    email: user?.email ?? null,
  });
});

app.get('/api/leagues', requireAuth, (_req, res) => {
  res.json({
    leagues: getLeagues(db).map((l) => ({
      id: l.id,
      name: l.name,
      teams: l.config.teams,
      budget: l.config.budget,
      draftStartTime: l.draftStartTime,
    })),
  });
});

/** Everything the board needs, in one response. The client derives the rest. */
app.get('/api/league/:id', requireAuth, (req, res) => {
  const league = getLeague(db, req.params.id);
  if (!league) {
    res.status(404).json({ error: 'No such league.' });
    return;
  }
  res.json({
    id: league.id,
    name: league.name,
    config: league.config,
    values: league.values,
    capturedAt: league.capturedAt,
    draftStartTime: league.draftStartTime,
    calibration: league.calibration,
    picks: listPicks(db, league.id),
  });
});

/** Just the log. Polled cheaply to reconcile a second tab or a recovered tab. */
app.get('/api/league/:id/picks', requireAuth, (req, res) => {
  res.json({ picks: listPicks(db, req.params.id) });
});

app.post('/api/league/:id/picks', requireAuth, (req, res) => {
  const league = getLeague(db, req.params.id);
  if (!league) {
    res.status(404).json({ error: 'No such league.' });
    return;
  }
  const { playerId, price, keeper, mine } = req.body ?? {};
  if (typeof playerId !== 'string') {
    res.status(400).json({ error: 'playerId is required.' });
    return;
  }
  const amount = Number(price);
  if (!Number.isInteger(amount) || amount < 0 || amount > league.config.budget) {
    res.status(400).json({ error: `Price must be a whole number between 0 and ${league.config.budget}.` });
    return;
  }
  // A player already on the board is a double-entry, which is the single most
  // likely mistake during a fast auction. Refuse it rather than corrupt budgets.
  if (listPicks(db, league.id).some((p) => p.playerId === playerId)) {
    res.status(409).json({ error: 'That player is already on the board.' });
    return;
  }
  res.json({
    pick: addPick(db, league.id, { playerId, price: amount, keeper: !!keeper, mine: !!mine }),
  });
});

app.post('/api/league/:id/undo', requireAuth, (req, res) => {
  const undone = voidLastPick(db, req.params.id);
  if (!undone) {
    res.status(404).json({ error: 'Nothing to undo.' });
    return;
  }
  res.json({ undone });
});

app.delete('/api/league/:id/picks/:seq', requireAuth, (req, res) => {
  const ok = voidPick(db, req.params.id, Number(req.params.seq));
  if (!ok) {
    res.status(404).json({ error: 'No such pick.' });
    return;
  }
  res.json({ ok: true });
});

app.patch('/api/league/:id/picks/:seq', requireAuth, (req, res) => {
  const price = req.body?.price === undefined ? undefined : Number(req.body.price);
  if (price !== undefined && (!Number.isInteger(price) || price < 0)) {
    res.status(400).json({ error: 'Price must be a whole number.' });
    return;
  }
  const ok = editPick(db, req.params.id, Number(req.params.seq), {
    price,
    mine: typeof req.body?.mine === 'boolean' ? req.body.mine : undefined,
  });
  if (!ok) {
    res.status(404).json({ error: 'No such pick.' });
    return;
  }
  res.json({ ok: true });
});



const DIST = join(process.cwd(), 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1y' }));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(DIST, 'index.html'));
});

await importSnapshots();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[gavel] listening on 127.0.0.1:${PORT}`);
});
