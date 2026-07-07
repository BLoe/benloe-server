import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { EMBEDDING_DIMS, chunkText, type Embedder } from '../embeddings/index.js';

export type ChunkKind = 'conversation' | 'journal' | 'document';

export interface ChunkHit {
  id: number;
  kind: ChunkKind;
  sourceRef: string;
  localDay: string | null;
  text: string;
  distance: number;
}

export interface LessonRow {
  id: number;
  text: string;
  domain: string | null;
  evidence: string | null;
  confidence: number | null;
  status: 'active' | 'retired' | 'superseded';
  times_applied: number;
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
        status TEXT CHECK(status IN ('active','retired','superseded')) DEFAULT 'active',
        times_applied INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_lesson USING vec0(embedding float[${EMBEDDING_DIMS}]);
    `);
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
    const rows = this.db
      .prepare(
        `SELECT c.id, c.kind, c.source_ref AS sourceRef, c.local_day AS localDay, c.text, v.distance
         FROM vec_chunk v JOIN chunk c ON c.id = v.rowid
         WHERE v.embedding MATCH ? AND v.k = ?
         ORDER BY v.distance`,
      )
      .all(EpisodicStore.asBuffer(vector), k * 3) as ChunkHit[];
    const filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
    return filtered.slice(0, k);
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
    const rows = this.db
      .prepare(
        `SELECT l.*, v.distance
         FROM vec_lesson v JOIN lesson l ON l.id = v.rowid
         WHERE v.embedding MATCH ? AND v.k = ?
         ORDER BY v.distance`,
      )
      .all(EpisodicStore.asBuffer(vector), k * 3) as (LessonRow & { distance: number })[];
    return rows.filter((r) => r.status === 'active').slice(0, k);
  }

  setLessonStatus(id: number, status: 'active' | 'retired' | 'superseded'): void {
    this.db.prepare('UPDATE lesson SET status = ? WHERE id = ?').run(status, id);
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
