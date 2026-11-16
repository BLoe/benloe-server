import express, { Router } from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extract, saveUpload } from '../src/attachments.js';
import documents from '../src/domains/documents.js';
import taxes, { taxHomeCards } from '../src/domains/taxes.js';
import { vaultFile, vaultRoot } from '../src/domains/_documents/vault.js';
import { archivers } from '../src/domains/_taxes/packet.js';
import type { Kevin } from '../src/kevin.js';
import { call, makeKevin, ok, view } from './helpers.js';

const W2 = 'Form W-2 Wage and Tax Statement 2026\nEmployer: Acme Corp\nWages: 150000.00\nFederal income tax withheld: 28000.00';
const RECEIPT = 'City Harvest\nThank you for your gift of $500.00 on 2026-12-01. No goods or services were provided.';

async function fileDoc(kevin: Kevin, name: string, text: string, input: Record<string, unknown>) {
  const a = await extract(kevin.db, saveUpload(kevin.db, Buffer.from(text), name).id);
  return ok(kevin, 'ingest_document', { attachment_id: a.id, ...input });
}

const CHECKLIST = [
  { label: 'W-2 from Acme', form_type: 'W-2' },
  { label: '1099-INT from Ally Bank', form_type: '1099-INT', notes: 'Download from the Ally tax forms page.' },
  { label: '1098 mortgage interest', form_type: '1098' },
  { label: 'Charity receipts' },
];

async function seed(kevin: Kevin) {
  await ok(kevin, 'tax_checklist_update', { year: 2026, items: CHECKLIST });
  const w2 = await fileDoc(kevin, 'w2-acme.txt', W2, { title: 'W-2 2026, Acme Corp', category: 'tax', tax_year: 2026 });
  const receipt = await fileDoc(kevin, 'city harvest.txt', RECEIPT, { title: 'City Harvest donation receipt', category: 'receipt', tax_year: 2026 });
  return { w2, receipt };
}

const servers: { close(): void }[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  Object.assign(archivers, { python: 'python3', zip: 'zip', tar: 'tar' });
});
async function serve(kevin: Kevin): Promise<string> {
  const app = express();
  const r = Router();
  taxes.routes!(r, kevin.db);
  app.use('/api/x/taxes', r);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/x/taxes`;
}

/** name -> text for every entry of a zip. */
const unzip = (file: string): Record<string, string> =>
  JSON.parse(execFileSync('python3', ['-I', '-c', "import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({n: z.read(n).decode('utf8','replace') for n in z.namelist()}))", file], { encoding: 'utf8' })) as Record<string, string>;

describe('tax_checklist_update', () => {
  it('creates a year with its checklist', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const r = await ok(kevin, 'tax_checklist_update', { year: 2026, items: CHECKLIST, preparer_notes: 'Refinanced in June.' });
    expect(r).toMatchObject({ year: 2026, status: 'open', preparer_notes: 'Refinanced in June.', progress: { total: 4, received: 0, expected: 4, not_applicable: 0 } });
    expect(r.checklist.map((c: { label: string }) => c.label)).toEqual(CHECKLIST.map((c) => c.label));
    expect(r.checklist[0]).toEqual({ id: 1, label: 'W-2 from Acme', form_type: 'W-2', status: 'expected', document_id: null, document_title: null, notes: null });
    // A call with only the year starts an empty one.
    expect(await ok(kevin, 'tax_checklist_update', { year: 2027 })).toMatchObject({ year: 2027, checklist: [] });
  });

  it('upserts by label or id, deletes, and rejects what does not fit, changing nothing on a failed call', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await seed(kevin);
    const r = await ok(kevin, 'tax_checklist_update', {
      year: 2026,
      items: [
        { label: 'w-2 FROM acme', notes: 'HR says by Jan 31.' }, // same item, matched without regard to case
        { id: 3, status: 'not_applicable', notes: 'Paid off the mortgage.' },
        { label: 'Charity receipts', delete: true },
        { label: '1099-B from Fidelity', form_type: '1099-B', status: 'received' },
      ],
    });
    expect(r.checklist).toEqual([
      { id: 1, label: 'W-2 from Acme', form_type: 'W-2', status: 'expected', document_id: null, document_title: null, notes: 'HR says by Jan 31.' },
      { id: 2, label: '1099-INT from Ally Bank', form_type: '1099-INT', status: 'expected', document_id: null, document_title: null, notes: 'Download from the Ally tax forms page.' },
      { id: 3, label: '1098 mortgage interest', form_type: '1098', status: 'not_applicable', document_id: null, document_title: null, notes: 'Paid off the mortgage.' },
      { id: 5, label: '1099-B from Fidelity', form_type: '1099-B', status: 'received', document_id: null, document_title: null, notes: null },
    ]);
    expect(r.progress).toEqual({ total: 4, received: 1, expected: 2, not_applicable: 1 });

    const bad = await call(kevin, 'tax_checklist_update', { year: 2026, items: [{ label: 'HSA 1099-SA' }, { id: 2, label: 'W-2 from Acme' }] });
    expect(bad.text).toMatch(/items\[1\].*already has an item with that label/);
    expect((await call(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 99, status: 'received' }] })).text).toMatch(/no checklist item 99/);
    expect((await call(kevin, 'tax_checklist_update', { year: 2025, items: [{ id: 2, status: 'received' }] })).text).toMatch(/belongs to 2026/);
    expect((await call(kevin, 'tax_checklist_update', { year: 2026, items: [{ status: 'received' }] })).text).toMatch(/needs a label/);
    expect((await call(kevin, 'tax_checklist_update', { year: 2026, items: [{ label: 'x', document_id: 404 }] })).text).toMatch(/no document 404/);
    expect((await view(kevin, 'taxes/year', { year: '2026' })).checklist).toHaveLength(4); // 'HSA 1099-SA' rolled back with its call
    expect((await view(kevin, 'taxes/years')).years.map((y: { year: number }) => y.year)).toEqual([2026]); // and so did 2025
  });

  it('copies last year\'s checklist with statuses reset and links cleared', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const { w2 } = await seed(kevin);
    await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ label: 'W-2 from Acme', document_id: w2.id }, { label: '1098 mortgage interest', status: 'not_applicable' }] });

    const r = await ok(kevin, 'tax_checklist_update', { year: 2027, copy_from_year: 2026, items: [{ label: 'HSA 1099-SA / 5498-SA', form_type: '1099-SA' }] });
    expect(r.copied).toBe(4);
    expect(r.checklist.map((c: { label: string; status: string; document_id: number | null }) => [c.label, c.status, c.document_id])).toEqual([
      ['W-2 from Acme', 'expected', null],
      ['1099-INT from Ally Bank', 'expected', null],
      ['1098 mortgage interest', 'expected', null],
      ['Charity receipts', 'expected', null],
      ['HSA 1099-SA / 5498-SA', 'expected', null],
    ]);
    expect(r.checklist[1]).toMatchObject({ form_type: '1099-INT', notes: 'Download from the Ally tax forms page.' });
    // 2026 is untouched, and copying again adds nothing.
    expect((await view(kevin, 'taxes/year', { year: '2026' })).progress).toEqual({ total: 4, received: 1, expected: 2, not_applicable: 1 });
    expect((await ok(kevin, 'tax_checklist_update', { year: 2027, copy_from_year: 2026 })).copied).toBe(0);
    expect((await call(kevin, 'tax_checklist_update', { year: 2028, copy_from_year: 2019 })).text).toMatch(/no checklist for 2019.*Years with a checklist: 2027, 2026/);
    expect((await call(kevin, 'tax_checklist_update', { year: 2027, copy_from_year: 2027 })).ok).toBe(false);
  });

  it('marks an item received when a document is linked, and unlinks when the document is deleted', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const { w2 } = await seed(kevin);
    const r = await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ label: 'W-2 from Acme', document_id: w2.id }] });
    expect(r.checklist[0]).toMatchObject({ status: 'received', document_id: w2.id, document_title: 'W-2 2026, Acme Corp' });
    const detail = await view(kevin, 'taxes/year', { year: '2026' });
    expect(detail.checklist[0]).toMatchObject({ document_title: 'W-2 2026, Acme Corp', document_file_url: `/api/x/documents/${w2.id}/file` });
    expect(detail.missing).toEqual(['1099-INT from Ally Bank', '1098 mortgage interest', 'Charity receipts']);
    // An explicit status wins over the link; null unlinks and leaves the status alone.
    expect((await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 1, document_id: w2.id, status: 'expected' }] })).checklist[0].status).toBe('expected');
    await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 1, document_id: w2.id }] });
    expect((await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 1, document_id: null }] })).checklist[0]).toMatchObject({ status: 'received', document_id: null });
    // Deleting the vault document clears the link.
    await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 1, document_id: w2.id }] });
    await ok(kevin, 'document_update', { id: w2.id, delete: true });
    expect((await view(kevin, 'taxes/year', { year: '2026' })).checklist[0]).toMatchObject({ document_id: null, document_title: null, document_file_url: null });
  });

  it('keeps preparer notes and the filed flag on the year', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await seed(kevin);
    await ok(kevin, 'tax_checklist_update', { year: 2026, preparer_notes: 'Sold RSUs in March.\nWorked from home all year.' });
    await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ id: 2, status: 'received' }] }); // notes survive an unrelated call
    expect((await view(kevin, 'taxes/year', { year: '2026' })).preparer_notes).toBe('Sold RSUs in March.\nWorked from home all year.');
    expect((await ok(kevin, 'tax_checklist_update', { year: 2026, status: 'filed' })).status).toBe('filed');
    expect((await view(kevin, 'taxes/years')).years[0]).toMatchObject({ year: 2026, status: 'filed' });
  });
});

describe('tax_deductions_update', () => {
  it('adds, changes and deletes in bulk and totals by category', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const { receipt } = await seed(kevin);
    const r = await ok(kevin, 'tax_deductions_update', {
      year: 2026,
      items: [
        { category: 'charity', description: 'Donation to City Harvest', amount: 500, date: '2026-12-01', document_id: receipt.id },
        { category: 'charity', description: 'Goodwill drop-off', amount: 120.456, date: '2026-05-14' },
        { category: 'education', description: 'Kite-making course', amount: 84.2 },
        { category: 'payment', description: 'Q2 federal estimated payment', amount: 2000, date: '2026-06-15' },
      ],
    });
    expect(r).toMatchObject({ year: 2026, added: 4, updated: 0, deleted: 0 });
    expect(r.items.map((d: { id: number }) => d.id).sort()).toEqual([1, 2, 3, 4]);
    expect(r.totals).toEqual({
      by_category: [
        { category: 'charity', label: 'Charitable giving', total: 620.46, count: 2 },
        { category: 'education', label: 'Education', total: 84.2, count: 1 },
        { category: 'payment', label: 'Tax payments', total: 2000, count: 1 },
      ],
      deductions_total: 704.66,
      payments_total: 2000,
    });

    const r2 = await ok(kevin, 'tax_deductions_update', { year: 2026, items: [{ id: 2, amount: 150, notes: 'Itemised list attached.' }, { id: 3, delete: true }, { category: 'hsa', description: 'HSA contribution', amount: 4300 }] });
    expect(r2).toMatchObject({ added: 1, updated: 1, deleted: 1, totals: { deductions_total: 4950, payments_total: 2000 } });
    expect(r2.items.find((d: { id: number }) => d.id === 2)).toMatchObject({ category: 'charity', description: 'Goodwill drop-off', amount: 150, date: '2026-05-14', notes: 'Itemised list attached.' });

    const detail = await view(kevin, 'taxes/year', { year: '2026' });
    expect(detail.deduction_groups.map((g: { category: string; total: number; count: number }) => [g.category, g.total, g.count])).toEqual([['charity', 650, 2], ['hsa', 4300, 1]]);
    expect(detail.deduction_groups[0].items[1]).toMatchObject({ description: 'Donation to City Harvest', document_title: 'City Harvest donation receipt', document_file_url: `/api/x/documents/${receipt.id}/file` });
    expect(detail.deductions_total).toBe(4950);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments_total).toBe(2000);
    expect((await view(kevin, 'taxes/years')).years[0]).toMatchObject({ year: 2026, deductions_total: 4950, payments_total: 2000 });
  });

  it('creates the year when needed and rejects incomplete or misplaced rows without writing any', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await ok(kevin, 'tax_deductions_update', { year: 2025, items: [{ category: 'energy', description: 'Heat pump', amount: 2000 }] });
    expect((await view(kevin, 'taxes/years')).years.map((y: { year: number }) => y.year)).toEqual([2025]);
    const bad = await call(kevin, 'tax_deductions_update', { year: 2025, items: [{ category: 'charity', description: 'ok', amount: 5 }, { description: 'no amount' }] });
    expect(bad.text).toMatch(/items\[1\] "no amount": a new row needs category, description and amount/);
    expect((await call(kevin, 'tax_deductions_update', { year: 2026, items: [{ id: 1, amount: 5 }] })).text).toMatch(/belongs to 2025/);
    expect((await call(kevin, 'tax_deductions_update', { year: 2025, items: [{ id: 50, delete: true }] })).text).toMatch(/no deduction row 50/);
    expect((await call(kevin, 'tax_deductions_update', { year: 2025, items: [{ category: 'charity', description: 'x', amount: -5 }] })).ok).toBe(false);
    expect((await call(kevin, 'tax_deductions_update', { year: 2025, items: [{ category: 'charity', description: 'x', amount: 5, date: '12/01/2025' }] })).text).toMatch(/YYYY-MM-DD/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM taxes_deductions').get()).toEqual({ n: 1 });
  });
});

describe('tax_packet_build', () => {
  async function ready(kevin: Kevin) {
    const { w2, receipt } = await seed(kevin);
    await ok(kevin, 'tax_checklist_update', {
      year: 2026, preparer_notes: 'Refinanced in June; the 1098 will come from two lenders.',
      items: [{ label: 'W-2 from Acme', document_id: w2.id }, { label: 'Charity receipts', document_id: receipt.id }, { label: '1098 mortgage interest', status: 'not_applicable' }],
    });
    await ok(kevin, 'tax_deductions_update', {
      year: 2026,
      items: [
        { category: 'charity', description: 'Donation to City Harvest', amount: 500, date: '2026-12-01', document_id: receipt.id },
        { category: 'charity', description: 'Goodwill | drop-off', amount: 1120.5 },
        { category: 'education', description: 'Kite-making course', amount: 84.2 },
        { category: 'payment', description: 'Q2 federal estimated payment', amount: 2000, date: '2026-06-15' },
      ],
    });
    return { w2, receipt };
  }

  it('builds a zip with the summary and one copy of every linked document', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await ready(kevin);
    const p = await ok(kevin, 'tax_packet_build', { year: 2026 });
    expect(p).toMatchObject({ packet_id: 1, year: 2026, format: 'zip', file_count: 2, missing_count: 1, missing: ['1099-INT from Ally Bank'], download_url: '/api/x/taxes/packets/1/file' });
    expect(p.filename).toMatch(/^tax-2026-\d{8}T\d{6}Z\.zip$/);
    expect(p).not.toHaveProperty('files_unavailable');

    const abs = vaultFile(join('_packets', p.filename))!;
    expect(abs).toBe(join(vaultRoot(), '_packets', p.filename));
    expect(statSync(abs).mode & 0o777).toBe(0o600);
    expect(statSync(join(vaultRoot(), '_packets')).mode & 0o777).toBe(0o700);
    expect(statSync(abs).size).toBe(p.size_bytes);
    expect(readdirSync(join(vaultRoot(), '_packets')).filter((f) => f.startsWith('.stage-'))).toEqual([]); // staging folder removed

    const z = unzip(abs);
    // The receipt is linked from the checklist and from a deduction: one copy.
    expect(Object.keys(z).sort()).toEqual(['tax-2026/documents/01-W-2-2026-Acme-Corp.txt', 'tax-2026/documents/02-City-Harvest-donation-receipt.txt', 'tax-2026/summary.md']);
    expect(z['tax-2026/documents/01-W-2-2026-Acme-Corp.txt']).toBe(W2);
    expect(z['tax-2026/documents/02-City-Harvest-donation-receipt.txt']).toBe(RECEIPT);

    const s = z['tax-2026/summary.md']!;
    expect(s).toMatch(/^# 2026 tax packet\n/);
    expect(s).toContain('2 document files included');
    expect(s).toContain('## Notes for the preparer\n\nRefinanced in June; the 1098 will come from two lenders.');
    expect(s).toContain('2 of 3 received, 1 still missing, 1 not applicable.');
    expect(s).toContain('| W-2 from Acme | W-2 | Received | documents/01-W-2-2026-Acme-Corp.txt |  |');
    expect(s).toContain('| 1099-INT from Ally Bank | 1099-INT | MISSING |  | Download from the Ally tax forms page. |');
    expect(s).toContain('| 1098 mortgage interest | 1098 | Not applicable |');
    expect(s).toContain('### Still missing\n\n- 1099-INT from Ally Bank (1099-INT): Download from the Ally tax forms page.');
    expect(s).toContain('### Charitable giving: $1,620.50');
    expect(s).toContain('| 2026-12-01 | Donation to City Harvest | $500.00 | documents/02-City-Harvest-donation-receipt.txt |  |');
    expect(s).toContain('| Goodwill \\| drop-off | $1,120.50 |'); // a pipe in the text does not break the table
    expect(s).toContain('### Education: $84.20');
    expect(s).toContain('**Total of all items above: $1,704.70**');
    expect(s).toContain('## Tax payments and withholding notes');
    expect(s).toContain('| 2026-06-15 | Q2 federal estimated payment | $2,000.00 |');
    expect(s).toContain('**Total payments: $2,000.00**');
    expect(s.indexOf('Total of all items above')).toBeLessThan(s.indexOf('Q2 federal estimated payment')); // payments are not counted as deductions

    // Recorded, and shown on the year.
    const detail = await view(kevin, 'taxes/year', { year: '2026' });
    expect(detail.packets).toEqual([{ id: 1, year: 2026, filename: p.filename, format: 'zip', file_count: 2, missing_count: 1, size_bytes: p.size_bytes, created_at: expect.any(String), file_url: '/api/x/taxes/packets/1/file' }]);
    expect((await view(kevin, 'taxes/years')).years[0]).toMatchObject({ packet_count: 1, last_packet_at: detail.packets[0].created_at });
  });

  it('builds again under a new name, says which linked files are gone, and handles an empty year', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const { w2 } = await ready(kevin);
    const first = await ok(kevin, 'tax_packet_build', { year: 2026 });
    kevin.db.prepare("UPDATE documents SET file_path = 'tax/lost.txt' WHERE id = ?").run(w2.id);
    const second = await ok(kevin, 'tax_packet_build', { year: 2026 });
    expect(second.filename).not.toBe(first.filename);
    expect(second).toMatchObject({ packet_id: 2, file_count: 1, files_unavailable: ['W-2 2026, Acme Corp'] });
    const z = unzip(vaultFile(join('_packets', second.filename))!);
    expect(Object.keys(z).sort()).toEqual(['tax-2026/documents/01-City-Harvest-donation-receipt.txt', 'tax-2026/summary.md']);
    expect(z['tax-2026/summary.md']).toContain('| W-2 from Acme | W-2 | Received | (file unavailable) |');

    await ok(kevin, 'tax_checklist_update', { year: 2030 });
    const empty = await ok(kevin, 'tax_packet_build', { year: 2030 });
    expect(empty).toMatchObject({ file_count: 0, missing_count: 0 });
    const s = unzip(vaultFile(join('_packets', empty.filename))!)['tax-2030/summary.md']!;
    expect(s).toContain('_No checklist items._');
    expect(s).toContain('_None recorded._');
    expect((await call(kevin, 'tax_packet_build', { year: 2019 })).text).toMatch(/no tax year 2019\. Years on record: 2030, 2026/);
  });

  it('falls back to tar.gz when nothing can write a zip', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await ready(kevin);
    Object.assign(archivers, { python: 'no-such-python3', zip: 'no-such-zip' });
    const p = await ok(kevin, 'tax_packet_build', { year: 2026 });
    expect(p.format).toBe('tar.gz');
    expect(p.filename).toMatch(/^tax-2026-.*\.tar\.gz$/);
    const abs = vaultFile(join('_packets', p.filename))!;
    const names = execFileSync('tar', ['-tzf', abs], { encoding: 'utf8' }).split('\n').filter((n) => n && !n.endsWith('/')).sort();
    expect(names).toEqual(['tax-2026/documents/01-W-2-2026-Acme-Corp.txt', 'tax-2026/documents/02-City-Harvest-donation-receipt.txt', 'tax-2026/summary.md']);
    expect(existsSync(abs.replace(/\.tar\.gz$/, '.zip'))).toBe(false);

    const res = await fetch(`${await serve(kevin)}/packets/${p.packet_id}/file`);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${p.filename}"`);
  });

  it('serves a packet as a download, and 404s anything else', async () => {
    const kevin = await makeKevin([documents, taxes]);
    await ready(kevin);
    const p = await ok(kevin, 'tax_packet_build', { year: 2026 });
    const base = await serve(kevin);
    const res = await fetch(`${base}/packets/${p.packet_id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${p.filename}"`);
    expect(res.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(p.size_bytes);
    const copy = join(tmpdir(), `kevin-packet-${process.pid}.zip`);
    writeFileSync(copy, body);
    expect(Object.keys(unzip(copy))).toContain('tax-2026/summary.md');

    expect((await fetch(`${base}/packets/99/file`)).status).toBe(404);
    expect((await fetch(`${base}/packets/x/file`)).status).toBe(404);
    kevin.db.prepare("UPDATE taxes_packets SET file_path = '../kevin.db' WHERE id = ?").run(p.packet_id);
    expect((await fetch(`${base}/packets/${p.packet_id}/file`)).status).toBe(404);
  });
});

describe('tax views', () => {
  it('lists years newest first with progress, and defaults the year view to the newest', async () => {
    const kevin = await makeKevin([documents, taxes]);
    expect(await view(kevin, 'taxes/years')).toEqual({ years: [] });
    expect(await view(kevin, 'taxes/year')).toEqual({ year: null, exists: false });
    await seed(kevin);
    await ok(kevin, 'tax_checklist_update', { year: 2025, items: [{ label: 'W-2 from Acme', status: 'received' }] });
    const years = (await view(kevin, 'taxes/years')).years;
    expect(years.map((y: { year: number }) => y.year)).toEqual([2026, 2025]);
    expect(years[0]).toMatchObject({ status: 'open', progress: { total: 4, received: 0, expected: 4, not_applicable: 0 }, deductions_total: 0, payments_total: 0, packet_count: 0, last_packet_at: null });
    expect(years[1].progress).toEqual({ total: 1, received: 1, expected: 0, not_applicable: 0 });
    expect((await view(kevin, 'taxes/year')).year).toBe(2026);
    expect(await view(kevin, 'taxes/year', { year: '2031' })).toMatchObject({ year: 2031, exists: false, status: null, checklist: [], deduction_groups: [], packets: [], progress: { total: 0 } });
  });

  it('puts a year on Home once it is over and documents are still out, and through April', async () => {
    const kevin = await makeKevin([documents, taxes]);
    expect(taxHomeCards(kevin.db, '2027-02-10')).toEqual({ cards: [] }); // taxes never used: nothing
    await ok(kevin, 'tax_checklist_update', {
      year: 2026,
      items: [...['W-2', '1099-INT', '1099-DIV', '1099-B'].map((l) => ({ label: l, status: 'received' })), ...['1098', 'HSA 1099-SA', 'Property tax statement', 'Charity receipts', 'Estimated tax payments'].map((l) => ({ label: l })), { label: 'Childcare statement', status: 'not_applicable' }],
    });
    // During the tax year itself the forms cannot have arrived yet.
    expect(taxHomeCards(kevin.db, '2026-11-14')).toEqual({ cards: [] });
    expect(taxHomeCards(kevin.db, '2027-02-10')).toEqual({
      cards: [{
        title: '2026 taxes: 4 of 9 documents in',
        lines: ['Missing: 1098', 'Missing: HSA 1099-SA', 'Missing: Property tax statement', 'Missing: Charity receipts', 'and 1 more'],
        link: '/taxes',
      }],
    });
    // Still outstanding after April: still shown.
    expect(taxHomeCards(kevin.db, '2027-07-01').cards[0]!.title).toBe('2026 taxes: 4 of 9 documents in');

    await ok(kevin, 'tax_checklist_update', { year: 2026, items: ['1098', 'HSA 1099-SA', 'Property tax statement', 'Charity receipts', 'Estimated tax payments'].map((l) => ({ label: l, status: 'received' })) });
    expect(taxHomeCards(kevin.db, '2027-03-01').cards).toEqual([{ title: '2026 taxes: 9 of 9 documents in', lines: ['Everything is in. The packet for the preparer can be built.'], link: '/taxes' }]);
    await ok(kevin, 'tax_packet_build', { year: 2026 });
    expect(taxHomeCards(kevin.db, '2027-03-01').cards[0]!.lines[0]).toMatch(/^Everything is in\. Packet built \d{4}-\d{2}-\d{2}\.$/);
    expect(taxHomeCards(kevin.db, '2027-07-01')).toEqual({ cards: [] }); // out of season with nothing outstanding
    await ok(kevin, 'tax_checklist_update', { year: 2026, status: 'filed' });
    expect(taxHomeCards(kevin.db, '2027-03-01')).toEqual({ cards: [] }); // filed: done
    // The next season opens with a nudge to start the year.
    expect(taxHomeCards(kevin.db, '2028-01-15').cards).toEqual([{ title: '2027 taxes: not started', lines: ["No checklist for this return yet. Last year's can be copied as a start."], link: '/taxes' }]);
    expect(taxHomeCards(kevin.db, '2028-06-15')).toEqual({ cards: [] });
    // The view itself runs on today's date.
    expect(await view(kevin, 'taxes/home')).toHaveProperty('cards');
  });

  it('answers the questions a model would put to it in SQL', async () => {
    const kevin = await makeKevin([documents, taxes]);
    const { w2, receipt } = await seed(kevin);
    await ok(kevin, 'tax_checklist_update', { year: 2026, items: [{ label: 'W-2 from Acme', document_id: w2.id }] });
    await ok(kevin, 'tax_deductions_update', {
      year: 2026,
      items: [
        { category: 'charity', description: 'City Harvest', amount: 500, document_id: receipt.id },
        { category: 'charity', description: 'Goodwill', amount: 120 },
        { category: 'payment', description: 'Q2 estimate', amount: 2000 },
      ],
    });
    // "Which tax documents am I still missing for 2026?"
    const missing = await ok(kevin, 'query', { sql: "SELECT label, form_type FROM taxes_checklist_items WHERE year = 2026 AND status = 'expected' ORDER BY id" });
    expect(missing.rows).toEqual([{ label: '1099-INT from Ally Bank', form_type: '1099-INT' }, { label: '1098 mortgage interest', form_type: '1098' }, { label: 'Charity receipts', form_type: null }]);
    // "Total charity this year?"
    expect((await ok(kevin, 'query', { sql: "SELECT SUM(amount) AS total FROM taxes_deductions WHERE year = 2026 AND category = 'charity'" })).rows).toEqual([{ total: 620 }]);
    // "What have I got for each item?"
    const joined = await ok(kevin, 'query', { sql: 'SELECT i.label, d.title FROM taxes_checklist_items i JOIN documents d ON d.id = i.document_id WHERE i.year = 2026' });
    expect(joined.rows).toEqual([{ label: 'W-2 from Acme', title: 'W-2 2026, Acme Corp' }]);
    const byCat = await ok(kevin, 'query', { sql: "SELECT category, SUM(amount) AS total FROM taxes_deductions WHERE year = 2026 AND category != 'payment' GROUP BY category" });
    expect(byCat.rows).toEqual([{ category: 'charity', total: 620 }]);

    expect(kevin.stableSystem).toMatch(/CREATE TABLE taxes_checklist_items \(/);
    expect(kevin.stableSystem).toMatch(/expected \(still missing\) \| received \| not_applicable/);
    expect(kevin.stableSystem).toMatch(/## taxes\nBen's US federal and state income tax return/);
    expect(kevin.tools.apiTools().map((t) => t.name).filter((n) => n.startsWith('tax_'))).toEqual(['tax_checklist_update', 'tax_deductions_update', 'tax_packet_build']);
  });
});
