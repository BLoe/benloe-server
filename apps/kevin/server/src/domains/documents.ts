// Documents: the vault of Ben's kept paperwork. A document is a file on disk
// (config.dataDir/documents/<category>/<id>-<name>, owner-only) plus a row of
// metadata and the text extracted from it at upload, indexed for recall.
// The text of a document is never logged.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { attachmentPath, getAttachment } from '../attachments.js';
import { type DB, nowIso } from '../db.js';
import { defineDomain } from '../domains.js';
import { indexItem, keywordSearch, unindexItem } from '../memory.js';
import { defineTool, ToolError } from '../tools.js';
import { copyPrivate, documentFileUrl, ensureVaultDir, isoDay, safeFilename, sendVaultFile, vaultFile, vaultPath } from './_documents/vault.js';

export const CATEGORIES = ['medical', 'insurance', 'tax', 'financial', 'legal', 'home', 'vehicle', 'identity', 'receipt', 'other'] as const;

interface Row {
  id: number; title: string; category: string; document_date: string | null; issuer: string | null; tax_year: number | null;
  summary: string | null; notes: string | null; extracted_text: string | null; text_chars: number;
  original_filename: string; mime: string; size_bytes: number; sha256: string; file_path: string; attachment_id: number | null;
  created_at: string; updated_at: string;
}

/** What the page and tool results carry: everything but the full text and the on-disk details. */
export interface DocumentInfo {
  id: number; title: string; category: string; tags: string[]; document_date: string | null; issuer: string | null; tax_year: number | null;
  summary: string | null; notes: string | null; original_filename: string; mime: string; size_bytes: number; text_chars: number;
  created_at: string; updated_at: string; file_url: string;
}

const tagsOf = (db: DB, id: number): string[] =>
  (db.prepare('SELECT tag FROM documents_tags WHERE document_id = ? ORDER BY tag').all(id) as { tag: string }[]).map((t) => t.tag);

const info = (db: DB, r: Row): DocumentInfo => ({
  id: r.id, title: r.title, category: r.category, tags: tagsOf(db, r.id), document_date: r.document_date, issuer: r.issuer, tax_year: r.tax_year,
  summary: r.summary, notes: r.notes, original_filename: r.original_filename, mime: r.mime, size_bytes: r.size_bytes, text_chars: r.text_chars,
  created_at: r.created_at, updated_at: r.updated_at, file_url: documentFileUrl(r.id),
});

const getRow = (db: DB, id: number): Row | undefined => db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Row | undefined;

const cleanTags = (tags: string[]): string[] => [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))].sort();

function setTags(db: DB, id: number, tags: string[]): void {
  db.prepare('DELETE FROM documents_tags WHERE document_id = ?').run(id);
  const ins = db.prepare('INSERT INTO documents_tags (document_id, tag) VALUES (?, ?)');
  for (const t of cleanTags(tags)) ins.run(id, t);
}

/** (Re)writes the document's entry in the search index: metadata first, then the full text. */
function reindex(db: DB, id: number): void {
  const r = getRow(db, id);
  if (!r) return;
  const tags = tagsOf(db, id);
  const head = [
    `Category: ${r.category}`, r.issuer && `From: ${r.issuer}`, r.document_date && `Date: ${r.document_date}`,
    r.tax_year != null && `Tax year: ${r.tax_year}`, tags.length > 0 && `Tags: ${tags.join(', ')}`,
  ].filter(Boolean).join(' · ');
  const body = [head, r.summary, r.notes, r.extracted_text].filter(Boolean).join('\n\n');
  indexItem(db, 'document', id, r.title, body, r.document_date ?? r.created_at);
}

const blank = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

const meta = {
  category: z.enum(CATEGORIES).describe('receipt is for proof of a purchase; tax is for forms and letters that belong to a return (W-2, 1099, 1098, IRS notices).'),
  tags: z.array(z.string().min(1).max(40)).max(20).describe('Short lowercase labels Ben would filter by: a person, a provider, an account, a topic. e.g. ["dental", "hsa"]. Replaces the whole list.'),
  document_date: isoDay.describe('The date printed on the document (statement date, date of service, issue date) as YYYY-MM-DD.'),
  issuer: z.string().max(120).describe('Who the document came from, as Ben would say it: "Aetna", "IRS", "Dr. Alvarez", "Fidelity".'),
  tax_year: z.number().int().min(1990).max(2100).describe('The tax year this belongs to when it matters for a return: a W-2 for wages earned in 2026 is 2026 even though it arrives in 2027.'),
  summary: z.string().max(1500).describe('One to three sentences with the facts someone would look this document up for: what it is, the amounts, the dates, the account or claim it concerns.'),
  notes: z.string().max(4000).describe('Ben\'s own remarks about the document, in his words.'),
};

/** Home: what was filed in the last seven days. */
export function documentsHomeCards(db: DB, now = new Date()): { cards: { title: string; lines: string[]; link: string }[] } {
  const recent = db
    .prepare('SELECT title, category FROM documents WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC')
    .all(new Date(now.getTime() - 7 * 86_400_000).toISOString(), now.toISOString()) as { title: string; category: string }[];
  if (!recent.length) return { cards: [] };
  const lines = recent.slice(0, 4).map((d) => `${d.title} (${d.category})`);
  if (recent.length > 4) lines.push(`and ${recent.length - 4} more`);
  return { cards: [{ title: `${recent.length} document${recent.length === 1 ? '' : 's'} filed this week`, lines, link: '/documents' }] };
}

const LIST_COLS = 'd.id, d.title, d.category, d.document_date, d.issuer, d.tax_year, d.summary, d.notes, d.text_chars, d.original_filename, d.mime, d.size_bytes, d.created_at, d.updated_at';

export default defineDomain({
  name: 'documents',
  migrations: [
    {
      id: 'documents-001',
      sql: `
      CREATE TABLE documents (
        -- The vault: one row per kept file (statements, policies, lab results, tax forms, receipts).
        -- The file itself is on disk; Ben opens it on the Documents page.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',        -- medical | insurance | tax | financial | legal | home | vehicle | identity | receipt | other
        document_date TEXT,                            -- YYYY-MM-DD printed on the document (statement date, date of service); not when it was filed
        issuer TEXT,                                   -- who it came from: 'Aetna', 'IRS', 'Dr. Alvarez'
        tax_year INTEGER,                              -- the return it belongs to, when it matters for taxes
        summary TEXT,                                  -- one to three sentences; use this when listing documents
        notes TEXT,                                    -- Ben's own remarks
        extracted_text TEXT,                           -- the full text of the file; large, read it in slices with substr(extracted_text, 1, 8000)
        text_chars INTEGER NOT NULL DEFAULT 0,         -- length of extracted_text; 0 means the file had no readable text
        original_filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL UNIQUE,                   -- of the file's bytes; the same file cannot be filed twice
        file_path TEXT NOT NULL,                       -- where the file is, relative to the vault folder
        attachment_id INTEGER,                         -- attachments.id of the upload it was filed from
        created_at TEXT NOT NULL,                      -- when it was filed in the vault
        updated_at TEXT NOT NULL
      );
      CREATE INDEX documents_category_date ON documents(category, document_date);
      CREATE INDEX documents_tax_year ON documents(tax_year);
      CREATE INDEX documents_created ON documents(created_at);
      CREATE TABLE documents_tags (
        -- One row per tag on a document. Tags are lowercase.
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (document_id, tag)
      );
      CREATE INDEX documents_tags_tag ON documents_tags(tag);
      `,
    },
  ],
  promptNote: `The vault of Ben's kept paperwork: medical, insurance, tax, financial, legal, home, vehicle and identity documents, and receipts. Each row in \`documents\` is a file stored on this server together with the text read from it.
When Ben uploads something worth keeping (a statement, a bill, a policy, a lab result, a tax form, a receipt for a large or deductible purchase), file it with ingest_document in the same turn, filling the title, category, document_date, issuer, tags, tax_year and summary from the text of the upload. A title says what it is, from whom and for when: "Aetna EOB, Dr. Alvarez visit, March 2026".
To find documents, SELECT id, title, category, document_date, issuer, summary FROM documents (tags are in documents_tags), or search inside their text with recall and kinds ["document"]; a hit's ref is the document id. Listings use summary. To read one document, SELECT substr(extracted_text, 1, 8000) and continue from 8001 while text_chars is larger.
Ben opens and downloads the files themselves on the Documents page (/documents).`,
  tools: [
    defineTool({
      name: 'ingest_document',
      description:
        'File an uploaded file in the documents vault so it is kept permanently, searchable and listed on the Documents page. Use it when Ben uploads paperwork worth keeping: medical records and bills, insurance policies and EOBs, tax forms, statements, contracts, titles, IDs, receipts. The file and the text already extracted from the upload are stored; you supply the metadata, read from that text. A file already in the vault is refused with the id of the existing document.',
      input: z.object({
        attachment_id: z.number().int().describe('The id of the upload, as shown with the attachment in the conversation.'),
        title: z.string().min(1).max(200).describe('What it is, from whom, for when: "W-2 2026, Acme Corp", "Aetna EOB, Dr. Alvarez visit, March 2026".'),
        category: meta.category.default('other'),
        tags: meta.tags.optional(),
        document_date: meta.document_date.optional(),
        issuer: meta.issuer.optional(),
        tax_year: meta.tax_year.optional(),
        summary: meta.summary.optional(),
        notes: meta.notes.optional(),
      }),
      touches: ['documents'],
      run: (i, ctx) => {
        const { db } = ctx;
        const a = getAttachment(db, i.attachment_id);
        if (!a) throw new ToolError(`There is no upload with id ${i.attachment_id}. The id is shown with each attachment in the conversation; SELECT id, filename, at FROM attachments ORDER BY id DESC LIMIT 10 lists recent uploads.`);
        const src = attachmentPath(a);
        if (!a.path || !existsSync(src)) throw new ToolError(`The file for upload ${a.id} (${a.filename}) is no longer on disk. Ask Ben to upload it again.`);
        const buf = readFileSync(src);
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const dup = db.prepare('SELECT id, title, category FROM documents WHERE sha256 = ?').get(sha256) as { id: number; title: string; category: string } | undefined;
        if (dup) throw new ToolError(`This exact file is already in the vault as document ${dup.id}, "${dup.title}" (${dup.category}). Change its details with document_update if needed.`);
        const text = a.extracted_text ?? '';
        const now = nowIso();
        let written: string | null = null;
        try {
          const id = db.transaction(() => {
            const newId = Number(
              db
                .prepare(
                  `INSERT INTO documents (title, category, document_date, issuer, tax_year, summary, notes, extracted_text, text_chars,
                     original_filename, mime, size_bytes, sha256, file_path, attachment_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                )
                .run(i.title.trim(), i.category, i.document_date ?? null, blank(i.issuer), i.tax_year ?? null, blank(i.summary), blank(i.notes), text || null, text.length,
                  a.filename, a.mime, buf.length, sha256, '', a.id, now, now).lastInsertRowid,
            );
            const rel = join(i.category, `${newId}-${safeFilename(a.filename)}`);
            const abs = vaultPath(rel);
            if (!abs) throw new Error('bad vault path');
            copyPrivate(src, abs);
            written = abs;
            db.prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(rel, newId);
            setTags(db, newId, i.tags ?? []);
            reindex(db, newId);
            return newId;
          })();
          return { filed: true, ...info(db, getRow(db, id)!), ...(text ? {} : { note: 'No text could be read from this file, so only its title, summary and notes are searchable.' }) };
        } catch (e) {
          if (written) rmSync(written, { force: true });
          throw e;
        }
      },
    }),
    defineTool({
      name: 'document_update',
      description:
        'Correct a document already in the vault: its title, category, tags, date, issuer, tax year, summary or notes. Only the fields you pass change; pass null to clear a date, issuer, tax year, summary or notes. With delete: true the document is removed from the vault for good, file included, after Ben confirms.',
      input: z.object({
        id: z.number().int().describe('documents.id'),
        title: z.string().min(1).max(200).optional(),
        category: meta.category.optional(),
        tags: meta.tags.optional(),
        document_date: meta.document_date.nullable().optional(),
        issuer: meta.issuer.nullable().optional(),
        tax_year: meta.tax_year.nullable().optional(),
        summary: meta.summary.nullable().optional(),
        notes: meta.notes.nullable().optional(),
        delete: z.boolean().optional().describe('true removes the document and its file permanently.'),
      }),
      touches: ['documents', 'taxes'],
      run: async (i, ctx) => {
        const { db } = ctx;
        const r = getRow(db, i.id);
        if (!r) throw new ToolError(`There is no document ${i.id}. SELECT id, title FROM documents finds the right one.`);
        if (i.delete) {
          if (!(await ctx.confirm(`Delete "${r.title}" from the documents vault? The stored file is removed for good.`))) throw new ToolError('Ben declined to delete that document. It is still in the vault.');
          db.transaction(() => {
            db.prepare('DELETE FROM documents WHERE id = ?').run(r.id);
            unindexItem(db, 'document', r.id);
          })();
          const abs = vaultPath(r.file_path);
          if (abs) rmSync(abs, { force: true });
          return { deleted: r.id, title: r.title };
        }
        const category = i.category ?? r.category;
        let filePath = r.file_path;
        let moved: { from: string; to: string } | null = null;
        if (category !== r.category) {
          // The folder on disk follows the category.
          const from = vaultFile(r.file_path);
          const rel = join(category, basename(r.file_path));
          const to = vaultPath(rel);
          if (from && to) {
            ensureVaultDir(dirname(to));
            renameSync(from, to);
            moved = { from, to };
            filePath = rel;
          }
        }
        const pick = <T>(v: T | null | undefined, cur: T | null): T | null => (v === undefined ? cur : v);
        try {
          db.transaction(() => {
            db.prepare('UPDATE documents SET title = ?, category = ?, document_date = ?, issuer = ?, tax_year = ?, summary = ?, notes = ?, file_path = ?, updated_at = ? WHERE id = ?').run(
              i.title?.trim() ?? r.title, category, pick(i.document_date, r.document_date), i.issuer === undefined ? r.issuer : blank(i.issuer), pick(i.tax_year, r.tax_year),
              i.summary === undefined ? r.summary : blank(i.summary), i.notes === undefined ? r.notes : blank(i.notes), filePath, nowIso(), r.id,
            );
            if (i.tags) setTags(db, r.id, i.tags);
            reindex(db, r.id);
          })();
        } catch (e) {
          if (moved) renameSync(moved.to, moved.from);
          throw e;
        }
        return info(db, getRow(db, r.id)!);
      },
    }),
  ],
  views: {
    /**
     * ?category= &tag= &tax_year= &q= &limit= (default 200, max 500) &offset=
     * Without q: newest document date first. With q: best match first, each row carrying a snippet.
     */
    list: (p, db) => {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (p.category) {
        where.push('d.category = ?');
        args.push(p.category);
      }
      if (p.tag) {
        where.push('EXISTS (SELECT 1 FROM documents_tags t WHERE t.document_id = d.id AND t.tag = ?)');
        args.push(p.tag.trim().toLowerCase());
      }
      if (p.tax_year && Number.isInteger(Number(p.tax_year))) {
        where.push('d.tax_year = ?');
        args.push(Number(p.tax_year));
      }
      const q = p.q?.trim() ?? '';
      const rank = new Map<number, { pos: number; snippet: string | null }>();
      if (q) {
        // Full-text hits first, in relevance order; then documents whose title, issuer, filename or a tag contains the typed text.
        for (const h of keywordSearch(db, q, 300, ['document'])) if (!rank.has(Number(h.ref))) rank.set(Number(h.ref), { pos: rank.size, snippet: h.snippet });
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const named = db
          .prepare(
            `SELECT d.id FROM documents d WHERE d.title LIKE ? ESCAPE '\\' OR d.issuer LIKE ? ESCAPE '\\' OR d.original_filename LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM documents_tags t WHERE t.document_id = d.id AND t.tag LIKE ? ESCAPE '\\')
             ORDER BY d.document_date DESC, d.id DESC LIMIT 300`,
          )
          .all(like, like, like, like) as { id: number }[];
        for (const n of named) if (!rank.has(n.id)) rank.set(n.id, { pos: rank.size, snippet: null });
        if (!rank.size) return { documents: [], total: 0 };
        where.push(`d.id IN (${[...rank.keys()].join(',')})`);
      }
      const rows = db
        .prepare(`SELECT ${LIST_COLS} FROM documents d ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.document_date IS NULL, d.document_date DESC, d.id DESC`)
        .all(...args) as Row[];
      if (q) rows.sort((a, b) => rank.get(a.id)!.pos - rank.get(b.id)!.pos);
      const limit = Math.min(500, Math.max(1, Number(p.limit) || 200));
      const offset = Math.max(0, Number(p.offset) || 0);
      return {
        documents: rows.slice(offset, offset + limit).map((r) => ({ ...info(db, r), snippet: q ? (rank.get(r.id)?.snippet ?? null) : null })),
        total: rows.length,
      };
    },
    /** ?id= : one document with its full text. { document: null } when there is none. */
    get: (p, db) => {
      const r = getRow(db, Number(p.id));
      return { document: r ? { ...info(db, r), extracted_text: r.extracted_text ?? '' } : null };
    },
    /** Counts for the filter chips. */
    facets: (_p, db) => ({
      total: (db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n,
      categories: db.prepare('SELECT category, COUNT(*) AS count FROM documents GROUP BY category ORDER BY count DESC, category').all(),
      tags: db.prepare('SELECT tag, COUNT(*) AS count FROM documents_tags GROUP BY tag ORDER BY count DESC, tag').all(),
      tax_years: db.prepare('SELECT tax_year, COUNT(*) AS count FROM documents WHERE tax_year IS NOT NULL GROUP BY tax_year ORDER BY tax_year DESC').all(),
    }),
    home: (_p, db) => documentsHomeCards(db),
  },
  routes(router, db) {
    // GET /api/x/documents/:id/file — the stored file. ?download=1 forces a save dialog.
    router.get('/:id/file', (req, res) => {
      const id = String(req.params.id);
      const r = /^\d+$/.test(id) ? getRow(db, Number(id)) : undefined;
      // Images, PDFs and plain text open in the browser; anything else downloads.
      const inline = !!r && req.query.download !== '1' && (r.mime.startsWith('image/') || r.mime === 'application/pdf' || r.mime === 'text/plain');
      if (!r || !sendVaultFile(res, r.file_path, { mime: r.mime, filename: r.original_filename, inline })) res.status(404).json({ error: 'no such document' });
    });
  },
});
