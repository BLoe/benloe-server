import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PROMPT_DIR, MemoryStore, PROMPT_CORE } from '../src/memory/index.js';
import { TemplateError, hasPlaceholder, loadValues, render } from '../src/memory/render.js';

/**
 * Placeholder substitution for repo-sourced prompt layers.
 *
 * Exists because a charter in a public repo cannot say a person's name, and
 * the first draft worked around that by saying "the principal" throughout —
 * publishable, and noticeably colder. The repo holds the template; the private
 * data directory holds the values.
 */
describe('render', () => {
  const values = { name: 'Ada', pronoun: 'she', possessive: 'her' };

  it('substitutes every occurrence', () => {
    expect(render('{{name}} and {{name}} again', values)).toBe('Ada and Ada again');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(render('{{ name }} and {{name}}', values)).toBe('Ada and Ada');
  });

  it('falls back to neutral prose when a known key has no configured value', () => {
    // A fresh install with no values.json must still assemble a prompt. It
    // reads generically — which is the tone the private file exists to replace.
    expect(render('Cabinet serves {{name}}.', {})).toBe('Cabinet serves the user.');
    expect(render('{{pronoun}} / {{possessive}}', {})).toBe('they / their');
  });

  it('leaves text with no placeholders exactly as it was', () => {
    const text = '# CHARTER\n\nNothing to substitute here — { not a placeholder } either.';
    expect(render(text, values)).toBe(text);
  });

  it('THROWS on an unknown key rather than rendering it or emptying it', () => {
    // The whole point. Rendering "{{name}}" into the prompt, or silently
    // dropping it, are both the failure this project keeps hitting: something
    // that looks like it worked and did not.
    // 'nickname' has no configured value AND no neutral default, so it is a
    // bug in the template rather than a missing setting.
    expect(() => render('Hello {{nickname}}', values, 'CHARTER.md')).toThrow(TemplateError);
    expect(() => render('Hello {{nickname}}', values, 'CHARTER.md')).toThrow(/CHARTER\.md/);
    expect(() => render('Hello {{nickname}}', values, 'CHARTER.md')).toThrow(/\{\{nickname\}\}/);
  });

  it('names every missing key at once, not just the first', () => {
    expect(() => render('{{a}} {{b}}', values)).toThrow(/\{\{a\}\}, \{\{b\}\}/);
  });

  it('detects whether text has any placeholder', () => {
    expect(hasPlaceholder('a {{b}} c')).toBe(true);
    expect(hasPlaceholder('a b c')).toBe(false);
    // Regex state must not leak between calls — /g regexes remember lastIndex.
    expect(hasPlaceholder('a {{b}} c')).toBe(true);
    expect(hasPlaceholder('a {{b}} c')).toBe(true);
  });
});

describe('loadValues', () => {
  it('returns an empty map when the file is absent, corrupt, or the wrong shape', () => {
    // Degrading to {} means render() throws a located error on the first
    // placeholder. A corrupt values file must not take the process down at
    // boot, but it must not silently produce a prompt full of {{name}} either.
    const dir = mkdtempSync(join(tmpdir(), 'cabinet-values-'));
    expect(loadValues(dir)).toEqual({});
    writeFileSync(join(dir, 'values.json'), 'not json');
    expect(loadValues(dir)).toEqual({});
    writeFileSync(join(dir, 'values.json'), '["a","b"]');
    expect(loadValues(dir)).toEqual({});
  });

  it('keeps string values and drops everything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cabinet-values-'));
    writeFileSync(join(dir, 'values.json'), JSON.stringify({ name: 'Ada', age: 36, nested: { x: 1 } }));
    expect(loadValues(dir)).toEqual({ name: 'Ada' });
  });
});

describe('promptCore applies values to repo layers only', () => {
  function store(values?: Record<string, string>) {
    const dataDir = mkdtempSync(join(tmpdir(), 'cabinet-render-'));
    const promptDir = mkdtempSync(join(tmpdir(), 'cabinet-render-p-'));
    if (values) writeFileSync(join(dataDir, 'values.json'), JSON.stringify(values));
    return { dataDir, promptDir };
  }

  it('renders a repo-sourced layer', () => {
    const { dataDir, promptDir } = store({ name: 'Ada' });
    writeFileSync(join(promptDir, 'CHARTER.md'), 'Cabinet is {{name}}’s chief of staff.');
    const mem = new MemoryStore(dataDir, promptDir, [{ file: 'CHARTER.md', source: 'repo' }]);
    expect(mem.promptCore()).toContain('Cabinet is Ada’s chief of staff.');
  });

  it('leaves a user-sourced layer untouched, braces and all', () => {
    // A private layer is already written about the actual person. Templating
    // it would add a failure mode for no gain — and its prose may legitimately
    // contain braces.
    const { dataDir, promptDir } = store({ name: 'Ada' });
    writeFileSync(join(dataDir, 'USER.md'), 'Literal {{name}} stays literal.');
    const mem = new MemoryStore(dataDir, promptDir, [{ file: 'USER.md', source: 'user' }]);
    expect(mem.promptCore()).toContain('Literal {{name}} stays literal.');
  });

  it('falls back to neutral prose rather than refusing to assemble', () => {
    // No values.json at all — a fresh install. The prompt still builds.
    const { dataDir, promptDir } = store();
    writeFileSync(join(promptDir, 'CHARTER.md'), 'Cabinet serves {{name}}.');
    const mem = new MemoryStore(dataDir, promptDir, [{ file: 'CHARTER.md', source: 'repo' }]);
    expect(mem.promptCore()).toContain('Cabinet serves the user.');
  });

  it('fails the turn loudly when a repo layer needs a key nobody defined', () => {
    // The difference that matters: a key with a neutral default is a missing
    // SETTING and degrades; a key with neither value nor default is a bug in
    // the template and stops the turn, naming the file and the key.
    const { dataDir, promptDir } = store({ name: 'Ada' });
    writeFileSync(join(promptDir, 'CHARTER.md'), 'Cabinet serves {{name}} in {{city}}.');
    const mem = new MemoryStore(dataDir, promptDir, [{ file: 'CHARTER.md', source: 'repo' }]);
    expect(() => mem.promptCore()).toThrow(/CHARTER\.md references \{\{city\}\}/);
  });
});

describe('the shipped prompt files and the values they need', () => {
  it('uses no placeholder that the live values file cannot fill', () => {
    // The guard that matters in production: a charter referencing {{nickname}}
    // would throw on every turn. Checked against the REAL values file, so
    // adding a placeholder without adding its value fails here, not at 6am.
    const live = loadValues('/srv/benloe/data/cabinet/memory');
    if (Object.keys(live).length === 0) return; // not on this machine; nothing to check

    for (const layer of PROMPT_CORE.filter((l) => l.source === 'repo')) {
      const text = readFileSync(join(DEFAULT_PROMPT_DIR, layer.file), 'utf8');
      expect(() => render(text, live, layer.file)).not.toThrow();
    }
  });

  it('never hard-codes a value that belongs in the values file', () => {
    // The regression this exists for: someone edits the charter, types the
    // name directly because it reads better, and the public repo quietly
    // gains a personal detail again.
    const live = loadValues('/srv/benloe/data/cabinet/memory');
    if (Object.keys(live).length === 0) return;

    // Only the files that are actually prompt layers. README.md documents the
    // directory and is never loaded.
    for (const file of PROMPT_CORE.filter((l) => l.source === 'repo').map((l) => l.file)) {
      const text = readFileSync(join(DEFAULT_PROMPT_DIR, file), 'utf8');
      for (const [key, value] of Object.entries(live)) {
        // Only names are worth this check — a pronoun like "he" appears inside
        // ordinary words and would fire constantly.
        if (value.length < 3) continue;
        expect(text, `${file} hard-codes the value of {{${key}}}; use the placeholder`).not.toMatch(
          new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        );
      }
    }
  });
});
