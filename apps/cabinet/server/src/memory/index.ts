import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MEMORY_TEMPLATES } from './templates.js';

export class MemoryError extends Error {}

const FILE_PATTERN = /^(?:[A-Z_]+\.md|domains\/[a-z0-9-]+\.md)$/;

export interface MemoryHistoryEntry {
  hash: string;
  message: string;
  at: string; // ISO
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Below this fraction of the OLD content's length remaining, a write reads as
 * catastrophic — a wipe, a truncation, a corrupted rewrite — rather than a
 * normal edit (mentorship: item 5, core-block self-editing discipline). Even
 * a full-rewrite condensing verbose prose rarely drops below half its length;
 * a 40%-remaining floor leaves real headroom for legitimate edits while
 * catching "half the file vanished" or worse. Ben's own call: block this
 * class outright rather than warn — the 99% case (a normal weekly-review
 * rewrite) stays fully autonomous, only the one failure mode that actually
 * corrupts core memory gets a hard stop.
 */
const CATASTROPHIC_SHRINK_FLOOR = 0.4;

/**
 * Always applies, regardless of what the file previously held: a write must
 * never be empty or binary-looking. Split from the shrink-ratio check below
 * because that one gets exempted for template-seeded content; this one never
 * does.
 */
function structuralCheck(after: string): string | null {
  if (/\0/.test(after)) return 'content contains a NUL byte — looks like binary/corrupt data, not markdown';
  if (after.trim().length === 0) return 'new content is empty';
  return null;
}

/**
 * Is `content` still byte-equivalent to the untouched seed template for
 * `file`? Exported (not just internal to the drift guard) — mentorship
 * Phase B's profileGap() reuses this exact check to decide whether
 * domains/health.md etc. have received real onboarding content yet, rather
 * than re-deriving the same comparison a second way.
 */
export function isStillTemplate(file: string, content: string): boolean {
  return content.trim() === (MEMORY_TEMPLATES[file] ?? '').trim();
}

/** null = the write is fine; a string = the reason it's refused. */
function shrinkCheck(before: string, after: string): string | null {
  const trimmedAfter = after.trim();
  const beforeLen = before.trim().length;
  if (beforeLen === 0) return null; // nothing to compare against — not a shrink
  const ratio = trimmedAfter.length / beforeLen;
  if (ratio < CATASTROPHIC_SHRINK_FLOOR) {
    return `content shrank to ${Math.round(ratio * 100)}% of its previous length (${beforeLen} → ${trimmedAfter.length} chars) — refusing an edit this large without review`;
  }
  return null;
}

/**
 * Curated markdown memory (§7.2). Lives in the private data dir as its own
 * git repo; every write is committed so the agent's mind has history.
 * STANDING_ORDERS.md is read-only through this interface — autonomy
 * promotions must come from Ben, never from the agent.
 */
export class MemoryStore {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'domains'), { recursive: true });
    this.git('init', '--quiet');
    // Local identity so commits work regardless of the host git config.
    try {
      this.git('config', 'user.email', 'cabinet@benloe.com');
      this.git('config', 'user.name', 'Cabinet');
    } catch {
      /* config failures are non-fatal */
    }
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8' });
  }

  /** Resolve and validate a memory file name; refuses traversal and unknown shapes. */
  private safePath(file: string): string {
    if (!FILE_PATTERN.test(file)) {
      throw new MemoryError(`invalid memory file name: ${file}`);
    }
    const full = resolve(this.dir, file);
    if (full !== join(this.dir, file) || !full.startsWith(this.dir + '/')) {
      throw new MemoryError(`path escapes memory dir: ${file}`);
    }
    return full;
  }

  /** Create any missing files from templates. Returns the names created. */
  ensureTemplates(): string[] {
    const created: string[] = [];
    for (const [name, content] of Object.entries(MEMORY_TEMPLATES)) {
      const full = this.safePath(name);
      if (!existsSync(full)) {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        created.push(name);
      }
    }
    if (created.length > 0) this.commit(`seed templates: ${created.join(', ')}`);
    return created;
  }

  list(): string[] {
    const top = readdirSync(this.dir).filter((f) => f.endsWith('.md'));
    const domains = existsSync(join(this.dir, 'domains'))
      ? readdirSync(join(this.dir, 'domains'))
          .filter((f) => f.endsWith('.md'))
          .map((f) => `domains/${f}`)
      : [];
    return [...top, ...domains].sort();
  }

  read(file: string): string {
    const full = this.safePath(file);
    if (!existsSync(full)) throw new MemoryError(`no such memory file: ${file}`);
    return readFileSync(full, 'utf8');
  }

  /**
   * Replace a memory file's content (the agent's Tier-4 update_memory tool).
   * STANDING_ORDERS.md is refused here by design (§6: promotions are Ben's).
   * A catastrophic edit (driftCheck) is refused too — normal edits stay fully
   * autonomous (Tier 4, no approval gate); only the one failure mode that
   * actually corrupts core memory gets hard-stopped (mentorship: item 5).
   * DB-agnostic on purpose (this store only knows git + the filesystem) — the
   * caller (cabinet-server.ts's update_memory tool) is what has a `db` handle
   * and is responsible for audit-logging a thrown refusal.
   */
  update(file: string, content: string, reason: string): void {
    if (file === 'STANDING_ORDERS.md') {
      throw new MemoryError('STANDING_ORDERS.md can only be changed by Ben (approval-gated).');
    }
    const structural = structuralCheck(content);
    if (structural) throw new MemoryError(`refusing to write ${file}: ${structural}`);
    const full = this.safePath(file);
    if (existsSync(full)) {
      const before = readFileSync(full, 'utf8');
      // A file still holding its untouched seed template is exempt from the
      // shrink check: templates are full of explanatory scaffolding text
      // precisely so a short real first value (e.g. "protein >= 185 g/day")
      // legitimately replaces most of it — that's the intended lifecycle,
      // not corruption. Once a file holds real (non-template) content, a
      // later catastrophic shrink is exactly the failure mode this guards.
      if (!isStillTemplate(file, before)) {
        const shrink = shrinkCheck(before, content);
        if (shrink) throw new MemoryError(`refusing to write ${file}: ${shrink}`);
      }
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    this.commit(`update ${file}: ${reason.slice(0, 120)}`);
  }

  private commit(message: string): void {
    this.git('add', '-A');
    try {
      this.git('commit', '--quiet', '-m', message);
    } catch (err) {
      // "nothing to commit" is fine (a write of byte-identical content must
      // be a no-op, not a throw) — anything else is not. Pre-existing bug
      // found while building item 5: git writes that message to STDOUT, not
      // stderr, so it never lands in execFileSync's thrown Error#message —
      // this check has silently never matched. Check stdout too.
      const out = `${(err as { stdout?: string }).stdout ?? ''} ${(err as Error).message}`;
      if (!out.includes('nothing to commit')) throw err;
    }
  }

  commitCount(): number {
    try {
      return parseInt(this.git('rev-list', '--count', 'HEAD').trim(), 10);
    } catch {
      return 0;
    }
  }

  /**
   * Recent commits touching one file — the paper trail behind `updatedAt`.
   * A read path (feeds GET /api/memory), so a git failure degrades to []
   * rather than 500ing the whole surface; matches the defensive-read pattern
   * already used for latestAssistantMessage in gateway/surfaces.ts.
   */
  history(file: string, limit = 10): MemoryHistoryEntry[] {
    let raw: string;
    try {
      const full = this.safePath(file);
      if (!existsSync(full)) return [];
      // %x01 prefixes each commit record so splitting on it yields clean
      // per-commit blocks even though commit messages are free text and may
      // contain anything else. --numstat (scoped to `-- file`) appends at
      // most one added/removed line per commit for this path.
      raw = this.git('log', `-n${limit}`, '--date=iso-strict', '--pretty=format:%x01%H%x1f%ad%x1f%s', '--numstat', '--', file);
    } catch {
      return [];
    }
    if (!raw.trim()) return [];
    const entries: MemoryHistoryEntry[] = [];
    for (const block of raw.split('\x01')) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      const header = lines[0] ?? '';
      const [hash, at, ...msgParts] = header.split('\x1f');
      if (!hash || !at) continue;
      const stat = lines.slice(1).find((l) => /^-?\d+\t-?\d+\t/.test(l) || /^-\t-\t/.test(l));
      let linesAdded = 0;
      let linesRemoved = 0;
      if (stat) {
        const [a, r] = stat.split('\t');
        linesAdded = a === '-' ? 0 : Number(a);
        linesRemoved = r === '-' ? 0 : Number(r);
      }
      entries.push({ hash: hash.slice(0, 12), message: msgParts.join('\x1f'), at, linesAdded, linesRemoved });
    }
    return entries;
  }

  /** The stable prompt layers, in cache-friendly order (§9.3 layers 1+3). */
  promptCore(): string {
    // SOUL + VOICE sit right after IDENTITY so the character frames everything
    // below it, and stays in the cache-stable prefix (§9.3).
    const order = ['IDENTITY.md', 'SOUL.md', 'VOICE.md', 'USER.md', 'PREFERENCES.md', 'GOALS.md', 'STANDING_ORDERS.md', 'PLATFORM.md'];
    return order
      .filter((f) => existsSync(join(this.dir, f)))
      .map((f) => `<memory file="${f}">\n${this.read(f)}\n</memory>`)
      .join('\n\n');
  }
}
