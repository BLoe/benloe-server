// The Taxes page's pure parts: grouping the checklist, the progress line,
// forms to tool inputs, and what a packet will hold.
// The shapes mirror server/src/domains/taxes.ts.

export type ItemStatus = 'expected' | 'received' | 'not_applicable';

export interface Progress { total: number; received: number; expected: number; not_applicable: number }

export interface YearSummary {
  year: number; status: string; progress: Progress; deductions_total: number; payments_total: number; packet_count: number; last_packet_at: string | null; updated_at: string;
}
export interface YearsView { years: YearSummary[] }

export interface ChecklistItem {
  id: number; year: number; label: string; form_type: string | null; status: string; document_id: number | null; document_title: string | null;
  notes: string | null; document_file_url: string | null;
}
export interface Deduction {
  id: number; year: number; category: string; description: string; amount: number; date: string | null; document_id: number | null; document_title: string | null;
  notes: string | null; document_file_url: string | null;
}
export interface DeductionGroup { category: string; label: string; total: number; count: number; items: Deduction[] }
export interface Packet { id: number; year: number; filename: string; format: string; file_count: number; missing_count: number; size_bytes: number; created_at: string; file_url: string }

export interface YearDetail {
  year: number | null; exists: boolean; status: string | null; preparer_notes: string; progress: Progress; checklist: ChecklistItem[]; missing: string[];
  deduction_groups: DeductionGroup[]; deductions_total: number; payments: Deduction[]; payments_total: number; packets: Packet[];
}

export interface BuildResult {
  packet_id: number; year: number; filename: string; format: string; file_count: number; missing_count: number; missing: string[]; size_bytes: number; download_url: string;
  files_unavailable?: string[];
}

// ---- checklist ---------------------------------------------------------------

/** The forms most returns need, offered when building a checklist. */
export const COMMON_FORMS: { label: string; form_type: string | null }[] = [
  { label: 'W-2', form_type: 'W-2' },
  { label: '1099-INT', form_type: '1099-INT' },
  { label: '1099-DIV', form_type: '1099-DIV' },
  { label: '1099-B', form_type: '1099-B' },
  { label: '1098 mortgage interest', form_type: '1098' },
  { label: '1099-SA', form_type: '1099-SA' },
  { label: '5498-SA', form_type: '5498-SA' },
  { label: 'Property tax statement', form_type: null },
  { label: 'Charity receipts', form_type: null },
  { label: 'Estimated tax payments', form_type: null },
];

/** Common forms not on the checklist yet (by label, or by a form's number). */
export function commonFormsLeft(items: Pick<ChecklistItem, 'label' | 'form_type'>[]): typeof COMMON_FORMS {
  const labels = new Set(items.map((i) => i.label.trim().toLowerCase()));
  const forms = new Set(items.map((i) => i.form_type?.trim().toUpperCase()).filter(Boolean));
  return COMMON_FORMS.filter((f) => !labels.has(f.label.toLowerCase()) && !(f.form_type && forms.has(f.form_type)));
}

/** The form number in a typed label: "w2 from Acme" -> "W-2", "1099-int Ally" -> "1099-INT". */
export function inferFormType(label: string): string | null {
  const m = /(?<![\w-])(w-?2g?|1099-?[a-z]{1,4}|1098(?:-[a-z])?|5498(?:-[a-z]{2,4})?|1095-[abc]|k-?1|1040-?es)(?![\w-])/i.exec(label);
  if (!m) return null;
  const raw = m[1]!.toUpperCase();
  if (/^W-?2G?$/.test(raw)) return raw.replace(/^W-?/, 'W-');
  if (/^K-?1$/.test(raw)) return 'K-1';
  if (/^1040-?ES$/.test(raw)) return '1040-ES';
  if (/^1099[A-Z]/.test(raw)) return raw.replace(/^1099/, '1099-');
  return raw;
}

const GROUPS: { status: ItemStatus; title: string }[] = [
  { status: 'expected', title: 'Still expected' },
  { status: 'received', title: 'Received' },
  { status: 'not_applicable', title: 'Not applicable this year' },
];

/** Checklist items by status, what is still out first. Empty groups are left out. */
export function groupChecklist<T extends { status: string }>(items: T[]): { status: ItemStatus; title: string; items: T[] }[] {
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.status === g.status) })).filter((g) => g.items.length > 0);
}

/** "5 of 9 in; missing: W-2 from Acme, 1099-INT and 2 more". Not-applicable items do not count. */
export function progressLine(p: Progress, missing: string[], show = 3): string {
  const needed = p.received + p.expected;
  if (!p.total) return 'Nothing on the checklist yet';
  if (!needed) return 'Nothing is expected this year';
  if (!p.expected) return needed === 1 ? 'The 1 document is in' : `All ${needed} documents are in`;
  const names = missing.slice(0, show).join(', ');
  const more = missing.length - show;
  return `${p.received} of ${needed} in; missing: ${names}${more > 0 ? ` and ${more} more` : ''}`;
}

/** The short form for a year chip: "5/9", "Filed", "New". */
export function yearChipNote(y: Pick<YearSummary, 'status' | 'progress'>): string {
  if (y.status === 'filed') return 'Filed';
  const needed = y.progress.received + y.progress.expected;
  return needed ? `${y.progress.received}/${needed}` : 'New';
}

export interface ItemDraft { label: string; form_type: string; notes: string }

/** One checklist item for tax_checklist_update: a new one, or the changed fields of an existing one. */
export function itemInput(existing: ChecklistItem | null, d: ItemDraft): { item: Record<string, unknown> } | { error: string } {
  const label = d.label.trim();
  if (!label) return { error: 'Say what is expected, e.g. “W-2 from Acme”.' };
  if (label.length > 160) return { error: 'The label is over 160 characters.' };
  if (d.form_type.trim().length > 40) return { error: 'The form type is over 40 characters.' };
  const form = d.form_type.trim() || null;
  const notes = d.notes.trim() || null;
  if (!existing) return { item: { label, ...(form ? { form_type: form } : {}), ...(notes ? { notes } : {}) } };
  return {
    item: {
      id: existing.id,
      ...(label !== existing.label ? { label } : {}),
      ...(form !== (existing.form_type ?? null) ? { form_type: form } : {}),
      ...(notes !== (existing.notes ?? null) ? { notes } : {}),
    },
  };
}

// ---- years --------------------------------------------------------------------

/** The year to offer when starting one: the next after the newest, else the return now due (last year until May, then this year). */
export function defaultNewYear(today: string, years: number[]): number {
  const thisYear = Number(today.slice(0, 4));
  const due = Number(today.slice(5, 7)) <= 4 ? thisYear - 1 : thisYear;
  if (!years.length) return due;
  const newest = Math.max(...years);
  return due > newest ? due : newest + 1;
}

/** The checklist to copy into a new year: the closest earlier year that has one, else the newest that has one. */
export function copySource(newYear: number, years: Pick<YearSummary, 'year' | 'progress'>[]): number | null {
  const withItems = years.filter((y) => y.progress.total > 0 && y.year !== newYear).map((y) => y.year).sort((a, b) => b - a);
  return withItems.find((y) => y < newYear) ?? withItems[0] ?? null;
}

export function newYearError(text: string, existing: number[]): string | null {
  if (!/^\d{4}$/.test(text.trim())) return 'Enter a year like 2026.';
  const y = Number(text);
  if (y < 1990 || y > 2100) return 'That year is out of range.';
  if (existing.includes(y)) return `${y} is already started.`;
  return null;
}

// ---- deductions ------------------------------------------------------------------

export const DEDUCTION_CATEGORIES = ['charity', 'medical', 'state_local_tax', 'mortgage_interest', 'business', 'education', 'retirement', 'hsa', 'childcare', 'energy', 'other'] as const;

export const DEDUCTION_LABELS: Record<string, string> = {
  charity: 'Charitable giving', medical: 'Medical', state_local_tax: 'State and local taxes', mortgage_interest: 'Mortgage interest', business: 'Business',
  education: 'Education', retirement: 'Retirement contributions', hsa: 'HSA', childcare: 'Childcare', energy: 'Energy credits', payment: 'Tax payments', other: 'Other',
};

export interface DeductionDraft { category: string; description: string; amount: string; date: string; document_id: number | null; document_title: string | null; notes: string }

export function deductionDraft(d: Deduction | null, category = 'charity'): DeductionDraft {
  if (!d) return { category, description: '', amount: '', date: '', document_id: null, document_title: null, notes: '' };
  return { category: d.category, description: d.description, amount: String(d.amount), date: d.date ?? '', document_id: d.document_id, document_title: d.document_title, notes: d.notes ?? '' };
}

/** "$1,234.50" -> 1234.5. null when it is not a non-negative amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Math.round(Number(t) * 100) / 100;
  return Number.isFinite(n) && n <= 100_000_000 ? n : null;
}

const realDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** One row for tax_deductions_update: a new one in full, or the changed fields of an existing one. */
export function deductionInput(existing: Deduction | null, d: DeductionDraft): { item: Record<string, unknown> } | { error: string } {
  const description = d.description.trim();
  if (!description) return { error: 'Say what it was, e.g. “Donation to City Harvest”.' };
  if (description.length > 300) return { error: 'The description is over 300 characters.' };
  const amount = parseAmount(d.amount);
  if (amount == null) return { error: 'Enter the amount in dollars, e.g. 250 or 1,234.56.' };
  if (d.date && !realDay(d.date)) return { error: 'The date is not a real date.' };
  const date = d.date || null;
  const notes = d.notes.trim() || null;
  if (!existing) {
    return { item: { category: d.category, description, amount, ...(date ? { date } : {}), ...(d.document_id != null ? { document_id: d.document_id } : {}), ...(notes ? { notes } : {}) } };
  }
  return {
    item: {
      id: existing.id,
      ...(d.category !== existing.category ? { category: d.category } : {}),
      ...(description !== existing.description ? { description } : {}),
      ...(amount !== existing.amount ? { amount } : {}),
      ...(date !== (existing.date ?? null) ? { date } : {}),
      ...(d.document_id !== (existing.document_id ?? null) ? { document_id: d.document_id } : {}),
      ...(notes !== (existing.notes ?? null) ? { notes } : {}),
    },
  };
}

// ---- packet ----------------------------------------------------------------------

/** What tax_packet_build would put in the archive now: every document linked to the checklist or a deduction, once. */
export function packetContents(d: Pick<YearDetail, 'checklist' | 'deduction_groups' | 'payments' | 'missing'>): { documents: { id: number; title: string }[]; missing: string[] } {
  const seen = new Map<number, string>();
  for (const r of [...d.checklist, ...d.deduction_groups.flatMap((g) => g.items), ...d.payments]) {
    if (r.document_id != null && !seen.has(r.document_id)) seen.set(r.document_id, r.document_title ?? `Document ${r.document_id}`);
  }
  return { documents: [...seen].map(([id, title]) => ({ id, title })), missing: d.missing };
}
