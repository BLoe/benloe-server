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
  /** persona.md, rules.md, people.md, profile.md — shipped with the code. */
  workspaceDir: resolve(env.KEVIN_WORKSPACE_DIR ?? join(here, '../../workspace')),
  /** Built frontend. */
  webDir: resolve(env.KEVIN_WEB_DIR ?? join(here, '../../web/dist')),
  /** Where the sandboxed shell runs; owned by the kevin-sh uid. */
  shellDir: resolve(env.KEVIN_SHELL_DIR ?? '/var/lib/kevin-sh/workspace'),
  /** How a shell command is launched. Production: sudo to the kevin-sh uid. */
  shellLauncher: (env.KEVIN_SHELL_LAUNCHER ?? 'sudo -n -u kevin-sh /usr/local/lib/benloe/kevin-shell').split(' '),
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
