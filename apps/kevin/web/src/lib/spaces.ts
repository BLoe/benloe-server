// Spaces: the areas Kevin makes at runtime (server/src/domains/spaces.ts).
// This file is the pure part of the generic space page: shapes, how a field's
// value is shown and parsed, due dates, and how records are grouped per layout.
import { calendarDay, money } from './format';

export const LAYOUTS = ['list', 'checklist', 'table', 'board', 'notes'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'checkbox', 'select', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

export interface Space {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  description: string | null;
  layout: Layout;
  fields: Field[];
  board_field: string | null;
  pinned: boolean;
  archived: boolean;
  created_by: string;
  link: string;
  counts: { total: number; open: number; due_soon: number };
}

export interface RecordAttachment {
  id: number;
  filename: string;
  mime: string;
  kind: string;
  /** /api/attachments/<id>/raw */
  url: string;
}

export interface SpaceRecord {
  id: number;
  title: string;
  done: boolean;
  due_on: string | null;
  body: string | null;
  data: Record<string, unknown>;
  /** Files attached to the record. */
  attachments?: RecordAttachment[];
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SpacePayload {
  space: Space | null;
  records: SpaceRecord[];
  today?: string;
}

export interface NavPayload {
  builtin: { path: string; name: string; hidden: boolean }[];
  spaces: Space[];
}

export const layoutLabel: Record<Layout, string> = { list: 'List', checklist: 'Checklist', table: 'Table', board: 'Board', notes: 'Notes' };
export const layoutHint: Record<Layout, string> = {
  list: 'Simple rows. Good for most things.',
  checklist: 'Things to tick off.',
  table: 'Records with several fields, in columns.',
  board: 'Cards moving through stages.',
  notes: 'Pages of writing.',
};
export const fieldTypeLabel: Record<FieldType, string> = {
  text: 'Text', longtext: 'Long text', number: 'Number', money: 'Money', date: 'Date', checkbox: 'Checkbox', select: 'Choice', url: 'Link',
};

// ---- due dates ------------------------------------------------------------------

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Where an open record's due date stands against today. Done records and records without a date have none. */
export function dueState(dueOn: string | null, today: string, done = false): DueState | null {
  if (!dueOn || done || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return null;
  const diff = dayNumber(dueOn) - dayNumber(today);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return diff <= 3 ? 'soon' : 'later';
}

/** "Overdue, Tue, Nov 10" / "Due today" / "Due tomorrow" / "Due Fri, Nov 20" */
export function dueLabel(dueOn: string, today: string): string {
  const state = dueState(dueOn, today);
  const day = calendarDay(dueOn, today);
  if (state === 'overdue') return day === 'Yesterday' ? 'Overdue since yesterday' : `Overdue, ${day}`;
  if (state === 'today') return 'Due today';
  return `Due ${day === 'Tomorrow' ? 'tomorrow' : day}`;
}

// ---- field values ---------------------------------------------------------------

export const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/** A link only if it is http(s): a stored "javascript:" value must never become an href. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A field's value as the page shows it. Tolerates values stored under an earlier field type. */
export function formatValue(field: Field, value: unknown, today?: string): string {
  if (!hasValue(value)) return '';
  switch (field.type) {
    case 'money': {
      const n = Number(value);
      return Number.isFinite(n) ? money(n, { cents: n % 1 !== 0 }) : String(value);
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(value);
    }
    case 'date': {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      return today ? calendarDay(s, today) : new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    case 'checkbox':
      return value === true || value === 1 || /^(true|yes|1|done)$/i.test(String(value)) ? 'Yes' : 'No';
    case 'url': {
      const href = safeUrl(value);
      if (!href) return String(value);
      const u = new URL(href);
      const path = u.pathname === '/' ? '' : u.pathname;
      const text = u.hostname.replace(/^www\./, '') + path;
      return text.length > 40 ? `${text.slice(0, 39)}…` : text;
    }
    default:
      return String(value);
  }
}

/** A stored value as the text a form input holds. Checkboxes use 'true' / ''. */
export function toInput(field: Field, value: unknown): string {
  if (!hasValue(value)) return '';
  if (field.type === 'checkbox') return formatValue(field, value) === 'Yes' ? 'true' : '';
  return String(value);
}

/** What the form holds, as the value to store. `null` clears the field. */
export function fromInput(field: Field, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim();
  if (field.type === 'checkbox') return { value: text === 'true' };
  if (!text) return { value: null };
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = Number(text.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: `${field.label} needs a number.` };
      return { value: field.type === 'money' ? Math.round(n * 100) / 100 : n };
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? { value: text } : { error: `${field.label} needs a date.` };
    case 'select': {
      const hit = field.options?.find((o) => o.toLowerCase() === text.toLowerCase());
      return hit ? { value: hit } : { error: `${field.label} must be one of: ${(field.options ?? []).join(', ')}.` };
    }
    case 'url': {
      const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
      const href = safeUrl(withScheme);
      return href ? { value: href } : { error: `${field.label} needs a web address.` };
    }
    default:
      return { value: raw.replace(/\s+$/, '') };
  }
}

// ---- the record form --------------------------------------------------------------

export interface RecordDraft {
  title: string;
  done: boolean;
  due_on: string;
  body: string;
  /** Field key -> what the input holds. */
  data: Record<string, string>;
  attachments: RecordAttachment[];
}

export function draftOf(space: Space, record: SpaceRecord | null, preset: Record<string, unknown> = {}): RecordDraft {
  const source = { ...preset, ...(record?.data ?? {}) };
  return {
    title: record?.title ?? '',
    done: record?.done ?? false,
    due_on: record?.due_on ?? '',
    body: record?.body ?? '',
    data: Object.fromEntries(space.fields.map((f) => [f.key, toInput(f, source[f.key])])),
    attachments: record?.attachments ?? [],
  };
}

export type RecordInput = { id?: number; title?: string; done?: boolean; due_on?: string | null; body?: string | null; data?: Record<string, unknown>; attachment_ids?: number[] };

/**
 * The write for a saved form: for a new record everything that was filled in,
 * for an existing one only what changed. Sending only changes matters: a value
 * stored under an old field definition would otherwise be re-validated and
 * block an unrelated edit.
 */
export function recordInput(space: Space, record: SpaceRecord | null, draft: RecordDraft): { input: RecordInput } | { error: string } {
  const title = draft.title.trim();
  if (!title) return { error: 'Give it a title.' };
  const before = draftOf(space, record);
  const data: Record<string, unknown> = {};
  for (const f of space.fields) {
    const raw = draft.data[f.key] ?? '';
    if (record ? raw === before.data[f.key] : raw === '') continue;
    const parsed = fromInput(f, raw);
    if ('error' in parsed) return parsed;
    data[f.key] = parsed.value;
  }
  const input: RecordInput = record ? { id: record.id } : {};
  if (!record || title !== record.title) input.title = title;
  if (!record ? draft.done : draft.done !== record.done) input.done = draft.done;
  if (draft.due_on !== before.due_on) input.due_on = draft.due_on || null;
  if (draft.body !== before.body) input.body = draft.body.trim() ? draft.body : null;
  if (Object.keys(data).length) input.data = data;
  // The server replaces the record's file list, so a change sends the whole list.
  const files = draft.attachments.map((a) => a.id);
  if (files.join(',') !== before.attachments.map((a) => a.id).join(',')) input.attachment_ids = files;
  return { input };
}

// ---- grouping per layout -----------------------------------------------------------

/** Records as the server ordered them (open first, by due date, then manual order), split at done. */
export function splitDone<T extends { done: boolean }>(records: T[]): { open: T[]; done: T[] } {
  return { open: records.filter((r) => !r.done), done: records.filter((r) => r.done) };
}

/** The select field a board's columns come from: `board_field`, else the first select field. */
export function boardField(space: Pick<Space, 'fields' | 'board_field'>): Field | null {
  return space.fields.find((f) => f.key === space.board_field && f.type === 'select') ?? space.fields.find((f) => f.type === 'select') ?? null;
}

export interface BoardColumn<T> {
  /** The option this column stands for; null is the column for records with no (or an unknown) value. */
  value: string | null;
  label: string;
  records: T[];
}

/**
 * One column per option, in the field's order. Records whose value is empty
 * or no longer an option go in a leading "No <field>" column, which exists
 * only when it has records.
 */
export function boardColumns<T extends { data: Record<string, unknown> }>(field: Field, records: T[]): BoardColumn<T>[] {
  const options = field.options ?? [];
  const byLower = new Map(options.map((o) => [o.toLowerCase(), o]));
  const columns = new Map<string, T[]>(options.map((o) => [o, []]));
  const loose: T[] = [];
  for (const r of records) {
    const v = r.data[field.key];
    const hit = hasValue(v) ? byLower.get(String(v).toLowerCase()) : undefined;
    if (hit) columns.get(hit)!.push(r);
    else loose.push(r);
  }
  const out: BoardColumn<T>[] = options.map((o) => ({ value: o, label: o, records: columns.get(o)! }));
  if (loose.length) out.unshift({ value: null, label: `No ${field.label.toLowerCase()}`, records: loose });
  return out;
}

/** A table's columns: the fields, plus due and done only when some record uses them. */
export function tableColumns(space: Pick<Space, 'fields'>, records: Pick<SpaceRecord, 'done' | 'due_on'>[]): { fields: Field[]; due: boolean; done: boolean } {
  return { fields: space.fields, due: records.some((r) => !!r.due_on), done: records.some((r) => r.done) };
}

/** The few field values worth showing on a row: the first `max` that are set, skipping long text and the board's own field. */
export function rowSummary(space: Pick<Space, 'fields'>, record: Pick<SpaceRecord, 'data'>, max = 2, skipKey?: string | null, today?: string): { field: Field; text: string }[] {
  const out: { field: Field; text: string }[] = [];
  for (const f of space.fields) {
    if (out.length >= max) break;
    if (f.type === 'longtext' || f.key === skipKey) continue;
    const v = record.data[f.key];
    if (!hasValue(v) || (f.type === 'checkbox' && formatValue(f, v) === 'No')) continue;
    out.push({ field: f, text: f.type === 'checkbox' ? f.label : formatValue(f, v, today) });
  }
  return out;
}

export function countsLabel(c: Space['counts']): string {
  if (c.total === 0) return 'Empty';
  const parts = [c.open === c.total ? `${c.total} ${c.total === 1 ? 'item' : 'items'}` : `${c.open} open of ${c.total}`];
  if (c.due_soon > 0) parts.push(`${c.due_soon} due soon`);
  return parts.join(', ');
}

// ---- the space form's field editor ---------------------------------------------------

export interface FieldDraft {
  /** Present for a field that already exists: keeping the key keeps the stored values. */
  key?: string;
  label: string;
  type: FieldType;
  /** select only: one option per line (commas also separate). */
  options: string;
}

export function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    const o = part.trim();
    if (!o || seen.has(o.toLowerCase())) continue;
    seen.add(o.toLowerCase());
    out.push(o);
  }
  return out;
}

export const fieldDrafts = (fields: Field[]): FieldDraft[] => fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: (f.options ?? []).join('\n') }));

/** The server derives a new field's key from its label the same way (spaces.ts keyify). */
export const keyify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

const RESERVED = ['title', 'done', 'due_on', 'body'];

/** The field list for space_save, or what is wrong with it. */
export function fieldInputs(drafts: FieldDraft[], layout: Layout): { fields: { key?: string; label: string; type: FieldType; options?: string[] }[] } | { error: string } {
  const keys = new Set<string>();
  const fields = [];
  for (const d of drafts) {
    const label = d.label.trim();
    if (!label) return { error: 'Every field needs a name.' };
    const key = d.key ?? keyify(label);
    if (RESERVED.includes(key)) return { error: `Every record already has ${label.toLowerCase()}; remove that field.` };
    if (keys.has(key)) return { error: `Two fields are named “${label}”.` };
    keys.add(key);
    const options = parseOptions(d.options);
    if (d.type === 'select' && !options.length) return { error: `“${label}” needs at least one choice.` };
    fields.push({ ...(d.key ? { key: d.key } : {}), label, type: d.type, ...(d.type === 'select' ? { options } : {}) });
  }
  if (layout === 'board' && !fields.some((f) => f.type === 'select')) return { error: 'A board needs a choice field for its columns, such as Status.' };
  return { fields };
}

/** Kevin writes icon names loosely ("BookOpen", "book_open"); lucide's are kebab-case. */
export function iconName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
}
