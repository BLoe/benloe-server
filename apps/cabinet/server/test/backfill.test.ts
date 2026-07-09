import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { extractText, findCandidates } from '../src/scripts/backfill-titles.js';

describe('extractText', () => {
  it('joins the text parts and ignores non-text parts', () => {
    const parts = JSON.stringify([
      { type: 'text', text: 'hello' },
      { type: 'tool-run', name: 'Bash' },
      { type: 'text', text: 'world' },
    ]);
    expect(extractText(parts)).toBe('hello world');
  });

  it('returns empty string on malformed JSON', () => {
    expect(extractText('not json')).toBe('');
  });
});

describe('findCandidates', () => {
  let dir: string;
  let cabinet: CabinetDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cabinet-bf-'));
    cabinet = openDb(join(dir, 'cabinet.db'));
  });
  afterEach(() => {
    cabinet.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const addThread = (title: string | null, kind = 'user') => {
    const id = randomUUID();
    cabinet.db.prepare('INSERT INTO thread (id, title, kind) VALUES (?,?,?)').run(id, title, kind);
    return id;
  };
  const addMsg = (threadId: string, role: string, text: string, at: string) =>
    cabinet.db
      .prepare('INSERT INTO message (id, thread_id, role, parts, created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(), threadId, role, JSON.stringify([{ type: 'text', text }]), at);

  it('selects only untitled user threads that have a real exchange', () => {
    // untitled, full exchange → candidate
    const t1 = addThread(null);
    addMsg(t1, 'user', 'first question', '2026-07-01 10:00:00');
    addMsg(t1, 'user', 'later question', '2026-07-01 10:05:00');
    addMsg(t1, 'assistant', 'the answer', '2026-07-01 10:00:30');

    // empty-string title → also a candidate (treated as untitled)
    const t2 = addThread('');
    addMsg(t2, 'user', 'hello', '2026-07-02 09:00:00');
    addMsg(t2, 'assistant', 'hi', '2026-07-02 09:00:10');

    // already titled → skipped
    const t3 = addThread('Established Title');
    addMsg(t3, 'user', 'q', '2026-07-03 09:00:00');
    addMsg(t3, 'assistant', 'a', '2026-07-03 09:00:10');

    // untitled but no assistant reply yet → skipped
    const t4 = addThread(null);
    addMsg(t4, 'user', 'unanswered', '2026-07-04 09:00:00');

    // non-user kind → skipped
    const t5 = addThread(null, 'heartbeat');
    addMsg(t5, 'user', 'beat', '2026-07-05 09:00:00');
    addMsg(t5, 'assistant', 'ok', '2026-07-05 09:00:10');

    const found = findCandidates(cabinet.db);
    const ids = found.map((c) => c.id).sort();
    expect(ids).toEqual([t1, t2].sort());

    const c1 = found.find((c) => c.id === t1)!;
    expect(c1.userText).toBe('first question'); // earliest user message, not the later one
    expect(c1.assistantText).toBe('the answer');
  });
});
