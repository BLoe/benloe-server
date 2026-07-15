#!/usr/bin/env node
/**
 * review-shot.mjs — screenshot pipeline for the VISION design-review loop.
 *
 * Mints a short-lived agent key, drives a real (headless) browser to one or
 * more Cabinet surfaces authenticated as that agent, screenshots each, then
 * revokes the key. The resulting PNGs are meant to be handed to a
 * design-reviewer subagent that actually reads the image (not the source).
 *
 * Usage:
 *   node apps/cabinet/web/scripts/review-shot.mjs <surface>
 *   node apps/cabinet/web/scripts/review-shot.mjs --all
 *
 * Supported surfaces: today, domains, ops, brain, threads
 *
 * In --all mode, a single agent key is minted and a single browser session
 * is used for all five surfaces (one login, sequential navigate+shoot) —
 * cheaper than five separate logins, and the key is still revoked exactly
 * once at the end (or on failure) via try/finally.
 *
 * Prints one PNG path per surface screenshotted, each on its own line, as
 * the shots are taken. Nothing else of consequence goes to stdout — errors,
 * progress, and per-surface failure notes go to stderr. The raw agent key is
 * NEVER printed — only used in-memory and redacted from error text.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const REPO_ROOT = '/srv/benloe';
const ARTANIS_DIR = path.join(REPO_ROOT, 'apps/artanis');
const AGENT_KEY_SCRIPT = path.join(ARTANIS_DIR, 'scripts/agent-key.ts');
const TSX_BIN = path.join(ARTANIS_DIR, 'node_modules/.bin/tsx');
const SCREENSHOT_DIR = '/srv/benloe/data/cabinet/review-screenshots';

const KEY_RE = /\bagk_[0-9a-f]+\b/;

function redact(str) {
  return String(str ?? '').replace(/\bagk_[0-9a-f]+\b/g, 'agk_***REDACTED***');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${cmd} ${args.join(' ')} exited ${code}: ${redact(stderr || stdout)}`
          )
        );
    });
  });
}

async function createAgentKey(name, label) {
  const { stdout } = await run(TSX_BIN, [AGENT_KEY_SCRIPT, 'create', name, label], {
    cwd: ARTANIS_DIR,
  });
  const match = stdout.match(KEY_RE);
  if (!match) throw new Error('failed to parse agent key from create output (key not printed for safety)');
  return match[0];
}

async function revokeAgentKey(name) {
  await run(TSX_BIN, [AGENT_KEY_SCRIPT, 'revoke', name], { cwd: ARTANIS_DIR });
}

// ---- per-surface drive scripts ----
// Each takes an authenticated Playwright `page` already on cabinet.benloe.com
// (rail nav visible) and must click into its surface and leave the page in
// the state to be screenshotted. Order here is the --all capture order.
const SURFACE_ORDER = ['today', 'domains', 'ops', 'brain', 'threads'];

async function clickRail(page, label) {
  await page
    .getByRole('navigation', { name: 'Surfaces' })
    .getByRole('button', { name: label })
    .click();
}

const SURFACES = {
  today: async (page) => {
    await clickRail(page, 'Today');
    // No unique ARIA landmark on Today (greeting heading is personalized
    // text) — the "today" root wrapper is the steadiest signal available.
    await page.waitForSelector('.today', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.today--message', { state: 'detached', timeout: 8000 }).catch(() => {});
  },
  domains: async (page) => {
    await clickRail(page, 'Domains');
    await page.getByRole('region', { name: 'Domains' }).waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.dom-body', { timeout: 15000 }).catch(() => {});
    await page
      .waitForFunction(() => !document.querySelector('.dom-body.is-loading'), { timeout: 8000 })
      .catch(() => {});
  },
  ops: async (page) => {
    await clickRail(page, 'Ops');
    await page.getByRole('region', { name: 'Operations ledger' }).waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.ops-feed', { timeout: 15000 }).catch(() => {});
  },
  brain: async (page) => {
    await clickRail(page, 'Brain');
    await page.getByRole('heading', { name: 'Brain' }).waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.brain__loading', { state: 'detached', timeout: 15000 }).catch(() => {});
  },
  threads: async (page) => {
    await clickRail(page, 'Threads');
    await page
      .getByRole('listbox', { name: 'Conversations' })
      .getByRole('option')
      .first()
      .click({ timeout: 15000 });
    await page
      .getByPlaceholder('Message Cabinet…')
      .waitFor({ state: 'visible', timeout: 15000 });
  },
};

function parseArgs(argv) {
  const arg = argv[2];
  if (!arg || arg === '--all') {
    return { mode: 'all', surfaces: SURFACE_ORDER };
  }
  if (!SURFACES[arg]) {
    console.error(`unknown surface "${arg}" — available: ${SURFACE_ORDER.join(', ')}, or --all`);
    process.exit(1);
  }
  return { mode: 'single', surfaces: [arg] };
}

async function main() {
  const { surfaces } = parseArgs(process.argv);

  const ts = Date.now();
  const agentName = `cabinet-shot-${ts}`;

  let key;
  try {
    key = await createAgentKey(agentName, 'design review');

    const { chromium } = require(path.join(REPO_ROOT, 'node_modules/playwright'));
    const browser = await chromium.launch({
      args: [
        '--host-resolver-rules=MAP cabinet.benloe.com 127.0.0.1,MAP auth.benloe.com 127.0.0.1',
      ],
    });

    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      // Exchange the agent key for a session cookie via the GET convenience
      // route (sets cookie domain=.benloe.com, then redirects to Cabinet).
      const loginUrl =
        `https://auth.benloe.com/api/auth/agent-login` +
        `?token=${encodeURIComponent(key)}&redirect=${encodeURIComponent('https://cabinet.benloe.com')}`;
      const resp = await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      if (!resp || !resp.ok()) {
        throw new Error(
          `agent-login navigation failed: ${resp ? resp.status() : 'no response'}`
        );
      }

      // Confirm we landed authenticated (the shell renders the rail nav),
      // not the "sign in via auth.benloe.com" screen.
      try {
        await page.waitForSelector('nav[aria-label="Surfaces"]', { timeout: 15000 });
      } catch {
        const bodyText = (await page.textContent('body').catch(() => '')) ?? '';
        throw new Error(
          `did not land authenticated on cabinet.benloe.com — page text: ${bodyText.slice(0, 300)}`
        );
      }

      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');

      const shotPaths = [];
      const failures = [];
      for (const surfaceName of surfaces) {
        try {
          await SURFACES[surfaceName](page);
          // Small settle delay so in-flight transitions/paints finish before
          // the pixels are captured.
          await page.waitForTimeout(300);

          const pngPath = path.join(SCREENSHOT_DIR, `${surfaceName}-${iso}.png`);
          await page.screenshot({ path: pngPath });
          shotPaths.push(pngPath);

          // Streamed as each surface completes — the only stdout content.
          console.log(pngPath);
        } catch (err) {
          failures.push(surfaceName);
          console.error(`WARNING: surface "${surfaceName}" failed, continuing: ${redact(err.message)}`);
        }
      }

      await browser.close();

      if (shotPaths.length === 0) {
        throw new Error(`all surfaces failed: ${failures.join(', ')}`);
      }
      if (failures.length > 0) {
        console.error(`done with failures on: ${failures.join(', ')}`);
      }
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  } finally {
    if (key !== undefined) {
      await revokeAgentKey(agentName).catch((err) => {
        console.error(`WARNING: failed to revoke temp agent key ${agentName}: ${redact(err.message)}`);
      });
    }
  }
}

main().catch((err) => {
  console.error(redact(err.stack || err.message || String(err)));
  process.exit(1);
});
