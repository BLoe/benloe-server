import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { EMBEDDING_DIMS, chunkText, type Embedder } from '../embeddings/index.js';
import { extractText, type MessagePart } from '../gateway/fold.js';

export type ChunkKind = 'conversation' | 'journal' | 'document';

export interface ChunkHit {
  id: number;
  kind: ChunkKind;
  sourceRef: string;
  localDay: string | null;
  text: string;
  distance: number;
}

export type LessonStatus = 'active' | 'retired' | 'superseded' | 'promoted';

export interface LessonRow {
  id: number;
  text: string;
  domain: string | null;
  evidence: string | null;
  confidence: number | null;
  status: LessonStatus;
  times_applied: number;
  created_at: string;
  last_used_at: string | null;
}

export interface EmbeddableTable {
  /** cabinet.db table name holding the raw text. */
  table: string;
  /** INTEGER flag column on that table: 0 = not yet embedded, 1 = embedded. */
  flagColumn: string;
  /** Column holding the free text to embed (or, with `extract`, the raw value to transform). */
  textColumn: string;
  /** episodic chunk kind these rows are indexed as. */
  kind: ChunkKind;
  /** Builds the episodic chunk.source_ref for a given row id. */
  sourceRef: (id: number) => string;
  /**
   * Extra SQL predicate ANDed onto `{flagColumn} = 0`, scoped to columns on
   * `table` itself (no joins — keeps this a plain string safely appended in
   * both the backfill candidate query and pendingBackfillCount below, so a
   * permanently-excluded row is excluded from BOTH and never inflates the
   * "pending" count by sitting at flagColumn=0 forever, uncounted-but-visible).
   */
  where?: string;
  /**
   * Transform the raw `textColumn` value into what to embed, or null to
   * skip-but-flag (the caller sets flagColumn=1 anyway — e.g. too short to
   * be worth a vector, not an error). Absent = use the raw value as-is
   * (journal_entry's original, unchanged behavior).
   */
  extract?: (raw: string) => string | null;
}

/**
 * Registry of every cabinet.db table that feeds the episodic embedder, paired
 * with the flag column marking "already embedded." Single edit point: a
 * domain that starts embedding text appends one entry here — the nightly
 * backfill job (scheduler/jobs.ts) and the healthz pendingBackfill count
 * (gateway/app.ts) both derive from this list instead of each hardcoding
 * journal_entry. Table/column names below are our own trusted constants, not
 * user input, so string-interpolating them into SQL (in the two consumers
 * above) is safe.
 */
export const EMBEDDABLE_TABLES: EmbeddableTable[] = [
  { table: 'journal_entry', flagColumn: 'embedded', textColumn: 'body', kind: 'journal', sourceRef: (id) => `journal:${id}` },
  {
    table: 'message',
    flagColumn: 'embedded',
    textColumn: 'parts',
    kind: 'conversation',
    sourceRef: (id) => `message:${id}`,
    // sys-* chat ids are exactly and only systemChat()'s cron/heartbeat
    // chats (scheduler/jobs.ts) — audit-shaped narration, not conversational
    // memory. Cheaper and more robust than joining to chat.kind: no join
    // needed, and it doesn't depend on kind semantics staying what they are today.
    where: "chat_id NOT LIKE 'sys-%' AND role IN ('user','assistant')",
    extract: (raw) => {
      let parts: MessagePart[];
      try {
        parts = JSON.parse(raw) as MessagePart[];
      } catch {
        return null; // malformed parts JSON — skip-but-flag, don't retry forever
      }
      const text = extractText(parts);
      // A floor, not a hard rule: drops tool-call-only turns and bare acks
      // ("ok", "thanks") as recall anchors while keeping short-but-real
      // replies ("yes, do it") that still carry meaning.
      return text.length >= 15 ? text : null;
    },
  },
];

/** Sum of not-yet-embedded rows across every table in EMBEDDABLE_TABLES — the "is the embed pipeline caught up?" number. */
export function pendingBackfillCount(db: Database.Database): number {
  let total = 0;
  for (const t of EMBEDDABLE_TABLES) {
    const where = t.where ? ` AND ${t.where}` : '';
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.flagColumn} = 0${where}`).get() as { n: number };
    total += row.n;
  }
  return total;
}

/** episodic.db: vector recall for conversations/journals/documents + the lesson bank. */
export class EpisodicStore {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk (
        id INTEGER PRIMARY KEY,
        kind TEXT CHECK(kind IN ('conversation','journal','document')) NOT NULL,
        source_ref TEXT NOT NULL,
        local_day TEXT,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunk USING vec0(embedding float[${EMBEDDING_DIMS}]);
      CREATE TABLE IF NOT EXISTS lesson (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        domain TEXT,
        evidence TEXT,
        confidence REAL,
        status TEXT CHECK(status IN ('active','retired','superseded','promoted')) DEFAULT 'active',
        times_applied INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_lesson USING vec0(embedding float[${EMBEDDING_DIMS}]);
    `);
    this.migrateLessonPromotedStatus();
  }

  /**
   * One-time, idempotent, self-healing schema evolution for a table with no
   * migration runner of its own (unlike cabinet.db's src/db/migrations).
   * 'promoted' was added to lesson.status's CHECK constraint after episodic.db
   * files already existed in the wild — CREATE TABLE IF NOT EXISTS above is a
   * no-op against them, so their CHECK still rejects 'promoted' until this
   * runs once. SQLite can't ALTER a CHECK constraint in place, so this does
   * the standard rebuild-and-swap; vec_lesson is untouched since rowids
   * (== lesson.id, an INTEGER PRIMARY KEY alias) are preserved verbatim.
   */
  private migrateLessonPromotedStatus(): void {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lesson'").get() as
      | { sql: string }
      | undefined;
    if (!row || row.sql.includes('promoted')) return; // fresh DB (already has it) or already migrated
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE lesson_migrating (
          id INTEGER PRIMARY KEY,
          text TEXT NOT NULL,
          domain TEXT,
          evidence TEXT,
          confidence REAL,
          status TEXT CHECK(status IN ('active','retired','superseded','promoted')) DEFAULT 'active',
          times_applied INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT
        );
        INSERT INTO lesson_migrating (id, text, domain, evidence, confidence, status, times_applied, created_at, last_used_at)
          SELECT id, text, domain, evidence, confidence, status, times_applied, created_at, last_used_at FROM lesson;
        DROP TABLE lesson;
        ALTER TABLE lesson_migrating RENAME TO lesson;
      `);
    })();
  }

  private static asBuffer(v: Float32Array): Buffer {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }

  insertChunk(kind: ChunkKind, sourceRef: string, localDay: string | null, text: string, vector: Float32Array): number {
    if (vector.length !== EMBEDDING_DIMS) throw new Error(`vector must be ${EMBEDDING_DIMS}-dim`);
    const insert = this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO chunk (kind, source_ref, local_day, text) VALUES (?,?,?,?)')
        .run(kind, sourceRef, localDay, text);
      this.db
        .prepare('INSERT INTO vec_chunk (rowid, embedding) VALUES (?, ?)')
        // sqlite-vec rejects JS-number rowids ("only integers allowed") — must be BigInt
        .run(BigInt(lastInsertRowid), EpisodicStore.asBuffer(vector));
      return Number(lastInsertRowid);
    });
    return insert();
  }

  searchChunks(vector: Float32Array, k = 6, kind?: ChunkKind): ChunkHit[] {
    // vec_chunk has no notion of `kind`, so a kind filter is applied after the KNN
    // fetch. A fixed over-fetch multiplier (previously k*3) silently under-returns
    // whenever the target kind is a minority of the corpus — e.g. one big document
    // import can push conversation chunks entirely outside a small candidate window,
    // and the caller gets fewer than k results (or none) with no indication why.
    // Guarantee correctness by bounding the candidate pool by the true row count
    // instead of guessing a multiplier. Cheap at personal-journal scale.
    const pool = kind ? this.countRows('chunk') : k;
    if (pool === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT c.id, c.kind, c.source_ref AS sourceRef, c.local_day AS localDay, c.text, v.distance
         FROM vec_chunk v JOIN chunk c ON c.id = v.rowid
         WHERE v.embedding MATCH ? AND v.k = ?
         ORDER BY v.distance`,
      )
      .all(EpisodicStore.asBuffer(vector), Math.max(pool, k)) as ChunkHit[];
    const filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
    return filtered.slice(0, k);
  }

  private countRows(table: 'chunk' | 'lesson'): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  /** Chunk + embed + insert a whole text; returns chunk ids. */
  async indexText(
    embedder: Embedder,
    kind: ChunkKind,
    sourceRef: string,
    localDay: string | null,
    text: string,
  ): Promise<number[]> {
    const chunks = chunkText(text);
    if (chunks.length === 0) return [];
    const vectors = await embedder.embed(chunks);
    return chunks.map((c, i) => this.insertChunk(kind, sourceRef, localDay, c, vectors[i]!));
  }

  insertLesson(
    text: string,
    domain: string | null,
    evidence: string | null,
    confidence: number,
    vector: Float32Array,
  ): number {
    const insert = this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO lesson (text, domain, evidence, confidence) VALUES (?,?,?,?)')
        .run(text, domain, evidence, confidence);
      this.db
        .prepare('INSERT INTO vec_lesson (rowid, embedding) VALUES (?, ?)')
        .run(BigInt(lastInsertRowid), EpisodicStore.asBuffer(vector));
      return Number(lastInsertRowid);
    });
    return insert();
  }

  searchLessons(vector: Float32Array, k = 4): (LessonRow & { distance: number })[] {
    // Same class of bug as searchChunks: retired/superseded lessons pushed a fixed
    // k*3 window below the true top-k active lessons whenever they outnumbered
    // active ones. Bound by the true row count instead of guessing.
    const pool = this.countRows('lesson');
    if (pool === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT l.*, v.distance
         FROM vec_lesson v JOIN lesson l ON l.id = v.rowid
         WHERE v.embedding MATCH ? AND v.k = ?
         ORDER BY v.distance`,
      )
      .all(EpisodicStore.asBuffer(vector), Math.max(pool, k)) as (LessonRow & { distance: number })[];
    return rows.filter((r) => r.status === 'active').slice(0, k);
  }

  setLessonStatus(id: number, status: LessonStatus): void {
    this.db.prepare('UPDATE lesson SET status = ? WHERE id = ?').run(status, id);
  }

  /**
   * Lessons eligible to graduate into always-on memory (PREFERENCES.md /
   * PLATFORM.md) instead of only ever being situationally KNN-recalled.
   * Deliberately no domain filter — a missing domain must not permanently
   * block graduation (the promotion step decides the destination file by
   * judgment when domain is null). minAgeDays is the load-bearing gate: it's
   * the only criterion immune to same-day recall bursts inflating
   * times_applied (verified against this store's own early data, where one
   * afternoon of manual testing alone produced double-digit times_applied
   * on a lesson that had existed for hours, not weeks).
   */
  listPromotableLessons(minConfidence: number, minTimesApplied: number, minAgeDays: number): LessonRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lesson
         WHERE status = 'active'
           AND confidence >= ?
           AND times_applied >= ?
           AND julianday('now') - julianday(created_at) >= ?
         ORDER BY times_applied DESC`,
      )
      .all(minConfidence, minTimesApplied, minAgeDays) as LessonRow[];
  }

  markLessonUsed(id: number): void {
    this.db
      .prepare("UPDATE lesson SET times_applied = times_applied + 1, last_used_at = datetime('now') WHERE id = ?")
      .run(id);
  }

  close(): void {
    this.db.close();
  }
}
