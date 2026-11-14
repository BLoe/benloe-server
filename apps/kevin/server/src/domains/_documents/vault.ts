// The documents vault on disk: config.dataDir/documents. Shared by the
// documents domain (the files) and the taxes domain (packets, linked files).
// Everything stored here is addressed by a path relative to the vault root,
// and nothing is ever opened without passing through vaultFile().
import type { Response } from 'express';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { config } from '../../config.js';

export const vaultRoot = (): string => join(config.dataDir, 'documents');

/** Same header the core puts on served uploads: stored bytes never run as a page on this origin. */
export const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";

/** Absolute path for a vault-relative path, or null when it would leave the vault. */
export function vaultPath(rel: string): string | null {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || isAbsolute(rel)) return null;
  const root = resolve(vaultRoot());
  const target = resolve(root, rel);
  const back = relative(root, target);
  if (!back || back === '..' || back.startsWith('..' + sep) || isAbsolute(back)) return null;
  return target;
}

/** Absolute path of an existing regular file inside the vault (symlinks resolved and re-checked), else null. */
export function vaultFile(rel: string): string | null {
  const target = vaultPath(rel);
  if (!target) return null;
  try {
    if (!lstatSync(target).isFile()) return null;
    const realRoot = realpathSync(vaultRoot());
    return realpathSync(target).startsWith(realRoot + sep) ? target : null;
  } catch {
    return null;
  }
}

/** Creates a folder inside the vault, owner-only. */
export function ensureVaultDir(abs: string): void {
  mkdirSync(abs, { recursive: true, mode: 0o700 });
}

/** Copies a file into place, owner-only. */
export function copyPrivate(src: string, dest: string): void {
  ensureVaultDir(dirname(dest));
  copyFileSync(src, dest);
  chmodSync(dest, 0o600);
}

/** A filename safe on disk and in a header: word characters, dot, dash, space. */
export const safeFilename = (s: string): string => s.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';

/** Sends a vault file with the protective headers. Returns false (nothing sent) when the path is not a file in the vault. */
export function sendVaultFile(res: Response, rel: string, o: { mime: string; filename: string; inline: boolean }): boolean {
  const abs = vaultFile(rel);
  if (!abs) return false;
  // The browser's PDF viewer will not render inside a sandbox; the stored type came from the file's bytes.
  if (o.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', FILE_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${o.inline ? 'inline' : 'attachment'}; filename="${safeFilename(o.filename)}"`);
  res.type(o.mime).sendFile(abs, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'file not found' });
  });
  return true;
}

/** A real calendar date as YYYY-MM-DD. */
export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a real calendar date');

export const documentFileUrl = (id: number): string => `/api/x/documents/${id}/file`;
