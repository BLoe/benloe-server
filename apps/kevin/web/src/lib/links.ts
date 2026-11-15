// Kevin mentions pages by path ("I set it up at /s/car-maintenance"). Those
// become links, but only when the text is exactly one of the app's own
// routes, so a file path or the tail of a URL is left alone.

// The routes in App.tsx. Kept as a list here because lib/ cannot import the
// page registry (the pages import the Markdown component that uses this).
const PAGES = ['pantry', 'cooking', 'workouts', 'money', 'taxes', 'documents', 'spaces', 'jobs', 'settings'];
const PATH = `/(?:${PAGES.join('|')})(?:\\?tab=[a-z]+)?|/s/[a-z0-9][a-z0-9-]*|/chat/[0-9a-f][0-9a-f-]{7,}`;
// Not preceded by something that makes it part of a longer path, URL or word; not followed by more path.
const IN_TEXT = new RegExp(`(?<![\\w/.:~@#-])(${PATH})(?![\\w/-]|\\.\\w)`, 'g');
const WHOLE = new RegExp(`^(?:${PATH})$`);

/** True when the whole string is an in-app path (for inline code like `/pantry`). */
export const isAppPath = (text: string): boolean => WHOLE.test(text);

export type TextPart = string | { path: string };

/** Splits text into plain runs and in-app paths, in order. Text without a path comes back as one string. */
export function splitPaths(text: string): TextPart[] {
  const out: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(IN_TEXT)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ path: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < text.length || !out.length) out.push(text.slice(at));
  return out;
}

// ---- as a remark plugin -------------------------------------------------------

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
}

function walk(node: Node): void {
  if (!node.children) return;
  const next: Node[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      for (const part of splitPaths(child.value)) {
        next.push(typeof part === 'string' ? { type: 'text', value: part } : { type: 'link', url: part.path, children: [{ type: 'text', value: part.path }] });
      }
    } else if (child.type === 'inlineCode' && child.value && isAppPath(child.value)) {
      next.push({ type: 'link', url: child.value, children: [child] });
    } else {
      // Text that is already a link, and code blocks, stay as written.
      if (child.type !== 'link' && child.type !== 'linkReference' && child.type !== 'code') walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark plugin: turns in-app paths in prose into links. */
export function remarkAppLinks() {
  return (tree: unknown): void => walk(tree as Node);
}
