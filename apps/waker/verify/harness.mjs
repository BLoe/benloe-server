/**
 * Shared machinery for every verification script.
 *
 * All four harnesses need the same three things — a free port, a fixture-mode
 * server, and a signed-in browser — and getting any of them subtly wrong is how
 * a harness ends up passing against the wrong data. They live here once.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, '.verify');

/**
 * A free ephemeral port.
 *
 * Not a fixed one: a stray server from an interrupted run holds a fixed port
 * and the next run then silently tests the OLD build, which is the worst
 * possible failure mode for a verification harness.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Boot the app against frozen fixtures. Returns { base, stop }. */
export async function startServer() {
  const port = await freePort();
  const proc = spawn('npx', ['tsx', 'src/server/index.ts'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      WAKER_SOURCE: 'fixtures',
      NODE_ENV: 'production',
      // A scratch cache: the harness must never read or write the production
      // one, or a screenshot could come from live data captured hours ago.
      WAKER_CACHE_DIR: join(OUT, 'cache'),
    },
  });

  let log = '';
  proc.stdout.on('data', (d) => (log += d.toString()));
  proc.stderr.on('data', (d) => (log += d.toString()));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server did not start in 40s:\n${log}`)),
      40_000
    );
    const check = setInterval(() => {
      if (log.includes('listening')) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  return {
    base: `http://127.0.0.1:${port}`,
    // Kill the whole process group: tsx spawns a child, and killing only the
    // parent leaves the real server holding the port.
    stop: () => {
      try {
        process.kill(-proc.pid);
      } catch {
        /* already gone */
      }
    },
  };
}

export async function launchBrowser() {
  return chromium.launch({
    // The bundled chromium and the installed playwright disagree about
    // versions on this box; the system Chrome is the one that actually runs.
    executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
    args: ['--no-sandbox'],
  });
}

/**
 * Sign in and land on the dynasty league.
 *
 * `waitUntil: 'domcontentloaded'`, never `networkidle`: several Waker pages
 * hold a request open while a market or a simulation resolves, and networkidle
 * simply never fires on them.
 */
export async function signIn(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  if (await page.$('#username')) {
    await page.fill('#username', 'BenLoe');
    await page.click('button[type=submit]');
  }
  await page.waitForSelector('nav[aria-label="Horizons"]', { timeout: 30_000 });
  // The app redirects to its preferred league; read where it landed rather
  // than hard-coding an id that a fixture recapture would invalidate.
  return page.evaluate(() => location.pathname.split('/')[2]);
}

/**
 * Watch a page for the things that should fail a run.
 *
 * Returns a live object; read it after the navigation. Requests to third-party
 * hosts are ignored — fixture mode should not make any, but a stray favicon or
 * font retry is not a reason to fail a visual check.
 */
export function watch(page) {
  const errors = [];
  const failures = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('http://127.0.0.1')) failures.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith('http://127.0.0.1') && r.status() >= 400) {
      failures.push(`${r.status()} ${r.url()}`);
    }
  });
  return { errors, failures };
}

/** Does the page scroll sideways? On any viewport that is a layout bug. */
export async function overflows(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
}

export async function ensureOut() {
  await mkdir(OUT, { recursive: true });
}

/** Wait for fonts and for the layout to settle before a screenshot. */
export async function settle(page, ms = 500) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

export const VIEWS = {
  desktop: { width: 1728, height: 1080 },
  laptop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
