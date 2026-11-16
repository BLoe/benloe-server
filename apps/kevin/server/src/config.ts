// Everything environment-shaped, in one place. Nothing here is a secret
// except what arrives through process.env from the kevin secret set.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3016),
  production: env.NODE_ENV === 'production',
  /** DB, documents, uploads, suggestions. Outside the repo: see CLAUDE.md. */
  dataDir: resolve(env.KEVIN_DATA_DIR ?? '/var/lib/kevin'),
  /** persona.md and rules.md, shipped with the code. Nothing about Ben is in them; his profile is in the database. */
  workspaceDir: resolve(env.KEVIN_WORKSPACE_DIR ?? join(here, '../../workspace')),
  /** Built frontend. */
  webDir: resolve(env.KEVIN_WEB_DIR ?? join(here, '../../web/dist')),
  /** Where the sandboxed shell runs; owned by the kevin-sh uid. */
  shellDir: resolve(env.KEVIN_SHELL_DIR ?? '/var/lib/kevin-sh/workspace'),
  /**
   * Where the sandbox runner is reached. `unix:<path>`: the socket systemd listens on (production, see
   * setup.sh). Anything else: a command that starts the runner directly (tests, a development machine),
   * which gives its time limit and session cleanup but none of the unit's confinement.
   */
  shellLauncher: (env.KEVIN_SHELL_LAUNCHER ?? 'unix:/run/kevin-sandbox/shell.sock').split(' '),
  /** The same, for text extraction from uploads: a sandbox with nowhere to write (not even /tmp; see setup.sh). */
  extractLauncher: (env.KEVIN_EXTRACT_LAUNCHER ?? 'unix:/run/kevin-sandbox/extract.sock').split(' '),
  /** Seconds a shell command may run before it and everything it started are killed. */
  shellSeconds: 115,
  /** Seconds a model-written SQL statement may run before it is cancelled. */
  sqlSeconds: 5,
  /** IRON PR (weights.benloe.com), Ben's lifting PR tracker. Read only, ever: see domains/ironpr.ts. */
  ironPrDb: env.KEVIN_IRONPR_DB ?? '/srv/benloe/data/weights.db',
  /** Who may sign in. From the kevin secret set, else the box owner's bootstrap file: see ecosystem.config.cjs. */
  ownerEmail: (env.KEVIN_OWNER_EMAIL ?? '').trim().toLowerCase(),
  authUrl: env.AUTH_SERVICE_URL ?? 'http://localhost:3002',
  publicUrl: env.KEVIN_PUBLIC_URL ?? 'https://kevin.benloe.com',
  timezone: env.KEVIN_TZ ?? 'America/New_York',
  vapidPublic: env.KEVIN_VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: env.KEVIN_VAPID_PRIVATE_KEY ?? '',
  openaiKey: env.OPENAI_API_KEY ?? '',
  /** Tests only: skips artanis. Dead in production. */
  testUser: env.NODE_ENV === 'production' ? '' : (env.KEVIN_TEST_USER ?? ''),
  models: {
    /** Normal turns. */
    main: env.KEVIN_MODEL_MAIN ?? 'claude-sonnet-5-5',
    /** Titles, summaries, extraction, the research sub-agent. */
    small: env.KEVIN_MODEL_SMALL ?? 'claude-haiku-5-5',
    /** Only when Ben asks ("think hard") or a schedule is configured for it. */
    deep: env.KEVIN_MODEL_DEEP ?? 'claude-opus-5-5',
  },
  defaultMonthlyCapUsd: 50,
};

export type Config = typeof config;

/** The workspace files that make up the fixed part of the prompt (prompt.ts). */
export const WORKSPACE_FILES = ['persona.md', 'rules.md'] as const;

/**
 * Reasons this configuration must not be run, as messages for the log; empty when it may.
 * In production the owner's address has to be set (KEVIN_OWNER_EMAIL, which ecosystem.config.cjs takes
 * from the kevin secret set, or else from BENLOE_OWNER_EMAIL in /etc/benloe/benloe-secrets.conf): it is
 * who the auth check lets in, and without it nobody can sign in while the server looks healthy.
 * In production the model API key has to be there too. In every mode, persona.md and rules.md must
 * be readable and not empty.
 */
export function startupProblems(c: Pick<Config, 'production' | 'ownerEmail' | 'workspaceDir'> & { anthropicKey?: string } = { ...config, anthropicKey: env.ANTHROPIC_API_KEY }): string[] {
  const problems: string[] = [];
  // Without it every turn fails while the server looks healthy.
  if (c.production && !c.anthropicKey?.trim()) problems.push('ANTHROPIC_API_KEY is not set. Add it to the kevin set at secrets.benloe.com and restart.');
  // The fixed prompt. Without rules.md Kevin would run with no rule about whose instructions to follow.
  for (const name of WORKSPACE_FILES) {
    let text = '';
    try {
      text = readFileSync(join(c.workspaceDir, name), 'utf8').trim();
    } catch {
      problems.push(`${join(c.workspaceDir, name)} cannot be read (KEVIN_WORKSPACE_DIR, or a release built without workspace/).`);
      continue;
    }
    if (!text) problems.push(`${join(c.workspaceDir, name)} is empty.`);
  }
  if (c.production && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.ownerEmail)) {
    problems.push('KEVIN_OWNER_EMAIL is not set to an email address. It is not kept in the repository: the PM2 config takes it from KEVIN_OWNER_EMAIL in the kevin set at secrets.benloe.com, or else from BENLOE_OWNER_EMAIL in /etc/benloe/benloe-secrets.conf. Set one of them and restart.');
  }
  return problems;
}
