// Taxes: per tax year, a checklist of the documents the return needs, the
// deductions and other tax-relevant amounts, and packets built for the preparer.
//
// Requires the documents domain: checklist items and deductions link to
// documents(id), and packets are written into the documents vault under
// _packets/. (documents.ts sorts before taxes.ts, so its tables exist first;
// tests load both: makeKevin([documents, taxes]).)
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import { type DB, nowIso } from '../db.js';
import { defineDomain } from '../domains.js';
import { localDay } from '../time.js';
import { defineTool, ToolError } from '../tools.js';
import { copyPrivate, documentFileUrl, ensureVaultDir, isoDay, sendVaultFile, vaultFile, vaultRoot } from './_documents/vault.js';
import { archive, CATEGORY_LABELS, summaryMarkdown } from './_taxes/packet.js';

export const DEDUCTION_CATEGORIES = ['charity', 'medical', 'state_local_tax', 'mortgage_interest', 'business', 'education', 'retirement', 'hsa', 'childcare', 'energy', 'payment', 'other'] as const;
const ITEM_STATUSES = ['expected', 'received', 'not_applicable'] as const;

const cents = (n: number): number => Math.round(n * 100) / 100;
const blank = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);
const packetFileUrl = (id: number): string => `/api/x/taxes/packets/${id}/file`;

interface YearRow { year: number; status: string; preparer_notes: string; created_at: string; updated_at: string }
interface ItemRow { id: number; year: number; label: string; form_type: string | null; status: string; document_id: number | null; document_title: string | null; notes: string | null; created_at: string; updated_at: string }
interface DeductionRow { id: number; year: number; category: string; description: string; amount: number; date: string | null; document_id: number | null; document_title: string | null; notes: string | null; created_at: string; updated_at: string }
interface PacketRow { id: number; year: number; file_path: string; format: string; file_count: number; missing_count: number; size_bytes: number; created_at: string }

const getYear = (db: DB, year: number): YearRow | undefined => db.prepare('SELECT * FROM taxes_years WHERE year = ?').get(year) as YearRow | undefined;

function ensureYear(db: DB, year: number): void {
  const now = nowIso();
  db.prepare('INSERT INTO taxes_years (year, created_at, updated_at) VALUES (?,?,?) ON CONFLICT(year) DO NOTHING').run(year, now, now);
}

const itemsOf = (db: DB, year: number): ItemRow[] =>
  db
    .prepare(
      `SELECT i.id, i.year, i.label, i.form_type, i.status, i.document_id, d.title AS document_title, i.notes, i.created_at, i.updated_at
       FROM taxes_checklist_items i LEFT JOIN documents d ON d.id = i.document_id WHERE i.year = ? ORDER BY i.id`,
    )
    .all(year) as ItemRow[];

const deductionsOf = (db: DB, year: number): DeductionRow[] =>
  db
    .prepare(
      `SELECT x.id, x.year, x.category, x.description, x.amount, x.date, x.document_id, d.title AS document_title, x.notes, x.created_at, x.updated_at
       FROM taxes_deductions x LEFT JOIN documents d ON d.id = x.document_id WHERE x.year = ? ORDER BY x.category, x.date IS NULL, x.date, x.id`,
    )
    .all(year) as DeductionRow[];

function progressOf(items: { status: string }[]): { total: number; received: number; expected: number; not_applicable: number } {
  const n = (s: string) => items.filter((i) => i.status === s).length;
  return { total: items.length, received: n('received'), expected: n('expected'), not_applicable: n('not_applicable') };
}

/** Totals per category for a year. Payments are kept apart: they are not deductions. */
function totalsOf(rows: { category: string; amount: number }[]): { by_category: { category: string; label: string; total: number; count: number }[]; deductions_total: number; payments_total: number } {
  const by = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const cur = by.get(r.category) ?? { total: 0, count: 0 };
    cur.total += r.amount;
    cur.count++;
    by.set(r.category, cur);
  }
  const by_category = DEDUCTION_CATEGORIES.filter((c) => by.has(c)).map((c) => ({ category: c as string, label: CATEGORY_LABELS[c] ?? c, total: cents(by.get(c)!.total), count: by.get(c)!.count }));
  return {
    by_category,
    deductions_total: cents(by_category.filter((c) => c.category !== 'payment').reduce((s, c) => s + c.total, 0)),
    payments_total: by.has('payment') ? cents(by.get('payment')!.total) : 0,
  };
}

function requireDocument(db: DB, id: number, where: string): void {
  if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) throw new ToolError(`${where}: there is no document ${id} in the vault. File the upload with ingest_document first, or find the id with SELECT id, title FROM documents WHERE tax_year = ... .`);
}

/** Home: a year whose return is not filed shows up once the tax year is over and documents are still out, and throughout January to April. */
export function taxHomeCards(db: DB, today: string = localDay()): { cards: { title: string; lines: string[]; link: string }[] } {
  const thisYear = Number(today.slice(0, 4));
  const inSeason = Number(today.slice(5, 7)) <= 4;
  const cards: { title: string; lines: string[]; link: string }[] = [];
  const years = db.prepare("SELECT year FROM taxes_years WHERE status != 'filed' AND year < ? ORDER BY year DESC").all(thisYear) as { year: number }[];
  for (const { year } of years) {
    const items = itemsOf(db, year);
    const p = progressOf(items);
    const due = inSeason && year === thisYear - 1;
    if (!p.expected && !due) continue;
    const needed = p.received + p.expected;
    if (!needed) {
      cards.push({ title: `${year} taxes: no checklist yet`, lines: ['Nothing is listed as expected for this return.'], link: '/taxes' });
    } else if (p.expected) {
      const missing = items.filter((i) => i.status === 'expected').map((i) => i.label);
      cards.push({
        title: `${year} taxes: ${p.received} of ${needed} documents in`,
        lines: [...missing.slice(0, 4).map((l) => `Missing: ${l}`), ...(missing.length > 4 ? [`and ${missing.length - 4} more`] : [])],
        link: '/taxes',
      });
    } else {
      const packet = db.prepare('SELECT created_at FROM taxes_packets WHERE year = ? ORDER BY id DESC LIMIT 1').get(year) as { created_at: string } | undefined;
      cards.push({
        title: `${year} taxes: ${p.received} of ${needed} documents in`,
        lines: [packet ? `Everything is in. Packet built ${localDay(new Date(packet.created_at))}.` : 'Everything is in. The packet for the preparer can be built.'],
        link: '/taxes',
      });
    }
  }
  // In season with earlier years on record but nothing started for the return now due.
  if (inSeason && !getYear(db, thisYear - 1) && db.prepare('SELECT 1 FROM taxes_years WHERE year < ?').get(thisYear - 1)) {
    cards.push({ title: `${thisYear - 1} taxes: not started`, lines: ['No checklist for this return yet. Last year\'s can be copied as a start.'], link: '/taxes' });
  }
  return { cards };
}

function yearDetail(db: DB, year: number) {
  const y = getYear(db, year);
  const items = itemsOf(db, year);
  const deductions = deductionsOf(db, year);
  const totals = totalsOf(deductions);
  const withUrl = <T extends { document_id: number | null }>(r: T) => ({ ...r, document_file_url: r.document_id == null ? null : documentFileUrl(r.document_id) });
  const packets = db.prepare('SELECT * FROM taxes_packets WHERE year = ? ORDER BY id DESC').all(year) as PacketRow[];
  return {
    year,
    exists: !!y,
    status: y?.status ?? null,
    preparer_notes: y?.preparer_notes ?? '',
    progress: progressOf(items),
    checklist: items.map(withUrl),
    missing: items.filter((i) => i.status === 'expected').map((i) => i.label),
    deduction_groups: totals.by_category
      .filter((c) => c.category !== 'payment')
      .map((c) => ({ ...c, items: deductions.filter((d) => d.category === c.category).map(withUrl) })),
    deductions_total: totals.deductions_total,
    payments: deductions.filter((d) => d.category === 'payment').map(withUrl),
    payments_total: totals.payments_total,
    packets: packets.map((p) => ({ id: p.id, year: p.year, filename: basename(p.file_path), format: p.format, file_count: p.file_count, missing_count: p.missing_count, size_bytes: p.size_bytes, created_at: p.created_at, file_url: packetFileUrl(p.id) })),
  };
}

const yearField = z.number().int().min(1990).max(2100).describe('The tax year: the calendar year the income was earned in, e.g. 2026 for the return filed in spring 2027.');

export default defineDomain({
  name: 'taxes',
  migrations: [
    {
      id: 'taxes-001',
      sql: `
      CREATE TABLE taxes_years (
        -- One row per tax return (US federal + state, individual).
        year INTEGER PRIMARY KEY,                      -- the tax year: income earned in this calendar year, return filed the following spring
        status TEXT NOT NULL DEFAULT 'open',           -- open (still gathering) | filed (return is done)
        preparer_notes TEXT NOT NULL DEFAULT '',       -- what Ben wants the preparer to know; printed at the top of the packet
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE taxes_checklist_items (
        -- The documents a year's return needs, one row each.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL REFERENCES taxes_years(year) ON DELETE CASCADE,
        label TEXT NOT NULL,                           -- 'W-2 from Acme', '1099-INT from Ally Bank', 'Property tax statement'
        form_type TEXT,                                -- 'W-2', '1099-INT', '1099-B', '1098', '1099-SA', '5498-SA'; NULL when there is no form (receipts, statements)
        status TEXT NOT NULL DEFAULT 'expected',       -- expected (still missing) | received | not_applicable (does not apply this year)
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,   -- the vault document that satisfies this item
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX taxes_checklist_items_year_label ON taxes_checklist_items(year, label COLLATE NOCASE);
      CREATE TABLE taxes_deductions (
        -- Deductible and other tax-relevant amounts for a year, one row per payment or receipt.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL REFERENCES taxes_years(year) ON DELETE CASCADE,
        category TEXT NOT NULL,                        -- charity | medical | state_local_tax | mortgage_interest | business | education | retirement | hsa | childcare | energy | other | payment (estimated tax paid or withholding: not a deduction, exclude from deduction totals)
        description TEXT NOT NULL,
        amount REAL NOT NULL,                          -- dollars
        date TEXT,                                     -- YYYY-MM-DD it was paid or given
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,   -- the receipt or statement in the vault
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX taxes_deductions_year_category ON taxes_deductions(year, category);
      CREATE TABLE taxes_packets (
        -- Archives built for the preparer with tax_packet_build; Ben downloads them on the Taxes page.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL REFERENCES taxes_years(year) ON DELETE CASCADE,
        file_path TEXT NOT NULL,                       -- relative to the vault folder
        format TEXT NOT NULL,                          -- zip | tar.gz
        file_count INTEGER NOT NULL,                   -- document files inside, not counting summary.md
        missing_count INTEGER NOT NULL,                -- checklist items still expected when it was built
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX taxes_packets_year ON taxes_packets(year);
      `,
    },
  ],
  promptNote: `Ben's US federal and state income tax return, one row per tax year in taxes_years. Each year has a checklist of the documents the return needs (taxes_checklist_items), the deductions and other tax-relevant amounts (taxes_deductions), and packets built for his preparer (taxes_packets).
To start a year, call tax_checklist_update with copy_from_year so last year's items carry over, then adjust for what changed (a new employer, a new account, a refinance).
When a tax document arrives, file it with ingest_document (category tax, tax_year set) and link it to its checklist item by passing document_id in tax_checklist_update; the item becomes received.
Record deductible or tax-relevant spending when Ben mentions it or uploads the receipt, with tax_deductions_update: amounts in dollars, the date paid, and the receipt's document id when it is in the vault. Estimated tax payments go in category payment.
What is still missing: SELECT label, form_type FROM taxes_checklist_items WHERE year = 2026 AND status = 'expected'. When Ben is ready to hand the year over, tax_packet_build makes the archive and he downloads it on the Taxes page (/taxes).`,
  tools: [
    defineTool({
      name: 'tax_checklist_update',
      description:
        'Create or change a tax year and its document checklist in one call: start the year (optionally copying another year\'s checklist), add, change or remove checklist items, link vault documents to items, write the notes for the preparer, and mark the year filed. Use it when a tax season starts, when a tax form arrives, when Ben says an item does not apply this year, and when he dictates something the preparer should know. Returns the year\'s full checklist with item ids.',
      input: z.object({
        year: yearField,
        copy_from_year: yearField.optional().describe('Copy this year\'s checklist items into `year`: every item not already there is added as expected, with no linked document. Use the previous year when starting a new one.'),
        items: z
          .array(
            z.object({
              id: z.number().int().optional().describe('taxes_checklist_items.id of an existing item. Without it the item is matched by label within the year, and created when no item has that label.'),
              label: z.string().min(1).max(160).optional().describe('What is expected and from whom: "W-2 from Acme", "1099-INT from Ally Bank", "1098 mortgage interest, Chase", "Property tax statement", "Charity receipts".'),
              form_type: z.string().max(40).nullable().optional().describe('The form number when there is one: W-2, 1099-INT, 1099-DIV, 1099-B, 1098, 1099-SA, 5498-SA, 1095-C.'),
              status: z.enum(ITEM_STATUSES).optional().describe('expected: still waiting for it. received: Ben has it. not_applicable: does not apply this year. Linking a document sets received on its own.'),
              document_id: z.number().int().nullable().optional().describe('documents.id of the filed document that satisfies this item; null unlinks it.'),
              notes: z.string().max(2000).nullable().optional(),
              delete: z.boolean().optional().describe('true removes the item (give its id or label).'),
            }),
          )
          .max(100)
          .optional()
          .describe('Checklist items to add, change or remove. Items you leave out are untouched.'),
        preparer_notes: z.string().max(20_000).optional().describe('The full text of the notes for the preparer; replaces what is there. It is printed at the top of the packet.'),
        status: z.enum(['open', 'filed']).optional().describe('filed once the return has been submitted; the year then stops appearing on Home.'),
      }),
      touches: ['taxes'],
      run: (i, ctx) => {
        const { db } = ctx;
        let copied = 0;
        db.transaction(() => {
          const now = nowIso();
          ensureYear(db, i.year);
          if (i.copy_from_year != null) {
            if (i.copy_from_year === i.year) throw new ToolError('copy_from_year is the same year as year.');
            const source = itemsOf(db, i.copy_from_year);
            if (!source.length) {
              const have = (db.prepare('SELECT DISTINCT year FROM taxes_checklist_items ORDER BY year DESC').all() as { year: number }[]).map((r) => r.year);
              throw new ToolError(`There is no checklist for ${i.copy_from_year} to copy. ${have.length ? `Years with a checklist: ${have.join(', ')}.` : 'No year has a checklist yet; add the items directly.'}`);
            }
            const ins = db.prepare(
              `INSERT INTO taxes_checklist_items (year, label, form_type, status, document_id, notes, created_at, updated_at)
               SELECT ?, ?, ?, 'expected', NULL, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM taxes_checklist_items WHERE year = ? AND label = ? COLLATE NOCASE)`,
            );
            for (const s of source) copied += ins.run(i.year, s.label, s.form_type, s.notes, now, now, i.year, s.label).changes;
          }
          (i.items ?? []).forEach((it, n) => {
            const at = `items[${n}]${it.label ? ` "${it.label}"` : ''}`;
            const label = it.label?.trim();
            const cur = (it.id != null
              ? db.prepare('SELECT * FROM taxes_checklist_items WHERE id = ?').get(it.id)
              : label
                ? db.prepare('SELECT * FROM taxes_checklist_items WHERE year = ? AND label = ? COLLATE NOCASE').get(i.year, label)
                : undefined) as ItemRow | undefined;
            if (it.id != null && !cur) throw new ToolError(`${at}: there is no checklist item ${it.id}.`);
            if (cur && cur.year !== i.year) throw new ToolError(`${at}: checklist item ${cur.id} belongs to ${cur.year}, and this call is for ${i.year}.`);
            if (it.delete) {
              if (!cur) throw new ToolError(`${at}: nothing to delete; give the id or the exact label of an item in ${i.year}.`);
              db.prepare('DELETE FROM taxes_checklist_items WHERE id = ?').run(cur.id);
              return;
            }
            if (it.document_id != null) requireDocument(db, it.document_id, at);
            // A linked document means the item is in hand, unless the call says otherwise.
            const status = it.status ?? (it.document_id != null ? 'received' : undefined);
            if (!cur) {
              if (!label) throw new ToolError(`${at}: a new checklist item needs a label.`);
              db.prepare('INSERT INTO taxes_checklist_items (year, label, form_type, status, document_id, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
                i.year, label, blank(it.form_type), status ?? 'expected', it.document_id ?? null, blank(it.notes), now, now,
              );
              return;
            }
            // With an id, a label renames the item; without one the label only found it.
            if (it.id != null && label && label.toLowerCase() !== cur.label.toLowerCase() && db.prepare('SELECT 1 FROM taxes_checklist_items WHERE year = ? AND label = ? COLLATE NOCASE AND id != ?').get(i.year, label, cur.id)) {
              throw new ToolError(`${at}: ${i.year} already has an item with that label.`);
            }
            db.prepare('UPDATE taxes_checklist_items SET label = ?, form_type = ?, status = ?, document_id = ?, notes = ?, updated_at = ? WHERE id = ?').run(
              it.id != null ? (label ?? cur.label) : cur.label, it.form_type === undefined ? cur.form_type : blank(it.form_type), status ?? cur.status,
              it.document_id === undefined ? cur.document_id : it.document_id, it.notes === undefined ? cur.notes : blank(it.notes), now, cur.id,
            );
          });
          if (i.preparer_notes !== undefined) db.prepare('UPDATE taxes_years SET preparer_notes = ? WHERE year = ?').run(i.preparer_notes.trim(), i.year);
          if (i.status) db.prepare('UPDATE taxes_years SET status = ? WHERE year = ?').run(i.status, i.year);
          db.prepare('UPDATE taxes_years SET updated_at = ? WHERE year = ?').run(now, i.year);
        })();
        const y = getYear(db, i.year)!;
        const items = itemsOf(db, i.year);
        return {
          year: y.year, status: y.status, preparer_notes: y.preparer_notes, ...(i.copy_from_year != null ? { copied } : {}), progress: progressOf(items),
          checklist: items.map((c) => ({ id: c.id, label: c.label, form_type: c.form_type, status: c.status, document_id: c.document_id, document_title: c.document_title, notes: c.notes })),
        };
      },
    }),
    defineTool({
      name: 'tax_deductions_update',
      description:
        'Add, change or remove a tax year\'s deductions and other tax-relevant amounts, several at once: charitable gifts, medical costs, state and local taxes, mortgage interest, business and education expenses, retirement and HSA contributions, childcare, energy credits, and estimated tax payments (category payment). Use it whenever Ben mentions or uploads something that belongs on the return. Returns the rows written, with ids, and the year\'s totals by category.',
      input: z.object({
        year: yearField,
        items: z
          .array(
            z.object({
              id: z.number().int().optional().describe('taxes_deductions.id to change or delete an existing row. Leave it out to add a new one.'),
              category: z.enum(DEDUCTION_CATEGORIES).optional().describe('payment is for estimated tax paid and withholding notes; state_local_tax covers property tax and state income tax.'),
              description: z.string().min(1).max(300).optional().describe('What it was and to whom: "Donation to City Harvest", "Q2 federal estimated payment".'),
              amount: z.number().min(0).max(100_000_000).optional().describe('Dollars, e.g. 250 or 1234.56.'),
              date: isoDay.nullable().optional().describe('YYYY-MM-DD it was paid or given.'),
              document_id: z.number().int().nullable().optional().describe('documents.id of the receipt or statement in the vault; null unlinks it.'),
              notes: z.string().max(2000).nullable().optional(),
              delete: z.boolean().optional().describe('true removes the row with this id.'),
            }),
          )
          .min(1)
          .max(200)
          .describe('A new row needs category, description and amount.'),
      }),
      touches: ['taxes'],
      run: (i, ctx) => {
        const { db } = ctx;
        const written: number[] = [];
        const counts = { added: 0, updated: 0, deleted: 0 };
        db.transaction(() => {
          const now = nowIso();
          ensureYear(db, i.year);
          i.items.forEach((it, n) => {
            const at = `items[${n}]${it.description ? ` "${it.description}"` : ''}`;
            if (it.document_id != null) requireDocument(db, it.document_id, at);
            if (it.id == null) {
              if (it.delete) throw new ToolError(`${at}: deleting needs the row's id.`);
              if (!it.category || !it.description?.trim() || it.amount == null) throw new ToolError(`${at}: a new row needs category, description and amount.`);
              written.push(Number(
                db.prepare('INSERT INTO taxes_deductions (year, category, description, amount, date, document_id, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
                  .run(i.year, it.category, it.description.trim(), cents(it.amount), it.date ?? null, it.document_id ?? null, blank(it.notes), now, now).lastInsertRowid,
              ));
              counts.added++;
              return;
            }
            const cur = db.prepare('SELECT * FROM taxes_deductions WHERE id = ?').get(it.id) as DeductionRow | undefined;
            if (!cur) throw new ToolError(`${at}: there is no deduction row ${it.id}.`);
            if (cur.year !== i.year) throw new ToolError(`${at}: row ${cur.id} belongs to ${cur.year}, and this call is for ${i.year}.`);
            if (it.delete) {
              db.prepare('DELETE FROM taxes_deductions WHERE id = ?').run(cur.id);
              counts.deleted++;
              return;
            }
            db.prepare('UPDATE taxes_deductions SET category = ?, description = ?, amount = ?, date = ?, document_id = ?, notes = ?, updated_at = ? WHERE id = ?').run(
              it.category ?? cur.category, it.description?.trim() || cur.description, it.amount == null ? cur.amount : cents(it.amount), it.date === undefined ? cur.date : it.date,
              it.document_id === undefined ? cur.document_id : it.document_id, it.notes === undefined ? cur.notes : blank(it.notes), now, cur.id,
            );
            written.push(cur.id);
            counts.updated++;
          });
          db.prepare('UPDATE taxes_years SET updated_at = ? WHERE year = ?').run(now, i.year);
        })();
        const all = deductionsOf(db, i.year);
        return {
          year: i.year, ...counts,
          items: all.filter((d) => written.includes(d.id)).map((d) => ({ id: d.id, category: d.category, description: d.description, amount: d.amount, date: d.date, document_id: d.document_id, notes: d.notes })),
          totals: totalsOf(all),
        };
      },
    }),
    defineTool({
      name: 'tax_packet_build',
      description:
        'Build the packet for Ben\'s tax preparer for one year: a zip holding summary.md (the checklist with what is received and what is still missing, deductions grouped by category with totals, payments, and the notes for the preparer) and a copy of every document linked to the checklist or to a deduction. Use it when Ben asks for the packet or says he is ready to send the year to his preparer; build it again after anything changes. Ben downloads it on the Taxes page.',
      input: z.object({ year: yearField }),
      touches: ['taxes'],
      run: async ({ year }, ctx) => {
        const { db } = ctx;
        const y = getYear(db, year);
        if (!y) {
          const have = (db.prepare('SELECT year FROM taxes_years ORDER BY year DESC').all() as { year: number }[]).map((r) => r.year);
          throw new ToolError(`There is no tax year ${year}. ${have.length ? `Years on record: ${have.join(', ')}.` : 'Start one with tax_checklist_update.'}`);
        }
        const items = itemsOf(db, year);
        const deductions = deductionsOf(db, year);
        const ids = [...new Set([...items, ...deductions].map((r) => r.document_id).filter((id): id is number => id != null))];

        const packetsDir = join(vaultRoot(), '_packets');
        ensureVaultDir(packetsDir);
        const stage = mkdtempSync(join(packetsDir, '.stage-'));
        const rootName = `tax-${year}`;
        try {
          mkdirSync(join(stage, rootName, 'documents'), { recursive: true, mode: 0o700 });
          const files = new Map<number, string>();
          const unavailable: string[] = [];
          for (const id of ids) {
            const d = db.prepare('SELECT id, title, original_filename, file_path FROM documents WHERE id = ?').get(id) as { id: number; title: string; original_filename: string; file_path: string } | undefined;
            const src = d && vaultFile(d.file_path);
            if (!d || !src) {
              unavailable.push(d?.title ?? `document ${id}`);
              continue;
            }
            const ext = extname(d.original_filename).replace(/[^\w.]/g, '').slice(0, 12);
            const slug = d.title.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
            const name = `documents/${String(files.size + 1).padStart(2, '0')}-${slug}${ext}`;
            copyPrivate(src, join(stage, rootName, name));
            files.set(id, name);
          }
          const summary = summaryMarkdown({ year, builtOn: localDay(), preparerNotes: y.preparer_notes, items, deductions, files });
          writeFileSync(join(stage, rootName, 'summary.md'), summary, { mode: 0o600 });

          const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
          let base = join(packetsDir, `${rootName}-${stamp}`);
          for (let n = 2; vaultFile(join('_packets', `${basename(base)}.zip`)) || vaultFile(join('_packets', `${basename(base)}.tar.gz`)); n++) base = join(packetsDir, `${rootName}-${stamp}-${n}`);
          const { file, format } = await archive(stage, rootName, base);
          chmodSync(file, 0o600);
          const missing = items.filter((c) => c.status === 'expected').map((c) => c.label);
          const size = statSync(file).size;
          const id = Number(
            db.prepare('INSERT INTO taxes_packets (year, file_path, format, file_count, missing_count, size_bytes, created_at) VALUES (?,?,?,?,?,?,?)')
              .run(year, join('_packets', basename(file)), format, files.size, missing.length, size, nowIso()).lastInsertRowid,
          );
          return {
            packet_id: id, year, filename: basename(file), format, file_count: files.size, missing_count: missing.length, missing, size_bytes: size, download_url: packetFileUrl(id),
            ...(unavailable.length ? { files_unavailable: unavailable } : {}),
          };
        } finally {
          rmSync(stage, { recursive: true, force: true });
        }
      },
    }),
  ],
  views: {
    /** Every tax year, newest first, with its progress. */
    years: (_p, db) => ({
      years: (db.prepare('SELECT * FROM taxes_years ORDER BY year DESC').all() as YearRow[]).map((y) => {
        const totals = totalsOf(db.prepare('SELECT category, amount FROM taxes_deductions WHERE year = ?').all(y.year) as { category: string; amount: number }[]);
        const packet = db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM taxes_packets WHERE year = ?').get(y.year) as { n: number; last: string | null };
        return {
          year: y.year, status: y.status, progress: progressOf(db.prepare('SELECT status FROM taxes_checklist_items WHERE year = ?').all(y.year) as { status: string }[]),
          deductions_total: totals.deductions_total, payments_total: totals.payments_total, packet_count: packet.n, last_packet_at: packet.last, updated_at: y.updated_at,
        };
      }),
    }),
    /** ?year= (default: the newest year on record). `exists` is false, with empty lists, when the year has not been started. */
    year: (p, db) => {
      const year = Number.isInteger(Number(p.year)) && p.year ? Number(p.year) : (db.prepare('SELECT MAX(year) AS y FROM taxes_years').get() as { y: number | null }).y;
      return year == null ? { year: null, exists: false } : yearDetail(db, year);
    },
    home: (_p, db) => taxHomeCards(db),
  },
  routes(router, db) {
    // GET /api/x/taxes/packets/:id/file — downloads a built packet.
    router.get('/packets/:id/file', (req, res) => {
      const id = String(req.params.id);
      const p = /^\d+$/.test(id) ? (db.prepare('SELECT * FROM taxes_packets WHERE id = ?').get(Number(id)) as PacketRow | undefined) : undefined;
      if (!p || !sendVaultFile(res, p.file_path, { mime: p.format === 'zip' ? 'application/zip' : 'application/gzip', filename: basename(p.file_path), inline: false })) {
        res.status(404).json({ error: 'no such packet' });
      }
    });
  },
});
