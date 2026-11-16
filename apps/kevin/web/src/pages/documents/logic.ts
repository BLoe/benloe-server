// The Documents page's pure parts: URL filters to view params, the filing
// form to tool inputs, tag handling, and highlighting search terms in text.
// The shapes mirror server/src/domains/documents.ts.

export const CATEGORIES = ['medical', 'insurance', 'tax', 'financial', 'legal', 'home', 'vehicle', 'identity', 'receipt', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  medical: 'Medical', insurance: 'Insurance', tax: 'Tax', financial: 'Financial', legal: 'Legal',
  home: 'Home', vehicle: 'Vehicle', identity: 'Identity', receipt: 'Receipt', other: 'Other',
};
export const categoryLabel = (c: string): string => CATEGORY_LABELS[c as Category] ?? c;

export interface DocumentInfo {
  id: number; title: string; category: string; tags: string[]; document_date: string | null; issuer: string | null; tax_year: number | null;
  summary: string | null; notes: string | null; original_filename: string; mime: string; size_bytes: number; text_chars: number;
  created_at: string; updated_at: string; file_url: string;
  /** Only on documents/list with a query. */
  snippet?: string | null;
}
export interface DocumentFull extends DocumentInfo { extracted_text: string }
export interface ListResult { documents: DocumentInfo[]; total: number }
export interface Facets {
  total: number;
  categories: { category: string; count: number }[];
  tags: { tag: string; count: number }[];
  tax_years: { tax_year: number; count: number }[];
}

// ---- filters <-> URL ---------------------------------------------------------

export interface Filters { q: string; category: string; tag: string; year: string }

export function filtersFromSearch(sp: URLSearchParams): Filters {
  const year = sp.get('year') ?? '';
  const category = sp.get('category') ?? '';
  return {
    q: sp.get('q') ?? '',
    category: (CATEGORIES as readonly string[]).includes(category) ? category : '',
    tag: (sp.get('tag') ?? '').trim().toLowerCase(),
    year: /^\d{4}$/.test(year) ? year : '',
  };
}

export const hasFilters = (f: Filters): boolean => !!(f.q.trim() || f.category || f.tag || f.year);

/** Params for documents/list. Empty filters are left out so the URL (and the cache key) stays stable. */
export function listParams(f: Filters, limit = 200): Record<string, string | number | undefined> {
  return {
    q: f.q.trim() || undefined,
    category: f.category || undefined,
    tag: f.tag || undefined,
    tax_year: f.year || undefined,
    limit: limit === 200 ? undefined : limit,
  };
}

/** The page's search params with some keys set (or removed when empty/null). Everything else is kept. */
export function withParams(sp: URLSearchParams, patch: Record<string, string | number | null | undefined>): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  return next;
}

/** In-app link to one document. */
export const documentLink = (id: number, q?: string): string => `/documents?doc=${id}${q?.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;

// ---- tags --------------------------------------------------------------------

/** The server's normalisation: lowercase, single spaces, unique, sorted. Also holds its limits (40 chars, 20 tags). */
export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^#+/, '').slice(0, 40).trim()).filter(Boolean))].sort().slice(0, 20);
}

/** What was typed in the tag box, split on commas. */
export const parseTagInput = (text: string): string[] => cleanTags(text.split(/[,\n]/));

/** Existing tags to offer: not already chosen, matching what is typed, most used first. */
export function tagSuggestions(facetTags: { tag: string; count: number }[], chosen: string[], typed: string, limit = 8): string[] {
  const t = typed.trim().toLowerCase();
  const have = new Set(chosen);
  return facetTags
    .filter((f) => !have.has(f.tag) && (!t || f.tag.includes(t)))
    .sort((a, b) => Number(b.tag.startsWith(t)) - Number(a.tag.startsWith(t)) || b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map((f) => f.tag);
}

// ---- the filing form -----------------------------------------------------------

export interface Draft {
  title: string; category: string; document_date: string; issuer: string; tags: string[]; tax_year: string; summary: string; notes: string;
}

/** "aetna_eob-march.pdf" -> "Aetna eob march". A dash next to a digit (a date, W-2, 1099-INT) is kept. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const spaced = base
    .replace(/[_+]+/g, ' ')
    .replace(/(?<!\d)-+(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return 'Document';
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1)).slice(0, 200);
}

export function newDraft(filename: string, preset: Partial<Draft> = {}): Draft {
  return { title: titleFromFilename(filename), category: 'other', document_date: '', issuer: '', tags: [], tax_year: '', summary: '', notes: '', ...preset };
}

export function draftOf(d: DocumentInfo): Draft {
  return {
    title: d.title, category: d.category, document_date: d.document_date ?? '', issuer: d.issuer ?? '', tags: d.tags,
    tax_year: d.tax_year == null ? '' : String(d.tax_year), summary: d.summary ?? '', notes: d.notes ?? '',
  };
}

export function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const yearOf = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return /^\d{4}$/.test(t) && n >= 1990 && n <= 2100 ? n : NaN;
};

/** Why the form cannot be saved, or null. */
export function draftError(d: Draft): string | null {
  if (!d.title.trim()) return 'Give it a title.';
  if (d.title.trim().length > 200) return 'The title is over 200 characters.';
  if (!(CATEGORIES as readonly string[]).includes(d.category)) return 'Pick a category.';
  if (d.document_date && !isRealDay(d.document_date)) return 'The document date is not a real date.';
  if (Number.isNaN(yearOf(d.tax_year))) return 'The tax year should be a year like 2026.';
  if (d.issuer.trim().length > 120) return 'The issuer is over 120 characters.';
  if (d.summary.trim().length > 1500) return 'The summary is over 1,500 characters.';
  if (d.notes.trim().length > 4000) return 'The notes are over 4,000 characters.';
  return null;
}

/** Input for ingest_document: blanks are left out. */
export function ingestInput(attachmentId: number, d: Draft): Record<string, unknown> {
  const year = yearOf(d.tax_year);
  const tags = cleanTags(d.tags);
  return {
    attachment_id: attachmentId,
    title: d.title.trim(),
    category: d.category,
    ...(tags.length ? { tags } : {}),
    ...(d.document_date ? { document_date: d.document_date } : {}),
    ...(d.issuer.trim() ? { issuer: d.issuer.trim() } : {}),
    ...(year != null && !Number.isNaN(year) ? { tax_year: year } : {}),
    ...(d.summary.trim() ? { summary: d.summary.trim() } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
  };
}

/** Input for document_update: only what changed; a cleared field is sent as null. Just `{ id }` means nothing changed. */
export function updateInput(doc: DocumentInfo, d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = { id: doc.id };
  const text = (key: 'issuer' | 'summary' | 'notes') => {
    const next = d[key].trim() || null;
    if (next !== (doc[key] ?? null)) out[key] = next;
  };
  if (d.title.trim() !== doc.title) out.title = d.title.trim();
  if (d.category !== doc.category) out.category = d.category;
  const date = d.document_date || null;
  if (date !== (doc.document_date ?? null)) out.document_date = date;
  const year = yearOf(d.tax_year);
  if (!Number.isNaN(year) && year !== (doc.tax_year ?? null)) out.tax_year = year;
  text('issuer');
  text('summary');
  text('notes');
  const tags = cleanTags(d.tags);
  if (tags.join('\n') !== cleanTags(doc.tags).join('\n')) out.tags = tags;
  return out;
}

/** The existing document named by ingest_document's "already in the vault" refusal. */
export function duplicateOf(error: string): { id: number; title: string | null } | null {
  const m = /already in the vault as document (\d+)(?:, "(.*)" \([a-z_]+\))?/.exec(error);
  return m ? { id: Number(m[1]), title: m[2] ?? null } : null;
}

// ---- highlighting ----------------------------------------------------------------

/** The words of a search worth marking in text: quotes and operators dropped, one-letter words ignored. */
export function searchTerms(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/[\s"'()*:^,;]+/)
    .map((w) => w.replace(/^[-+.]+|[-+.]+$/g, ''))
    .filter((w) => w.length >= 2 && !['and', 'or', 'not', 'near'].includes(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/**
 * What to mark for "find in this text": the typed phrase when the text holds
 * it as typed, otherwise its words (a search that arrived from the list is
 * by words, and extracted text often breaks a phrase across lines).
 */
export function findTerms(text: string, q: string): string[] {
  const phrase = q.trim().toLowerCase();
  if (phrase.length >= 2 && text.toLowerCase().includes(phrase)) return [phrase];
  return searchTerms(q);
}

export interface Part { text: string; hit: boolean }

/** Splits text into runs that match a term (case-insensitive) and runs that do not. */
export function highlightParts(text: string, terms: string[]): Part[] {
  if (!text) return [];
  const usable = terms.filter(Boolean);
  if (!usable.length) return [{ text, hit: false }];
  const re = new RegExp(usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

export const countHits = (parts: Part[]): number => parts.reduce((n, p) => n + (p.hit ? 1 : 0), 0);

// ---- display -----------------------------------------------------------------------

/** A stored YYYY-MM-DD as "Mar 12, 2026". */
export function docDate(day: string | null | undefined): string {
  if (!day || !isRealDay(day)) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const isImage = (mime: string): boolean => mime.startsWith('image/');

export function fileKind(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (isImage(mime)) return 'Image';
  if (mime === 'text/csv') return 'CSV';
  if (mime.startsWith('text/') || mime === 'application/json') return 'Text file';
  return 'File';
}

/** What "Ask Kevin about this document" puts in the composer. */
export const askPrompt = (d: { id: number; title: string }): string => `About document ${d.id} (“${d.title}”): `;
