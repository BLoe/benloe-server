import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { logRetrieval, retrievalLogCount } from '../src/episodic/retrieval-log.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-retrieval-log-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('logRetrieval (mentorship: Phase 3 item 3 — instrumentation only, no scoring)', () => {
  it('writes a row with the full shape: caller, query_text, k, results JSON, result_count', () => {
    logRetrieval(cabinet.db, {
      caller: 'search_episodic',
      queryText: 'what did we decide about the guard threshold',
      k: 6,
      results: [{ id: 1, distance: 0.42, kind: 'journal' }, { id: 2, distance: 0.81, kind: 'conversation' }],
    });
    const row = cabinet.db.prepare('SELECT caller, query_text, k, results, result_count FROM retrieval_log').get() as {
      caller: string; query_text: string; k: number; results: string; result_count: number;
    };
    expect(row.caller).toBe('search_episodic');
    expect(row.query_text).toBe('what did we decide about the guard threshold');
    expect(row.k).toBe(6);
    expect(row.result_count).toBe(2);
    expect(JSON.parse(row.results)).toEqual([
      { id: 1, distance: 0.42, kind: 'journal' },
      { id: 2, distance: 0.81, kind: 'conversation' },
    ]);
  });

  it('logs a zero-hit retrieval too (result_count 0, empty results array) — an empty corpus is real signal, not an error', () => {
    logRetrieval(cabinet.db, { caller: 'search_documents', queryText: 'anything', k: 6, results: [] });
    const row = cabinet.db.prepare('SELECT result_count, results FROM retrieval_log').get() as { result_count: number; results: string };
    expect(row.result_count).toBe(0);
    expect(JSON.parse(row.results)).toEqual([]);
  });

  it('swallows a failure (e.g. a broken db handle) and never throws — a logging failure must not break retrieval', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brokenDb = { prepare: () => { throw new Error('db is closed'); } } as unknown as Parameters<typeof logRetrieval>[0];
    expect(() => logRetrieval(brokenDb, { caller: 'recallLessons', queryText: 'x', k: 4, results: [] })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('logRetrieval: failed to log a recallLessons retrieval'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db is closed'));
    warn.mockRestore();
  });
});

describe('retrievalLogCount (mentorship: Phase 3 item 3 — the healthz "is it accumulating" signal)', () => {
  it('reflects the number of rows logged', () => {
    expect(retrievalLogCount(cabinet.db)).toBe(0);
    logRetrieval(cabinet.db, { caller: 'recallLessons', queryText: 'a', k: 4, results: [] });
    logRetrieval(cabinet.db, { caller: 'recallLessons', queryText: 'b', k: 4, results: [] });
    expect(retrievalLogCount(cabinet.db)).toBe(2);
  });

  it('degrades to 0 rather than throwing if the query fails (e.g. table missing)', () => {
    const brokenDb = { prepare: () => { throw new Error('no such table'); } } as unknown as Parameters<typeof retrievalLogCount>[0];
    expect(retrievalLogCount(brokenDb)).toBe(0);
  });
});
