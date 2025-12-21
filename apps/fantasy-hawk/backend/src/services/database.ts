import path from 'path';
import { YahooTokens } from '../types';

// Import better-sqlite3 from parent node_modules
const Database = require('/var/apps/node_modules/better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../fantasy-hawk.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

export function initDatabase(): void {
  // Create yahoo_tokens table (OAuth 2.0)
  db.exec(`
    CREATE TABLE IF NOT EXISTS yahoo_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_yahoo_tokens_user_id ON yahoo_tokens(user_id);
  `);

  // Create oauth_states table (CSRF protection during OAuth 2.0 flow)
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
  `);

  console.log('Database initialized successfully');
}

// Yahoo Token Management (OAuth 2.0)
export function saveYahooTokens(tokens: YahooTokens): void {
  const stmt = db.prepare(`
    INSERT INTO yahoo_tokens (user_id, access_token, refresh_token, token_expires, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires = excluded.token_expires,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    tokens.userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.tokenExpires,
    tokens.createdAt,
    tokens.updatedAt
  );
}

export function getYahooTokens(userId: string): YahooTokens | null {
  const stmt = db.prepare(`
    SELECT user_id as userId, access_token as accessToken, refresh_token as refreshToken,
           token_expires as tokenExpires, created_at as createdAt, updated_at as updatedAt
    FROM yahoo_tokens
    WHERE user_id = ?
  `);

  return stmt.get(userId) as YahooTokens | null;
}

export function deleteYahooTokens(userId: string): void {
  const stmt = db.prepare('DELETE FROM yahoo_tokens WHERE user_id = ?');
  stmt.run(userId);
}

// OAuth State Management (OAuth 2.0 CSRF protection)
export function saveOAuthState(state: string, userId: string): void {
  const now = Date.now();
  const expiresAt = now + 600000; // 10 minutes

  const stmt = db.prepare(`
    INSERT INTO oauth_states (state, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(state, userId, now, expiresAt);
}

export function getOAuthState(state: string): { userId: string } | null {
  const stmt = db.prepare(`
    SELECT user_id as userId
    FROM oauth_states
    WHERE state = ? AND expires_at > ?
  `);

  return stmt.get(state, Date.now()) as { userId: string } | null;
}

export function deleteOAuthState(state: string): void {
  const stmt = db.prepare('DELETE FROM oauth_states WHERE state = ?');
  stmt.run(state);
}

// Cleanup expired states periodically
export function cleanupExpiredStates(): void {
  const stmt = db.prepare('DELETE FROM oauth_states WHERE expires_at < ?');
  const result = stmt.run(Date.now());
  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} expired OAuth states`);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredStates, 3600000);

export { db };
