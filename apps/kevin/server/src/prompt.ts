// Prompt assembly.
//
// The system prompt is up to three blocks (agent.ts puts them together):
//
//  1. The stable block: workspace/persona.md and rules.md, the app's pages,
//     domain notes and the database schema. Built once at startup (and once
//     per set of switched-off areas). With the sorted tool list in front of
//     it, it is byte-identical across turns and threads, and it carries a
//     cache breakpoint.
//  2. The profile ("About Ben"), read from the database on every turn, with
//     its own cache breakpoint. Left out when there is no profile.
//  3. Facts and each domain's current state, uncached. Saving a fact rewrites
//     the conversation cache after this point, never blocks 1 and 2.
//
// What changes every message (the time, the page, memory hits) travels inside
// the user message, so history stays append-only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.js';
import type { Domain } from './domains.js';
import { config } from './config.js';
import { type Hit, listFacts, listProfile } from './memory.js';
import { localStamp } from './time.js';

/**
 * A workspace file, which must be there and say something. Kevin does not run without his persona
 * and rules: rules.md is where he is told to take instructions only from Ben, never from a web page.
 * startupProblems() refuses to start on the same condition with a clearer message; this is the lock.
 */
const read = (name: string): string => {
  const text = readFileSync(join(config.workspaceDir, name), 'utf8').trim();
  if (!text) throw new Error(`workspace file ${name} is empty`);
  return text;
};

// Tables left out of the schema the model is shown: internals it has no use for. This keeps them out
// of its way; it is not a lock. `query` can still read them if the model names one.
const HIDDEN = new Set(['push_subscriptions', 'embeddings', 'messages', '_migrations', 'settings']);

/** Does this table belong to one of the named domains? Tables are prefixed with their domain's name. */
const ownedBy = (table: string, domains: string[]): boolean => domains.some((d) => table === d || table.startsWith(`${d}_`));

export function schemaText(db: DB, omitDomains: string[] = []): string {
  const rows = db
    // Views too: a domain may define one so the model's common queries are trivially right.
    .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%' ORDER BY type, name")
    .all() as { name: string; sql: string }[];
  return rows
    .filter((r) => !HIDDEN.has(r.name) && !ownedBy(r.name, omitDomains))
    .map((r) => r.sql.replace(/\n\s+/g, '\n  ').trim() + ';')
    .join('\n');
}

/**
 * `off` names the built-in areas Ben has switched off in Settings. Their notes, tools and tables are
 * left out: an area he does not use should not cost tokens on every message.
 */
export function buildStableSystem(db: DB, domains: Domain[], off: string[] = []): string {
  const notes = domains.filter((d) => d.promptNote && !off.includes(d.name)).map((d) => `## ${d.name}\n${d.promptNote!.trim()}`).join('\n\n');
  return [
    read('persona.md'),
    read('rules.md'),
    `# The app\n\nBen uses you through a web app with these pages: Home (/), Pantry (/pantry), Cooking (/cooking), Workouts (/workouts), Money (/money), Taxes (/taxes), Documents (/documents), one page per space (/s/<slug>), Jobs (/jobs), Settings (/settings). Chat sits beside every page. Notifications you send appear in the app's inbox and as push notifications; give each a \`link\` to the page it is about.\n\nTimes in the database are UTC ISO strings unless a column says otherwise; dates Ben means are in ${config.timezone}.`,
    notes ? `# Areas\n\n${notes}` : '',
    off.length ? `# Areas switched off\n\nBen has switched these built-in areas off, so you have no tools or tables for them: ${off.join(', ')}. If he asks for one, tell him it can be turned back on in Settings, under Navigation.` : '',
    `# Database schema (SQLite)\n\n\`\`\`sql\n${schemaText(db, off)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Who Ben is: the profile sections from the database (never from the repo, which is public).
 * Its own system block with its own cache breakpoint: it is long and changes rarely.
 */
export function profileBlock(db: DB): string {
  const sections = listProfile(db);
  if (!sections.length) return '';
  return (
    '# About Ben\n\nWhat you know about Ben as a person, kept by you over time. Where a saved fact below says something different, the fact is newer and wins; fix the section when you notice.\n\n' +
    sections.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n')
  );
}

/** The last system block: what changes as Kevin works. Never cached on its own. */
export function factsBlock(db: DB, domains: Domain[] = []): string {
  const facts = listFacts(db);
  const parts = [
    facts.length ? '# Facts you have saved about Ben\n\n' + facts.map((f) => `- [${f.id}] (${f.category}) ${f.text}`).join('\n') : '',
    ...domains.map((d) => d.promptState?.(db)?.trim() ?? ''),
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function contextBlock(o: { page?: string | null; hits?: Hit[]; summary?: string | null; now?: Date; origin?: 'chat' | 'job'; readOnly?: boolean }): string {
  const lines = [`now: ${localStamp(o.now ?? new Date())}`];
  if (o.origin === 'job') {
    lines.push('This turn was started by a schedule, with nobody watching. Do the work, then send what Ben should see with `notify`.');
    if (o.readOnly) lines.push('This schedule is not allowed to change Ben\'s data, so you have no tools that do. Read, research and work things out, then tell Ben with `notify` what you found and what you would change.');
  } else if (o.page) lines.push(`page Ben is on: ${o.page}`);
  if (o.hits?.length) {
    lines.push('possibly relevant from memory:');
    for (const h of o.hits) lines.push(`- (${h.kind}${h.at ? ' ' + h.at.slice(0, 10) : ''}) ${h.title ? h.title + ': ' : ''}${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  let out = `<context>\n${lines.join('\n')}\n</context>`;
  if (o.summary) out = `<earlier_in_this_conversation>\n${o.summary}\n</earlier_in_this_conversation>\n${out}`;
  return out;
}
