import Database from 'better-sqlite3';
import { config } from '../config.js';
import { encrypt, decrypt, hashToken, hashClientSecret } from './crypto.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(config.databasePath);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

function initializeSchema(): void {
  const database = db!;

  // Dynamic Client Registration
  database.exec(`
    CREATE TABLE IF NOT EXISTS mcp_clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT NOT NULL,
      client_name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      grant_types TEXT NOT NULL,
      response_types TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // PKCE state during authorization flow
  database.exec(`
    CREATE TABLE IF NOT EXISTS pkce_states (
      state TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      redirect_uri TEXT NOT NULL,
      scope TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // Authorization codes (short-lived)
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      redirect_uri TEXT NOT NULL,
      yahoo_access_token_encrypted TEXT NOT NULL,
      yahoo_refresh_token_encrypted TEXT NOT NULL,
      yahoo_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // MCP sessions (maps MCP tokens to Yahoo tokens)
  database.exec(`
    CREATE TABLE IF NOT EXISTS mcp_sessions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      access_token_hash TEXT NOT NULL UNIQUE,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      yahoo_access_token_encrypted TEXT NOT NULL,
      yahoo_refresh_token_encrypted TEXT NOT NULL,
      yahoo_expires_at INTEGER NOT NULL,
      access_token_expires_at INTEGER NOT NULL,
      refresh_token_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Indexes
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_access_token ON mcp_sessions(access_token_hash)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON mcp_sessions(refresh_token_hash)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_pkce_expires ON pkce_states(expires_at)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)
  `);

  console.log('Database schema initialized');
}

// ============================================================
// Client Registration
// ============================================================

export interface McpClient {
  clientId: string;
  clientSecretHash: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  createdAt: number;
  updatedAt: number;
}

export function createClient(
  clientId: string,
  clientSecretHash: string,
  clientName: string,
  redirectUris: string[],
  grantTypes: string[] = ['authorization_code', 'refresh_token'],
  responseTypes: string[] = ['code']
): void {
  const now = Date.now();
  const stmt = getDatabase().prepare(`
    INSERT INTO mcp_clients (client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    clientId,
    clientSecretHash,
    clientName,
    JSON.stringify(redirectUris),
    JSON.stringify(grantTypes),
    JSON.stringify(responseTypes),
    now,
    now
  );
}

export function getClient(clientId: string): McpClient | null {
  const stmt = getDatabase().prepare('SELECT * FROM mcp_clients WHERE client_id = ?');
  const row = stmt.get(clientId) as any;
  if (!row) return null;

  return {
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris),
    grantTypes: JSON.parse(row.grant_types),
    responseTypes: JSON.parse(row.response_types),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// PKCE State
// ============================================================

export interface PkceState {
  state: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  scope: string | null;
  createdAt: number;
  expiresAt: number;
}

export function savePkceState(
  state: string,
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  redirectUri: string,
  scope: string | null
): void {
  const now = Date.now();
  const expiresAt = now + config.pkceStateTtl * 1000;

  const stmt = getDatabase().prepare(`
    INSERT INTO pkce_states (state, client_id, code_challenge, code_challenge_method, redirect_uri, scope, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(state, clientId, codeChallenge, codeChallengeMethod, redirectUri, scope, now, expiresAt);
}

export function getPkceState(state: string): PkceState | null {
  const stmt = getDatabase().prepare('SELECT * FROM pkce_states WHERE state = ?');
  const row = stmt.get(state) as any;
  if (!row) return null;

  return {
    state: row.state,
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function deletePkceState(state: string): void {
  const stmt = getDatabase().prepare('DELETE FROM pkce_states WHERE state = ?');
  stmt.run(state);
}

// ============================================================
// Authorization Codes
// ============================================================

export interface AuthCode {
  code: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  yahooAccessToken: string;
  yahooRefreshToken: string;
  yahooExpiresAt: number;
  createdAt: number;
  expiresAt: number;
}

export function saveAuthCode(
  code: string,
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  redirectUri: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number
): void {
  const now = Date.now();
  const expiresAt = now + config.authCodeTtl * 1000;

  const stmt = getDatabase().prepare(`
    INSERT INTO auth_codes (code, client_id, code_challenge, code_challenge_method, redirect_uri, yahoo_access_token_encrypted, yahoo_refresh_token_encrypted, yahoo_expires_at, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    code,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    encrypt(yahooAccessToken),
    encrypt(yahooRefreshToken),
    yahooExpiresAt,
    now,
    expiresAt
  );
}

export function getAuthCode(code: string): AuthCode | null {
  const stmt = getDatabase().prepare('SELECT * FROM auth_codes WHERE code = ?');
  const row = stmt.get(code) as any;
  if (!row) return null;

  return {
    code: row.code,
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    redirectUri: row.redirect_uri,
    yahooAccessToken: decrypt(row.yahoo_access_token_encrypted),
    yahooRefreshToken: decrypt(row.yahoo_refresh_token_encrypted),
    yahooExpiresAt: row.yahoo_expires_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function deleteAuthCode(code: string): void {
  const stmt = getDatabase().prepare('DELETE FROM auth_codes WHERE code = ?');
  stmt.run(code);
}

// ============================================================
// MCP Sessions
// ============================================================

export interface McpSession {
  id: string;
  clientId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  yahooAccessToken: string;
  yahooRefreshToken: string;
  yahooExpiresAt: number;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export function createSession(
  id: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number
): void {
  const now = Date.now();
  const accessTokenExpiresAt = now + config.accessTokenTtl * 1000;
  const refreshTokenExpiresAt = now + config.refreshTokenTtl * 1000;

  const stmt = getDatabase().prepare(`
    INSERT INTO mcp_sessions (id, client_id, access_token_hash, refresh_token_hash, yahoo_access_token_encrypted, yahoo_refresh_token_encrypted, yahoo_expires_at, access_token_expires_at, refresh_token_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    clientId,
    hashToken(accessToken),
    hashToken(refreshToken),
    encrypt(yahooAccessToken),
    encrypt(yahooRefreshToken),
    yahooExpiresAt,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    now,
    now
  );
}

export function getSessionByAccessToken(accessToken: string): McpSession | null {
  const hash = hashToken(accessToken);
  const stmt = getDatabase().prepare('SELECT * FROM mcp_sessions WHERE access_token_hash = ?');
  const row = stmt.get(hash) as any;
  if (!row) return null;

  return {
    id: row.id,
    clientId: row.client_id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    yahooAccessToken: decrypt(row.yahoo_access_token_encrypted),
    yahooRefreshToken: decrypt(row.yahoo_refresh_token_encrypted),
    yahooExpiresAt: row.yahoo_expires_at,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSessionByRefreshToken(refreshToken: string): McpSession | null {
  const hash = hashToken(refreshToken);
  const stmt = getDatabase().prepare('SELECT * FROM mcp_sessions WHERE refresh_token_hash = ?');
  const row = stmt.get(hash) as any;
  if (!row) return null;

  return {
    id: row.id,
    clientId: row.client_id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    yahooAccessToken: decrypt(row.yahoo_access_token_encrypted),
    yahooRefreshToken: decrypt(row.yahoo_refresh_token_encrypted),
    yahooExpiresAt: row.yahoo_expires_at,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateSessionTokens(
  sessionId: string,
  newAccessToken: string,
  newRefreshToken: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number
): void {
  const now = Date.now();
  const accessTokenExpiresAt = now + config.accessTokenTtl * 1000;
  const refreshTokenExpiresAt = now + config.refreshTokenTtl * 1000;

  const stmt = getDatabase().prepare(`
    UPDATE mcp_sessions
    SET access_token_hash = ?, refresh_token_hash = ?, yahoo_access_token_encrypted = ?, yahoo_refresh_token_encrypted = ?, yahoo_expires_at = ?, access_token_expires_at = ?, refresh_token_expires_at = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    hashToken(newAccessToken),
    hashToken(newRefreshToken),
    encrypt(yahooAccessToken),
    encrypt(yahooRefreshToken),
    yahooExpiresAt,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    now,
    sessionId
  );
}

export function updateSessionYahooTokens(
  sessionId: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number
): void {
  const now = Date.now();

  const stmt = getDatabase().prepare(`
    UPDATE mcp_sessions
    SET yahoo_access_token_encrypted = ?, yahoo_refresh_token_encrypted = ?, yahoo_expires_at = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    encrypt(yahooAccessToken),
    encrypt(yahooRefreshToken),
    yahooExpiresAt,
    now,
    sessionId
  );
}

export function deleteSession(sessionId: string): void {
  const stmt = getDatabase().prepare('DELETE FROM mcp_sessions WHERE id = ?');
  stmt.run(sessionId);
}

// ============================================================
// Cleanup
// ============================================================

export function cleanupExpiredRecords(): void {
  const now = Date.now();

  getDatabase().prepare('DELETE FROM pkce_states WHERE expires_at < ?').run(now);
  getDatabase().prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now);
  getDatabase().prepare('DELETE FROM mcp_sessions WHERE refresh_token_expires_at < ?').run(now);

  console.log('Cleaned up expired records');
}

// Run cleanup every hour
setInterval(cleanupExpiredRecords, 60 * 60 * 1000);
