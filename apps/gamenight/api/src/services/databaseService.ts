import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(__dirname, '../../prisma/gamenight.db');
const db: Database.Database = new Database(dbPath, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
});

// Enable foreign keys and other optimizations
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize database schema with proper error handling
try {
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
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'FULL', 'CANCELLED', 'COMPLETED')),
      creatorId TEXT NOT NULL,
      commitmentDeadline DATETIME,
      parentEventId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gameId) REFERENCES games (id) ON DELETE RESTRICT,
      FOREIGN KEY (parentEventId) REFERENCES events (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      userId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMMITTED' CHECK(status IN ('COMMITTED', 'WAITLISTED', 'DECLINED')),
      joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE,
      UNIQUE(eventId, userId)
    );

    CREATE TABLE IF NOT EXISTS recurring_patterns (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL UNIQUE,
      frequency TEXT NOT NULL CHECK(frequency IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY')),
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
      type TEXT NOT NULL DEFAULT 'BEFORE_EVENT' CHECK(type IN ('BEFORE_EVENT', 'WEEKLY_DIGEST', 'COMMITMENT_DEADLINE')),
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
    CREATE INDEX IF NOT EXISTS idx_games_bggId ON games(bggId);
    CREATE INDEX IF NOT EXISTS idx_events_datetime ON events(dateTime);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_creator ON events(creatorId);
    CREATE INDEX IF NOT EXISTS idx_events_game ON events(gameId);
    CREATE INDEX IF NOT EXISTS idx_commitments_user ON commitments(userId);
    CREATE INDEX IF NOT EXISTS idx_commitments_event ON commitments(eventId);
    CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
    CREATE INDEX IF NOT EXISTS idx_reminders_sent ON event_reminders(sent);
    CREATE INDEX IF NOT EXISTS idx_reminders_reminderAt ON event_reminders(reminderAt);
  `);

  console.log('✅ Database schema initialized successfully');
} catch (error) {
  console.error('❌ Database initialization failed:', error);
  process.exit(1);
}

// Enhanced ID generation with better collision resistance
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `gn_${timestamp}_${random}`;
}

// Type definitions
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

export interface EventWithDetails extends Event {
  game: Game;
  commitments: Commitment[];
  committedCount: number;
  waitlistedCount: number;
  spotsAvailable: number;
  isFull: boolean;
  canJoin: boolean;
}

export interface Commitment {
  id: string;
  eventId: string;
  userId: string;
  status: 'COMMITTED' | 'WAITLISTED' | 'DECLINED';
  joinedAt: string;
  notes?: string;
}

export interface RecurringPattern {
  id: string;
  eventId: string;
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  interval: number;
  endDate?: string;
  createdAt: string;
}

// Enhanced game service with better error handling
export const gameService = {
  getAll: (): Game[] => {
    try {
      return db.prepare('SELECT * FROM games ORDER BY name ASC').all() as Game[];
    } catch (error) {
      console.error('Error fetching games:', error);
      throw new Error('Failed to fetch games');
    }
  },

  getById: (id: string): Game | null => {
    try {
      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as Game | undefined;
      return game || null;
    } catch (error) {
      console.error('Error fetching game by ID:', error);
      throw new Error('Failed to fetch game');
    }
  },

  search: (query: string): Game[] => {
    try {
      return db
        .prepare('SELECT * FROM games WHERE name LIKE ? ORDER BY name ASC')
        .all(`%${query}%`) as Game[];
    } catch (error) {
      console.error('Error searching games:', error);
      throw new Error('Failed to search games');
    }
  },

  create: (data: Omit<Game, 'id' | 'createdAt' | 'updatedAt'>): Game => {
    try {
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
        game.duration || null,
        game.complexity || null,
        game.bggId || null,
        game.imageUrl || null,
        game.description || null,
        game.bestWith || null,
        game.createdAt,
        game.updatedAt
      );

      return game;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Game already exists (duplicate BGG ID)');
      }
      console.error('Error creating game:', error);
      throw new Error('Failed to create game');
    }
  },

  update: (id: string, data: Partial<Omit<Game, 'id' | 'createdAt'>>): Game | null => {
    try {
      const updatedAt = new Date().toISOString();
      const updateData = { ...data, updatedAt };

      const fields = Object.keys(updateData).filter((key) => key !== 'id' && key !== 'createdAt');
      if (fields.length === 0) return gameService.getById(id);

      const values = fields.map((field) => updateData[field as keyof typeof updateData]);
      const setClause = fields.map((field) => `${field} = ?`).join(', ');

      const result = db.prepare(`UPDATE games SET ${setClause} WHERE id = ?`).run(...values, id);

      if (result.changes === 0) {
        return null;
      }

      return gameService.getById(id);
    } catch (error) {
      console.error('Error updating game:', error);
      throw new Error('Failed to update game');
    }
  },

  delete: (id: string): boolean => {
    try {
      const result = db.prepare('DELETE FROM games WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new Error('Cannot delete game: it has associated events');
      }
      console.error('Error deleting game:', error);
      throw new Error('Failed to delete game');
    }
  },
};

// Enhanced event service
export const eventService = {
  getAll: (startDate?: Date, endDate?: Date, status?: string): EventWithDetails[] => {
    try {
      let query = `
        SELECT e.*, g.*,
               g.name as game_name, g.minPlayers, g.maxPlayers, g.imageUrl as game_imageUrl
        FROM events e 
        JOIN games g ON e.gameId = g.id
      `;
      const params: any[] = [];

      const conditions: string[] = [];
      if (startDate && endDate) {
        conditions.push('e.dateTime >= ? AND e.dateTime <= ?');
        params.push(startDate.toISOString(), endDate.toISOString());
      }
      if (status) {
        conditions.push('e.status = ?');
        params.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
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
          duration: row.duration,
          complexity: row.complexity,
          bggId: row.bggId,
          description: row.description,
          bestWith: row.bestWith,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };

        const commitments = commitmentService.getByEventId(event.id);
        const committedCount = commitments.filter((c) => c.status === 'COMMITTED').length;
        const waitlistedCount = commitments.filter((c) => c.status === 'WAITLISTED').length;
        const spotsAvailable = Math.max(0, game.maxPlayers - committedCount);

        return {
          ...event,
          game,
          commitments,
          committedCount,
          waitlistedCount,
          spotsAvailable,
          isFull: spotsAvailable <= 0,
          canJoin: spotsAvailable > 0 && event.status === 'OPEN',
        } as EventWithDetails;
      });
    } catch (error) {
      console.error('Error fetching events:', error);
      throw new Error('Failed to fetch events');
    }
  },

  getById: (id: string): EventWithDetails | null => {
    try {
      const events = eventService.getAll();
      return events.find((e) => e.id === id) || null;
    } catch (error) {
      console.error('Error fetching event by ID:', error);
      throw new Error('Failed to fetch event');
    }
  },

  getByUserId: (userId: string): EventWithDetails[] => {
    try {
      const events = eventService.getAll();
      return events.filter(
        (e) =>
          e.creatorId === userId ||
          e.commitments.some((c) => c.userId === userId && c.status !== 'DECLINED')
      );
    } catch (error) {
      console.error('Error fetching events by user ID:', error);
      throw new Error('Failed to fetch user events');
    }
  },

  create: (data: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): EventWithDetails | null => {
    try {
      const id = generateId();
      const now = new Date().toISOString();
      const event = { ...data, id, createdAt: now, updatedAt: now };

      // Validate game exists
      const game = gameService.getById(event.gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      db.prepare(
        `
        INSERT INTO events (id, title, gameId, dateTime, location, description, status, creatorId, commitmentDeadline, parentEventId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        event.id,
        event.title || null,
        event.gameId,
        event.dateTime,
        event.location || null,
        event.description || null,
        event.status,
        event.creatorId,
        event.commitmentDeadline || null,
        event.parentEventId || null,
        event.createdAt,
        event.updatedAt
      );

      return eventService.getById(id);
    } catch (error) {
      console.error('Error creating event:', error);
      throw new Error('Failed to create event');
    }
  },

  update: (id: string, data: Partial<Omit<Event, 'id' | 'createdAt'>>): EventWithDetails | null => {
    try {
      const updatedAt = new Date().toISOString();
      const updateData = { ...data, updatedAt };

      const fields = Object.keys(updateData).filter((key) => key !== 'id' && key !== 'createdAt');
      if (fields.length === 0) return eventService.getById(id);

      const values = fields.map((field) => updateData[field as keyof typeof updateData]);
      const setClause = fields.map((field) => `${field} = ?`).join(', ');

      const result = db.prepare(`UPDATE events SET ${setClause} WHERE id = ?`).run(...values, id);

      if (result.changes === 0) {
        return null;
      }

      return eventService.getById(id);
    } catch (error) {
      console.error('Error updating event:', error);
      throw new Error('Failed to update event');
    }
  },
};

// Enhanced commitment service
export const commitmentService = {
  getByEventId: (eventId: string): Commitment[] => {
    try {
      return db
        .prepare('SELECT * FROM commitments WHERE eventId = ? ORDER BY joinedAt ASC')
        .all(eventId) as Commitment[];
    } catch (error) {
      console.error('Error fetching commitments by event ID:', error);
      throw new Error('Failed to fetch commitments');
    }
  },

  getByUserId: (userId: string): Commitment[] => {
    try {
      return db
        .prepare('SELECT * FROM commitments WHERE userId = ? ORDER BY joinedAt DESC')
        .all(userId) as Commitment[];
    } catch (error) {
      console.error('Error fetching commitments by user ID:', error);
      throw new Error('Failed to fetch user commitments');
    }
  },

  getUserCommitmentForEvent: (eventId: string, userId: string): Commitment | null => {
    try {
      const commitment = db
        .prepare('SELECT * FROM commitments WHERE eventId = ? AND userId = ?')
        .get(eventId, userId) as Commitment | undefined;
      return commitment || null;
    } catch (error) {
      console.error('Error fetching user commitment for event:', error);
      throw new Error('Failed to fetch commitment');
    }
  },

  create: (data: Omit<Commitment, 'id' | 'joinedAt'>): Commitment => {
    try {
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
        commitment.notes || null
      );

      return commitment;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('User already has a commitment to this event');
      }
      console.error('Error creating commitment:', error);
      throw new Error('Failed to create commitment');
    }
  },

  update: (id: string, data: Partial<Omit<Commitment, 'id' | 'joinedAt'>>): Commitment | null => {
    try {
      const fields = Object.keys(data).filter((key) => key !== 'id' && key !== 'joinedAt');
      if (fields.length === 0) {
        const commitment = db.prepare('SELECT * FROM commitments WHERE id = ?').get(id) as
          | Commitment
          | undefined;
        return commitment || null;
      }

      const values = fields.map((field) => data[field as keyof typeof data]);
      const setClause = fields.map((field) => `${field} = ?`).join(', ');

      const result = db
        .prepare(`UPDATE commitments SET ${setClause} WHERE id = ?`)
        .run(...values, id);

      if (result.changes === 0) {
        return null;
      }

      const commitment = db.prepare('SELECT * FROM commitments WHERE id = ?').get(id) as Commitment;
      return commitment;
    } catch (error) {
      console.error('Error updating commitment:', error);
      throw new Error('Failed to update commitment');
    }
  },

  delete: (id: string): boolean => {
    try {
      const result = db.prepare('DELETE FROM commitments WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting commitment:', error);
      throw new Error('Failed to delete commitment');
    }
  },

  countCommittedForEvent: (eventId: string): number => {
    try {
      const result = db
        .prepare('SELECT COUNT(*) as count FROM commitments WHERE eventId = ? AND status = ?')
        .get(eventId, 'COMMITTED') as any;
      return result.count || 0;
    } catch (error) {
      console.error('Error counting commitments:', error);
      throw new Error('Failed to count commitments');
    }
  },
};

// Close database on exit
process.on('exit', () => {
  try {
    db.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database:', error);
  }
});

process.on('SIGINT', () => {
  try {
    db.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing database:', error);
    process.exit(1);
  }
});

export { db };
export default db;
