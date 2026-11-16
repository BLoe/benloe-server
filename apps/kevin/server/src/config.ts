// Everything environment-shaped, in one place. Nothing here is a secret
// except what arrives through process.env from the kevin secret set.
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
  /** The same, for text extraction from uploads: a sandbox with no writable folder at all. */
  extractLauncher: (env.KEVIN_EXTRACT_LAUNCHER ?? 'unix:/run/kevin-sandbox/extract.sock').split(' '),
  /** Seconds a shell command may run before it and everything it started are killed. */
  shellSeconds: 115,
  /** Seconds a model-written SQL statement may run before it is cancelled. */
  sqlSeconds: 5,
  /** IRON PR (weights.benloe.com), Ben's lifting PR tracker. Read only, ever: see domains/ironpr.ts. */
  ironPrDb: env.KEVIN_IRONPR_DB ?? '/srv/benloe/data/weights.db',
  ownerEmail: (env.KEVIN_OWNER_EMAIL ?? '').toLowerCase(),
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
