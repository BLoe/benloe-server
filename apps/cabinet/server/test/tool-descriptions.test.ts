import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { buildCabinetTools, type CabinetToolContext } from '../src/tools/cabinet.js';

/**
 * Tool descriptions are generic, and stay generic.
 *
 * Two reasons, and the second is the one that bites.
 *
 * 1. src/tools/cabinet.ts is tracked in a PUBLIC repo. Descriptions had
 *    accumulated a named medical condition, a named behavioural program and a
 *    substance inventory — not leaked, just written into source by people
 *    thinking of it as code rather than as prose about a person.
 *
 * 2. The SDK defers these tools behind tool search, so a description is not in
 *    context on a normal turn at all. Anything user-specific written here is
 *    therefore both public AND unread — the worst of both.
 *
 * The rules below are structural rather than a list of banned words, so they
 * keep working for facts nobody has thought of yet, and so this file does not
 * have to restate the private details it exists to keep out.
 */
function descriptions(): { name: string; description: string }[] {
  const db = new Database(':memory:');
  const ctx = {
    db,
    readonlyDb: db,
    episodic: {},
    embedder: {},
    memory: {},
    approvals: {},
    widgetBus: { emit() {} },
    plaid: { configured: () => false },
  } as unknown as CabinetToolContext;
  const tools = buildCabinetTools(ctx) as unknown as { name: string; description: string }[];
  db.close();
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

const all = descriptions();

describe('tool descriptions are about the tool, not about the user', () => {
  it('never names the owner', () => {
    // A description that says "Ben" is describing a person, not a capability,
    // and it is doing it in a public file.
    const offenders = all.filter((t) => /\bBen(?:'s)?\b/.test(t.description)).map((t) => t.name);
    expect(offenders, 'name the user in the user layer, not in a tool description').toEqual([]);
  });

  it('never cites a private memory file as the source of its reasoning', () => {
    // `plans/health.md doses walking against ...` was real. A description that
    // leans on a private document both leaks its contents and breaks silently
    // when that document is not loaded — which, after the prompt rewrite, is
    // most turns.
    //
    // update_memory is the exception by construction: naming the files it can
    // write is what the tool IS.
    const offenders = all
      .filter((t) => t.name !== 'update_memory')
      .filter((t) => /\b(?:plans|domains)\/[a-z-]+\.md\b/.test(t.description))
      .map((t) => t.name);
    expect(offenders, 'a tool description must not depend on a private document').toEqual([]);
  });

  it('never references a personal program, playbook or numbered experiment', () => {
    // "PLAYBOOK P4's ranking", "The Phase 0 / TUNING E2 read", "experiment E2
    // actually reads". These name one person's regimen, and they rot with no
    // warning when the regimen changes.
    const offenders = all
      .filter((t) => /\bPLAYBOOK\b|\bTUNING\b|\bPhase \d|\bexperiment E\d/.test(t.description))
      .map((t) => t.name);
    expect(offenders, 'describe the shape of the analysis, not one person’s program').toEqual([]);
  });

  it('keeps every description non-empty and reasonably sized', () => {
    // Not a style rule — a description is how tool search finds the tool, so
    // an empty one is an undiscoverable tool. The ceiling is a smell test: a
    // description over ~900 chars is usually carrying procedure that belongs
    // in the system layer.
    for (const t of all) {
      expect(t.description.trim().length, `${t.name} has no description`).toBeGreaterThan(20);
      expect(t.description.length, `${t.name} is long enough to be hiding a procedure`).toBeLessThan(900);
    }
  });
});
