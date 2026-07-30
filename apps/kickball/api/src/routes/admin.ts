/**
 * Manager-only endpoints behind the Artanis session: roster, ratings, league
 * settings, and the week-to-week game workflow.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import { readSettings, writeSetting } from '../db';
import { POSITIONS, STATS, getPosition, getStat } from '../engine/domain';
import type { DefenseLock } from '../engine/defense';
import {
  comparisonCounts,
  computeRatings,
  fitMatrix,
  generateLineup,
  listPlayers,
  seasonHistory,
} from '../services/lineup';

const GENDERS = new Set(['woman', 'man', 'nonbinary']);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function adminRoutes(db: DB): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    res.json({ user: req.user });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      stats: STATS,
      positions: POSITIONS,
      settings: readSettings(db),
    });
  });

  router.patch('/settings', (req, res) => {
    const body = req.body ?? {};
    if (typeof body.team_name === 'string' && body.team_name.trim()) {
      writeSetting(db, 'team_name', body.team_name.trim());
    }
    if (body.innings !== undefined) {
      const innings = Number(body.innings);
      if (!Number.isInteger(innings) || innings < 1 || innings > 12) {
        res.status(400).json({ error: 'Innings must be a whole number between 1 and 12.' });
        return;
      }
      writeSetting(db, 'innings', String(innings));
    }
    if (body.min_women_in_field !== undefined) {
      const min = Number(body.min_women_in_field);
      if (!Number.isInteger(min) || min < 0 || min > POSITIONS.length) {
        res.status(400).json({ error: `The minimum must be between 0 and ${POSITIONS.length}.` });
        return;
      }
      writeSetting(db, 'min_women_in_field', String(min));
    }
    if (body.max_same_gender_run !== undefined) {
      const run = Number(body.max_same_gender_run);
      if (!Number.isInteger(run) || run < 0 || run > 20) {
        res.status(400).json({ error: 'That has to be a whole number between 0 and 20.' });
        return;
      }
      writeSetting(db, 'max_same_gender_run', String(run));
    }
    if (typeof body.rating_game_passcode === 'string') {
      writeSetting(db, 'rating_game_passcode', body.rating_game_passcode.trim());
    }
    if (typeof body.admin_emails === 'string') {
      writeSetting(db, 'admin_emails', body.admin_emails.trim());
    }
    res.json({ settings: readSettings(db) });
  });

  // ---- Roster --------------------------------------------------------------

  router.get('/players', (_req, res) => {
    res.json({ players: listPlayers(db) });
  });

  router.post('/players', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'A player needs a name.' });
      return;
    }
    const gender = GENDERS.has(req.body?.gender) ? req.body.gender : 'man';
    const excluded = Array.isArray(req.body?.excludedPositions)
      ? req.body.excludedPositions.filter((k: unknown) => typeof k === 'string' && getPosition(k))
      : [];
    const nextOrder =
      ((db.prepare('SELECT MAX(sort_order) AS m FROM players').get() as { m: number | null }).m ?? -1) + 1;

    const id = randomUUID();
    db.prepare(
      `INSERT INTO players (id, name, gender, active, excluded_positions, notes, sort_order, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(id, name, gender, JSON.stringify(excluded), String(req.body?.notes ?? ''), nextOrder, new Date().toISOString());

    res.status(201).json({ player: listPlayers(db).find((p) => p.id === id) });
  });

  router.patch('/players/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'No such player.' });
      return;
    }
    const body = req.body ?? {};
    if (typeof body.name === 'string' && body.name.trim()) {
      db.prepare('UPDATE players SET name = ? WHERE id = ?').run(body.name.trim(), req.params.id);
    }
    if (GENDERS.has(body.gender)) {
      db.prepare('UPDATE players SET gender = ? WHERE id = ?').run(body.gender, req.params.id);
    }
    if (body.active !== undefined) {
      db.prepare('UPDATE players SET active = ? WHERE id = ?').run(body.active ? 1 : 0, req.params.id);
    }
    if (Array.isArray(body.excludedPositions)) {
      const excluded = body.excludedPositions.filter((k: unknown) => typeof k === 'string' && getPosition(k));
      db.prepare('UPDATE players SET excluded_positions = ? WHERE id = ?').run(
        JSON.stringify(excluded),
        req.params.id
      );
    }
    if (typeof body.notes === 'string') {
      db.prepare('UPDATE players SET notes = ? WHERE id = ?').run(body.notes, req.params.id);
    }
    res.json({ player: listPlayers(db).find((p) => p.id === req.params.id) });
  });

  router.delete('/players/:id', (req, res) => {
    const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'No such player.' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/players/reorder', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const update = db.prepare('UPDATE players SET sort_order = ? WHERE id = ?');
    db.transaction(() => {
      ids.forEach((id: string, index: number) => update.run(index, id));
    })();
    res.json({ players: listPlayers(db) });
  });

  // ---- Ratings -------------------------------------------------------------

  router.get('/ratings', (req, res) => {
    const includeSelfRatings = req.query.includeSelf !== 'false';
    const players = listPlayers(db);
    const table = computeRatings(db, { includeSelfRatings, playerIds: players.map((p) => p.id) });

    const ratings: Record<string, Record<string, { rating: number; confidence: number; comparisons: number }>> = {};
    for (const stat of STATS) {
      ratings[stat.key] = {};
      for (const player of players) {
        const value = table.get(stat.key)?.get(player.id);
        ratings[stat.key][player.id] = {
          rating: value?.rating ?? 50,
          confidence: value?.confidence ?? 0,
          comparisons: value?.comparisons ?? 0,
        };
      }
    }

    const history = seasonHistory(db);
    res.json({
      ratings,
      counts: comparisonCounts(db),
      fits: fitMatrix(players, table, history),
      history,
    });
  });

  router.get('/comparisons', (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    const rows = db
      .prepare(
        `SELECT c.id, c.stat_key, c.created_at,
                a.name AS player_a_name, b.name AS player_b_name,
                c.winner_id, r.name AS rater_name
           FROM comparisons c
           LEFT JOIN players a ON a.id = c.player_a
           LEFT JOIN players b ON b.id = c.player_b
           LEFT JOIN players r ON r.id = c.rater_id
          ORDER BY c.id DESC LIMIT ?`
      )
      .all(limit);
    res.json({ comparisons: rows });
  });

  router.delete('/comparisons/:id', (req, res) => {
    const result = db.prepare('DELETE FROM comparisons WHERE id = ?').run(Number(req.params.id));
    if (result.changes === 0) {
      res.status(404).json({ error: 'No such comparison.' });
      return;
    }
    res.json({ ok: true });
  });

  // ---- Games ---------------------------------------------------------------

  function loadGame(id: string) {
    return db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | {
          id: string;
          played_on: string;
          opponent: string;
          first_pitch: string;
          field: string;
          notes: string;
          status: string;
          slug: string | null;
          seed: string;
          generated_at: string | null;
          summary: string;
        }
      | undefined;
  }

  function gamePayload(id: string) {
    const game = loadGame(id);
    if (!game) return null;
    const availability = db
      .prepare('SELECT player_id, available FROM availability WHERE game_id = ?')
      .all(id) as { player_id: string; available: number }[];
    const batting = db
      .prepare('SELECT slot, player_id FROM batting_slots WHERE game_id = ? ORDER BY slot')
      .all(id) as { slot: number; player_id: string }[];
    const defense = db
      .prepare('SELECT inning, position_key, player_id, locked FROM defense_assignments WHERE game_id = ?')
      .all(id) as { inning: number; position_key: string; player_id: string; locked: number }[];

    let summary: unknown = {};
    try {
      summary = JSON.parse(game.summary);
    } catch {
      summary = {};
    }

    return {
      game: {
        id: game.id,
        playedOn: game.played_on,
        opponent: game.opponent,
        firstPitch: game.first_pitch,
        field: game.field,
        notes: game.notes,
        status: game.status,
        slug: game.slug,
        generatedAt: game.generated_at,
      },
      availability: availability.filter((a) => a.available === 1).map((a) => a.player_id),
      battingOrder: batting.map((b) => b.player_id),
      defense,
      summary,
    };
  }

  router.get('/games', (_req, res) => {
    const rows = db
      .prepare('SELECT id, played_on, opponent, status, slug, generated_at FROM games ORDER BY played_on DESC, created_at DESC')
      .all() as {
      id: string;
      played_on: string;
      opponent: string;
      status: string;
      slug: string | null;
      generated_at: string | null;
    }[];
    res.json({
      games: rows.map((r) => ({
        id: r.id,
        playedOn: r.played_on,
        opponent: r.opponent,
        status: r.status,
        slug: r.slug,
        generatedAt: r.generated_at,
      })),
    });
  });

  router.post('/games', (req, res) => {
    const playedOn = String(req.body?.playedOn ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) {
      res.status(400).json({ error: 'Pick a date for the game.' });
      return;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO games (id, played_on, opponent, first_pitch, field, notes, status, seed, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '{}', ?)`
    ).run(
      id,
      playedOn,
      String(req.body?.opponent ?? '').trim(),
      String(req.body?.firstPitch ?? '').trim(),
      String(req.body?.field ?? '').trim(),
      String(req.body?.notes ?? '').trim(),
      randomUUID().slice(0, 8),
      new Date().toISOString()
    );

    // Default everyone active to available; unchecking is faster than checking.
    const insert = db.prepare('INSERT INTO availability (game_id, player_id, available) VALUES (?, ?, 1)');
    db.transaction(() => {
      for (const player of listPlayers(db, { activeOnly: true })) insert.run(id, player.id);
    })();

    res.status(201).json(gamePayload(id));
  });

  router.get('/games/:id', (req, res) => {
    const payload = gamePayload(req.params.id);
    if (!payload) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    res.json(payload);
  });

  router.patch('/games/:id', (req, res) => {
    if (!loadGame(req.params.id)) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    const fields: [string, string][] = [
      ['opponent', 'opponent'],
      ['firstPitch', 'first_pitch'],
      ['field', 'field'],
      ['notes', 'notes'],
      ['playedOn', 'played_on'],
    ];
    for (const [key, column] of fields) {
      if (typeof req.body?.[key] === 'string') {
        db.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).run(req.body[key].trim(), req.params.id);
      }
    }
    res.json(gamePayload(req.params.id));
  });

  router.delete('/games/:id', (req, res) => {
    const result = db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    res.json({ ok: true });
  });

  router.put('/games/:id/availability', (req, res) => {
    if (!loadGame(req.params.id)) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    const available = new Set(Array.isArray(req.body?.playerIds) ? req.body.playerIds : []);
    const upsert = db.prepare(
      `INSERT INTO availability (game_id, player_id, available) VALUES (?, ?, ?)
       ON CONFLICT(game_id, player_id) DO UPDATE SET available = excluded.available`
    );
    db.transaction(() => {
      for (const player of listPlayers(db)) {
        upsert.run(req.params.id, player.id, available.has(player.id) ? 1 : 0);
      }
    })();
    res.json(gamePayload(req.params.id));
  });

  /**
   * Regenerates both lineups. Assignments the manager pinned are passed to the
   * optimizer as locks, so a deliberate choice survives a regenerate and
   * everything else is re-solved around it.
   */
  router.post('/games/:id/generate', (req, res) => {
    const game = loadGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }

    const keepLocks = req.body?.keepLocks !== false;
    const locks: DefenseLock[] = keepLocks
      ? (
          db
            .prepare('SELECT inning, position_key, player_id FROM defense_assignments WHERE game_id = ? AND locked = 1')
            .all(req.params.id) as { inning: number; position_key: string; player_id: string }[]
        ).map((r) => ({ inning: r.inning, positionKey: r.position_key, playerId: r.player_id }))
      : [];

    // A new seed each time, so "generate again" actually explores something new.
    const seed = String(req.body?.seed ?? randomUUID().slice(0, 8));

    let result;
    try {
      result = generateLineup(db, req.params.id, { seed, locks });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : 'Could not build a lineup.' });
      return;
    }

    const lockedSet = new Set(locks.map((l) => `${l.inning}:${l.positionKey}`));

    db.transaction(() => {
      db.prepare('DELETE FROM batting_slots WHERE game_id = ?').run(req.params.id);
      db.prepare('DELETE FROM defense_assignments WHERE game_id = ?').run(req.params.id);

      const insertSlot = db.prepare('INSERT INTO batting_slots (game_id, slot, player_id) VALUES (?, ?, ?)');
      result.battingOrder.forEach((playerId, slot) => insertSlot.run(req.params.id, slot, playerId));

      const insertPosition = db.prepare(
        'INSERT INTO defense_assignments (game_id, inning, position_key, player_id, locked) VALUES (?, ?, ?, ?, ?)'
      );
      result.assignment.forEach((row, inning) => {
        row.forEach((playerId, index) => {
          const positionKey = POSITIONS[index].key;
          insertPosition.run(
            req.params.id,
            inning,
            positionKey,
            playerId,
            lockedSet.has(`${inning}:${positionKey}`) ? 1 : 0
          );
        });
      });

      db.prepare('UPDATE games SET seed = ?, generated_at = ?, summary = ? WHERE id = ?').run(
        seed,
        new Date().toISOString(),
        JSON.stringify(result.summary),
        req.params.id
      );
    })();

    res.json(gamePayload(req.params.id));
  });

  /** Manual override of a generated lineup. */
  router.put('/games/:id/lineup', (req, res) => {
    if (!loadGame(req.params.id)) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }

    const battingOrder: string[] = Array.isArray(req.body?.battingOrder) ? req.body.battingOrder : [];
    const defense: { inning: number; positionKey: string; playerId: string; locked?: boolean }[] =
      Array.isArray(req.body?.defense) ? req.body.defense : [];

    // Refuse a lineup that puts the same person in two places at once, rather
    // than silently storing something that cannot be played.
    const perInning = new Map<number, Set<string>>();
    for (const entry of defense) {
      if (!getPosition(entry.positionKey)) {
        res.status(400).json({ error: `Unknown position: ${entry.positionKey}` });
        return;
      }
      const seen = perInning.get(entry.inning) ?? new Set<string>();
      if (seen.has(entry.playerId)) {
        res.status(400).json({ error: `Someone is assigned twice in inning ${entry.inning + 1}.` });
        return;
      }
      seen.add(entry.playerId);
      perInning.set(entry.inning, seen);
    }

    db.transaction(() => {
      if (battingOrder.length > 0) {
        db.prepare('DELETE FROM batting_slots WHERE game_id = ?').run(req.params.id);
        const insert = db.prepare('INSERT INTO batting_slots (game_id, slot, player_id) VALUES (?, ?, ?)');
        battingOrder.forEach((playerId, slot) => insert.run(req.params.id, slot, playerId));
      }
      if (defense.length > 0) {
        db.prepare('DELETE FROM defense_assignments WHERE game_id = ?').run(req.params.id);
        const insert = db.prepare(
          'INSERT INTO defense_assignments (game_id, inning, position_key, player_id, locked) VALUES (?, ?, ?, ?, ?)'
        );
        for (const entry of defense) {
          insert.run(req.params.id, entry.inning, entry.positionKey, entry.playerId, entry.locked ? 1 : 0);
        }
      }
    })();

    res.json(gamePayload(req.params.id));
  });

  router.post('/games/:id/publish', (req, res) => {
    const game = loadGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    const slots = (db.prepare('SELECT COUNT(*) AS n FROM batting_slots WHERE game_id = ?').get(req.params.id) as {
      n: number;
    }).n;
    if (slots === 0) {
      res.status(422).json({ error: 'Generate a lineup before publishing it.' });
      return;
    }

    let slug = game.slug;
    if (!slug) {
      const base = slugify(`${game.played_on} ${game.opponent || 'kickball'}`) || 'lineup';
      slug = `${base}-${randomUUID().slice(0, 6)}`;
    }
    db.prepare("UPDATE games SET status = 'published', slug = ? WHERE id = ?").run(slug, req.params.id);
    res.json(gamePayload(req.params.id));
  });

  router.post('/games/:id/unpublish', (req, res) => {
    if (!loadGame(req.params.id)) {
      res.status(404).json({ error: 'No such game.' });
      return;
    }
    db.prepare("UPDATE games SET status = 'draft' WHERE id = ?").run(req.params.id);
    res.json(gamePayload(req.params.id));
  });

  return router;
}

export { getStat };
