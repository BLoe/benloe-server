import { describe, expect, it } from 'vitest';
import { classifyDirtyPaths, DEFAULT_ALLOWED_PREFIXES } from '../scripts/deploy-guard.mjs';

describe('classifyDirtyPaths', () => {
  it('allows modified/untracked paths inside the default scope', () => {
    const { allowed, blocking } = classifyDirtyPaths(
      [' M apps/cabinet/server/src/index.ts', '?? infra/scripts/cabinet-deploy.sh'],
      DEFAULT_ALLOWED_PREFIXES,
    );
    expect(blocking).toEqual([]);
    expect(allowed).toEqual(['apps/cabinet/server/src/index.ts', 'infra/scripts/cabinet-deploy.sh']);
  });

  it('blocks paths outside the default scope', () => {
    const { blocking } = classifyDirtyPaths([' M apps/artanis/src/foo.ts'], DEFAULT_ALLOWED_PREFIXES);
    expect(blocking).toEqual(['apps/artanis/src/foo.ts']);
  });

  it('resolves renames to the new path', () => {
    const { allowed, blocking } = classifyDirtyPaths(
      ['R  apps/cabinet/server/src/old.ts -> apps/cabinet/server/src/new.ts'],
      DEFAULT_ALLOWED_PREFIXES,
    );
    expect(blocking).toEqual([]);
    expect(allowed).toEqual(['apps/cabinet/server/src/new.ts']);
  });

  it('ignores blank lines', () => {
    const { allowed, blocking } = classifyDirtyPaths(['', ' M apps/cabinet/server/x.ts', ''], DEFAULT_ALLOWED_PREFIXES);
    expect(blocking).toEqual([]);
    expect(allowed).toHaveLength(1);
  });

  it('honors extra allowed prefixes', () => {
    const { blocking } = classifyDirtyPaths([' M docs/foo.md'], [...DEFAULT_ALLOWED_PREFIXES, 'docs/']);
    expect(blocking).toEqual([]);
  });

  it('a mix of allowed and blocking paths sorts into both buckets', () => {
    const { allowed, blocking } = classifyDirtyPaths(
      [' M apps/cabinet/server/src/index.ts', ' M apps/dada/src/bar.ts'],
      DEFAULT_ALLOWED_PREFIXES,
    );
    expect(allowed).toEqual(['apps/cabinet/server/src/index.ts']);
    expect(blocking).toEqual(['apps/dada/src/bar.ts']);
  });
});
