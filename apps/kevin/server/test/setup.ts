// Runs before any test file imports src/config.ts: every test process gets its
// own throwaway data and sandbox folders, the sandbox runner started directly, and no auth.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'kevin-test-'));
// Removed when this file's tests are done: /tmp is a memory filesystem on the box, and a few
// hundred left-over runs (tens of MB each) once filled it.
afterAll(() => rmSync(root, { recursive: true, force: true }));
process.env.KEVIN_DATA_DIR = join(root, 'data');
process.env.KEVIN_SHELL_DIR = join(root, 'sandbox');
// The real sandbox runner, started directly: same framing, time limit and session cleanup as in
// production, without the systemd unit's confinement (which needs root and a second uid).
const runner = fileURLToPath(new URL('../../sandbox/kevin-sandbox-run', import.meta.url));
process.env.KEVIN_SHELL_LAUNCHER = `python3 -I ${runner}`;
process.env.KEVIN_EXTRACT_LAUNCHER = `python3 -I ${runner}`;
process.env.KEVIN_TEST_USER = 'ben';
process.env.KEVIN_OWNER_EMAIL = 'ben@example.com';
process.env.KEVIN_VAPID_PUBLIC_KEY = '';
process.env.KEVIN_VAPID_PRIVATE_KEY = '';
process.env.ANTHROPIC_API_KEY = 'test-key-never-sent';
delete process.env.OPENAI_API_KEY;
