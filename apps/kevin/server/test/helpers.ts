// Shared by every test file.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import type { Domain } from '../src/domains.js';
import { createKevin, type Kevin } from '../src/kevin.js';
import type { ToolCtx } from '../src/tools.js';

/** A Kevin on a throwaway database with just the domains under test. */
export async function makeKevin(domains: Domain[] = []): Promise<Kevin> {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.shellDir, { recursive: true });
  // A file, not ':memory:': SQL the model writes runs in a separate process, which needs a file to open.
  return createKevin({ dbPath: join(config.dataDir, `test-${randomUUID()}.db`), domains });
}

/** Calls a tool the way the agent would. `confirm` answers any confirm prompt. */
export function call(kevin: Kevin, tool: string, input: unknown, opts: { source?: ToolCtx['source']; confirm?: boolean } = {}) {
  return kevin.tools.call(tool, input, { db: kevin.db, source: opts.source ?? 'agent', threadId: null, turnId: null, confirm: () => Promise.resolve(opts.confirm ?? true) });
}

/** Calls a tool and returns its value, failing the test with the tool's message if it errored. */
export async function ok<T = any>(kevin: Kevin, tool: string, input: unknown): Promise<T> {
  const r = await call(kevin, tool, input);
  if (!r.ok) throw new Error(`${tool} failed: ${r.text}`);
  return r.value as T;
}

/** Reads a view the way the page would. */
export async function view<T = any>(kevin: Kevin, path: string, params: Record<string, string> = {}): Promise<T> {
  const v = kevin.views.get(path);
  if (!v) throw new Error(`no view ${path}`);
  return (await v(params, kevin.db)) as T;
}
