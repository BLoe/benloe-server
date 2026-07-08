import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MEMORY_TEMPLATES } from './templates.js';

export class MemoryError extends Error {}

const FILE_PATTERN = /^(?:[A-Z_]+\.md|domains\/[a-z0-9-]+\.md)$/;

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
      this.git('config', 'user.email', 'pals@benloe.com');
      this.git('config', 'user.name', 'PALS');
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
   */
  update(file: string, content: string, reason: string): void {
    if (file === 'STANDING_ORDERS.md') {
      throw new MemoryError('STANDING_ORDERS.md can only be changed by Ben (approval-gated).');
    }
    const full = this.safePath(file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    this.commit(`update ${file}: ${reason.slice(0, 120)}`);
  }

  private commit(message: string): void {
    this.git('add', '-A');
    try {
      this.git('commit', '--quiet', '-m', message);
    } catch (err) {
      // "nothing to commit" is fine; anything else is not.
      if (!String(err).includes('nothing to commit')) throw err;
    }
  }

  commitCount(): number {
    try {
      return parseInt(this.git('rev-list', '--count', 'HEAD').trim(), 10);
    } catch {
      return 0;
    }
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
