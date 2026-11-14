// Runs before any test file imports src/config.ts: every test process gets its
// own throwaway data and sandbox folders, a plain-bash "sandbox", and no auth.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kevin-test-'));
process.env.KEVIN_DATA_DIR = join(root, 'data');
process.env.KEVIN_SHELL_DIR = join(root, 'sandbox');
process.env.KEVIN_SHELL_LAUNCHER = 'bash -c';
process.env.KEVIN_TEST_USER = 'ben';
process.env.KEVIN_OWNER_EMAIL = 'ben@example.com';
process.env.KEVIN_VAPID_PUBLIC_KEY = '';
process.env.KEVIN_VAPID_PRIVATE_KEY = '';
process.env.ANTHROPIC_API_KEY = 'test-key-never-sent';
delete process.env.OPENAI_API_KEY;
