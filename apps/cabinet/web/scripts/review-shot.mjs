#!/usr/bin/env node
/**
 * review-shot.mjs — screenshot pipeline for the VISION design-review loop.
 *
 * Mints a short-lived agent key, drives a real (headless) browser to a
 * Cabinet surface authenticated as that agent, screenshots it, then revokes
 * the key. The resulting PNG is meant to be handed to a design-reviewer
 * subagent that actually reads the image (not the source).
 *
 * Usage:
 *   node apps/cabinet/web/scripts/review-shot.mjs <surface>
 *
 * Currently supported surfaces: composer
 *
 * Prints exactly one thing of consequence to stdout: the absolute path to
 * the PNG, as the final line. Everything else goes to stderr. The raw agent
 * key is NEVER printed — only used in-memory and redacted from error text.
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
// and must leave the page in the state to be screenshotted.
const SURFACES = {
  composer: async (page) => {
    await page
      .getByRole('navigation', { name: 'Surfaces' })
      .getByRole('button', { name: 'Threads' })
      .click();
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

async function main() {
  const surfaceName = process.argv[2] || 'composer';
  const drive = SURFACES[surfaceName];
  if (!drive) {
    console.error(
      `unknown surface "${surfaceName}" — available: ${Object.keys(SURFACES).join(', ')}`
    );
    process.exit(1);
  }

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

      await drive(page);

      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
      const pngPath = path.join(SCREENSHOT_DIR, `${surfaceName}-${iso}.png`);
      await page.screenshot({ path: pngPath });

      await browser.close();

      // FINAL stdout line — the only thing callers should parse.
      console.log(pngPath);
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
