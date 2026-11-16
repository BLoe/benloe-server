// SQL the model wrote (the `query` tool, and the statement of a `check` schedule) never runs on
// the server's own database connection. better-sqlite3 is synchronous: a statement that does not
// come back (a recursive query without an end, a join of everything with everything) would stop
// the whole server, and nothing in the library can interrupt it. So each statement runs in a
// short-lived child process with its own connection, and a statement that is still running at
// the deadline dies with that process.
//
// The connection is opened read-only, so the statement cannot change the database whatever it
// says; the single-SELECT check below is what turns everything else away with a clear message.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { config } from './config.js';
import type { Kevin } from './kevin.js';

const SQLITE = createRequire(import.meta.url).resolve('better-sqlite3');

/** Most JSON the child will send back; the rows are cut there. */
const MAX_RESULT_BYTES = 2_000_000;
/** A single text value longer than this is cut, with a note of its length. */
const MAX_VALUE_CHARS = 50_000;

// Plain JavaScript, run with `node -e`. It reads one JSON request on stdin and writes one JSON reply.
const CHILD = `
let input = '';
process.stdin.on('data', (c) => (input += c)).on('end', () => {
  const req = JSON.parse(input);
  let reply;
  try {
    const db = new (require(req.lib))(req.path, { readonly: true, fileMustExist: true });
    db.pragma('hard_heap_limit = ' + 256 * 1024 * 1024);
    const stmt = db.prepare(req.sql);
    if (req.check && (!stmt.readonly || !stmt.reader)) throw new Error('only a single read-only SELECT is allowed here');
    const rows = [];
    let bytes = 0;
    let cut = false;
    for (const row of stmt.iterate()) {
      for (const k of Object.keys(row)) {
        const v = row[k];
        if (Buffer.isBuffer(v)) row[k] = '[binary, ' + v.length + ' bytes]';
        else if (typeof v === 'bigint') row[k] = v.toString();
        else if (typeof v === 'string' && v.length > req.maxValue) row[k] = v.slice(0, req.maxValue) + '[cut: ' + v.length + ' characters; read the rest with substr()]';
      }
      bytes += JSON.stringify(row).length;
      if (bytes > req.maxBytes) { cut = true; break; }
      rows.push(row);
      if (rows.length >= req.limit) break;
    }
    reply = { rows, cut };
  } catch (e) {
    reply = { error: String((e && e.message) || e) };
  }
  process.stdout.write(JSON.stringify(reply), () => process.exit(0));
});
`;

export interface QueryResult {
  rows: Record<string, unknown>[];
  /** The rows stop early because together they passed the size limit (not because of `limit`). */
  cut: boolean;
}

/**
 * Runs one read-only statement and returns at most `limit` rows. Rejects with a plain Error (its message
 * is fit for the model) when the statement is not a single SELECT, fails, or is still running after
 * `config.sqlSeconds`.
 *
 * `statementCheck: false` leaves out the single-SELECT check. No tool passes it; a test does, to show
 * that the read-only connection refuses a write by itself.
 */
export function readOnlyQuery(kevin: Kevin, sql: string, limit = 200, { statementCheck = true }: { statementCheck?: boolean } = {}): Promise<QueryResult> {
  const { db } = kevin;
  if (db.memory) return Promise.reject(new Error('model SQL needs a database file; this database is in memory'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', CHILD], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`the query was still running after ${config.sqlSeconds} seconds and was cancelled; make it do less work`))), config.sqlSeconds * 1000);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_RESULT_BYTES * 2) finish(() => reject(new Error('the query returned too much data')));
      else out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => void (err.length < 20 && err.push(c)));
    child.on('error', (e) => finish(() => reject(new Error(`the query could not be started: ${e.message}`))));
    child.on('close', (code) =>
      finish(() => {
        let reply: { rows?: Record<string, unknown>[]; cut?: boolean; error?: string };
        try {
          reply = JSON.parse(Buffer.concat(out).toString('utf8')) as typeof reply;
        } catch {
          // Killed by its memory limit, or it crashed: there is no reply to read.
          console.error(`model SQL child ended without a reply (exit ${code}): ${Buffer.concat(err).toString('utf8').slice(0, 500)}`);
          return void reject(new Error('the query could not be completed (it used too much memory or failed inside SQLite)'));
        }
        if (reply.error != null) return void reject(new Error(reply.error));
        resolve({ rows: reply.rows ?? [], cut: reply.cut === true });
      }),
    );
    // The child may die (the deadline) before it has read its request.
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ lib: SQLITE, path: db.name, sql, limit, check: statementCheck, maxBytes: MAX_RESULT_BYTES, maxValue: MAX_VALUE_CHARS }));
  });
}
