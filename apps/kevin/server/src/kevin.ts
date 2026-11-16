// The assembled application: database, domains, tools, views, prompt. One of
// these exists per process; tests build their own against a temp database.
import { join } from 'node:path';
import { config } from './config.js';
import { type DB, getSetting, openDb } from './db.js';
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
  /** The cached system prompt with every area on. */
  stableSystem: string;
  /** What this turn should see, given the areas Ben has switched off: the prompt, and which tools to leave out. */
  scope(): { system: string; offTools: Set<string>; off: string[] };
}

// Areas that read another area's tables stay usable only if that one stays in the prompt.
const NEEDS: Record<string, string[]> = { cooking: ['pantry'], taxes: ['documents'] };

export async function createKevin(opts: { dbPath?: string; domains?: Domain[] } = {}): Promise<Kevin> {
  const domains = opts.domains ?? (await loadDomains());
  const db = openDb(opts.dbPath ?? join(config.dataDir, 'kevin.db'), domains.flatMap((d) => d.migrations ?? []));
  const tools = new ToolRegistry();
  const views = new Map<string, View>();
  const cache = new Map<string, string>();
  const kevin: Kevin = {
    db, domains, tools, views, stableSystem: '',
    scope() {
      // A hidden page (Settings → Navigation) is "/pantry"; its domain is "pantry".
      const hidden = new Set(getSetting<string[]>(db, 'hidden_pages', []).map((p) => p.replace(/^\//, '')));
      for (const d of domains) if (!hidden.has(d.name)) for (const need of NEEDS[d.name] ?? []) hidden.delete(need);
      // IRON PR has no page of its own; it goes wherever Workouts goes.
      if (hidden.has('workouts')) hidden.add('ironpr');
      const off = domains.map((d) => d.name).filter((n) => hidden.has(n) && n !== 'spaces').sort();
      const key = off.join(',');
      if (!cache.has(key)) cache.set(key, off.length ? buildStableSystem(db, domains, off) : kevin.stableSystem);
      const offTools = new Set(domains.filter((d) => off.includes(d.name)).flatMap((d) => (d.tools ?? []).map((t) => t.name)));
      return { system: cache.get(key)!, offTools, off };
    },
  };
  for (const t of coreTools(kevin)) tools.register(t);
  for (const [name, v] of Object.entries(coreViews(kevin))) views.set(`system/${name}`, v);
  for (const d of domains) {
    for (const t of d.tools ?? []) tools.register(t);
    for (const [name, v] of Object.entries(d.views ?? {})) views.set(`${d.name}/${name}`, v);
  }
  kevin.stableSystem = buildStableSystem(db, domains);
  return kevin;
}
