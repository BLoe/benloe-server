import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(__dirname, '../../prisma/gamenight.db');
const db: Database.Database = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  minPlayers INTEGER NOT NULL,
  maxPlayers INTEGER NOT NULL,
  duration INTEGER,
  complexity REAL,
  bggId INTEGER UNIQUE,
  imageUrl TEXT,
  description TEXT,
  bestWith TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT,
  gameId TEXT NOT NULL,
  dateTime DATETIME NOT NULL,
  location TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  creatorId TEXT NOT NULL,
  commitmentDeadline DATETIME,
  parentEventId TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gameId) REFERENCES games (id),
  FOREIGN KEY (parentEventId) REFERENCES events (id)
);

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMMITTED',
  joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE,
  UNIQUE(eventId, userId)
);

CREATE TABLE IF NOT EXISTS recurring_patterns (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL,
  interval INTEGER NOT NULL DEFAULT 1,
  endDate DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_reminders (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  userId TEXT NOT NULL,
  reminderAt DATETIME NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'BEFORE_EVENT',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE,
  UNIQUE(eventId, userId, type)
);

CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Create indices for better performance
db.exec(`
CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
CREATE INDEX IF NOT EXISTS idx_events_datetime ON events(dateTime);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_creator ON events(creatorId);
CREATE INDEX IF NOT EXISTS idx_commitments_user ON commitments(userId);
CREATE INDEX IF NOT EXISTS idx_commitments_event ON commitments(eventId);
`);

function generateId(): string {
  return 'cuid_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

export interface Game {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  duration?: number;
  complexity?: number;
  bggId?: number;
  imageUrl?: string;
  description?: string;
  bestWith?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  title?: string;
  gameId: string;
  dateTime: string;
  location?: string;
  description?: string;
  status: 'OPEN' | 'FULL' | 'CANCELLED' | 'COMPLETED';
  creatorId: string;
  commitmentDeadline?: string;
  parentEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventWithGame extends Event {
  game: Game;
  commitments: Commitment[];
  committedCount: number;
  waitlistedCount: number;
  spotsAvailable: number;
  isFull: boolean;
}

export interface Commitment {
  id: string;
  eventId: string;
  userId: string;
  status: 'COMMITTED' | 'WAITLISTED' | 'DECLINED';
  joinedAt: string;
  notes?: string;
}

// Game service functions
export const gameService = {
  getAll: () => {
    return db.prepare('SELECT * FROM games ORDER BY name ASC').all() as Game[];
  },

  getById: (id: string) => {
    return db.prepare('SELECT * FROM games WHERE id = ?').get(id) as Game | undefined;
  },

  create: (data: Omit<Game, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = generateId();
    const now = new Date().toISOString();
    const game = { ...data, id, createdAt: now, updatedAt: now };

    db.prepare(
      `
      INSERT INTO games (id, name, minPlayers, maxPlayers, duration, complexity, bggId, imageUrl, description, bestWith, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      game.id,
      game.name,
      game.minPlayers,
      game.maxPlayers,
      game.duration,
      game.complexity,
      game.bggId,
      game.imageUrl,
      game.description,
      game.bestWith,
      game.createdAt,
      game.updatedAt
    );

    return game;
  },

  update: (id: string, data: Partial<Omit<Game, 'id' | 'createdAt'>>) => {
    const updatedAt = new Date().toISOString();
    const fields = Object.keys(data).filter((key) => key !== 'id' && key !== 'createdAt');
    const values = fields.map((field) => data[field as keyof typeof data]);
    const setClause = fields.map((field) => `${field} = ?`).join(', ');

    db.prepare(`UPDATE games SET ${setClause}, updatedAt = ? WHERE id = ?`).run(
      ...values,
      updatedAt,
      id
    );

    return gameService.getById(id);
  },

  delete: (id: string) => {
    const result = db.prepare('DELETE FROM games WHERE id = ?').run(id);
    return result.changes > 0;
  },
};

// Event service functions
export const eventService = {
  getAll: (startDate?: Date, endDate?: Date) => {
    let query = `
      SELECT e.*, g.name as game_name, g.minPlayers, g.maxPlayers, g.imageUrl as game_imageUrl
      FROM events e 
      JOIN games g ON e.gameId = g.id
    `;
    const params: any[] = [];

    if (startDate && endDate) {
      query += ' WHERE e.dateTime >= ? AND e.dateTime <= ?';
      params.push(startDate.toISOString(), endDate.toISOString());
    }

    query += ' ORDER BY e.dateTime ASC';

    const events = db.prepare(query).all(...params) as any[];

    return events.map((row) => {
      const event: Event = {
        id: row.id,
        title: row.title,
        gameId: row.gameId,
        dateTime: row.dateTime,
        location: row.location,
        description: row.description,
        status: row.status,
        creatorId: row.creatorId,
        commitmentDeadline: row.commitmentDeadline,
        parentEventId: row.parentEventId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      const game: Game = {
        id: row.gameId,
        name: row.game_name,
        minPlayers: row.minPlayers,
        maxPlayers: row.maxPlayers,
        imageUrl: row.game_imageUrl,
        duration: 0,
        createdAt: '',
        updatedAt: '',
      };

      const commitments = commitmentService.getByEventId(event.id);
      const committedCount = commitments.filter((c) => c.status === 'COMMITTED').length;
      const waitlistedCount = commitments.filter((c) => c.status === 'WAITLISTED').length;
      const spotsAvailable = game.maxPlayers - committedCount;

      return {
        ...event,
        game,
        commitments,
        committedCount,
        waitlistedCount,
        spotsAvailable,
        isFull: spotsAvailable <= 0,
      } as EventWithGame;
    });
  },

  getById: (id: string) => {
    const row = db
      .prepare(
        `
      SELECT e.*, g.name as game_name, g.minPlayers, g.maxPlayers, g.imageUrl as game_imageUrl
      FROM events e 
      JOIN games g ON e.gameId = g.id 
      WHERE e.id = ?
    `
      )
      .get(id) as any;

    if (!row) return undefined;

    const event: Event = {
      id: row.id,
      title: row.title,
      gameId: row.gameId,
      dateTime: row.dateTime,
      location: row.location,
      description: row.description,
      status: row.status,
      creatorId: row.creatorId,
      commitmentDeadline: row.commitmentDeadline,
      parentEventId: row.parentEventId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    const game: Game = {
      id: row.gameId,
      name: row.game_name,
      minPlayers: row.minPlayers,
      maxPlayers: row.maxPlayers,
      imageUrl: row.game_imageUrl,
      duration: 0,
      createdAt: '',
      updatedAt: '',
    };

    const commitments = commitmentService.getByEventId(event.id);
    const committedCount = commitments.filter((c) => c.status === 'COMMITTED').length;
    const waitlistedCount = commitments.filter((c) => c.status === 'WAITLISTED').length;
    const spotsAvailable = game.maxPlayers - committedCount;

    return {
      ...event,
      game,
      commitments,
      committedCount,
      waitlistedCount,
      spotsAvailable,
      isFull: spotsAvailable <= 0,
    } as EventWithGame;
  },

  create: (data: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = generateId();
    const now = new Date().toISOString();
    const event = { ...data, id, createdAt: now, updatedAt: now };

    db.prepare(
      `
      INSERT INTO events (id, title, gameId, dateTime, location, description, status, creatorId, commitmentDeadline, parentEventId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      event.id,
      event.title,
      event.gameId,
      event.dateTime,
      event.location,
      event.description,
      event.status,
      event.creatorId,
      event.commitmentDeadline,
      event.parentEventId,
      event.createdAt,
      event.updatedAt
    );

    return eventService.getById(id);
  },

  update: (id: string, data: Partial<Omit<Event, 'id' | 'createdAt'>>) => {
    const updatedAt = new Date().toISOString();
    const fields = Object.keys(data).filter((key) => key !== 'id' && key !== 'createdAt');
    const values = fields.map((field) => data[field as keyof typeof data]);
    const setClause = fields.map((field) => `${field} = ?`).join(', ');

    if (fields.length > 0) {
      db.prepare(`UPDATE events SET ${setClause}, updatedAt = ? WHERE id = ?`).run(
        ...values,
        updatedAt,
        id
      );
    }

    return eventService.getById(id);
  },
};

// Commitment service functions
export const commitmentService = {
  getByEventId: (eventId: string) => {
    return db
      .prepare('SELECT * FROM commitments WHERE eventId = ? ORDER BY joinedAt ASC')
      .all(eventId) as Commitment[];
  },

  getByUserId: (userId: string) => {
    return db
      .prepare('SELECT * FROM commitments WHERE userId = ? ORDER BY joinedAt DESC')
      .all(userId) as Commitment[];
  },

  getUserCommitmentForEvent: (eventId: string, userId: string) => {
    return db
      .prepare('SELECT * FROM commitments WHERE eventId = ? AND userId = ?')
      .get(eventId, userId) as Commitment | undefined;
  },

  create: (data: Omit<Commitment, 'id' | 'joinedAt'>) => {
    const id = generateId();
    const joinedAt = new Date().toISOString();
    const commitment = { ...data, id, joinedAt };

    db.prepare(
      `
      INSERT INTO commitments (id, eventId, userId, status, joinedAt, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      commitment.id,
      commitment.eventId,
      commitment.userId,
      commitment.status,
      commitment.joinedAt,
      commitment.notes
    );

    return commitment;
  },

  update: (id: string, data: Partial<Omit<Commitment, 'id'>>) => {
    const fields = Object.keys(data).filter((key) => key !== 'id');
    const values = fields.map((field) => data[field as keyof typeof data]);
    const setClause = fields.map((field) => `${field} = ?`).join(', ');

    db.prepare(`UPDATE commitments SET ${setClause} WHERE id = ?`).run(...values, id);

    return db.prepare('SELECT * FROM commitments WHERE id = ?').get(id) as Commitment;
  },

  delete: (id: string) => {
    const result = db.prepare('DELETE FROM commitments WHERE id = ?').run(id);
    return result.changes > 0;
  },

  countCommittedForEvent: (eventId: string) => {
    const result = db
      .prepare('SELECT COUNT(*) as count FROM commitments WHERE eventId = ? AND status = ?')
      .get(eventId, 'COMMITTED') as any;
    return result.count;
  },
};

// Recurring pattern interface
export interface RecurringPattern {
  id: string;
  eventId: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  endDate?: string;
  createdAt: string;
}

// Recurring pattern service functions
export const recurringPatternService = {
  getByEventId: (eventId: string) => {
    return db.prepare('SELECT * FROM recurring_patterns WHERE eventId = ?').get(eventId) as
      | RecurringPattern
      | undefined;
  },

  create: (data: Omit<RecurringPattern, 'id' | 'createdAt'>) => {
    const id = generateId();
    const createdAt = new Date().toISOString();
    const pattern = { ...data, id, createdAt };

    db.prepare(
      `
      INSERT INTO recurring_patterns (id, eventId, frequency, interval, endDate, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      pattern.id,
      pattern.eventId,
      pattern.frequency,
      pattern.interval,
      pattern.endDate,
      pattern.createdAt
    );

    return pattern;
  },

  update: (id: string, data: Partial<Omit<RecurringPattern, 'id' | 'createdAt'>>) => {
    const fields = Object.keys(data).filter((key) => key !== 'id' && key !== 'createdAt');
    const values = fields.map((field) => data[field as keyof typeof data]);
    const setClause = fields.map((field) => `${field} = ?`).join(', ');

    if (fields.length > 0) {
      db.prepare(`UPDATE recurring_patterns SET ${setClause} WHERE id = ?`).run(...values, id);
    }

    return db.prepare('SELECT * FROM recurring_patterns WHERE id = ?').get(id) as RecurringPattern;
  },

  delete: (id: string) => {
    const result = db.prepare('DELETE FROM recurring_patterns WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deleteByEventId: (eventId: string) => {
    const result = db.prepare('DELETE FROM recurring_patterns WHERE eventId = ?').run(eventId);
    return result.changes > 0;
  },
};

export { db };
