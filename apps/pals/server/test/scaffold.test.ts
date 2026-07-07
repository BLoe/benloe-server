import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Scaffold invariants from docs/AgentArchitectureV2.md §15 step 1.
// These guard the deployment substrate; later suites assume all of it.

describe('scaffold', () => {
  it('data directories exist and are gitignored', () => {
    for (const d of ['memory', 'documents', 'photos', 'backups', 'models', 'threads']) {
      expect(existsSync(`/srv/benloe/data/pals/${d}`)).toBe(true);
    }
    const ignore = execFileSync('git', ['-C', '/srv/benloe', 'check-ignore', 'data/pals/pals.db'], {
      encoding: 'utf8',
    });
    expect(ignore.trim()).toBe('data/pals/pals.db');
  });

  it('memory dir is its own git repo (private, not the monorepo)', () => {
    const top = execFileSync('git', ['-C', '/srv/benloe/data/pals/memory', 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
    expect(top).toBe('/srv/benloe/data/pals/memory');
  });

  it('privops canonical copy is root-owned and not writable by others', () => {
    const st = statSync('/usr/local/sbin/pals-privops');
    expect(st.uid).toBe(0);
    expect(st.mode & 0o022).toBe(0); // no group/other write
  });

  it('secrets file is root-only', () => {
    const st = statSync('/srv/benloe/.env');
    expect(st.uid).toBe(0);
    expect(st.mode & 0o077).toBe(0); // no group/other access at all
  });
});
