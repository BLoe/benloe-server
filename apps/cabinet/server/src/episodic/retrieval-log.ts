import type Database from 'better-sqlite3';

export type RetrievalCaller = 'recallLessons' | 'search_episodic' | 'search_documents';

export interface RetrievalHit {
  id: number;
  distance: number;
  kind: string;
}

/**
 * Instrumentation only (§ mentorship Phase 3, item 3) — captures every KNN
 * retrieval into retrieval_log so that once the corpus has grown enough to
 * mean something, logged queries can be replayed against candidate scorers
 * and a real recall@k delta computed. NOT a scoring system; this never reads
 * its own log to influence a live retrieval.
 *
 * Deliberately swallows its own errors — logging must never be able to break
 * an actual retrieval path (the whole point is invisible instrumentation,
 * not a new way for recall to fail). console.warns with enough context to
 * diagnose (caller, query length, the error) rather than failing silently —
 * same discipline as the embed-backfill catch blocks elsewhere in this file
 * area, applied to a read-adjacent path instead of a write one.
 */
export function logRetrieval(
  db: Database.Database,
  entry: { caller: RetrievalCaller; queryText: string; k: number; results: RetrievalHit[] },
): void {
  try {
    db.prepare(
      'INSERT INTO retrieval_log (caller, query_text, k, results, result_count) VALUES (?,?,?,?,?)',
    ).run(entry.caller, entry.queryText, entry.k, JSON.stringify(entry.results), entry.results.length);
  } catch (err) {
    console.warn(
      `logRetrieval: failed to log a ${entry.caller} retrieval (query length ${entry.queryText.length}, k=${entry.k}): ${(err as Error).message}`,
    );
  }
}

/** The "is the harness actually accumulating data?" number for healthz. */
export function retrievalLogCount(db: Database.Database): number {
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM retrieval_log').get() as { n: number }).n;
  } catch {
    return 0; // e.g. mid-migration or a test DB without the table — never break healthz over this
  }
}
