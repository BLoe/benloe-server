import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chat-image attachments (§ vision spike, 2026-07-11): images pasted/dropped
 * into the composer live on disk under an id, mirroring the review-shots
 * pattern (gateway/app.ts) — small `message.parts` rows in the DB, bytes
 * fetched on demand through an authenticated GET. This module is the one
 * place that decides what's an allowed image and enforces the byte cap;
 * gateway/app.ts's routes and runtime/agent.ts's turn assembly both trust it
 * rather than re-deriving the rules.
 */

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

const EXT_BY_MIME: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_BY_EXT: Record<string, ImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Decoded-byte cap, enforced server-side — never trust the client's own
 *  size accounting. 6MB comfortably covers a phone screenshot/photo; the
 *  express.json limit on POST /api/attachments (app.ts) is sized above this
 *  with base64's ~33% inflation plus JSON overhead already accounted for. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Every saved attachment's filename matches this — the id IS the filename
 *  (uuid + extension), so there is no separate id→file lookup to keep in
 *  sync. No `/` or `\` in the charset, so no name can smuggle a path
 *  segment (same reasoning as review-shots' SHOT_NAME_RE). */
export const ATTACHMENT_NAME_RE = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/;

export function isAllowedImageMime(x: unknown): x is ImageMime {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(EXT_BY_MIME, x);
}

/** Derives mime from a validated filename's extension — the filename
 *  (written server-side at save time) is authoritative; a chat request's
 *  own claimed mediaType is never trusted for this. */
export function mimeFromFilename(filename: string): ImageMime | null {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  const ext = m?.[1]?.toLowerCase();
  return ext ? (MIME_BY_EXT[ext] ?? null) : null;
}

export class AttachmentError extends Error {}

/**
 * Validates, decodes, and writes one uploaded image. Throws AttachmentError
 * with a client-safe message on any validation failure — the route turns
 * that into a 400.
 *
 * KNOWN LEAK: an attachment uploaded but never sent in a /api/chat turn is
 * never cleaned up (there's no reference-counting or expiry). Not building
 * GC now — single-user box, low volume, YAGNI. If it ever matters, a sweep
 * would go here: list files in `dir` older than N days whose id doesn't
 * appear in any message.parts, delete them.
 */
export function saveAttachment(dir: string, mediaType: unknown, dataBase64: unknown): { id: string; mediaType: ImageMime } {
  if (!isAllowedImageMime(mediaType)) {
    throw new AttachmentError(`unsupported image type: ${String(mediaType)}`);
  }
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    throw new AttachmentError('missing image data');
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0) throw new AttachmentError('empty image data');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new AttachmentError(`image too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES})`);
  }
  mkdirSync(dir, { recursive: true });
  const id = `${randomUUID()}.${EXT_BY_MIME[mediaType]}`;
  writeFileSync(join(dir, id), bytes);
  return { id, mediaType };
}
