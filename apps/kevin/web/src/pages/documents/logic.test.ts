import { describe, expect, it } from 'vitest';
import {
  askPrompt, cleanTags, findTerms, countHits, docDate, documentLink, draftError, draftOf, duplicateOf, filtersFromSearch, hasFilters, highlightParts, ingestInput,
  listParams, newDraft, parseTagInput, searchTerms, tagSuggestions, titleFromFilename, updateInput, withParams, type DocumentInfo,
} from './logic';

const doc: DocumentInfo = {
  id: 7, title: 'Northwind invoice, March 2026', category: 'insurance', tags: ['northwind', 'invoice'], document_date: '2026-03-12', issuer: 'Northwind', tax_year: 2026,
  summary: 'Repair on March 3.', notes: null, original_filename: 'invoice.pdf', mime: 'application/pdf', size_bytes: 1200, text_chars: 800,
  created_at: '2026-03-20T10:00:00.000Z', updated_at: '2026-03-20T10:00:00.000Z', file_url: '/api/x/documents/7/file',
};

describe('filters', () => {
  it('reads the URL, dropping values the server would not accept', () => {
    const f = filtersFromSearch(new URLSearchParams('q=spars&category=home&tag=%20HSA%20&year=2026&doc=4'));
    expect(f).toEqual({ q: 'spars', category: 'home', tag: 'hsa', year: '2026' });
    expect(filtersFromSearch(new URLSearchParams('category=nonsense&year=20x6'))).toEqual({ q: '', category: '', tag: '', year: '' });
  });

  it('builds view params without empty keys', () => {
    expect(listParams({ q: '  w-2 ', category: 'tax', tag: '', year: '2026' })).toEqual({ q: 'w-2', category: 'tax', tag: undefined, tax_year: '2026', limit: undefined });
    expect(listParams({ q: '', category: '', tag: '', year: '' }, 400).limit).toBe(400);
    expect(hasFilters({ q: ' ', category: '', tag: '', year: '' })).toBe(false);
    expect(hasFilters({ q: '', category: '', tag: 'hsa', year: '' })).toBe(true);
  });

  it('sets and removes search params, keeping the rest', () => {
    const sp = new URLSearchParams('q=invoice&category=home');
    expect(withParams(sp, { category: null, doc: 9 }).toString()).toBe('q=invoice&doc=9');
    expect(withParams(sp, { q: '' }).toString()).toBe('category=home');
    expect(sp.toString()).toBe('q=invoice&category=home');
  });

  it('links to a document, carrying the search', () => {
    expect(documentLink(3)).toBe('/documents?doc=3');
    expect(documentLink(3, ' kite string ')).toBe('/documents?doc=3&q=kite%20string');
  });
});

describe('tags', () => {
  it('normalises the way the server does', () => {
    expect(cleanTags([' CLUB ', 'club', 'Blue  Shed', '', '#kites'])).toEqual(['blue shed', 'club', 'kites']);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`))).toHaveLength(20);
    expect(cleanTags(['x'.repeat(60)])[0]).toHaveLength(40);
  });

  it('splits typed text on commas', () => {
    expect(parseTagInput('Kites, club ,, Northwind')).toEqual(['club', 'kites', 'northwind']);
  });

  it('suggests unused tags, prefix matches then most used first', () => {
    const facets = [{ tag: 'club', count: 5 }, { tag: 'kites', count: 3 }, { tag: 'northwind', count: 9 }, { tag: 'craft', count: 1 }];
    expect(tagSuggestions(facets, ['northwind'], '')).toEqual(['club', 'kites', 'craft']);
    expect(tagSuggestions(facets, [], 'c')).toEqual(['club', 'craft']);
    expect(tagSuggestions(facets, [], 'te')).toEqual(['kites']);
    expect(tagSuggestions(facets, [], '', 2)).toEqual(['northwind', 'club']);
  });
});

describe('filing form', () => {
  it('makes a title from a filename', () => {
    expect(titleFromFilename('northwind_invoice-march.pdf')).toBe('Northwind invoice march');
    expect(titleFromFilename('W-2_2026.PDF')).toBe('W-2 2026');
    expect(titleFromFilename('statement 2026-03-31.pdf')).toBe('Statement 2026-03-31');
    expect(titleFromFilename('1099-INT-ally.pdf')).toBe('1099-INT ally');
    expect(titleFromFilename('IMG_4412.jpg')).toBe('IMG 4412');
    expect(titleFromFilename('.pdf')).toBe('Document');
  });

  it('starts a draft from the filename and a preset', () => {
    expect(newDraft('scan.jpg', { category: 'tax', tax_year: '2026', title: 'W-2 from Acme' })).toMatchObject({ title: 'W-2 from Acme', category: 'tax', tax_year: '2026', tags: [] });
    expect(newDraft('kite_plans.pdf').title).toBe('Kite plans');
  });

  it('says why a draft cannot be saved', () => {
    const d = newDraft('a.pdf');
    expect(draftError(d)).toBeNull();
    expect(draftError({ ...d, title: '  ' })).toMatch(/title/);
    expect(draftError({ ...d, tax_year: '26' })).toMatch(/tax year/);
    expect(draftError({ ...d, tax_year: '1880' })).toMatch(/tax year/);
    expect(draftError({ ...d, document_date: '2026-02-31' })).toMatch(/date/);
    expect(draftError({ ...d, summary: 'x'.repeat(1501) })).toMatch(/summary/);
  });

  it('builds ingest_document input, leaving blanks out', () => {
    expect(ingestInput(12, newDraft('a.pdf'))).toEqual({ attachment_id: 12, title: 'A', category: 'other' });
    expect(
      ingestInput(12, { title: ' W-2 2026, Acme ', category: 'tax', document_date: '2027-01-20', issuer: ' Acme ', tags: ['W-2', 'acme'], tax_year: '2026', summary: 'Wages 100k', notes: ' ' }),
    ).toEqual({ attachment_id: 12, title: 'W-2 2026, Acme', category: 'tax', tags: ['acme', 'w-2'], document_date: '2027-01-20', issuer: 'Acme', tax_year: 2026, summary: 'Wages 100k' });
  });

  it('builds document_update input from what changed only', () => {
    expect(updateInput(doc, draftOf(doc))).toEqual({ id: 7 });
    expect(updateInput(doc, { ...draftOf(doc), title: 'Northwind invoice', issuer: '', tax_year: '', tags: ['invoice', 'Northwind', 'spars'], notes: 'Paid' })).toEqual({
      id: 7, title: 'Northwind invoice', issuer: null, tax_year: null, tags: ['invoice', 'northwind', 'spars'], notes: 'Paid',
    });
    expect(updateInput(doc, { ...draftOf(doc), document_date: '', category: 'home', tags: [] })).toEqual({ id: 7, document_date: null, category: 'home', tags: [] });
  });

  it('finds the existing document in a duplicate refusal', () => {
    expect(duplicateOf('This exact file is already in the vault as document 1, "Northwind invoice, spar repair, March 2026" (insurance). Change its details with document_update if needed.')).toEqual({
      id: 1, title: 'Northwind invoice, spar repair, March 2026',
    });
    expect(duplicateOf('already in the vault as document 42')).toEqual({ id: 42, title: null });
    expect(duplicateOf('There is no upload with id 3.')).toBeNull();
  });
});

describe('highlighting', () => {
  it('takes the words of a search', () => {
    expect(searchTerms('"kite string" AND a aerodynamics*')).toEqual(['aerodynamics', 'string', 'kite']);
    expect(searchTerms('  ')).toEqual([]);
    expect(searchTerms('W-2 w-2')).toEqual(['w-2']);
  });

  it('finds a typed phrase whole when the text has it, else by its words', () => {
    const text = 'Payroll period 3: gross 5,700.00. Payroll period 33: gross 5,700.00';
    expect(findTerms(text, 'payroll period 33')).toEqual(['payroll period 33']);
    expect(findTerms(text, 'gross payroll')).toEqual(['payroll', 'gross']);
    expect(findTerms(text, ' ')).toEqual([]);
  });

  it('splits text into hits and the rest', () => {
    const parts = highlightParts('Federal tax withheld: 18,400. Tax year 2026.', ['tax', 'withheld']);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['tax', 'withheld', 'Tax']);
    expect(parts.map((p) => p.text).join('')).toBe('Federal tax withheld: 18,400. Tax year 2026.');
    expect(countHits(parts)).toBe(3);
  });

  it('treats terms literally and copes with none', () => {
    expect(highlightParts('cost (est.) $40', ['(est.)']).filter((p) => p.hit)).toEqual([{ text: '(est.)', hit: true }]);
    expect(highlightParts('plain', [])).toEqual([{ text: 'plain', hit: false }]);
    expect(highlightParts('', ['a'])).toEqual([]);
    expect(countHits(highlightParts('nothing here', ['zebra']))).toBe(0);
  });
});

describe('display', () => {
  it('formats a stored day', () => {
    expect(docDate('2026-03-12')).toBe('Mar 12, 2026');
    expect(docDate(null)).toBe('');
    expect(docDate('2026-13-40')).toBe('');
  });

  it('names the document in the chat prefill', () => {
    expect(askPrompt({ id: 7, title: 'Northwind invoice' })).toBe('About document 7 (“Northwind invoice”): ');
  });
});
