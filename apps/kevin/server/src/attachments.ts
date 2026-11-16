// Uploads. A photo or PDF is read once, when it arrives: the extracted text
// is stored and indexed, so Kevin can use the file later without seeing the
// bytes again. Files stay on this box; the bytes go to the API only here and
// on the turn the file is attached to.
import type Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { type DB, nowIso } from './db.js';
import { small, spend } from './llm.js';
import { indexItem } from './memory.js';
import { runInSandbox } from './sandbox.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface Attachment {
  id: number; at: string; filename: string; mime: string; size: number; path: string; kind: string; extracted_text: string | null; extract_status: string;
}

/** Type by content, never by what the browser claimed. */
export function sniff(buf: Buffer, filename: string): { mime: string; kind: 'image' | 'pdf' | 'text' | 'other' } {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', kind: 'image' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  if (buf.subarray(0, 4).toString() === 'GIF8') return { mime: 'image/gif', kind: 'image' };
  if (buf.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', kind: 'pdf' };
  // Text if it decodes cleanly and has no NULs in the first 8K.
  const head = buf.subarray(0, 8192);
  if (!head.includes(0) && !head.toString('utf8').includes('�')) {
    return { mime: /\.csv$/i.test(filename) ? 'text/csv' : /\.json$/i.test(filename) ? 'application/json' : 'text/plain', kind: 'text' };
  }
  return { mime: 'application/octet-stream', kind: 'other' };
}

const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';

export function saveUpload(db: DB, buf: Buffer, filename: string): Attachment {
  if (!buf.length) throw new Error('empty upload');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('file is over 25 MB');
  const { mime, kind } = sniff(buf, filename);
  const now = new Date();
  // One transaction: if the file cannot be written, no row is left pointing at nothing.
  return db.transaction(() => {
    const id = Number(
      db.prepare('INSERT INTO attachments (at, filename, mime, size, path, kind) VALUES (?,?,?,?,?,?)').run(now.toISOString(), safeName(filename), mime, buf.length, '', kind).lastInsertRowid,
    );
    const rel = join('uploads', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${id}-${safeName(filename)}`);
    const abs = join(config.dataDir, rel);
    mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, buf, { mode: 0o600 });
    db.prepare('UPDATE attachments SET path = ? WHERE id = ?').run(rel, id);
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment;
  })();
}

/** Characters of a file's text that are kept for the model. Longer text is cut, and says so. */
export const MAX_EXTRACT_CHARS = 200_000;
const capped = (text: string): string =>
  text.length > MAX_EXTRACT_CHARS ? `${text.slice(0, MAX_EXTRACT_CHARS)}\n[cut here: this is the first ${MAX_EXTRACT_CHARS} of ${text.length} characters of the file]` : text;

/**
 * The text layer of a PDF, read by pdftotext. The PDF is an upload and pdftotext is a large parser, so it
 * does not run in this process's uid, which owns Ben's records: the bytes are piped to it inside the
 * extraction sandbox (no network, no writable folder, another uid; see setup.sh) and only its text comes back.
 * Returns '' when it could not be read; the reason is logged.
 */
async function pdfText(bytes: Buffer, id: number): Promise<string> {
  const r = await runInSandbox(config.extractLauncher, 'exec pdftotext -layout -l 60 - -', { stdin: bytes, maxOut: 20 * 1024 * 1024, seconds: 60 });
  if (r.code === 0) return r.stdout.toString('utf8').trim();
  console.error(`pdftotext failed for attachment ${id}: ${r.failure ?? (r.timedOut ? 'took longer than 60 seconds' : r.overflow ? 'produced more than 20 MB of text' : r.stderr.trim().slice(0, 300) || `exit code ${r.code}`)}`);
  return '';
}

const EXTRACT_SYSTEM =
  'You are reading a file for a personal assistant that will rely on your text instead of the file. Transcribe every piece of text and every number exactly, keeping tables as tables. For a photo of food, a fridge, a pantry shelf or a receipt, list each item with any visible quantity, size, brand, price and date. For a form or statement, start with one line saying what the document is, who issued it and its date. Describe anything visual that carries meaning. Output the content only.';

/** Reads the file's content into text. Never throws; records the outcome on the row. */
export async function extract(db: DB, id: number): Promise<Attachment> {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment;
  const abs = join(config.dataDir, a.path);
  let text = '';
  let status = 'done';
  try {
    if (a.kind === 'text') {
      text = capped(readFileSync(abs, 'utf8'));
    } else if (a.kind === 'pdf') {
      text = capped(await pdfText(readFileSync(abs), id));
      // A scan has no text layer: have the model read the pages.
      if (text.replace(/\s/g, '').length < 200 && a.size <= 20 * 1024 * 1024) {
        if (spend(db).blocked) throw new Error('monthly spend cap reached');
        const doc: Anthropic.DocumentBlockParam = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(abs).toString('base64') } };
        text = await small(db, { purpose: 'vision' }, EXTRACT_SYSTEM, [doc, { type: 'text', text: `File name: ${a.filename}` }], 16_000);
      }
    } else if (a.kind === 'image' && a.size <= 4_500_000) {
      if (spend(db).blocked) throw new Error('monthly spend cap reached');
      const img: Anthropic.ImageBlockParam = { type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: readFileSync(abs).toString('base64') } };
      text = await small(db, { purpose: 'vision' }, EXTRACT_SYSTEM, [img, { type: 'text', text: `File name: ${a.filename}` }], 8000);
    } else {
      status = 'skipped';
    }
  } catch (e) {
    status = 'failed';
    console.error(`extraction failed for attachment ${id}`, e);
  }
  db.prepare('UPDATE attachments SET extracted_text = ?, extract_status = ? WHERE id = ?').run(text || null, status, id);
  if (text) indexItem(db, 'attachment', id, a.filename, text, a.at);
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment;
}

export function getAttachment(db: DB, id: number): Attachment | undefined {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment | undefined;
}

export const attachmentPath = (a: Attachment): string => join(config.dataDir, a.path);
export { nowIso };
