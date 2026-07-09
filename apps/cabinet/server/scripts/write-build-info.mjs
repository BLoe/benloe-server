#!/usr/bin/env node
// Build-time only — never runs in the production process. Bakes the commit
// that was actually built into dist/build-info.json, so healthz.buildMarker
// (gateway/app.ts) reflects what's really deployed instead of a hand-typed
// string that goes stale the moment a second deploy happens. index.ts reads
// this file once at startup — no git subprocess, no filesystem git read, in
// the running server.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url))); // .../apps/cabinet/server

function git(args) {
  return execFileSync('git', args, { cwd: serverDir, encoding: 'utf8' }).trim();
}

let sha = 'unknown';
let dirty = false;
try {
  sha = git(['rev-parse', '--short=12', 'HEAD']);
  dirty = git(['status', '--porcelain']).length > 0;
} catch {
  // Best-effort: a tarball deploy with no .git present shouldn't fail the build.
}

mkdirSync(join(serverDir, 'dist'), { recursive: true });
const info = { sha: dirty ? `${sha}-dirty` : sha, builtAt: new Date().toISOString() };
writeFileSync(join(serverDir, 'dist', 'build-info.json'), JSON.stringify(info, null, 2));
console.log(`build-info: ${info.sha} (built ${info.builtAt})`);
