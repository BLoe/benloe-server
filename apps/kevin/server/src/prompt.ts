// Prompt assembly.
//
// The stable block (persona, rules, people, profile, schema, domain notes) is
// read once at startup and carries a 1-hour cache breakpoint; with the sorted
// tool list in front of it, that prefix is byte-identical across turns and
// threads. Facts follow as a second, small block: saving a fact costs one
// re-write of the conversation cache, never of the stable prefix.
//
// What changes every message (the time, the page, memory hits) travels inside
// the user message, so history stays append-only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.js';
import type { Domain } from './domains.js';
import { config } from './config.js';
import { type Hit, listFacts } from './memory.js';
import { localStamp } from './time.js';

const read = (name: string): string => {
  try {
    return readFileSync(join(config.workspaceDir, name), 'utf8').trim();
  } catch {
    return '';
  }
};

// Tables the model has no business reading through `query`.
const HIDDEN = new Set(['push_subscriptions', 'embeddings', 'messages', '_migrations', 'settings']);

export function schemaText(db: DB): string {
  const rows = db
    // Views too: a domain may define one so the model's common queries are trivially right.
    .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%' ORDER BY type, name")
    .all() as { name: string; sql: string }[];
  return rows
    .filter((r) => !HIDDEN.has(r.name))
    .map((r) => r.sql.replace(/\n\s+/g, '\n  ').trim() + ';')
    .join('\n');
}

export function buildStableSystem(db: DB, domains: Domain[]): string {
  const notes = domains.filter((d) => d.promptNote).map((d) => `## ${d.name}\n${d.promptNote!.trim()}`).join('\n\n');
  return [
    read('persona.md'),
    read('rules.md'),
    read('people.md'),
    read('profile.md'),
    `# The app\n\nBen uses you through a web app with these pages: Home (/), Pantry (/pantry), Cooking (/cooking), Workouts (/workouts), Money (/money), Taxes (/taxes), Documents (/documents), one page per space (/s/<slug>), Jobs (/jobs), Settings (/settings). Chat sits beside every page. Notifications you send appear in the app's inbox and as push notifications; give each a \`link\` to the page it is about.\n\nTimes in the database are UTC ISO strings unless a column says otherwise; dates Ben means are in ${config.timezone}.`,
    notes ? `# Areas\n\n${notes}` : '',
    `# Database schema (SQLite)\n\n\`\`\`sql\n${schemaText(db)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The second system block: what changes as Kevin works. Never cached on its own. */
export function factsBlock(db: DB, domains: Domain[] = []): string {
  const facts = listFacts(db);
  const parts = [
    facts.length ? '# Facts you have saved about Ben\n\n' + facts.map((f) => `- [${f.id}] (${f.category}) ${f.text}`).join('\n') : '',
    ...domains.map((d) => d.promptState?.(db)?.trim() ?? ''),
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function contextBlock(o: { page?: string | null; hits?: Hit[]; summary?: string | null; now?: Date; origin?: 'chat' | 'job' }): string {
  const lines = [`now: ${localStamp(o.now ?? new Date())}`];
  if (o.origin === 'job') lines.push('This turn was started by a schedule, with nobody watching. Do the work, then send what Ben should see with `notify`.');
  else if (o.page) lines.push(`page Ben is on: ${o.page}`);
  if (o.hits?.length) {
    lines.push('possibly relevant from memory:');
    for (const h of o.hits) lines.push(`- (${h.kind}${h.at ? ' ' + h.at.slice(0, 10) : ''}) ${h.title ? h.title + ': ' : ''}${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  let out = `<context>\n${lines.join('\n')}\n</context>`;
  if (o.summary) out = `<earlier_in_this_conversation>\n${o.summary}\n</earlier_in_this_conversation>\n${out}`;
  return out;
}
