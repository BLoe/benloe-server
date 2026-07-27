/**
 * Unauthenticated endpoints: the rating game and the shareable lineup page.
 *
 * Nothing here exposes a numeric rating. The game deals in matchups, and the
 * lineup page deals in names and positions.
 */

import { Router } from 'express';
import type { DB } from '../db';
import { readSettings } from '../db';
import { STATS, POSITIONS, getStat } from '../engine/domain';
import { Rng } from '../engine/rng';
import { pairKey, selectMatchup } from '../engine/ratings';
import type { MatchupContext } from '../engine/ratings';
import { computeRatings, listPlayers } from '../services/lineup';

export function publicRoutes(db: DB): Router {
  const router = Router();

  router.get('/team', (_req, res) => {
    const settings = readSettings(db);
    res.json({
      teamName: settings.team_name,
      innings: settings.innings,
      passcodeRequired: settings.rating_game_passcode.length > 0,
    });
  });

  /** The roster, for the "who are you?" step. Names only. */
  router.get('/raters', (_req, res) => {
    const players = listPlayers(db, { activeOnly: true });
    res.json({ players: players.map((p) => ({ id: p.id, name: p.name })) });
  });

  router.post('/passcode', (req, res) => {
    const settings = readSettings(db);
    const supplied = String(req.body?.passcode ?? '');
    if (!settings.rating_game_passcode) {
      res.json({ ok: true });
      return;
    }
    if (supplied === settings.rating_game_passcode) {
      res.json({ ok: true });
      return;
    }
    res.status(403).json({ error: "That code doesn't match. Ask whoever shared the link." });
  });

  function checkPasscode(supplied: unknown): boolean {
    const settings = readSettings(db);
    if (!settings.rating_game_passcode) return true;
    return String(supplied ?? '') === settings.rating_game_passcode;
  }

  /**
   * The next comparison to show.
   *
   * `seen` carries the pairs this rater has just been shown so the game does
   * not circle back to the same two people twice in a row.
   */
  router.get('/matchup', (req, res) => {
    if (!checkPasscode(req.query.passcode)) {
      res.status(403).json({ error: 'Passcode required.' });
      return;
    }

    const players = listPlayers(db, { activeOnly: true });
    if (players.length < 2) {
      res.status(409).json({ error: 'There need to be at least two players on the roster.' });
      return;
    }

    const ids = players.map((p) => p.id);
    const table = computeRatings(db, { playerIds: ids });

    const pairRows = db
      .prepare('SELECT stat_key, player_a, player_b, COUNT(*) AS n FROM comparisons GROUP BY stat_key, player_a, player_b')
      .all() as { stat_key: string; player_a: string; player_b: string; n: number }[];

    const perStatPairs = new Map<string, Map<string, number>>();
    const perStatTotal = new Map<string, number>();
    for (const stat of STATS) {
      perStatPairs.set(stat.key, new Map());
      perStatTotal.set(stat.key, 0);
    }
    for (const row of pairRows) {
      const pairs = perStatPairs.get(row.stat_key);
      if (!pairs) continue;
      const key = pairKey(row.player_a, row.player_b);
      pairs.set(key, (pairs.get(key) ?? 0) + row.n);
      perStatTotal.set(row.stat_key, (perStatTotal.get(row.stat_key) ?? 0) + row.n);
    }

    const contexts: MatchupContext[] = STATS.map((stat) => ({
      statKey: stat.key,
      ratings: table.get(stat.key) ?? new Map(),
      comparisonCount: perStatTotal.get(stat.key) ?? 0,
      pairCounts: perStatPairs.get(stat.key) ?? new Map(),
    }));

    const seen = new Set(
      String(req.query.seen ?? '')
        .split(',')
        .filter(Boolean)
    );

    // Fresh entropy per request; the matchup should not repeat on reload.
    const rng = new Rng(`${Date.now()}:${Math.random()}`);
    let matchup = selectMatchup(contexts, rng, { exclude: seen });
    if (!matchup) matchup = selectMatchup(contexts, rng);
    if (!matchup) {
      res.status(409).json({ error: 'No matchups left to show.' });
      return;
    }

    const nameOf = new Map(players.map((p) => [p.id, p.name]));
    const stat = getStat(matchup.statKey)!;
    res.json({
      stat: { key: stat.key, name: stat.name, category: stat.category, prompt: stat.prompt, description: stat.description },
      playerA: { id: matchup.playerA, name: nameOf.get(matchup.playerA) },
      playerB: { id: matchup.playerB, name: nameOf.get(matchup.playerB) },
      pairKey: pairKey(matchup.playerA, matchup.playerB),
    });
  });

  router.post('/comparison', (req, res) => {
    const body = req.body ?? {};
    if (!checkPasscode(body.passcode)) {
      res.status(403).json({ error: 'Passcode required.' });
      return;
    }

    const { statKey, playerA, playerB, winnerId, raterId } = body as {
      statKey?: string;
      playerA?: string;
      playerB?: string;
      winnerId?: string | null;
      raterId?: string | null;
    };

    if (!statKey || !getStat(statKey)) {
      res.status(400).json({ error: 'Unknown stat.' });
      return;
    }
    if (!playerA || !playerB || playerA === playerB) {
      res.status(400).json({ error: 'A comparison needs two different players.' });
      return;
    }
    if (winnerId != null && winnerId !== playerA && winnerId !== playerB) {
      res.status(400).json({ error: 'The winner has to be one of the two players shown.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM players WHERE id = ? AND active = 1');
    if (!exists.get(playerA) || !exists.get(playerB)) {
      res.status(400).json({ error: 'One of those players is no longer on the roster.' });
      return;
    }
    const rater = raterId && exists.get(raterId) ? raterId : null;

    db.prepare(
      `INSERT INTO comparisons (stat_key, player_a, player_b, winner_id, rater_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(statKey, playerA, playerB, winnerId ?? null, rater, new Date().toISOString());

    const total = (db.prepare('SELECT COUNT(*) AS n FROM comparisons').get() as { n: number }).n;
    const mine = rater
      ? (db.prepare('SELECT COUNT(*) AS n FROM comparisons WHERE rater_id = ?').get(rater) as { n: number }).n
      : 0;

    res.status(201).json({ ok: true, totalComparisons: total, yourComparisons: mine });
  });

  router.get('/progress', (req, res) => {
    const raterId = req.query.raterId ? String(req.query.raterId) : null;
    const total = (db.prepare('SELECT COUNT(*) AS n FROM comparisons').get() as { n: number }).n;
    const mine = raterId
      ? (db.prepare('SELECT COUNT(*) AS n FROM comparisons WHERE rater_id = ?').get(raterId) as { n: number }).n
      : 0;
    const players = listPlayers(db, { activeOnly: true }).length;
    // Every pair, on every stat, is the theoretical ceiling.
    const universe = players >= 2 ? ((players * (players - 1)) / 2) * STATS.length : 0;
    res.json({ totalComparisons: total, yourComparisons: mine, universe });
  });

  /** A published lineup, by slug. Positions and names, never numbers. */
  router.get('/lineup/:slug', (req, res) => {
    const game = db
      .prepare("SELECT * FROM games WHERE slug = ? AND status = 'published'")
      .get(req.params.slug) as
      | {
          id: string;
          played_on: string;
          opponent: string;
          first_pitch: string;
          field: string;
          notes: string;
          summary: string;
        }
      | undefined;

    if (!game) {
      res.status(404).json({ error: 'No published lineup at that link.' });
      return;
    }

    const settings = readSettings(db);
    const players = new Map(listPlayers(db).map((p) => [p.id, p.name]));

    const battingRows = db
      .prepare('SELECT slot, player_id FROM batting_slots WHERE game_id = ? ORDER BY slot')
      .all(game.id) as { slot: number; player_id: string }[];

    const defenseRows = db
      .prepare('SELECT inning, position_key, player_id FROM defense_assignments WHERE game_id = ? ORDER BY inning')
      .all(game.id) as { inning: number; position_key: string; player_id: string }[];

    const innings: Record<number, Record<string, string>> = {};
    for (const row of defenseRows) {
      innings[row.inning] ??= {};
      innings[row.inning][row.position_key] = row.player_id;
    }

    let summary: { insights?: string[] } = {};
    try {
      summary = JSON.parse(game.summary);
    } catch {
      summary = {};
    }

    const inningList = Object.keys(innings)
      .map(Number)
      .sort((a, b) => a - b)
      .map((inning) => ({
        inning: inning + 1,
        positions: POSITIONS.map((position) => ({
          key: position.key,
          code: position.code,
          name: position.name,
          alias: position.alias ?? null,
          zone: position.zone,
          x: position.x,
          y: position.y,
          playerId: innings[inning][position.key] ?? null,
          playerName: players.get(innings[inning][position.key]) ?? null,
        })),
        bench: battingRows
          .map((r) => r.player_id)
          .filter((id) => !Object.values(innings[inning]).includes(id))
          .map((id) => ({ id, name: players.get(id) ?? 'Unknown' })),
      }));

    res.json({
      teamName: settings.team_name,
      game: {
        playedOn: game.played_on,
        opponent: game.opponent,
        firstPitch: game.first_pitch,
        field: game.field,
        notes: game.notes,
      },
      battingOrder: battingRows.map((row) => ({
        slot: row.slot + 1,
        playerId: row.player_id,
        name: players.get(row.player_id) ?? 'Unknown',
      })),
      innings: inningList,
      insights: summary.insights ?? [],
    });
  });

  return router;
}
