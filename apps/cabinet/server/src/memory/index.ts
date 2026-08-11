import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MEMORY_TEMPLATES } from './templates.js';

export class MemoryError extends Error {}

/**
 * Where repo-sourced prompt layers live. Resolved from this module's own
 * location so the same expression works under `tsx` (src/memory → src/prompts)
 * and in production (dist/memory → dist/prompts); `npm run build` copies the
 * directory across, the same way it does db/migrations.
 */
export const DEFAULT_PROMPT_DIR = join(import.meta.dirname, '../prompts');

/**
 * Which of the two roots a prompt layer is read from.
 *
 * - `repo` — generic, reviewable, changed by PR. Lives in src/prompts/.
 * - `user` — personal, private, changed by Cabinet as it learns. Lives in the
 *   memory directory under data/, which is its own git repo with no remote.
 *
 * The distinction is privacy, not authority. A `repo` layer is not more
 * trusted than a `user` one; it is merely one that can be published.
 */
export type PromptSource = 'repo' | 'user';

export interface PromptLayer {
  file: string;
  source: PromptSource;
}

/**
 * The system prompt, as an ordered manifest.
 *
 * This replaced a bare list of filenames that were all implicitly read from
 * the memory directory. Naming the source per layer is what lets a file move
 * into the repo as a one-line change here, rather than as a change to how the
 * loader works.
 *
 * Order is load-bearing and later wins — see CORRECTIONS.md below.
 *
 * Everything is `user` today. That is the honest starting state, not an
 * oversight: the loader shipped before any content moved, so that the first
 * move is a diff you can read. See docs/prompt-architecture.md.
 */
export const PROMPT_CORE: readonly PromptLayer[] = [
  // CHARTER is the constitution and leads: everything below operates inside
  // it. Then the register (VOICE), how Cabinet is currently tuning itself
  // (TUNING), the default shape of a day (RHYTHM), who Ben is (USER), what
  // works on him (PLAYBOOK), and finally the operational layers.
  //
  // IDENTITY.md deliberately drops out here — CHARTER supersedes it for
  // interactive turns. It survives for HEARTBEATS, whose minimal prompt is
  // IDENTITY + HEARTBEAT (runtime/prompt.ts's assemblePrompt), so IDENTITY
  // has to stand alone on that path.
  // First layer to move into the repo (2026-08-11). Generic by construction —
  // it describes the relationship, not the person; who the principal IS lives
  // in the user layer. The data/ copy is left in place, shadowed, so a revert
  // of this line restores the old charter without needing a file restore.
  { file: 'CHARTER.md', source: 'repo' },
  // VOICE.md dropped from the prompt 2026-08-11: the charter above now covers
  // how Cabinet talks, and two documents describing one voice is how they came
  // to disagree about reply length in the first place. The file is left on
  // disk, unloaded — its worked examples are worth mining for the user layer,
  // and they are full of personal detail that cannot come into this repo.
  { file: 'TUNING.md', source: 'user' },
  { file: 'RHYTHM.md', source: 'user' },
  { file: 'USER.md', source: 'user' },
  // CORRECTIONS.md sits immediately after USER.md and outranks it. It is the
  // append-only ledger of things Ben has explicitly told Cabinet were wrong.
  // It exists because a correction made in conversation has a shelf life of
  // one session: the narrative files get RE-AUTHORED by later sessions working
  // from source documents, and a re-author silently reverts whatever the last
  // conversation fixed (2026-08-03, C-1). Append-only is the mechanism —
  // nothing rewrites this file, so nothing can revert it.
  { file: 'CORRECTIONS.md', source: 'user' },
  { file: 'PLAYBOOK.md', source: 'user' },
  { file: 'PREFERENCES.md', source: 'user' },
  { file: 'GOALS.md', source: 'user' },
  { file: 'STANDING_ORDERS.md', source: 'user' },
  { file: 'PLATFORM.md', source: 'user' },
];


/**
 * Two nested namespaces, not one:
 * - domains/*.md are rolling NARRATIVES — what happened, rewritten at weekly
 *   review, deliberately capped and disposable.
 * - plans/*.md are the REASONING layer — why the current plan is the plan.
 *   Goal-table rows are projections of these files; when a plan changes, the
 *   rows change. Added 2026-08-01 with the v2 persona stack, whose
 *   plans/health.md is the first of them.
 */
const FILE_PATTERN = /^(?:[A-Z_]+\.md|(?:domains|plans)\/[a-z0-9-]+\.md)$/;

/** Nested memory namespaces, in the order list() reports them. */
const SUBDIRS = ['domains', 'plans'] as const;

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
  /** Files this store serves from promptDir. Derived from the manifest. */
  private readonly repoSourced: Set<string>;

  /**
   * @param dir        the private memory directory (its own git repo)
   * @param promptDir  the repo-sourced prompt layers. Defaults to the copy
   *                   shipped beside this module; overridable for tests.
   * @param manifest   which layers load, in what order, from which root.
   *                   A parameter rather than a module constant so the
   *                   two-root behaviour is testable without shipping a
   *                   repo-sourced layer to make it so.
   */
  constructor(
    readonly dir: string,
    readonly promptDir: string = DEFAULT_PROMPT_DIR,
    readonly manifest: readonly PromptLayer[] = PROMPT_CORE,
  ) {
    this.repoSourced = new Set(manifest.filter((l) => l.source === 'repo').map((l) => l.file));
    for (const sub of SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
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

  /**
   * Resolve and validate a memory file name against a given root; refuses
   * traversal and unknown shapes. Both roots go through this — a repo-sourced
   * layer is still attacker-adjacent input if a name ever reaches it from a
   * tool argument, and the traversal check is the reason `read()` cannot be
   * pointed at anything outside the two directories.
   */
  private pathIn(root: string, file: string): string {
    if (!FILE_PATTERN.test(file)) {
      throw new MemoryError(`invalid memory file name: ${file}`);
    }
    const full = resolve(root, file);
    if (full !== join(root, file) || !full.startsWith(root + '/')) {
      throw new MemoryError(`path escapes memory dir: ${file}`);
    }
    return full;
  }

  /** Resolve a name in the private memory directory. */
  private safePath(file: string): string {
    return this.pathIn(this.dir, file);
  }

  /**
   * Which root a file is read from. Only layers the manifest declares `repo`
   * come from the repo; everything else — domain narratives, plans, anything
   * not in PROMPT_CORE at all — stays in the private directory.
   */
  private rootFor(file: string): string {
    return this.repoSourced.has(file) ? this.promptDir : this.dir;
  }

  /** True when this file is served from the repo and is not writable here. */
  isRepoSourced(file: string): boolean {
    return this.repoSourced.has(file);
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
    const nested = SUBDIRS.flatMap((sub) =>
      existsSync(join(this.dir, sub))
        ? readdirSync(join(this.dir, sub))
            .filter((f) => f.endsWith('.md'))
            .map((f) => `${sub}/${f}`)
        : [],
    );
    return [...top, ...nested].sort();
  }

  read(file: string): string {
    const full = this.pathIn(this.rootFor(file), file);
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
    if (this.repoSourced.has(file)) {
      // Not a policy gate — a fact about where the bytes are. This file is
      // served from the repo, so a write here would land in the private
      // directory and be shadowed by the repo copy on the very next read: the
      // edit would appear to succeed and change nothing, which is the worst
      // available outcome. Editing it means editing the repo and deploying.
      throw new MemoryError(
        `${file} is served from the repo (${this.promptDir}), not from the memory directory. ` +
          `Edit apps/cabinet/server/src/prompts/${file} and open a PR — a write here would be silently ignored.`,
      );
    }
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

  /**
   * The stable prompt layers, in cache-friendly order (§9.3 layers 1+3).
   *
   * Reads PROMPT_CORE, resolving each layer against its declared root. A
   * missing file is skipped rather than fatal — the same tolerance the old
   * existsSync filter had, and the reason a manifest entry can be added
   * before its file exists.
   *
   * The `<memory file="...">` wrapper carries the bare filename with no hint
   * of which root it came from. That is deliberate: where a layer is stored
   * is an operational detail, and telling the model that some of its own
   * mind is "the reviewed part" invites it to weigh them differently.
   */
  promptCore(): string {
    // Reads this.manifest and nothing else. It deliberately takes no override:
    // an earlier draft let a caller pass a different manifest, which meant
    // promptCore() could serve a file from the repo while read() — keyed on
    // the constructor's manifest — served the data-dir copy of the same name.
    // One manifest per store is what makes those two agree.
    //
    // Resolved through pathIn rather than a bare join, so a name reaching the
    // manifest from anywhere still gets the traversal check.
    return this.manifest
      .map(({ file, source }) => ({ file, full: this.pathIn(source === 'repo' ? this.promptDir : this.dir, file) }))
      .filter(({ full }) => existsSync(full))
      .map(({ full, file }) => `<memory file="${file}">\n${readFileSync(full, 'utf8')}\n</memory>`)
      .join('\n\n');
  }
}
