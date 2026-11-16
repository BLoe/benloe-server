import { describe, expect, it } from 'vitest';
import {
  commonFormsLeft, copySource, deductionDraft, deductionInput, defaultNewYear, groupChecklist, inferFormType, itemInput, newYearError, packetContents, parseAmount,
  progressLine, yearChipNote, type ChecklistItem, type Deduction,
} from './logic';

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: 1, year: 2026, label: 'W-2 from Acme', form_type: 'W-2', status: 'expected', document_id: null, document_title: null, notes: null, document_file_url: null, ...over,
});
const ded = (over: Partial<Deduction>): Deduction => ({
  id: 1, year: 2026, category: 'charity', description: 'City Harvest', amount: 250, date: '2026-06-01', document_id: null, document_title: null, notes: null, document_file_url: null, ...over,
});

describe('checklist', () => {
  it('groups by status with what is still out first, dropping empty groups', () => {
    const g = groupChecklist([item({ id: 1, status: 'received' }), item({ id: 2 }), item({ id: 3, status: 'not_applicable' }), item({ id: 4 })]);
    expect(g.map((x) => [x.status, x.items.map((i) => i.id)])).toEqual([['expected', [2, 4]], ['received', [1]], ['not_applicable', [3]]]);
    expect(groupChecklist([item({ status: 'received' })]).map((x) => x.title)).toEqual(['Received']);
    expect(groupChecklist([])).toEqual([]);
  });

  it('writes the progress line', () => {
    expect(progressLine({ total: 10, received: 5, expected: 4, not_applicable: 1 }, ['W-2 from Acme', '1099-INT', '1098', 'Charity receipts'])).toBe('5 of 9 in; missing: W-2 from Acme, 1099-INT, 1098 and 1 more');
    expect(progressLine({ total: 3, received: 2, expected: 1, not_applicable: 0 }, ['1098'])).toBe('2 of 3 in; missing: 1098');
    expect(progressLine({ total: 3, received: 3, expected: 0, not_applicable: 0 }, [])).toBe('All 3 documents are in');
    expect(progressLine({ total: 1, received: 1, expected: 0, not_applicable: 0 }, [])).toBe('The 1 document is in');
    expect(progressLine({ total: 0, received: 0, expected: 0, not_applicable: 0 }, [])).toBe('Nothing on the checklist yet');
    expect(progressLine({ total: 2, received: 0, expected: 0, not_applicable: 2 }, [])).toBe('Nothing is expected this year');
  });

  it('labels a year chip', () => {
    expect(yearChipNote({ status: 'filed', progress: { total: 9, received: 9, expected: 0, not_applicable: 0 } })).toBe('Filed');
    expect(yearChipNote({ status: 'open', progress: { total: 10, received: 5, expected: 4, not_applicable: 1 } })).toBe('5/9');
    expect(yearChipNote({ status: 'open', progress: { total: 0, received: 0, expected: 0, not_applicable: 0 } })).toBe('New');
  });

  it('finds the form number in a label', () => {
    expect(inferFormType('w2 from Acme')).toBe('W-2');
    expect(inferFormType('W-2 from Acme')).toBe('W-2');
    expect(inferFormType('1099-int from Ally Bank')).toBe('1099-INT');
    expect(inferFormType('Fidelity 1099B')).toBe('1099-B');
    expect(inferFormType('1098 mortgage interest, Chase')).toBe('1098');
    expect(inferFormType('HSA 5498-SA')).toBe('5498-SA');
    expect(inferFormType('1095-C from employer')).toBe('1095-C');
    expect(inferFormType('Property tax statement')).toBeNull();
    expect(inferFormType('Invoice 10995')).toBeNull();
  });

  it('offers only the common forms not on the list', () => {
    const left = commonFormsLeft([item({ label: 'W-2 from Acme', form_type: 'W-2' }), item({ label: 'charity receipts', form_type: null })]).map((f) => f.label);
    expect(left).not.toContain('W-2');
    expect(left).not.toContain('Charity receipts');
    expect(left).toContain('1099-INT');
    expect(commonFormsLeft([])).toHaveLength(10);
  });

  it('builds a checklist item for the tool', () => {
    expect(itemInput(null, { label: ' 1099-INT from Ally ', form_type: '1099-INT', notes: '' })).toEqual({ item: { label: '1099-INT from Ally', form_type: '1099-INT' } });
    expect(itemInput(null, { label: ' ', form_type: '', notes: '' })).toHaveProperty('error');
    const cur = item({ id: 9, notes: 'Arrives late January' });
    expect(itemInput(cur, { label: 'W-2 from Acme', form_type: 'W-2', notes: 'Arrives late January' })).toEqual({ item: { id: 9 } });
    expect(itemInput(cur, { label: 'W-2 from Acme Corp', form_type: '', notes: '' })).toEqual({ item: { id: 9, label: 'W-2 from Acme Corp', form_type: null, notes: null } });
  });
});

describe('years', () => {
  it('offers the return now due, or the year after the newest', () => {
    expect(defaultNewYear('2027-02-10', [])).toBe(2026);
    expect(defaultNewYear('2026-11-14', [])).toBe(2026);
    expect(defaultNewYear('2026-11-14', [2025, 2024])).toBe(2026);
    expect(defaultNewYear('2027-02-10', [2026, 2025])).toBe(2027);
    expect(defaultNewYear('2027-02-10', [2024])).toBe(2026);
  });

  it('picks the checklist to copy', () => {
    const y = (year: number, total: number) => ({ year, progress: { total, received: 0, expected: total, not_applicable: 0 } });
    expect(copySource(2026, [y(2025, 9), y(2024, 7)])).toBe(2025);
    expect(copySource(2026, [y(2025, 0), y(2024, 7)])).toBe(2024);
    expect(copySource(2023, [y(2025, 9), y(2024, 7)])).toBe(2025);
    expect(copySource(2026, [y(2025, 0)])).toBeNull();
  });

  it('checks a new year', () => {
    expect(newYearError('2026', [2025])).toBeNull();
    expect(newYearError('2025', [2025])).toMatch(/already/);
    expect(newYearError('26', [])).toMatch(/year like/);
    expect(newYearError('1850', [])).toMatch(/range/);
  });
});

describe('deductions', () => {
  it('parses amounts', () => {
    expect(parseAmount('$1,234.50')).toBe(1234.5);
    expect(parseAmount('250')).toBe(250);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('12.345')).toBe(12.35);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('12a')).toBeNull();
  });

  it('builds a new row in full', () => {
    expect(deductionInput(null, { ...deductionDraft(null), description: ' Donation to City Harvest ', amount: '250', date: '2026-06-01', document_id: 4, document_title: 'x' })).toEqual({
      item: { category: 'charity', description: 'Donation to City Harvest', amount: 250, date: '2026-06-01', document_id: 4 },
    });
    expect(deductionInput(null, { ...deductionDraft(null, 'payment'), description: 'Q1 estimate', amount: '1,500' })).toEqual({ item: { category: 'payment', description: 'Q1 estimate', amount: 1500 } });
  });

  it('says why a row cannot be saved', () => {
    expect(deductionInput(null, deductionDraft(null))).toHaveProperty('error');
    expect(deductionInput(null, { ...deductionDraft(null), description: 'x', amount: 'lots' })).toHaveProperty('error');
    expect(deductionInput(null, { ...deductionDraft(null), description: 'x', amount: '5', date: '2026-02-30' })).toHaveProperty('error');
  });

  it('sends only what changed on an existing row', () => {
    const cur = ded({ id: 3, document_id: 8, document_title: 'Receipt', notes: 'cash' });
    expect(deductionInput(cur, deductionDraft(cur))).toEqual({ item: { id: 3 } });
    expect(deductionInput(cur, { ...deductionDraft(cur), amount: '300', date: '', document_id: null, notes: '', category: 'medical' })).toEqual({
      item: { id: 3, category: 'medical', amount: 300, date: null, document_id: null, notes: null },
    });
  });
});

describe('packet', () => {
  it('lists each linked document once', () => {
    const c = packetContents({
      checklist: [item({ document_id: 2, document_title: 'W-2 2026' }), item({ id: 2, document_id: null })],
      deduction_groups: [{ category: 'charity', label: 'Charitable giving', total: 250, count: 2, items: [ded({ document_id: 5, document_title: 'Receipt' }), ded({ id: 2, document_id: 2, document_title: 'W-2 2026' })] }],
      payments: [ded({ id: 3, category: 'payment', document_id: 6, document_title: null })],
      missing: ['1098'],
    });
    expect(c.documents).toEqual([{ id: 2, title: 'W-2 2026' }, { id: 5, title: 'Receipt' }, { id: 6, title: 'Document 6' }]);
    expect(c.missing).toEqual(['1098']);
  });
});
