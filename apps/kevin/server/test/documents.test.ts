import express, { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extract, saveUpload } from '../src/attachments.js';
import { config } from '../src/config.js';
import documents, { documentsHomeCards } from '../src/domains/documents.js';
import { FILE_CSP, vaultFile, vaultPath, vaultRoot } from '../src/domains/_documents/vault.js';
import type { Kevin } from '../src/kevin.js';
import { call, makeKevin, ok, view } from './helpers.js';

const INVOICE = 'Northwind Kite Repair invoice\nCustomer: Test Owner\nTechnician: Zephyrine\nDate of service: 2026-03-02\nWork: spar replacement\nAmount due: $84.20';
const W2 = 'Form W-2 Wage and Tax Statement 2026\nEmployer: Acme Corp\nWages, tips, other compensation: 150000.00\nFederal income tax withheld: 28000.00';
const LEASE = 'Residential lease agreement between landlord Hargrove Properties and tenant. Monthly rent 2400. Term begins 2025-09-01.';

async function upload(kevin: Kevin, name: string, text: string) {
  return extract(kevin.db, saveUpload(kevin.db, Buffer.from(text), name).id);
}

async function seed(kevin: Kevin) {
  const invoice = await ok(kevin, 'ingest_document', {
    attachment_id: (await upload(kevin, 'northwind invoice.txt', INVOICE)).id, title: 'Northwind invoice, spar repair, March 2026', category: 'home',
    tags: ['Mending', ' club ', 'mending'], document_date: '2026-03-10', issuer: 'Northwind', summary: 'Spar replacement on 2026-03-02; $84.20 due.',
  });
  const w2 = await ok(kevin, 'ingest_document', {
    attachment_id: (await upload(kevin, 'w2.txt', W2)).id, title: 'W-2 2026, Acme Corp', category: 'tax', tags: ['w-2'], document_date: '2027-01-20', issuer: 'Acme Corp', tax_year: 2026,
  });
  const lease = await ok(kevin, 'ingest_document', { attachment_id: (await upload(kevin, 'lease.txt', LEASE)).id, title: 'Apartment lease 2025' });
  return { invoice, w2, lease };
}

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
async function serve(kevin: Kevin): Promise<string> {
  const app = express();
  const r = Router();
  documents.routes!(r, kevin.db);
  app.use('/api/x/documents', r);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/x/documents`;
}

const pathOf = (kevin: Kevin, id: number) => (kevin.db.prepare('SELECT file_path FROM documents WHERE id = ?').get(id) as { file_path: string }).file_path;

describe('ingest_document', () => {
  it('copies the file into the vault owner-only, stores metadata and text, and indexes it', async () => {
    const kevin = await makeKevin([documents]);
    const { invoice, lease } = await seed(kevin);
    expect(invoice).toMatchObject({
      filed: true, id: 1, title: 'Northwind invoice, spar repair, March 2026', category: 'home', tags: ['club', 'mending'], document_date: '2026-03-10', issuer: 'Northwind', tax_year: null,
      original_filename: 'northwind invoice.txt', mime: 'text/plain', size_bytes: INVOICE.length, text_chars: INVOICE.length, file_url: '/api/x/documents/1/file',
    });
    expect(invoice).not.toHaveProperty('extracted_text');
    expect(invoice).not.toHaveProperty('file_path');
    // Everything but attachment_id and title is optional.
    expect(lease).toMatchObject({ category: 'other', tags: [], document_date: null, issuer: null, summary: null });

    const rel = pathOf(kevin, invoice.id);
    expect(rel).toBe('home/1-northwind invoice.txt');
    const abs = join(config.dataDir, 'documents', rel);
    expect(readFileSync(abs, 'utf8')).toBe(INVOICE);
    expect(statSync(abs).mode & 0o777).toBe(0o600);
    expect(statSync(join(config.dataDir, 'documents', 'home')).mode & 0o777).toBe(0o700);
    expect(statSync(vaultRoot()).mode & 0o777).toBe(0o700);

    const row = kevin.db.prepare('SELECT sha256, attachment_id, extracted_text FROM documents WHERE id = 1').get() as { sha256: string; attachment_id: number; extracted_text: string };
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.extracted_text).toBe(INVOICE);

    // Recall reaches the text and the metadata.
    const hits = (await ok(kevin, 'recall', { query: 'spar replacement', kinds: ['document'] })).hits;
    expect(hits[0]).toMatchObject({ kind: 'document', ref: '1', title: 'Northwind invoice, spar repair, March 2026', at: '2026-03-10' });
    expect((await ok(kevin, 'recall', { query: 'club', kinds: ['document'] })).hits[0].ref).toBe('1');
  });

  it('refuses a file already in the vault, naming the existing document', async () => {
    const kevin = await makeKevin([documents]);
    await seed(kevin);
    const again = await upload(kevin, 'renamed copy.txt', INVOICE);
    const r = await call(kevin, 'ingest_document', { attachment_id: again.id, title: 'Same invoice again' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/already in the vault as document 1, "Northwind invoice, spar repair, March 2026"/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 3 });
  });

  it('explains a bad attachment id, a bad date and a bad category', async () => {
    const kevin = await makeKevin([documents]);
    expect((await call(kevin, 'ingest_document', { attachment_id: 99, title: 'x' })).text).toMatch(/no upload with id 99/);
    const a = await upload(kevin, 'a.txt', 'some text');
    expect((await call(kevin, 'ingest_document', { attachment_id: a.id, title: 'x', document_date: '2026-02-30' })).text).toMatch(/document_date/);
    expect((await call(kevin, 'ingest_document', { attachment_id: a.id, title: 'x', document_date: 'March 3' })).text).toMatch(/YYYY-MM-DD/);
    expect((await call(kevin, 'ingest_document', { attachment_id: a.id, title: 'x', category: 'misc' })).ok).toBe(false);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 0 });
  });

  it('files a file with no readable text and says so', async () => {
    const kevin = await makeKevin([documents]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a picture')]);
    const a = saveUpload(kevin.db, png, 'insurance card.png'); // never extracted: no API call in tests
    const d = await ok(kevin, 'ingest_document', { attachment_id: a.id, title: 'Northwind membership card', category: 'insurance', summary: 'Member number K-000-TEST, group 0042.' });
    expect(d).toMatchObject({ mime: 'image/png', text_chars: 0 });
    expect(d.note).toMatch(/No text could be read/);
    expect((await ok(kevin, 'recall', { query: '0042', kinds: ['document'] })).hits[0].ref).toBe(String(d.id));
  });

  it('is offered to the model with only attachment_id and title required, and is callable from the page', async () => {
    const kevin = await makeKevin([documents]);
    const tool = kevin.tools.apiTools().find((t) => t.name === 'ingest_document')!;
    expect(tool.input_schema.required).toEqual(['attachment_id', 'title']);
    expect(kevin.tools.apiTools().map((t) => t.name).filter((n) => /document/.test(n))).toEqual(['document_update', 'ingest_document']);
    const a = await upload(kevin, 'a.txt', 'filed from the page');
    expect((await call(kevin, 'ingest_document', { attachment_id: a.id, title: 'From the page' }, { source: 'ui' })).ok).toBe(true);
  });
});

describe('document_update', () => {
  it('changes only what is passed, clears with null, and re-indexes', async () => {
    const kevin = await makeKevin([documents]);
    const { invoice } = await seed(kevin);
    const u = await ok(kevin, 'document_update', { id: invoice.id, title: 'Northwind invoice, spar work', tags: ['spars'], notes: 'Sent to the kite club for reimbursement.', issuer: null });
    expect(u).toMatchObject({ title: 'Northwind invoice, spar work', tags: ['spars'], issuer: null, category: 'home', document_date: '2026-03-10', notes: 'Sent to the kite club for reimbursement.' });
    expect(u.summary).toMatch(/84\.20/);

    const find = async (q: string) => (await ok(kevin, 'recall', { query: q, kinds: ['document'] })).hits.map((h: { ref: string }) => h.ref);
    expect(await find('reimbursement')).toEqual(['1']); // new notes
    expect(await find('spars')).toEqual(['1']); // new tag
    expect(await find('work')).toEqual(['1']); // new title
    expect(await find('mending')).toEqual([]); // old tag
    expect(await find('march')).toEqual([]); // old title
    expect(kevin.db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE kind = 'document' AND ref = '1'").get()).toEqual({ n: 1 });
    expect((await call(kevin, 'document_update', { id: 77, title: 'x' })).text).toMatch(/no document 77/);
  });

  it('moves the file when the category changes', async () => {
    const kevin = await makeKevin([documents]);
    const { lease } = await seed(kevin);
    const before = vaultFile(pathOf(kevin, lease.id))!;
    await ok(kevin, 'document_update', { id: lease.id, category: 'legal', tax_year: 2025 });
    expect(pathOf(kevin, lease.id)).toBe('legal/3-lease.txt');
    expect(existsSync(before)).toBe(false);
    expect(readFileSync(vaultFile('legal/3-lease.txt')!, 'utf8')).toBe(LEASE);
    expect((await view(kevin, 'documents/list', { category: 'legal' })).documents.map((d: { id: number }) => d.id)).toEqual([lease.id]);
  });

  it('deletes the file, the row and the index entry once Ben confirms; a declined confirm keeps everything', async () => {
    const kevin = await makeKevin([documents]);
    const { invoice } = await seed(kevin);
    const abs = vaultFile(pathOf(kevin, invoice.id))!;
    const declined = await call(kevin, 'document_update', { id: invoice.id, delete: true }, { confirm: false });
    expect(declined.ok).toBe(false);
    expect(declined.text).toMatch(/declined/);
    expect(existsSync(abs)).toBe(true);
    expect((await view(kevin, 'documents/get', { id: String(invoice.id) })).document.title).toMatch(/Northwind/);
    expect((await ok(kevin, 'recall', { query: 'spar', kinds: ['document'] })).hits).toHaveLength(1);

    expect(await ok(kevin, 'document_update', { id: invoice.id, delete: true })).toEqual({ deleted: invoice.id, title: 'Northwind invoice, spar repair, March 2026' });
    expect(existsSync(abs)).toBe(false);
    expect((await view(kevin, 'documents/get', { id: String(invoice.id) })).document).toBeNull();
    expect((await ok(kevin, 'recall', { query: 'spar', kinds: ['document'] })).hits).toEqual([]);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM documents_tags WHERE document_id = ?').get(invoice.id)).toEqual({ n: 0 });
    // The same file can be filed again afterwards.
    const again = await upload(kevin, 'northwind invoice.txt', INVOICE);
    expect((await call(kevin, 'ingest_document', { attachment_id: again.id, title: 'Invoice refiled' })).ok).toBe(true);
  });
});

describe('document views', () => {
  it('lists by document date, newest first, without the full text, and filters', async () => {
    const kevin = await makeKevin([documents]);
    await seed(kevin);
    const all = await view(kevin, 'documents/list');
    expect(all.total).toBe(3);
    expect(all.documents.map((d: { title: string }) => d.title)).toEqual(['W-2 2026, Acme Corp', 'Northwind invoice, spar repair, March 2026', 'Apartment lease 2025']); // undated last
    expect(all.documents[0]).not.toHaveProperty('extracted_text');
    expect(all.documents[0]).toMatchObject({ snippet: null, tags: ['w-2'], file_url: '/api/x/documents/2/file' });
    const ids = async (p: Record<string, string>) => (await view(kevin, 'documents/list', p)).documents.map((d: { id: number }) => d.id);
    expect(await ids({ category: 'home' })).toEqual([1]);
    expect(await ids({ tag: 'CLUB' })).toEqual([1]);
    expect(await ids({ tax_year: '2026' })).toEqual([2]);
    expect(await ids({ category: 'tax', tag: 'mending' })).toEqual([]);
    expect(await ids({ limit: '1', offset: '1' })).toEqual([1]);
  });

  it('searches the full text with snippets, and titles, issuers and tags by what is typed', async () => {
    const kevin = await makeKevin([documents]);
    await seed(kevin);
    const r = await view(kevin, 'documents/list', { q: 'withheld wages' });
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0].id).toBe(2);
    expect(r.documents[0].snippet).toMatch(/withheld/i);
    expect(r.documents[0]).not.toHaveProperty('extracted_text');
    // A partial word finds the issuer even though the full-text index matches whole words.
    const partial = await view(kevin, 'documents/list', { q: 'nort' });
    expect(partial.documents.map((d: { id: number }) => d.id)).toEqual([1]);
    expect(partial.documents[0].snippet).toBeNull();
    // q combines with the other filters; nothing found is an empty list.
    expect((await view(kevin, 'documents/list', { q: 'landlord', category: 'home' })).documents).toEqual([]);
    expect((await view(kevin, 'documents/list', { q: 'landlord' })).documents[0].id).toBe(3);
    expect(await view(kevin, 'documents/list', { q: 'zebra%' })).toEqual({ documents: [], total: 0 });
    // Only documents: the uploads themselves are indexed too, under another kind.
    expect((await view(kevin, 'documents/list', { q: 'spar' })).total).toBe(1);
  });

  it('returns one document with its text, and facets for the filter chips', async () => {
    const kevin = await makeKevin([documents]);
    await seed(kevin);
    const got = (await view(kevin, 'documents/get', { id: '2' })).document;
    expect(got).toMatchObject({ id: 2, title: 'W-2 2026, Acme Corp', extracted_text: W2, tax_year: 2026 });
    expect((await view(kevin, 'documents/get', { id: 'nope' })).document).toBeNull();
    expect(await view(kevin, 'documents/facets')).toEqual({
      total: 3,
      categories: [{ category: 'home', count: 1 }, { category: 'other', count: 1 }, { category: 'tax', count: 1 }],
      tags: [{ tag: 'club', count: 1 }, { tag: 'mending', count: 1 }, { tag: 'w-2', count: 1 }],
      tax_years: [{ tax_year: 2026, count: 1 }],
    });
  });

  it('shows on Home what was filed this week, and nothing otherwise', async () => {
    const kevin = await makeKevin([documents]);
    expect(await view(kevin, 'documents/home')).toEqual({ cards: [] });
    await seed(kevin);
    const home = await view(kevin, 'documents/home');
    expect(home.cards).toHaveLength(1);
    expect(home.cards[0]).toMatchObject({ title: '3 documents filed this week', link: '/documents' });
    expect(home.cards[0].lines).toContain('W-2 2026, Acme Corp (tax)');
    expect(documentsHomeCards(kevin.db, new Date(Date.now() + 8 * 86_400_000))).toEqual({ cards: [] });
  });

  it('is readable with the SQL a model would write', async () => {
    const kevin = await makeKevin([documents]);
    await seed(kevin);
    const listing = await ok(kevin, 'query', {
      sql: "SELECT d.id, d.title, d.document_date, d.summary FROM documents d JOIN documents_tags t ON t.document_id = d.id WHERE t.tag = 'mending' ORDER BY d.document_date DESC",
    });
    expect(listing.rows).toEqual([{ id: 1, title: 'Northwind invoice, spar repair, March 2026', document_date: '2026-03-10', summary: 'Spar replacement on 2026-03-02; $84.20 due.' }]);
    const slice = await ok(kevin, 'query', { sql: 'SELECT substr(extracted_text, 1, 29) AS text, text_chars FROM documents WHERE id = 1' });
    expect(slice.rows).toEqual([{ text: 'Northwind Kite Repair invoice', text_chars: INVOICE.length }]);
    // The schema and the working notes reach the system prompt, comments included.
    expect(kevin.stableSystem).toMatch(/CREATE TABLE documents \(/);
    expect(kevin.stableSystem).toMatch(/read it in slices with substr/);
    expect(kevin.stableSystem).toMatch(/## documents\nThe vault of Ben's kept paperwork/);
  });
});

describe('GET /api/x/documents/:id/file', () => {
  it('serves the stored file with the protective headers', async () => {
    const kevin = await makeKevin([documents]);
    const { invoice } = await seed(kevin);
    const base = await serve(kevin);
    const res = await fetch(`${base}/${invoice.id}/file`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INVOICE);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('content-security-policy')).toBe(FILE_CSP);
    expect(FILE_CSP).toBe("sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"); // the core's header for uploads
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="northwind invoice.txt"');
    expect((await fetch(`${base}/${invoice.id}/file?download=1`)).headers.get('content-disposition')).toBe('attachment; filename="northwind invoice.txt"');
  });

  it('sanitizes the filename and downloads what a browser should not render', async () => {
    const kevin = await makeKevin([documents]);
    const a = saveUpload(kevin.db, Buffer.from([0, 1, 2, 3, 0, 255]), 'bad"name\r\nX-Evil: 1.bin');
    await extract(kevin.db, a.id); // 'other': skipped without any API call
    const d = await ok(kevin, 'ingest_document', { attachment_id: a.id, title: 'Odd file' });
    const res = await fetch(`${await serve(kevin)}/${d.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.\- ]+"$/);
    expect(res.headers.get('x-evil')).toBeNull();
  });

  it('answers 404 for unknown ids, missing files, and any path that leaves the vault', async () => {
    const kevin = await makeKevin([documents]);
    const { invoice, w2, lease } = await seed(kevin);
    const base = await serve(kevin);
    expect((await fetch(`${base}/999/file`)).status).toBe(404);
    expect((await fetch(`${base}/abc/file`)).status).toBe(404);
    expect((await fetch(`${base}/..%2F..%2Fkevin.db/file`)).status).toBe(404);

    // A row pointing outside the vault is never followed, whatever put it there.
    writeFileSync(join(config.dataDir, 'outside.txt'), 'not a vault file');
    const setPath = (id: number, p: string) => kevin.db.prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(p, id);
    setPath(invoice.id, '../outside.txt');
    expect((await fetch(`${base}/${invoice.id}/file`)).status).toBe(404);
    setPath(invoice.id, join(config.dataDir, 'outside.txt'));
    expect((await fetch(`${base}/${invoice.id}/file`)).status).toBe(404);
    setPath(invoice.id, 'home/../../outside.txt');
    expect((await fetch(`${base}/${invoice.id}/file`)).status).toBe(404);
    // A symlink inside the vault that points out of it.
    mkdirSync(join(vaultRoot(), 'other'), { recursive: true });
    symlinkSync(join(config.dataDir, 'outside.txt'), join(vaultRoot(), 'other', 'link.txt'));
    setPath(w2.id, 'other/link.txt');
    expect((await fetch(`${base}/${w2.id}/file`)).status).toBe(404);
    // A directory, and a file that has gone missing.
    setPath(lease.id, 'other');
    expect((await fetch(`${base}/${lease.id}/file`)).status).toBe(404);
    setPath(lease.id, 'other/gone.txt');
    expect((await fetch(`${base}/${lease.id}/file`)).status).toBe(404);

    expect(vaultPath('../outside.txt')).toBeNull();
    expect(vaultPath('/etc/passwd')).toBeNull();
    expect(vaultPath('')).toBeNull();
    expect(vaultPath('home/1-a.txt')).toBe(join(vaultRoot(), 'home', '1-a.txt'));
  });
});
