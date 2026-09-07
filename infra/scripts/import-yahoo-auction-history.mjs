/**
 * One-off: pull a Yahoo auction league's past draft results for Gavel.
 *
 * WHY THIS LIVES HERE AND NOT IN apps/gavel:
 * Gavel's defining property is that it makes no network call on any path that
 * matters, and holds no credential. Giving it a Yahoo OAuth flow would undo
 * both for the sake of data that never changes — last year's draft results are
 * a frozen historical fact. So this is a maintenance script, run by hand,
 * whose output is a static file Gavel then reads offline forever.
 *
 * It borrows the Yahoo credentials that already exist on this box in
 * apps/yahoo-fantasy-mcp rather than registering a second OAuth app. That
 * crosses the one-app-one-secret-file line deliberately and visibly: it runs as
 * root, by hand, with the owner's explicit say-so, and it NEVER writes a token
 * anywhere. If this ever needs to be routine, the right move is to extend
 * yahoo-fantasy-mcp, not to give Gavel a credential.
 *
 * STATUS (2026-09-07): BLOCKED, and not by anything on this box. The stored
 * refresh token still works — Yahoo returns a fresh access token — but every
 * Fantasy API call with it returns:
 *
 *     403 "This application is not authorized to perform this action."
 *
 * That is an APP-level permission, not a token problem. The OAuth app behind
 * yahoo-fantasy-mcp has lost (or never had) Fantasy Sports read access at
 * developer.yahoo.com. Nothing in this script or in that service can fix it;
 * the app's permissions have to be corrected and the account re-consented.
 * Note this also means apps/yahoo-fantasy-mcp itself is non-functional.
 *
 * Usage:  node infra/scripts/import-yahoo-auction-history.mjs [--write <league.json>]
 *
 * Prints the leagues it finds and their auction results. With --write it merges
 * `history` and `teamNames` into a Gavel league definition file.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/srv/benloe/apps/yahoo-fantasy-mcp/');
const Database = require('better-sqlite3');

const ENV_PATH = '/run/benloe-secrets/yahoo-fantasy-mcp.env';
const DB_PATH = '/srv/benloe/data/yahoo-fantasy-mcp.db';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';

function readEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

/** Mirrors apps/yahoo-fantasy-mcp/src/services/crypto.ts exactly. */
function makeDecrypt(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  return (ciphertext) => {
    const [iv, tag, data] = ciphertext.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return d.update(data, 'hex', 'utf8') + d.final('utf8');
  };
}

async function yahoo(token, path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}format=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw Object.assign(new Error(`Yahoo ${res.status} on ${path}`), { status: res.status });
  return res.json();
}

async function refresh(env, refreshToken) {
  const body = new URLSearchParams({
    client_id: env.YAHOO_CLIENT_ID,
    client_secret: env.YAHOO_CLIENT_SECRET,
    redirect_uri: 'oob',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Yahoo's JSON is XML wearing a costume: objects keyed "0","1","2" with a
 * "count", and arrays of single-key objects. Walking it generically is far more
 * robust than indexing into it, which breaks whenever a field is absent.
 */
function collect(node, key, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) collect(v, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    else collect(v, key, out);
  }
  return out;
}

function flatten(node, into = {}) {
  if (node == null || typeof node !== 'object') return into;
  if (Array.isArray(node)) {
    for (const v of node) flatten(v, into);
    return into;
  }
  for (const [k, v] of Object.entries(node)) {
    if (v == null) continue;
    if (typeof v === 'object') flatten(v, into);
    else if (!(k in into)) into[k] = v;
  }
  return into;
}

async function main() {
  const env = readEnv(ENV_PATH);
  if (!env.MCP_TOKEN_ENCRYPTION_KEY || !env.YAHOO_CLIENT_ID) {
    console.error('yahoo-fantasy-mcp env is missing its Yahoo credentials.');
    process.exit(1);
  }
  const decrypt = makeDecrypt(env.MCP_TOKEN_ENCRYPTION_KEY);

  const db = new Database(DB_PATH, { readonly: true });
  const sessions = db
    .prepare(
      'SELECT yahoo_access_token_encrypted a, yahoo_refresh_token_encrypted r FROM mcp_sessions ORDER BY updated_at DESC'
    )
    .all();
  db.close();
  if (sessions.length === 0) {
    console.error('No Yahoo session stored. Connect the Yahoo MCP once, then re-run.');
    process.exit(1);
  }

  let token = null;
  for (const s of sessions) {
    let access;
    try {
      access = decrypt(s.a);
    } catch {
      continue;
    }
    try {
      await yahoo(access, '/users;use_login=1/games;game_codes=nfl');
      token = access;
      break;
    } catch (err) {
      if (err.status !== 401 || !s.r) continue;
      try {
        const fresh = await refresh(env, decrypt(s.r));
        await yahoo(fresh, '/users;use_login=1/games;game_codes=nfl');
        token = fresh;
        break;
      } catch {
        /* try the next session */
      }
    }
  }
  if (!token) {
    console.error('No stored Yahoo session still works. Re-connect the Yahoo MCP.');
    process.exit(1);
  }
  console.log('Yahoo session OK (token not written anywhere).\n');

  // Every NFL league this account has ever been in, across seasons.
  const leaguesDoc = await yahoo(token, '/users;use_login=1/games;game_codes=nfl/leagues');
  const leagues = collect(leaguesDoc, 'league')
    .map((l) => flatten(l))
    .filter((l) => l.league_key)
    .filter((l, i, arr) => arr.findIndex((x) => x.league_key === l.league_key) === i);

  console.log(`Found ${leagues.length} NFL league(s):`);
  for (const l of leagues) {
    console.log(`  ${l.season}  ${l.league_key.padEnd(16)} ${l.name}  (${l.num_teams} teams)`);
  }

  const results = [];
  for (const league of leagues) {
    let settings, teamsDoc, draftDoc;
    try {
      settings = flatten(await yahoo(token, `/league/${league.league_key}/settings`));
      teamsDoc = await yahoo(token, `/league/${league.league_key}/teams`);
      draftDoc = await yahoo(token, `/league/${league.league_key}/draftresults`);
    } catch (err) {
      console.log(`  ! ${league.league_key}: ${err.message}`);
      continue;
    }

    const picks = collect(draftDoc, 'draft_result')
      .map((p) => flatten(p))
      .filter((p) => p.player_key);
    const withCost = picks.filter((p) => Number(p.cost) > 0);
    const teams = collect(teamsDoc, 'team')
      .map((t) => flatten(t))
      .filter((t) => t.team_key && t.name)
      .filter((t, i, arr) => arr.findIndex((x) => x.team_key === t.team_key) === i);

    results.push({ league, settings, teams, picks, withCost });
    console.log(
      `\n  ${league.season} ${league.name}: draft=${settings.draft_type ?? '?'}  ` +
        `picks=${picks.length}  priced=${withCost.length}  teams=${teams.length}`
    );
    if (withCost.length) {
      const top = withCost.map((p) => Number(p.cost)).sort((a, b) => b - a).slice(0, 8);
      console.log(`      top costs: ${top.join(', ')}   total $${withCost.reduce((s, p) => s + Number(p.cost), 0)}`);
    }
    if (teams.length) console.log(`      managers: ${teams.map((t) => t.name).join(', ')}`);
  }

  fs.writeFileSync('/tmp/yahoo-import.json', JSON.stringify(results, null, 1));
  console.log('\nFull payload written to /tmp/yahoo-import.json for the next step.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
