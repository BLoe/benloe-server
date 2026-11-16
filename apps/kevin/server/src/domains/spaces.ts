// Spaces: areas Kevin makes on the spot for anything that has no built-in
// page. A trip, car maintenance, a reading list, a home project: each is a
// space with its own fields and records, and it gets a page in the app the
// moment it exists. The built-in areas (pantry, money, ...) exist because they
// need logic a list cannot give; everything else lives here, so a new kind of
// task never needs a code change.
import { z } from 'zod';
import { type DB, getSetting, nowIso, setSetting } from '../db.js';
import { defineDomain } from '../domains.js';
import { indexItem, unindexItem } from '../memory.js';
import { localDay } from '../time.js';
import { defineTool, ToolError } from '../tools.js';

export const LAYOUTS = ['list', 'checklist', 'table', 'board', 'notes'] as const;
export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'checkbox', 'select', 'url'] as const;
/** The built-in pages, in nav order. Ben can hide any of them; Home, Jobs and Settings always show. */
export const BUILTIN_PAGES = [
  { path: '/pantry', name: 'Pantry' }, { path: '/cooking', name: 'Cooking' }, { path: '/workouts', name: 'Workouts' },
  { path: '/money', name: 'Money' }, { path: '/taxes', name: 'Taxes' }, { path: '/documents', name: 'Documents' },
] as const;

export interface Field { key: string; label: string; type: (typeof FIELD_TYPES)[number]; options?: string[] }
interface SpaceRow {
  id: number; slug: string; name: string; icon: string | null; description: string | null; layout: (typeof LAYOUTS)[number];
  fields: string; board_field: string | null; pinned: number; archived: number; created_by: string; created_at: string; updated_at: string;
}
interface RecordRow {
  id: number; space_id: number; title: string; data: string; done: number; due_on: string | null; body: string | null; position: number; attachment_ids: string; created_at: string; updated_at: string;
}

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const day = z.string().refine(isDay, 'must be a real date written YYYY-MM-DD');
const slugify = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'space';
const keyify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

const fieldInput = z.object({
  key: z.string().max(40).optional().describe('snake_case name used in record data and in SQL; derived from the label when omitted.'),
  label: z.string().min(1).max(60).describe('What the page shows: "Mileage", "Booked?"'),
  type: z.enum(FIELD_TYPES).default('text').describe('money is dollars; date is YYYY-MM-DD; select needs options.'),
  options: z.array(z.string().min(1).max(60)).max(30).optional().describe('select only: the allowed values, in order.'),
});

function findSpace(db: DB, ref: string | number): SpaceRow {
  const row = (typeof ref === 'number' || /^\d+$/.test(String(ref))
    ? db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(ref))
    : db.prepare('SELECT * FROM spaces WHERE slug = ? OR name = ? COLLATE NOCASE').get(slugify(String(ref)), String(ref))) as SpaceRow | undefined;
  if (!row) {
    const names = (db.prepare('SELECT slug FROM spaces WHERE archived = 0 ORDER BY slug').all() as { slug: string }[]).map((s) => s.slug);
    throw new ToolError(`No space "${ref}". ${names.length ? `Spaces: ${names.join(', ')}.` : 'There are no spaces yet; create one with space_save.'}`);
  }
  return row;
}

const fieldsOf = (s: SpaceRow): Field[] => JSON.parse(s.fields) as Field[];

/** Checks one record's custom values against the space's fields and returns them in stored form. */
function coerceData(fields: Field[], data: Record<string, unknown>): Record<string, unknown> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(data)) {
    const f = byKey.get(k) ?? fields.find((x) => x.label.toLowerCase() === k.toLowerCase());
    if (!f) throw new ToolError(`"${k}" is not a field of this space. Fields: ${fields.map((x) => x.key).join(', ') || '(none)'}. Add it with space_save first, or put the detail in body.`);
    if (raw === null || raw === '') {
      out[f.key] = null;
      continue;
    }
    if (f.type === 'number' || f.type === 'money') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) throw new ToolError(`${f.key} must be a number; got "${String(raw)}".`);
      out[f.key] = f.type === 'money' ? Math.round(n * 100) / 100 : n;
    } else if (f.type === 'date') {
      if (typeof raw !== 'string' || !isDay(raw)) throw new ToolError(`${f.key} must be a date written YYYY-MM-DD; got "${String(raw)}".`);
      out[f.key] = raw;
    } else if (f.type === 'checkbox') {
      out[f.key] = raw === true || raw === 1 || /^(true|yes|1|done)$/i.test(String(raw));
    } else if (f.type === 'select') {
      const hit = f.options?.find((o) => o.toLowerCase() === String(raw).toLowerCase());
      if (!hit) throw new ToolError(`${f.key} must be one of: ${(f.options ?? []).join(', ')}; got "${String(raw)}".`);
      out[f.key] = hit;
    } else {
      out[f.key] = String(raw);
    }
  }
  return out;
}

function recordView(db: DB, r: RecordRow) {
  const ids = JSON.parse(r.attachment_ids) as number[];
  const attachments = ids
    .map((id) => db.prepare('SELECT id, filename, mime, kind FROM attachments WHERE id = ?').get(id) as { id: number; filename: string; mime: string; kind: string } | undefined)
    .filter((a): a is { id: number; filename: string; mime: string; kind: string } => !!a)
    .map((a) => ({ ...a, url: `/api/attachments/${a.id}/raw` }));
  return {
    id: r.id, title: r.title, done: !!r.done, due_on: r.due_on, body: r.body, data: JSON.parse(r.data) as Record<string, unknown>, position: r.position,
    attachments, created_at: r.created_at, updated_at: r.updated_at,
  };
}

const NAME_NOISE = new Set(['the', 'a', 'an', 'my', 'our', 'to', 'for', 'of', 'in', 'and', 'list', 'tracker', 'tracking', 'log', 'plan', 'planning', 'notes', 'stuff', 'things']);
const nameWords = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => w.replace(/s$/, '')).filter((w) => w.length > 1 && !NAME_NOISE.has(w));

/** Existing spaces whose names share most of their meaningful words with `name`: "Japan trip" vs "Trip to Japan". */
export function similarSpaces(db: DB, name: string): { slug: string; name: string }[] {
  const want = new Set(nameWords(name));
  if (!want.size) return [];
  return (db.prepare('SELECT slug, name FROM spaces WHERE archived = 0').all() as { slug: string; name: string }[]).filter((s) => {
    const have = new Set(nameWords(s.name));
    if (!have.size) return false;
    const shared = [...want].filter((w) => have.has(w)).length;
    return shared / Math.min(want.size, have.size) >= 0.6;
  });
}

/**
 * Reconciles a new field list with the old one. A field keeps its key for life: the key is what
 * records, SQL in scheduled checks and the table layout read by, so a rename changes the label only.
 * A type change converts the stored values, and is refused if any value cannot be converted.
 */
function reconcileFields(db: DB, s: SpaceRow, incoming: { key?: string; label: string; type: Field['type']; options?: string[] }[]): Field[] {
  const old = fieldsOf(s);
  const used = new Set<string>();
  const next: Field[] = incoming.map((f) => {
    const prior = (f.key && old.find((o) => o.key === keyify(f.key!))) || old.find((o) => o.label.toLowerCase() === f.label.toLowerCase() && !used.has(o.key));
    const key = prior?.key ?? keyify(f.key ?? f.label);
    used.add(key);
    return { key, label: f.label, type: f.type, ...(f.type === 'select' ? { options: f.options ?? [] } : {}) };
  });
  const changed = next.filter((f) => {
    const o = old.find((x) => x.key === f.key);
    return o && (o.type !== f.type || (f.type === 'select' && JSON.stringify(o.options) !== JSON.stringify(f.options)));
  });
  if (changed.length) {
    const rows = db.prepare('SELECT id, title, data FROM space_records WHERE space_id = ?').all(s.id) as { id: number; title: string; data: string }[];
    const upd = db.prepare('UPDATE space_records SET data = ? WHERE id = ?');
    for (const r of rows) {
      const data = JSON.parse(r.data) as Record<string, unknown>;
      let touched = false;
      for (const f of changed) {
        if (data[f.key] == null || data[f.key] === '') continue;
        try {
          data[f.key] = coerceData([f], { [f.key]: data[f.key] })[f.key];
          touched = true;
        } catch {
          throw new ToolError(`Changing "${f.label}" to ${f.type} would lose data: the record "${r.title}" holds "${String(data[f.key])}". Fix or clear those values first, or add a new field instead.`);
        }
      }
      if (touched) upd.run(JSON.stringify(data), r.id);
    }
  }
  return next;
}


function spaceView(db: DB, s: SpaceRow) {
  const c = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done = 0), 0) AS open, COALESCE(SUM(done = 0 AND due_on IS NOT NULL AND due_on <= ?), 0) AS due FROM space_records WHERE space_id = ?')
    .get(localDay(new Date(Date.now() + 3 * 86_400_000)), s.id) as { total: number; open: number; due: number };
  return {
    id: s.id, slug: s.slug, name: s.name, icon: s.icon, description: s.description, layout: s.layout, fields: fieldsOf(s), board_field: s.board_field,
    pinned: !!s.pinned, archived: !!s.archived, created_by: s.created_by, created_at: s.created_at, updated_at: s.updated_at,
    link: `/s/${s.slug}`, counts: { total: c.total, open: c.open, due_soon: c.due },
  };
}

function indexRecord(db: DB, s: SpaceRow, r: RecordRow): void {
  const data = Object.entries(JSON.parse(r.data) as Record<string, unknown>).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join('; ');
  indexItem(db, 'space-record', r.id, `${s.name}: ${r.title}`, [data, r.due_on ? `due ${r.due_on}` : '', r.body ?? ''].filter(Boolean).join('\n'), r.updated_at);
}

export default defineDomain({
  name: 'spaces',
  migrations: [
    {
      id: 'spaces-001',
      sql: `
      CREATE TABLE spaces (
        -- Areas made for things with no built-in page: a trip, car maintenance, a reading list. Each has a page at /s/<slug>.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,                 -- url name: 'portugal-trip'
        name TEXT NOT NULL,                        -- 'Portugal trip'
        icon TEXT,                                 -- a lucide icon name for the nav: 'plane', 'car', 'book-open'
        description TEXT,                          -- one line: what this space is for
        layout TEXT NOT NULL DEFAULT 'list',       -- how the page shows records: list | checklist | table | board | notes
        fields TEXT NOT NULL DEFAULT '[]',         -- JSON array of custom fields: [{"key":"mileage","label":"Mileage","type":"number"}]; types: text longtext number money date checkbox select url
        board_field TEXT,                          -- board layout: the select field whose options are the columns
        pinned INTEGER NOT NULL DEFAULT 1,         -- 1 = shown in the nav
        archived INTEGER NOT NULL DEFAULT 0,       -- 1 = finished with; hidden, records kept
        created_by TEXT NOT NULL DEFAULT 'kevin',  -- kevin | ben
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE space_records (
        -- The rows of a space. Every record has a title; done, due_on and body are there for any space to use.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',           -- JSON object of the space's custom fields by key. Read with json_extract(data, '$.mileage')
        done INTEGER NOT NULL DEFAULT 0,           -- 1 = completed / checked off
        due_on TEXT,                               -- YYYY-MM-DD; open records due within 3 days appear on Home
        body TEXT,                                 -- free-form notes in markdown; the whole content in a 'notes' space
        position REAL NOT NULL DEFAULT 0,          -- manual order within the space, ascending
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX space_records_space ON space_records(space_id, done, position);
      CREATE INDEX space_records_due ON space_records(done, due_on);
      `,
    },
    {
      id: 'spaces-002',
      // Files attached to a record: a booking confirmation on a trip item, a receipt on a repair.
      sql: `ALTER TABLE space_records ADD COLUMN attachment_ids TEXT NOT NULL DEFAULT '[]';   -- JSON array of attachments.id (uploaded files shown on the record)`,
    },
  ],
  promptState: (db) => {
    const rows = db.prepare('SELECT * FROM spaces WHERE archived = 0 ORDER BY name COLLATE NOCASE').all() as SpaceRow[];
    if (!rows.length) return '# Spaces\n\nNone yet.';
    return '# Spaces that exist\n\n' + rows.map((r) => {
      const f = fieldsOf(r).map((x) => x.key).join(', ');
      return `- ${r.slug} — ${r.name} (${r.layout}${f ? `; fields: ${f}` : ''})${r.description ? `: ${r.description}` : ''}`;
    }).join('\n');
  },
  promptNote: `Spaces are how you handle anything that is not pantry, cooking, workouts, money, taxes or documents. When Ben brings something with ongoing state (a trip to plan, a car's service history, books to read, a home project, gift ideas, a job search), make a space for it with space_save and put the records in with space_records_update in the same turn; it gets its own page at /s/<slug> straight away. Pick the layout that fits: checklist for things to tick off, table for records with several fields, board for things moving through stages, notes for writing (an itinerary, a comparison, a plan), list otherwise. Give a space only the fields it needs; title, done, due_on and body exist on every record already. The spaces that exist are listed under "Spaces that exist"; add to one of those when it fits, since every new space is a permanent entry in Ben's navigation. A one-off question needs no space. When something is over (the trip happened), archive its space with space_save { archived: true }; the records are kept and Ben can delete it for good from the app. A file Ben attached can be put on a record with attachment_ids. Read records with SQL: SELECT r.title, json_extract(r.data, '$.cost') FROM space_records r JOIN spaces s ON s.id = r.space_id WHERE s.slug = 'portugal-trip'.`,
  tools: [
    defineTool({
      name: 'space_save',
      description:
        'Create a space, or change one (pass its slug or id as `space`). A space is a named area with its own page for something that has no built-in page. On create, name is required and the slug is derived from it. On update only the fields you pass change; passing `fields` replaces the field list. A field keeps its key for life: to rename one, send the same key with a new label; changing a type converts the stored values. Example: { name: "Car maintenance", icon: "car", layout: "table", description: "Service history and what is due for the Subaru", fields: [{ label: "Mileage", type: "number" }, { label: "Cost", type: "money" }, { label: "Shop" }] }.',
      input: z.object({
        space: z.union([z.string(), z.number()]).optional().describe('Slug or id of an existing space to change. Omit to create.'),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(300).nullable().optional(),
        icon: z.string().max(40).nullable().optional().describe('A lucide icon name in kebab-case: plane, car, book-open, home, gift, briefcase, heart-pulse, wrench, graduation-cap, baby, dog, music.'),
        layout: z.enum(LAYOUTS).optional(),
        fields: z.array(fieldInput).max(20).optional(),
        board_field: z.string().nullable().optional().describe('board layout: key of the select field whose options are the columns.'),
        pinned: z.boolean().optional().describe('Show in the nav.'),
        archived: z.boolean().optional().describe('true when the thing is over (the trip happened); hides the space and keeps its records.'),
        confirm_new: z.boolean().optional().describe('Create it even though a similarly named space exists, after deciding that one does not fit.'),
      }),
      touches: ['spaces'],
      run: (i, ctx) => {
        const { db } = ctx;
        const now = nowIso();
        // One transaction: a space that fails a later check (a board with no columns) must not be left behind.
        return db.transaction(() => {
        const target = i.space === undefined ? null : findSpace(db, i.space);
        const fields: Field[] | undefined = !i.fields ? undefined
          : target ? reconcileFields(db, target, i.fields)
          : i.fields.map((f) => ({ key: keyify(f.key ?? f.label), label: f.label, type: f.type, ...(f.type === 'select' ? { options: f.options ?? [] } : {}) }));
        if (fields) {
          const keys = fields.map((f) => f.key);
          const dup = keys.find((k, n) => keys.indexOf(k) !== n);
          if (dup) throw new ToolError(`Two fields would share the key "${dup}". Give them distinct labels or keys.`);
          const empty = fields.find((f) => f.type === 'select' && !f.options?.length);
          if (empty) throw new ToolError(`The select field "${empty.label}" needs options.`);
          if (fields.some((f) => ['title', 'done', 'due_on', 'body'].includes(f.key))) throw new ToolError('title, done, due_on and body exist on every record already; leave them out of fields.');
        }
        let s: SpaceRow;
        if (!target) {
          if (!i.name) throw new ToolError('A new space needs a name.');
          const near = similarSpaces(db, i.name).filter((x) => x.slug !== slugify(i.name!));
          if (near.length && !i.confirm_new && ctx.source !== 'ui') {
            throw new ToolError(`There is already ${near.map((x) => `"${x.name}" (${x.slug})`).join(' and ')}. Add to that space if it is the same thing; if this really is separate, call again with confirm_new: true.`);
          }
          let slug = slugify(i.name);
          if (db.prepare('SELECT 1 FROM spaces WHERE slug = ?').get(slug)) {
            const existing = db.prepare('SELECT slug, name, archived FROM spaces WHERE slug = ?').get(slug) as { slug: string; name: string; archived: number };
            if (!existing.archived) throw new ToolError(`There is already a space "${existing.name}" (${existing.slug}). Add to it, or change it by passing space: "${existing.slug}".`);
            // The archived one keeps its address; the new one gets the month, and a number if that is taken too.
            const base = `${slug}-${localDay().slice(0, 7)}`;
            slug = base;
            for (let n = 2; db.prepare('SELECT 1 FROM spaces WHERE slug = ?').get(slug); n++) slug = `${base}-${n}`;
          }
          const layout = i.layout ?? 'list';
          const id = db.prepare('INSERT INTO spaces (slug, name, icon, description, layout, fields, board_field, pinned, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .run(slug, i.name.trim(), i.icon ?? null, i.description ?? null, layout, JSON.stringify(fields ?? []), i.board_field ?? null, i.pinned === false ? 0 : 1, ctx.source === 'ui' ? 'ben' : 'kevin', now, now).lastInsertRowid;
          s = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as SpaceRow;
        } else {
          const cur = target;
          db.prepare('UPDATE spaces SET name = ?, icon = ?, description = ?, layout = ?, fields = ?, board_field = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?').run(
            i.name?.trim() ?? cur.name, i.icon === undefined ? cur.icon : i.icon, i.description === undefined ? cur.description : i.description, i.layout ?? cur.layout,
            fields ? JSON.stringify(fields) : cur.fields, i.board_field === undefined ? cur.board_field : i.board_field,
            i.pinned === undefined ? cur.pinned : i.pinned ? 1 : 0, i.archived === undefined ? cur.archived : i.archived ? 1 : 0, now, cur.id);
          s = db.prepare('SELECT * FROM spaces WHERE id = ?').get(cur.id) as SpaceRow;
        }
        if (s.layout === 'board') {
          const f = fieldsOf(s).find((x) => x.key === s.board_field) ?? fieldsOf(s).find((x) => x.type === 'select');
          if (!f || f.type !== 'select') throw new ToolError('A board needs a select field for its columns, e.g. fields: [{ label: "Status", type: "select", options: ["To do", "Doing", "Done"] }].');
          if (s.board_field !== f.key) db.prepare('UPDATE spaces SET board_field = ? WHERE id = ?').run(f.key, s.id);
          s = db.prepare('SELECT * FROM spaces WHERE id = ?').get(s.id) as SpaceRow;
        }
        return spaceView(db, s);
        })();
      },
    }),
    defineTool({
      name: 'space_records_update',
      description:
        'Add, change, tick off or delete records in a space, many at once. Without `id` a record is created; with `id` only the fields you pass change; `match_title: true` updates the existing record with that title instead of creating a second one. Custom fields go in `data` by key. Example: { space: "car-maintenance", records: [{ title: "Oil change", due_on: "2027-02-01", data: { mileage: 48200, cost: 89.5, shop: "Midas" } }, { id: 12, done: true }] }.',
      input: z.object({
        space: z.union([z.string(), z.number()]).describe('Slug, name or id of the space.'),
        records: z.array(z.object({
          id: z.number().int().optional().describe('space_records.id of an existing record.'),
          title: z.string().min(1).max(300).optional(),
          match_title: z.boolean().optional().describe('Update the record that already has this title (case-insensitive) rather than adding another.'),
          done: z.boolean().optional(),
          due_on: day.nullable().optional(),
          body: z.string().max(100_000).nullable().optional().describe('Markdown notes for this record; in a notes space, the page content.'),
          data: z.record(z.string(), z.unknown()).optional().describe('Custom field values by field key. null clears a value.'),
          attachment_ids: z.array(z.number().int()).max(20).optional().describe('Uploaded files to show on this record (the #ids of attachments Ben sent). Replaces the record\'s list.'),
          position: z.number().optional().describe('Manual order, ascending.'),
          delete: z.boolean().optional(),
        })).min(1).max(300),
      }),
      touches: ['spaces'],
      run: (i, ctx) => {
        const { db } = ctx;
        const s = findSpace(db, i.space);
        const fields = fieldsOf(s);
        const now = nowIso();
        const out = { space: s.slug, added: [] as string[], updated: [] as string[], deleted: [] as string[], records: [] as { id: number; title: string }[] };
        db.transaction(() => {
          let next = (db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM space_records WHERE space_id = ?').get(s.id) as { p: number }).p;
          for (const r of i.records) {
            let cur: RecordRow | undefined;
            if (r.id != null) {
              cur = db.prepare('SELECT * FROM space_records WHERE id = ? AND space_id = ?').get(r.id, s.id) as RecordRow | undefined;
              if (!cur) throw new ToolError(`No record ${r.id} in ${s.slug}.`);
            } else if ((r.match_title || r.delete) && r.title) {
              cur = db.prepare('SELECT * FROM space_records WHERE space_id = ? AND title = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(s.id, r.title) as RecordRow | undefined;
              if (!cur && r.delete) throw new ToolError(`No record titled "${r.title}" in ${s.slug}.`);
            }
            if (r.delete) {
              if (!cur) throw new ToolError('To delete a record pass its id or its title.');
              db.prepare('DELETE FROM space_records WHERE id = ?').run(cur.id);
              unindexItem(db, 'space-record', cur.id);
              out.deleted.push(cur.title);
              continue;
            }
            const data = r.data ? coerceData(fields, r.data) : {};
            const missing = r.attachment_ids?.find((id) => !db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(id));
            if (missing !== undefined) throw new ToolError(`There is no attachment #${missing}.`);
            if (cur) {
              const merged = { ...(JSON.parse(cur.data) as Record<string, unknown>), ...data };
              db.prepare('UPDATE space_records SET title = ?, data = ?, done = ?, due_on = ?, body = ?, position = ?, attachment_ids = ?, updated_at = ? WHERE id = ?').run(
                r.title ?? cur.title, JSON.stringify(merged), r.done === undefined ? cur.done : r.done ? 1 : 0, r.due_on === undefined ? cur.due_on : r.due_on,
                r.body === undefined ? cur.body : r.body, r.position ?? cur.position, r.attachment_ids ? JSON.stringify(r.attachment_ids) : cur.attachment_ids, now, cur.id);
              out.updated.push(r.title ?? cur.title);
              out.records.push({ id: cur.id, title: r.title ?? cur.title });
              indexRecord(db, s, db.prepare('SELECT * FROM space_records WHERE id = ?').get(cur.id) as RecordRow);
            } else {
              if (!r.title) throw new ToolError('A new record needs a title.');
              next += 1;
              const id = db.prepare('INSERT INTO space_records (space_id, title, data, done, due_on, body, position, attachment_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
                .run(s.id, r.title, JSON.stringify(data), r.done ? 1 : 0, r.due_on ?? null, r.body ?? null, r.position ?? next, JSON.stringify(r.attachment_ids ?? []), now, now).lastInsertRowid;
              out.added.push(r.title);
              out.records.push({ id: Number(id), title: r.title });
              indexRecord(db, s, db.prepare('SELECT * FROM space_records WHERE id = ?').get(id) as RecordRow);
            }
          }
          db.prepare('UPDATE spaces SET updated_at = ? WHERE id = ?').run(now, s.id);
        })();
        return { ...out, link: `/s/${s.slug}`, counts: spaceView(db, s).counts };
      },
    }),
    defineTool({
      name: 'space_delete',
      description: 'Delete a space and every record in it, for good.',
      // Ben only, from the app. Kevin archives (space_save { archived: true }), which loses nothing.
      agent: false,
      ui: true,
      input: z.object({ space: z.union([z.string(), z.number()]) }),
      touches: ['spaces'],
      run: async ({ space }, ctx) => {
        const s = findSpace(ctx.db, space);
        const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM space_records WHERE space_id = ?').get(s.id) as { n: number }).n;
        if (!(await ctx.confirm(`Delete the space "${s.name}" and its ${n} record${n === 1 ? '' : 's'}?`))) throw new ToolError('Ben declined to delete that space.');
        for (const r of ctx.db.prepare('SELECT id FROM space_records WHERE space_id = ?').all(s.id) as { id: number }[]) unindexItem(ctx.db, 'space-record', r.id);
        ctx.db.prepare('DELETE FROM spaces WHERE id = ?').run(s.id);
        return { deleted: s.name, records: n };
      },
    }),
    defineTool({
      name: 'nav_update',
      description: 'Choose which built-in pages show in the navigation.',
      agent: false,
      ui: true,
      input: z.object({ hidden_pages: z.array(z.string()).max(20) }),
      touches: ['spaces'],
      run: ({ hidden_pages }, ctx) => {
        const valid = hidden_pages.filter((p) => BUILTIN_PAGES.some((b) => b.path === p));
        setSetting(ctx.db, 'hidden_pages', valid);
        return { hidden_pages: valid };
      },
    }),
  ],
  views: {
    /** Everything the navigation needs: built-in pages (with hidden flags) and spaces. */
    nav: (_p, db) => {
      const hidden = new Set(getSetting<string[]>(db, 'hidden_pages', []));
      return {
        builtin: BUILTIN_PAGES.map((b) => ({ ...b, hidden: hidden.has(b.path) })),
        spaces: (db.prepare('SELECT * FROM spaces WHERE archived = 0 ORDER BY pinned DESC, name COLLATE NOCASE').all() as SpaceRow[]).map((s) => spaceView(db, s)),
      };
    },
    /** ?archived=1 to include archived spaces. */
    list: (p, db) => ({
      spaces: (db.prepare(`SELECT * FROM spaces ${p.archived === '1' ? '' : 'WHERE archived = 0'} ORDER BY archived, name COLLATE NOCASE`).all() as SpaceRow[]).map((s) => spaceView(db, s)),
    }),
    /** ?space=<slug or id> → the space and all its records: open first, then by due date, then manual order. */
    get: (p, db) => {
      const s = (/^\d+$/.test(p.space ?? '') ? db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(p.space)) : db.prepare('SELECT * FROM spaces WHERE slug = ?').get(p.space ?? '')) as SpaceRow | undefined;
      if (!s) return { space: null, records: [] };
      const rows = db.prepare('SELECT * FROM space_records WHERE space_id = ? ORDER BY done, due_on IS NULL, due_on, position, id').all(s.id) as RecordRow[];
      return { space: spaceView(db, s), records: rows.map((r) => recordView(db, r)), today: localDay() };
    },
    home: (_p, db) => {
      const today = localDay();
      const soon = localDay(new Date(Date.now() + 3 * 86_400_000));
      const rows = db.prepare(
        `SELECT s.name, s.slug, r.title, r.due_on FROM space_records r JOIN spaces s ON s.id = r.space_id
         WHERE s.archived = 0 AND r.done = 0 AND r.due_on IS NOT NULL AND r.due_on <= ? ORDER BY r.due_on, r.id`,
      ).all(soon) as { name: string; slug: string; title: string; due_on: string }[];
      const bySpace = new Map<string, { name: string; slug: string; lines: string[] }>();
      for (const r of rows) {
        const g = bySpace.get(r.slug) ?? { name: r.name, slug: r.slug, lines: [] };
        const when = r.due_on < today ? `overdue since ${r.due_on}` : r.due_on === today ? 'due today' : `due ${r.due_on}`;
        g.lines.push(`${r.title} — ${when}`);
        bySpace.set(r.slug, g);
      }
      return { cards: [...bySpace.values()].map((g) => ({ title: g.name, lines: g.lines.length > 5 ? [...g.lines.slice(0, 4), `and ${g.lines.length - 4} more`] : g.lines, link: `/s/${g.slug}` })) };
    },
  },
});
