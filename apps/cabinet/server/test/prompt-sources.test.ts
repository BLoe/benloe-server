import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PROMPT_DIR, MemoryStore, PROMPT_CORE, type PromptLayer } from '../src/memory/index.js';

/**
 * The two-root loader: prompt layers come either from the repo (generic,
 * reviewable) or from the private memory directory (personal). No model, no
 * network.
 *
 * The property these protect is that MOVING a layer between roots is a
 * one-line manifest edit and nothing else — no loader change, no change to
 * what the model reads. The failure this guards against is a manifest entry
 * that silently resolves to nothing, which is the same shape as the patch that
 * once "applied" to a function that had been renamed and matched nothing.
 */
const layers = (...specs: [string, 'repo' | 'user'][]): PromptLayer[] =>
  specs.map(([file, source]) => ({ file, source }));

function roots(manifest?: PromptLayer[]): { mem: MemoryStore; dataDir: string; promptDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'cabinet-data-'));
  const promptDir = mkdtempSync(join(tmpdir(), 'cabinet-prompts-'));
  return { mem: new MemoryStore(dataDir, promptDir, manifest), dataDir, promptDir };
}

describe('the manifest matches what is on disk', () => {
  it('ships a file for every repo-sourced layer it declares', () => {
    // The silent-no-op guard. A manifest entry whose file does not exist is
    // skipped by promptCore() without complaint — correct for a `user` layer
    // on a fresh install, and a disaster for a `repo` one, because the layer
    // is IN the repo and its absence means the build did not copy it or the
    // filename is wrong. Either way Cabinet boots with part of its mind
    // missing and says nothing.
    for (const layer of PROMPT_CORE.filter((l) => l.source === 'repo')) {
      expect(existsSync(join(DEFAULT_PROMPT_DIR, layer.file)), `${layer.file} declared 'repo' but not present in src/prompts/`).toBe(true);
    }
  });

  it('names each file exactly once', () => {
    const names = PROMPT_CORE.map((l) => l.file);
    expect(new Set(names).size).toBe(names.length);
  });

  it('loads only what the manifest names, never the whole directory', () => {
    // src/prompts/README.md documents the directory and must never reach the
    // model. Directory-scanning would have shipped it.
    const { mem, promptDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(promptDir, 'README.md'), '# not a prompt layer');
    writeFileSync(join(promptDir, 'CHARTER.md'), 'charter body');
    const core = mem.promptCore();
    expect(core).toContain('charter body');
    expect(core).not.toContain('not a prompt layer');
  });
});

describe('resolution by source', () => {
  it('reads a repo layer from the prompt dir and a user layer from the data dir', () => {
    const { mem, dataDir, promptDir } = roots(layers(['CHARTER.md', 'repo'], ['USER.md', 'user']));
    writeFileSync(join(promptDir, 'CHARTER.md'), 'from the repo');
    writeFileSync(join(dataDir, 'USER.md'), 'from the data dir');
    const core = mem.promptCore();
    expect(core).toContain('from the repo');
    expect(core).toContain('from the data dir');
  });

  it('does not find a repo-sourced layer that only exists in the data dir', () => {
    // The move is a manifest edit PLUS a file move. Flipping the manifest
    // without moving the file must drop the layer loudly-in-a-test rather
    // than quietly keeping the old copy alive.
    const { mem, dataDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(dataDir, 'CHARTER.md'), 'stale copy left behind');
    expect(mem.promptCore()).toBe('');
  });

  it('lets the repo copy win when a file exists in both roots', () => {
    // The state during a move, and after a sloppy one. Whichever wins must be
    // predictable; the repo is the reviewed copy, so it does.
    const { mem, dataDir, promptDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(dataDir, 'CHARTER.md'), 'OLD private copy');
    writeFileSync(join(promptDir, 'CHARTER.md'), 'NEW reviewed copy');
    const core = mem.promptCore();
    expect(core).toContain('NEW reviewed copy');
    expect(core).not.toContain('OLD private copy');
    expect(mem.read('CHARTER.md')).toBe('NEW reviewed copy');
  });

  it('keeps manifest order regardless of which root each layer came from', () => {
    const { mem, dataDir, promptDir } = roots(layers(['CHARTER.md', 'repo'], ['USER.md', 'user'], ['PLATFORM.md', 'repo']));
    writeFileSync(join(promptDir, 'CHARTER.md'), 'first');
    writeFileSync(join(dataDir, 'USER.md'), 'second');
    writeFileSync(join(promptDir, 'PLATFORM.md'), 'third');
    const core = mem.promptCore();
    expect(core.indexOf('first')).toBeLessThan(core.indexOf('second'));
    expect(core.indexOf('second')).toBeLessThan(core.indexOf('third'));
  });

  it('skips a missing layer rather than failing the turn', () => {
    const { mem, dataDir } = roots(layers(['CHARTER.md', 'repo'], ['USER.md', 'user']));
    writeFileSync(join(dataDir, 'USER.md'), 'present');
    expect(mem.promptCore()).toContain('present');
  });

  it('tags a layer with its bare filename, not its root', () => {
    // The model is not told which half of its mind is the reviewed half.
    const { mem, promptDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(promptDir, 'CHARTER.md'), 'body');
    const core = mem.promptCore();
    expect(core).toContain('<memory file="CHARTER.md">');
    expect(core).not.toContain(promptDir);
  });

  it('still refuses a traversing name from an injected manifest', () => {
    const { mem } = roots(layers(['../../etc/passwd', 'repo']));
    expect(() => mem.promptCore()).toThrow(/invalid memory file name/);
  });
});

describe('writing a repo-sourced layer', () => {
  it('is refused, and the message says where to go instead', () => {
    // Not a policy gate. A write here would land in the data dir and be
    // shadowed by the repo copy on the next read — it would appear to succeed
    // and change nothing, which is worse than failing.
    const { mem, promptDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(promptDir, 'CHARTER.md'), 'body');
    expect(mem.isRepoSourced('CHARTER.md')).toBe(true);
    const write = () => mem.update('CHARTER.md', 'rewritten by the agent', 'testing');
    expect(write).toThrow(/served from the repo/);
    expect(write).toThrow(/open a PR/);
  });

  it('does not leave a shadowed copy behind in the data dir', () => {
    // The failure the refusal exists to prevent, asserted directly.
    const { mem, dataDir, promptDir } = roots(layers(['CHARTER.md', 'repo']));
    writeFileSync(join(promptDir, 'CHARTER.md'), 'the real one');
    expect(() => mem.update('CHARTER.md', 'x'.repeat(200), 'testing')).toThrow();
    expect(existsSync(join(dataDir, 'CHARTER.md'))).toBe(false);
    expect(mem.read('CHARTER.md')).toBe('the real one');
  });

  it('leaves user-sourced layers fully writable', () => {
    // Principle 5 of docs/prompt-architecture.md: every file is agent-editable.
    // The repo refusal above is about bytes, not permission, and it must not
    // spread to files that live in the writable root.
    const { mem } = roots(layers(['CHARTER.md', 'repo']));
    mem.update('PLAYBOOK.md', 'a'.repeat(200), 'first write');
    expect(mem.read('PLAYBOOK.md')).toBe('a'.repeat(200));
  });
});

describe('the shipped prompt directory', () => {
  it('holds no layer that the manifest does not name', () => {
    // A markdown file sitting in src/prompts/ that nothing loads is dead
    // weight that reads, to the next person, as live prompt content.
    if (!existsSync(DEFAULT_PROMPT_DIR)) return;
    const named = new Set(PROMPT_CORE.map((l) => l.file));
    const stray = readdirSync(DEFAULT_PROMPT_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md' && !named.has(f));
    expect(stray, 'unreferenced markdown in src/prompts/').toEqual([]);
  });

  it('exists, so the build has something to copy', () => {
    expect(existsSync(DEFAULT_PROMPT_DIR)).toBe(true);
  });
});

describe('moving a layer changes that layer and nothing else', () => {
  it('assembles the same files in the same order regardless of where they load from', () => {
    // Replaces "produces byte-identical output to an all-user manifest",
    // which was the right assertion while nothing had moved and became
    // impossible to satisfy the moment CHARTER.md became repo-sourced
    // (2026-08-11). The invariant worth keeping is not that the bytes are
    // identical — the whole point of a move is that they change — but that
    // moving a layer cannot reorder, drop or duplicate the others.
    const dataDir = mkdtempSync(join(tmpdir(), 'cabinet-same-'));
    const shipped = new MemoryStore(dataDir, DEFAULT_PROMPT_DIR);
    shipped.ensureTemplates();
    const allUser = new MemoryStore(
      dataDir,
      DEFAULT_PROMPT_DIR,
      PROMPT_CORE.map((l) => ({ file: l.file, source: 'user' as const })),
    );

    const tags = (core: string) => [...core.matchAll(/<memory file="([^"]+)">/g)].map((m) => m[1]);
    expect(tags(shipped.promptCore())).toEqual(tags(allUser.promptCore()));
    expect(shipped.promptCore().length).toBeGreaterThan(0);
  });

  it('serves a repo-sourced layer from the repo, not from the seeded data dir', () => {
    // The move actually taking effect, asserted directly rather than inferred
    // from the absence of a difference.
    const repoLayers = PROMPT_CORE.filter((l) => l.source === 'repo');
    if (repoLayers.length === 0) return; // nothing has moved yet

    const dataDir = mkdtempSync(join(tmpdir(), 'cabinet-moved-'));
    const mem = new MemoryStore(dataDir, DEFAULT_PROMPT_DIR);
    mem.ensureTemplates(); // seeds the OLD copy into data/ for every layer
    for (const layer of repoLayers) {
      expect(mem.read(layer.file), `${layer.file} should come from src/prompts/`).toBe(
        readFileSync(join(DEFAULT_PROMPT_DIR, layer.file), 'utf8'),
      );
    }
  });
});
