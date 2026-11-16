// The "About Ben" profile: the top layer of Kevin's memory (system/profile,
// profile_update in server/src/core/index.ts). The pure helpers for showing it.

export interface ProfileSection {
  key: string;
  title: string;
  /** Markdown. */
  body: string;
  position: number;
  updated_at: string;
  updated_by: string;
  /** How many earlier versions are kept. */
  versions: number;
}

export interface ProfileView {
  sections: ProfileSection[];
  chars: number;
}

export interface ProfileVersion {
  id: number;
  key: string;
  title: string;
  body: string;
  replaced_at: string;
  replaced_by: string;
}

/** Who wrote or replaced something, as the page says it. */
export function byLabel(by: string): string {
  if (by === 'ben') return 'you';
  if (by === 'kevin') return 'Kevin';
  if (by === 'import') return 'an import';
  return by;
}

/** Markdown as the plain words it would read as, on one line: for a collapsed section's two-line preview. */
export function previewText(markdown: string, max = 240): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** "about 5,200 words", rounded so it reads as a size and not a measurement. */
export function roughWords(sections: Pick<ProfileSection, 'body'>[]): string {
  const n = sections.reduce((sum, s) => sum + wordCount(s.body), 0);
  if (n < 100) return `${n} ${n === 1 ? 'word' : 'words'}`;
  const step = n < 1000 ? 50 : 100;
  return `about ${(Math.round(n / step) * step).toLocaleString('en-US')} words`;
}

/**
 * The write for a saved edit: only what changed. Null when nothing did.
 * A section is addressed by its key, so a rename in the same save is safe.
 */
export function profileInput(section: Pick<ProfileSection, 'key' | 'title' | 'body'> | null, title: string, body: string): Record<string, unknown> | null {
  const t = title.trim();
  const b = body.trim();
  if (!section) return { section: t, body: b };
  const input: Record<string, unknown> = { section: section.key };
  if (b !== section.body.trim()) input.body = b;
  if (t !== section.title) input.title = t;
  return Object.keys(input).length > 1 ? input : null;
}

/** The log records every write as "<tool> <input json>". For the profile that would spill its text into the log list; say what happened instead. */
export function logLine(text: string): string {
  if (!text.startsWith('profile_update ')) return text;
  const section = /"section":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  const what = /"delete":true/.test(text) ? 'deleted' : /"append":/.test(text) ? 'added to' : 'updated';
  return section ? `About you: ${what} “${section.replace(/\\(.)/g, '$1')}”` : 'About you: updated';
}

export const isProfileWrite = (tool: string): boolean => tool === 'profile_update';
