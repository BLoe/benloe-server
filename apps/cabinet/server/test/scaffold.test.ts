import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Scaffold invariants from docs/AgentArchitectureV2.md §15 step 1.
// These guard the deployment substrate; later suites assume all of it.

describe('scaffold', () => {
  it('data directories exist and are gitignored', () => {
    for (const d of ['memory', 'documents', 'photos', 'backups', 'models', 'chats']) {
      expect(existsSync(`/srv/benloe/data/cabinet/${d}`)).toBe(true);
    }
    const ignore = execFileSync('git', ['-C', '/srv/benloe', 'check-ignore', 'data/cabinet/cabinet.db'], {
      encoding: 'utf8',
    });
    expect(ignore.trim()).toBe('data/cabinet/cabinet.db');
  });

  it('memory dir is its own git repo (private, not the monorepo)', () => {
    const top = execFileSync('git', ['-C', '/srv/benloe/data/cabinet/memory', 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
    expect(top).toBe('/srv/benloe/data/cabinet/memory');
  });

  it('privops canonical copy is root-owned and not writable by others', () => {
    const st = statSync('/usr/local/sbin/cabinet-privops');
    expect(st.uid).toBe(0);
    expect(st.mode & 0o022).toBe(0); // no group/other write
  });

  // Cabinet reads only its own rendered set. The uid check is the load-bearing
  // half: the render is owned by the renderer, NOT by claude-worker, so the mode
  // bits below mean Cabinet's own uid cannot open the file it is configured
  // from. Everything Cabinet gets, root's PM2 daemon hands it (ecosystem.config.js).
  it("cabinet's rendered secret set is readable only by the renderer", () => {
    const rendererUid = Number(execFileSync('id', ['-u', 'benloe-secrets'], { encoding: 'utf8' }).trim());
    const st = statSync('/run/benloe-secrets/cabinet.env');
    expect(st.uid).toBe(rendererUid);
    expect(st.mode & 0o077).toBe(0); // no group/other access at all
  });
});
