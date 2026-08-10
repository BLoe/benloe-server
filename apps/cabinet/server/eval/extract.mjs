#!/usr/bin/env node
/**
 * Pull real conversational turns out of cabinet.db for error analysis.
 *
 * WHY THIS EXISTS
 * The prompt architecture is about to change, and the honest way to decide
 * WHAT to change is to read what actually goes wrong — not to reason from the
 * prompt files about what probably goes wrong. Error analysis first, eval
 * dataset second, redesign third.
 *
 * PERSONAL DATA — READ BEFORE EDITING
 * Every row this touches is Ben's life: what he ate, weighed, felt, earns,
 * smokes. `benloe-server` is a PUBLIC repository. So:
 *   - output goes to the gitignored data tree, never inside the repo
 *   - this file contains no real values, and neither may its tests
 *   - do not add a --stdout mode; a transcript pasted into a terminal ends up
 *     in a scrollback, a screenshot, or a chat log
 * This is the same door the 2026-08-01 PDF and the 2026-08-02 migration
 * comments went through. The standing rule lives in Cabinet's own
 * PLATFORM.md ("Personal data can leak through CODE, not just through
 * files"), which is in the gitignored memory tree rather than in this repo —
 * so it is restated here rather than cited: comments, tests, fixtures,
 * commit messages and error strings are all PUBLISHED DOCUMENTS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB = process.env.CABINET_DB ?? '/srv/benloe/data/cabinet/cabinet.db';
/** Inside data/, which is gitignored — see the header. */
const OUT = process.env.EVAL_OUT ?? '/srv/benloe/data/cabinet/eval/turns.jsonl';

/**
 * Only turns from the CURRENT prompt architecture, by default.
 *
 * The v2 persona stack landed 2026-08-01 (CHARTER/VOICE/TUNING/RHYTHM, and a
 * profileGap rewritten to emit outcomes instead of field names). Turns before
 * it were produced by a different system, so a failure found in them says
 * nothing about the prompt being changed now.
 *
 * This is not hypothetical. The first labelling pass sampled 22 pre-v2 turns
 * out of 40 — stratifying by chat over-weights the OLDEST chats, since they
 * have had the longest to accumulate turns — and its headline finding turned
 * out to describe behaviour that had already been fixed. Of that pass's six
 * failure modes, exactly one survived the cutoff.
 *
 * Set EVAL_SINCE='' deliberately to study the old architecture; the default
 * is the safe one.
 */
const SINCE = process.env.EVAL_SINCE ?? '2026-08-01';

/**
 * Ben's own turns, identified by author.
 *
 * `author` is the only reliable discriminator. Of 466 user-role rows, most
 * are machine-generated: heartbeat and cron turns are written with a NULL
 * author, and a peer agent writes as its own address. Filtering on
 * "role = 'user'" alone yields a corpus that is ~70% the system talking to
 * itself, which would make every conclusion drawn from it wrong.
 */
const BEN = process.env.CABINET_OWNER_EMAIL ?? 'below413@gmail.com';

/** Does this JSONL file already carry hand-written labels or notes? */
export function hasLabels(path, read = readFileSync) {
  let raw;
  try {
    raw = read(path, 'utf8');
  } catch {
    return false;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      try {
        const r = JSON.parse(line);
        return (Array.isArray(r.labels) && r.labels.length > 0) || (typeof r.note === 'string' && r.note.trim() !== '');
      } catch {
        return false;
      }
    });
}

/** The monorepo root — nothing this script writes may land inside it. */
const REPO_ROOT = process.env.PR_REVIEWER_REPO_DIR ?? '/srv/benloe';

/**
 * Refuse an output path inside the repository.
 *
 * `infra/scripts/cabinet-deploy.sh` runs `git add apps/cabinet infra/scripts`
 * followed by `git commit` on every Cabinet self-deploy. So an EVAL_OUT
 * pointing anywhere under apps/cabinet — the obvious place to put it, next to
 * this script — would commit a file full of Ben's health, money and mood to a
 * PUBLIC repository on the next deploy, with no further action by anyone.
 *
 * The header of this file says output goes to the gitignored data tree. This
 * is that sentence made enforceable: a comment cannot stop a `-o` flag.
 */
export function assertSafeOutput(out, repoRoot = REPO_ROOT) {
  const full = resolve(out);
  const root = resolve(repoRoot);
  if (full === root || full.startsWith(`${root}/`)) {
    // data/ is gitignored, so it is the one path inside the tree that is safe.
    if (!full.startsWith(`${root}/data/`)) {
      throw new Error(
        `refusing to write ${full}: it is inside the public repo at ${root}, ` +
          `which cabinet-deploy.sh auto-commits. Write to /srv/benloe/data/... instead.`,
      );
    }
  }
  return full;
}

/** Text out of the `parts` JSON blob, concatenated. */
export function partsToText(parts) {
  let blocks;
  try {
    blocks = JSON.parse(parts);
  } catch {
    return '';
  }
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Pair each of Ben's turns with the assistant turn that answered it.
 *
 * "The next assistant message in the same chat" rather than a join on some
 * reply id, because there is no reply id — and a turn with no answer after it
 * is itself a finding worth keeping (an abandoned or crashed turn), so those
 * are retained with `reply: null` rather than dropped.
 */
export function pairTurns(rows, since = SINCE) {
  const pairs = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.role !== 'user' || row.author !== BEN) continue;
    if (since && row.created_at < since) continue;
    let reply = null;
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[j].chat_id !== row.chat_id) continue;
      // Only BEN speaking again ends the search. A peer agent and the
      // heartbeat also write role='user' rows, and treating those as "Ben
      // spoke again" recorded an answered turn as unanswered — inventing
      // crashed turns that never happened.
      if (rows[j].role === 'user' && rows[j].author === BEN) break;
      if (rows[j].role === 'assistant') {
        reply = rows[j];
        break;
      }
    }
    pairs.push({ prompt: row, reply });
  }
  return pairs;
}

/**
 * Deterministic stratified sample.
 *
 * Stratified by chat so the sample cannot be dominated by one long
 * conversation — 43 chats hold turns very unevenly, and a naive head/tail
 * slice would describe a week rather than a month. Deterministic (no RNG) so
 * two runs produce the same sample and a finding can be traced back to the
 * turn that produced it.
 */
export function stratify(pairs, limit) {
  const byChat = new Map();
  for (const p of pairs) {
    const k = p.prompt.chat_id;
    if (!byChat.has(k)) byChat.set(k, []);
    byChat.get(k).push(p);
  }
  const chats = [...byChat.values()];
  const out = [];
  for (let round = 0; out.length < limit; round += 1) {
    let took = false;
    for (const list of chats) {
      if (round >= list.length) continue;
      out.push(list[round]);
      took = true;
      if (out.length >= limit) break;
    }
    if (!took) break; // every chat exhausted
  }
  return out;
}

async function main() {
  const limit = Number(process.env.EVAL_LIMIT ?? 40);
  if (!existsSync(DB)) throw new Error(`no database at ${DB}`);
  // Imported lazily so the pure functions above (which are what the tests
  // exercise) do not drag in a native module. Loading better-sqlite3 at module
  // scope made this file unimportable anywhere it was not installed.
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  // rowid breaks ties. created_at is second-resolution, so a turn and its
  // reply routinely share a timestamp — and an arbitrary order there records
  // an answered turn as unanswered, which then reads as a crashed turn.
  const rows = db
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.author, m.parts, m.created_at,
              c.register, c.title
         FROM message m JOIN chat c ON c.id = m.chat_id
        WHERE m.role IN ('user','assistant')
        ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all();
  db.close();

  const pairs = pairTurns(rows);
  const sample = stratify(pairs, limit);
  const records = sample.map((p, i) => ({
    n: i + 1,
    id: p.prompt.id,
    chat_id: p.prompt.chat_id,
    chat_title: p.prompt.title,
    // NOTE: chat.register is mutable and this is its value NOW, not the value
    // in force when the turn ran. settleRegister rewrites it on every user
    // turn, so a turn from three weeks ago carries today's register. Usable
    // for "what register is this conversation in", useless for per-turn
    // attribution — do not draw a per-turn conclusion from it.
    registerNow: p.prompt.register ?? null,
    at: p.prompt.created_at,
    ben: partsToText(p.prompt.parts),
    // An unparseable or text-free reply is NOT the same as no reply, and not
    // the same as an empty answer: partsToText returns '' for both a corrupt
    // blob and a genuinely empty one. Distinguish them, or a corrupt row reads
    // as "Cabinet answered with nothing", which is a finding that never
    // happened.
    cabinet: p.reply ? partsToText(p.reply.parts) || null : null,
    replyUnreadable: p.reply ? partsToText(p.reply.parts) === '' : false,
    // Filled in by hand or by the labelling pass — see TAXONOMY.md.
    labels: [],
    note: '',
  }));

  assertSafeOutput(OUT);
  mkdirSync(dirname(OUT), { recursive: true });
  // Labelling is hours of reading. Overwriting a file that already carries
  // labels would destroy it silently, and the natural workflow (extract,
  // label, re-extract with a wider limit) walks straight into that.
  if (existsSync(OUT) && hasLabels(OUT)) {
    throw new Error(
      `${OUT} already contains labelled turns — refusing to overwrite. ` +
        `Move it aside, or set EVAL_OUT to a different path.`,
    );
  }
  writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // Counts only. Never the content.
  console.log(
    `${pairs.length} of Ben's turns${SINCE ? ` since ${SINCE}` : ''}; wrote ${records.length} to ${OUT} ` +
      `(${new Set(records.map((r) => r.chat_id)).size} distinct chats, ` +
      `${records.filter((r) => r.cabinet === null).length} with no reply)`,
  );
}

if (process.argv[1] && process.argv[1].endsWith('extract.mjs')) main();

export { BEN, OUT, DB, SINCE };
