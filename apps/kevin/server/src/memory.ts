// Memory: the daily log, the search index over everything recallable, and
// durable facts. Keyword search is SQLite FTS5; when an OpenAI key is present
// in the kevin secret set, embeddings are added and the two are fused.
import { type DB, nowIso } from './db.js';
import { config } from './config.js';
import { localDay } from './time.js';

export interface Hit {
  kind: string; ref: string; title: string; snippet: string; at: string | null;
}

/** Puts (or replaces) one item in the search index. */
export function indexItem(db: DB, kind: string, ref: string | number, title: string, body: string, at: string = nowIso()): void {
  db.prepare('DELETE FROM search_index WHERE kind = ? AND ref = ?').run(kind, String(ref));
  if (!title.trim() && !body.trim()) return;
  db.prepare('INSERT INTO search_index (title, body, kind, ref, at) VALUES (?,?,?,?,?)').run(title, body, kind, String(ref), at);
  if (config.openaiKey) db.prepare('DELETE FROM embeddings WHERE kind = ? AND ref = ?').run(kind, String(ref));
}

export function unindexItem(db: DB, kind: string, ref: string | number): void {
  db.prepare('DELETE FROM search_index WHERE kind = ? AND ref = ?').run(kind, String(ref));
  db.prepare('DELETE FROM embeddings WHERE kind = ? AND ref = ?').run(kind, String(ref));
}

const STOP = new Set(('a an and are as at be but by can did do for from had has have how i if in is it its me my of on or our so than that the their them ' +
  'then there these they this to up was we were what when where which who will with you your about any some just not no yes please kevin').split(' '));

/** Free text -> an FTS5 query: significant words, OR-ed, each quoted so nothing is parsed as syntax. */
export function ftsQuery(text: string): string {
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24);
  return words.map((w) => `"${w}"`).join(' OR ');
}

export function keywordSearch(db: DB, query: string, limit = 8, kinds?: string[]): Hit[] {
  const q = ftsQuery(query);
  if (!q) return [];
  const kindSql = kinds?.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT kind, ref, title, at, snippet(search_index, 1, '', '', ' … ', 40) AS snippet
       FROM search_index WHERE search_index MATCH ? ${kindSql} ORDER BY bm25(search_index, 4.0, 1.0) LIMIT ?`,
    )
    .all(q, ...(kinds ?? []), limit) as Hit[];
}

// ---- embeddings (optional) ---------------------------------------------------

async function embed(texts: string[]): Promise<Float32Array[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => Float32Array.from(d.embedding));
}

const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Embeds indexed items that have no vectors yet. Returns how many it did. No-op without a key. */
export async function embedPending(db: DB, max = 64): Promise<number> {
  if (!config.openaiKey) return 0;
  const rows = db
    .prepare(
      `SELECT s.kind, s.ref, s.title, s.body FROM search_index s
       WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.kind = s.kind AND e.ref = s.ref) LIMIT ?`,
    )
    .all(max) as { kind: string; ref: string; title: string; body: string }[];
  if (!rows.length) return 0;
  const chunks: { kind: string; ref: string; chunk: number; text: string }[] = [];
  for (const r of rows) {
    const text = `${r.title}\n${r.body}`;
    for (let i = 0, n = 0; i < text.length && n < 20; i += 1500, n++) chunks.push({ kind: r.kind, ref: r.ref, chunk: n, text: text.slice(i, i + 1500) });
  }
  const ins = db.prepare('INSERT OR REPLACE INTO embeddings (kind, ref, chunk, text, vec) VALUES (?,?,?,?,?)');
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    const vecs = await embed(batch.map((c) => c.text));
    db.transaction(() => batch.forEach((c, j) => ins.run(c.kind, c.ref, c.chunk, c.text, toBlob(vecs[j]!))))();
  }
  return rows.length;
}

/** Keyword search, fused with vector search when embeddings are on. */
export async function search(db: DB, query: string, limit = 8, kinds?: string[]): Promise<Hit[]> {
  const kw = keywordSearch(db, query, limit * 2, kinds);
  if (!config.openaiKey) return kw.slice(0, limit);
  let vecHits: Hit[] = [];
  try {
    const [qv] = await embed([query]);
    const kindSql = kinds?.length ? `WHERE kind IN (${kinds.map(() => '?').join(',')})` : '';
    const rows = db.prepare(`SELECT kind, ref, text, vec FROM embeddings ${kindSql}`).all(...(kinds ?? [])) as { kind: string; ref: string; text: string; vec: Buffer }[];
    const best = new Map<string, { score: number; row: (typeof rows)[number] }>();
    for (const r of rows) {
      const score = cosine(qv!, fromBlob(r.vec));
      const key = `${r.kind}:${r.ref}`;
      if (!best.has(key) || best.get(key)!.score < score) best.set(key, { score, row: r });
    }
    vecHits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit * 2).map(({ row }) => {
      const meta = db.prepare('SELECT title, at FROM search_index WHERE kind = ? AND ref = ?').get(row.kind, row.ref) as { title: string; at: string } | undefined;
      return { kind: row.kind, ref: row.ref, title: meta?.title ?? '', snippet: row.text.slice(0, 300), at: meta?.at ?? null };
    });
  } catch (e) {
    console.error('vector search failed; keyword only', e);
  }
  // Reciprocal rank fusion.
  const score = new Map<string, { s: number; hit: Hit }>();
  for (const list of [kw, vecHits]) {
    list.forEach((hit, i) => {
      const key = `${hit.kind}:${hit.ref}`;
      const cur = score.get(key) ?? { s: 0, hit };
      cur.s += 1 / (60 + i);
      score.set(key, cur);
    });
  }
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.hit);
}

// ---- the daily log -----------------------------------------------------------

export function logEvent(db: DB, text: string, threadId: string | null = null, kind: 'event' | 'summary' | 'note' = 'event', at = new Date()): number {
  const day = localDay(at);
  const id = Number(
    db.prepare('INSERT INTO memory_log (at, day, kind, thread_id, text) VALUES (?,?,?,?,?)').run(at.toISOString(), day, kind, threadId, text).lastInsertRowid,
  );
  // Events are searchable too, but summaries and notes carry the weight.
  indexItem(db, `log-${kind}`, id, day, text, at.toISOString());
  return id;
}

// ---- facts -------------------------------------------------------------------

export interface Fact { id: number; text: string; category: string; created_at: string; updated_at: string }

export function listFacts(db: DB): Fact[] {
  return db.prepare('SELECT * FROM facts ORDER BY category, id').all() as Fact[];
}
export function addFact(db: DB, text: string, category = 'general'): Fact {
  const now = nowIso();
  const id = db.prepare('INSERT INTO facts (text, category, created_at, updated_at) VALUES (?,?,?,?)').run(text.trim(), category.trim().toLowerCase() || 'general', now, now).lastInsertRowid;
  return db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as Fact;
}
export function updateFact(db: DB, id: number, text: string, category?: string): boolean {
  return db.prepare('UPDATE facts SET text = ?, category = COALESCE(?, category), updated_at = ? WHERE id = ?').run(text.trim(), category ?? null, nowIso(), id).changes > 0;
}
export function deleteFact(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM facts WHERE id = ?').run(id).changes > 0;
}

// ---- profile -----------------------------------------------------------------

export interface ProfileSection { key: string; title: string; body: string; position: number; updated_at: string; updated_by: string }

export const profileKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'section';

export function listProfile(db: DB): ProfileSection[] {
  return db.prepare('SELECT * FROM profile_sections ORDER BY position, key').all() as ProfileSection[];
}

export function findProfileSection(db: DB, ref: string): ProfileSection | undefined {
  return (db.prepare('SELECT * FROM profile_sections WHERE key = ? OR title = ? COLLATE NOCASE').get(profileKey(ref), ref) as ProfileSection | undefined);
}

/** Creates or replaces a section. The version it replaces is kept in profile_history. */
export function saveProfileSection(db: DB, o: { key: string; title: string; body: string; by: string; position?: number }): ProfileSection {
  const now = nowIso();
  const cur = db.prepare('SELECT * FROM profile_sections WHERE key = ?').get(o.key) as ProfileSection | undefined;
  db.transaction(() => {
    if (cur && (cur.body !== o.body || cur.title !== o.title)) {
      db.prepare('INSERT INTO profile_history (key, title, body, replaced_at, replaced_by) VALUES (?,?,?,?,?)').run(cur.key, cur.title, cur.body, now, o.by);
    }
    const position = o.position ?? cur?.position ?? ((db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM profile_sections').get() as { p: number }).p + 10);
    db.prepare(
      `INSERT INTO profile_sections (key, title, body, position, updated_at, updated_by) VALUES (?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, position = excluded.position, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(o.key, o.title.trim(), o.body.trim(), position, now, o.by);
  })();
  indexItem(db, 'profile', o.key, o.title, o.body);
  return db.prepare('SELECT * FROM profile_sections WHERE key = ?').get(o.key) as ProfileSection;
}

export function deleteProfileSection(db: DB, key: string, by: string): boolean {
  const cur = db.prepare('SELECT * FROM profile_sections WHERE key = ?').get(key) as ProfileSection | undefined;
  if (!cur) return false;
  db.transaction(() => {
    db.prepare('INSERT INTO profile_history (key, title, body, replaced_at, replaced_by) VALUES (?,?,?,?,?)').run(cur.key, cur.title, cur.body, nowIso(), by);
    db.prepare('DELETE FROM profile_sections WHERE key = ?').run(key);
  })();
  unindexItem(db, 'profile', key);
  return true;
}

