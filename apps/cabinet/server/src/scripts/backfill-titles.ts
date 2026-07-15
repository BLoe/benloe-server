/**
 * One-shot maintenance: name every still-"untitled" user chat from its
 * opening exchange, using the same Haiku titler as the live path (§9.2).
 *
 * Runs under PM2's env injection so it inherits the service's Claude auth
 * without any secret being materialised here. Privilege-drops to claude-worker
 * exactly like the gateway (§13.2) before doing any work.
 *
 *   pm2 start backfill.config.cjs   # reads .env, forks us, we self-drop
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { openDb } from '../db/index.js';
import { configureAuth } from '../runtime/agent.js';
import { generateTitle } from '../runtime/titler.js';
import { extractText as extractTextFromParts, type MessagePart } from '../gateway/fold.js';

// Only the direct `node backfill-titles.js` invocation runs the script; when a
// test imports the helpers below, none of the executable machinery (privilege
// drop, DB open, model calls) fires.
const IS_ENTRY = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const proc = process as NodeJS.Process & {
  initgroups?(user: string, extraGroup: string): void;
  setgid?(id: string | number): void;
  setuid?(id: string | number): void;
};
if (IS_ENTRY && proc.getuid?.() === 0) {
  const RUN_AS = process.env.CABINET_RUN_AS ?? 'claude-worker';
  proc.initgroups?.(RUN_AS, RUN_AS);
  proc.setgid?.(RUN_AS);
  proc.setuid?.(RUN_AS);
  if (proc.getuid?.() === 0) {
    console.error('refusing to run as root');
    process.exit(1);
  }
}

/**
 * Concatenate the text parts of a persisted message row's parts JSON.
 * Delegates to gateway/fold.ts's extractText — the one canonical "what
 * counts as a message's real text" rule (also used by transcript.ts and the
 * conversation-indexing backfill, episodic/index.ts) — this wrapper only
 * adds the raw-JSON-string parse/catch this script's callers need.
 */
export function extractText(partsJson: string): string {
  try {
    return extractTextFromParts(JSON.parse(partsJson) as MessagePart[]);
  } catch {
    return '';
  }
}

interface Candidate {
  id: string;
  userText: string;
  assistantText: string;
}

/** Untitled user chats that have at least one user + one assistant message. */
export function findCandidates(db: import('better-sqlite3').Database): Candidate[] {
  const chats = db
    .prepare(
      `SELECT id FROM chat
       WHERE kind = 'user' AND (title IS NULL OR title = '')
       ORDER BY updated_at DESC`,
    )
    .all() as { id: string }[];

  const firstOf = db.prepare(
    `SELECT parts FROM message WHERE chat_id = ? AND role = ? ORDER BY created_at ASC LIMIT 1`,
  );

  const out: Candidate[] = [];
  for (const t of chats) {
    const u = firstOf.get(t.id, 'user') as { parts: string } | undefined;
    const a = firstOf.get(t.id, 'assistant') as { parts: string } | undefined;
    if (!u || !a) continue; // need a real exchange to name it
    const userText = extractText(u.parts);
    const assistantText = extractText(a.parts);
    if (!userText) continue;
    out.push({ id: t.id, userText, assistantText });
  }
  return out;
}

async function main(): Promise<void> {
  configureAuth(process.env);
  const dataDir = process.env.CABINET_DATA_DIR ?? '/srv/benloe/data/cabinet';
  const cabinet = openDb(join(dataDir, 'cabinet.db'));
  const update = cabinet.db.prepare("UPDATE chat SET title = ? WHERE id = ? AND (title IS NULL OR title = '')");

  const candidates = findCandidates(cabinet.db);
  console.log(`backfill: ${candidates.length} untitled chat(s) to name`);

  let named = 0;
  for (const c of candidates) {
    const title = await generateTitle(sdkQuery, { userText: c.userText, assistantText: c.assistantText });
    if (title) {
      update.run(title, c.id);
      named++;
      console.log(`  ${c.id}  →  ${title}`);
    } else {
      console.log(`  ${c.id}  →  (no title produced, left untitled)`);
    }
  }
  console.log(`backfill: done — named ${named}/${candidates.length}`);
  cabinet.close();
  process.exit(0);
}

if (IS_ENTRY) void main();
