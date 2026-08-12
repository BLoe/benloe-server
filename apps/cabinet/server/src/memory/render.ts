import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Placeholder substitution for repo-sourced prompt layers.
 *
 * The problem this solves: a charter that lives in a public repo cannot say
 * "Ben", so the first draft said "the principal" throughout — publishable, and
 * noticeably colder. Writing about someone in the third person abstract is a
 * worse prompt than writing about them by name.
 *
 * So the repo holds `{{name}}` and the private data directory holds the value.
 * The published file is a template; the assembled prompt is natural prose.
 *
 * Deliberately small. This substitutes TOKENS — a name, a city, a pronoun —
 * that appear inline in otherwise-generic sentences. It is NOT a mechanism for
 * hiding passages: a paragraph about someone's medical history is not a hole in
 * a generic sentence, it is content, and it belongs in the private user layer
 * whole rather than smuggled through a placeholder.
 *
 * Values live in <dataDir>/values.json, a flat string map, gitignored with the
 * rest of data/.
 */
export class TemplateError extends Error {}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Neutral fallbacks, so a fresh install with no values.json still assembles a
 * working prompt instead of refusing to boot. They read as generic prose —
 * which is exactly the tone the private values file exists to replace.
 *
 * A placeholder with no value AND no default here still throws: that is a
 * template referencing something nobody has defined, which is a bug in the
 * template rather than a missing setting.
 */
export const DEFAULT_VALUES: Record<string, string> = {
  name: 'the user',
  pronoun: 'they',
  possessive: 'their',
  object: 'them',
};

export function loadValues(dataDir: string): Record<string, string> {
  const path = join(dataDir, 'values.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // A corrupt values file must not take the process down at boot. An empty
    // map means render() throws on the first placeholder, which is a loud,
    // located failure rather than a silent one.
    return {};
  }
}

/**
 * Replace every `{{key}}` with its value.
 *
 * A key with neither a value nor a default THROWS, rather than rendering
 * `{{name}}` into the prompt or silently emptying it. Both of those are the
 * failure this rewrite keeps running into — something that looks like it
 * worked and did not.
 *
 * A key that has a DEFAULT_VALUES entry but no configured value renders the
 * neutral fallback, so a fresh install boots with generic prose rather than
 * not booting.
 */
export function render(text: string, values: Record<string, string>, where = 'template'): string {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_match, key: string) => {
    const v = values[key] ?? DEFAULT_VALUES[key];
    if (v === undefined) {
      missing.add(key);
      return '';
    }
    return v;
  });
  if (missing.size > 0) {
    throw new TemplateError(
      `${where} references ${[...missing].map((k) => `{{${k}}}`).join(', ')}, ` +
        `which ${missing.size === 1 ? 'is' : 'are'} not set in values.json`,
    );
  }
  return out;
}

/** Does this text contain any placeholder at all? Cheap pre-check. */
export function hasPlaceholder(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}
