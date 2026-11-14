// The assembled application: database, domains, tools, views, prompt. One of
// these exists per process; tests build their own against a temp database.
import { join } from 'node:path';
import { config } from './config.js';
import { type DB, openDb } from './db.js';
import { type Domain, type View, loadDomains } from './domains.js';
import { buildStableSystem } from './prompt.js';
import { ToolRegistry } from './tools.js';
import { coreTools, coreViews } from './core/index.js';

export interface Kevin {
  db: DB;
  domains: Domain[];
  tools: ToolRegistry;
  /** "domain/view" -> function */
  views: Map<string, View>;
  stableSystem: string;
}

export async function createKevin(opts: { dbPath?: string; domains?: Domain[] } = {}): Promise<Kevin> {
  const domains = opts.domains ?? (await loadDomains());
  const db = openDb(opts.dbPath ?? join(config.dataDir, 'kevin.db'), domains.flatMap((d) => d.migrations ?? []));
  const tools = new ToolRegistry();
  const views = new Map<string, View>();
  const kevin: Kevin = { db, domains, tools, views, stableSystem: '' };
  for (const t of coreTools(kevin)) tools.register(t);
  for (const [name, v] of Object.entries(coreViews(kevin))) views.set(`system/${name}`, v);
  for (const d of domains) {
    for (const t of d.tools ?? []) tools.register(t);
    for (const [name, v] of Object.entries(d.views ?? {})) views.set(`${d.name}/${name}`, v);
  }
  kevin.stableSystem = buildStableSystem(db, domains);
  return kevin;
}
