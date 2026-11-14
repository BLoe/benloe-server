// A domain is one area of Ben's life (pantry, workouts, money...) packaged as:
// its tables, its typed write tools, and named read views for its page.
// Dropping a file in src/domains/ is the whole registration.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DB, Migration } from './db.js';
import type { Router } from 'express';
import type { ToolDef } from './tools.js';

export type View = (params: Record<string, string>, db: DB) => unknown;

export interface Domain {
  /** Also the name used in `touches` and in /api/view/<name>/<view>. */
  name: string;
  /** Append-only. Ids must be globally unique: prefix with the domain name. */
  migrations?: Migration[];
  tools?: ToolDef[];
  /** Reads for the domain's page. JSON-serialisable results. */
  views?: Record<string, View>;
  /**
   * Extra HTTP endpoints, mounted at /api/x/<name>/ behind the owner check.
   * For what views and tools cannot carry: file downloads, raw uploads.
   */
  routes?(router: Router, db: DB): void;
  /** A few lines for the system prompt: what this area is and how Kevin should work in it. */
  promptNote?: string;
}

export const defineDomain = (d: Domain): Domain => d;

export async function loadDomains(): Promise<Domain[]> {
  // Development only: start the server with core alone while domains are mid-edit.
  if (process.env.KEVIN_NO_DOMAINS === '1' && process.env.NODE_ENV !== 'production') return [];
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'domains');
  const files = readdirSync(dir)
    .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts') && !f.includes('.test.'))
    .sort();
  const out: Domain[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)) as { default?: Domain };
    if (!mod.default?.name) throw new Error(`domains/${f} has no default export from defineDomain()`);
    out.push(mod.default);
  }
  return out;
}
