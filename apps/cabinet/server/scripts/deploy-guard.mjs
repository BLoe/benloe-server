#!/usr/bin/env node
// Clean-tree guard for infra/scripts/cabinet-deploy.sh — refuses to build+ship
// if the working tree has uncommitted changes OUTSIDE the paths this deploy
// wrapper is entitled to touch (apps/cabinet/, infra/scripts/ by default).
// Prevents a cabinet deploy from silently sweeping in an unrelated
// half-finished edit to another app via a blind `git add -A`. Pure
// classification logic is exported so it's unit-testable without a real git
// process (see test/deploy-guard.test.ts); main() is the thin CLI shim
// cabinet-deploy.sh actually invokes.
import { execFileSync } from 'node:child_process';

export const DEFAULT_ALLOWED_PREFIXES = ['apps/cabinet/', 'infra/scripts/'];

/**
 * Classifies `git status --porcelain` lines against an allow-list of path
 * prefixes. Each porcelain v1 line is two status chars + a space + the path
 * (`" M path"`, `"?? path"`), or for renames `"R  old -> new"` — the path
 * that matters for "what would get staged" is the part after `' -> '` when
 * present.
 */
export function classifyDirtyPaths(porcelainLines, allowedPrefixes = DEFAULT_ALLOWED_PREFIXES) {
  const allowed = [];
  const blocking = [];
  for (const raw of porcelainLines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const path = line.includes(' -> ') ? line.slice(line.indexOf(' -> ') + 4) : line.slice(3);
    (allowedPrefixes.some((p) => path.startsWith(p)) ? allowed : blocking).push(path);
  }
  return { allowed, blocking };
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

export function main(argv = process.argv.slice(2)) {
  const allowAll = argv.includes('--all');
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow') extra.push(argv[++i]);
  }
  const allowedPrefixes = [...DEFAULT_ALLOWED_PREFIXES, ...extra];

  if (allowAll) {
    console.log('deploy-guard: --all passed, skipping dirty-tree scope check');
    return 0;
  }

  const root = repoRoot();
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n');
  const { blocking } = classifyDirtyPaths(porcelain, allowedPrefixes);
  if (blocking.length > 0) {
    console.error('deploy-guard: refusing — dirty paths outside allowed scope:');
    for (const p of blocking) console.error(`  ${p}`);
    console.error(`allowed prefixes: ${allowedPrefixes.join(', ')} (use --allow <prefix> or --all to override)`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
