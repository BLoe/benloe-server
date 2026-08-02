/**
 * Visual + runtime verification.
 *
 * Boots the app against frozen fixtures, walks every route at three viewports,
 * screenshots each one, and fails on any console error or failed request.
 *
 *   node verify/verify.mjs            # all routes, all viewports
 *   node verify/verify.mjs --only=overview
 *   node verify/verify.mjs --view=desktop
 *
 * Fixture mode is what makes this deterministic: the same run always produces
 * the same pixels, so a visual diff means the code changed, not the data.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.verify');
/** Grab a free ephemeral port so repeat runs never collide with a stray server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const LEAGUE = '1180168833027727360'; // dynasty 2025 — a complete season, richest fixture
const PRESEASON = '1312065694577209344'; // dynasty 2026 — schedule published, nothing played

const VIEWS = {
  desktop: { width: 1728, height: 1080 },
  laptop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const ROUTES = [
  { name: 'overview', path: `/l/${LEAGUE}`, waitFor: 'text=Standings' },
  { name: 'matchups', path: `/l/${LEAGUE}/matchups/12`, waitFor: 'text=Full breakdown' },
  { name: 'teams', path: `/l/${LEAGUE}/teams`, waitFor: 'text=FAAB left' },
  { name: 'activity', path: `/l/${LEAGUE}/activity`, waitFor: 'text=League activity' },
  // A league before kickoff renders a different set of states entirely, and live
  // production caught a bug here that the completed-season fixture could not.
  { name: 'preseason', path: `/l/${PRESEASON}`, waitFor: 'text=Not started' },
  { name: 'chat', path: `/l/${LEAGUE}/chat`, waitFor: 'text=Read only' },
  { name: 'activity-trades', path: `/l/${LEAGUE}/activity`, waitFor: 'text=One row per manager' },
  { name: 'matchup-detail', path: `/l/${LEAGUE}/matchups/12/1`, waitFor: 'text=Edge by slot' },
  { name: 'player', path: `/l/${LEAGUE}/players/4984`, waitFor: 'text=Points by week' },
  // The projected season only makes sense on the league that has not played
  // yet, which is also the one with published projections.
  { name: 'projected', path: `/l/${PRESEASON}/projected`, waitFor: 'text=Projected standings' },
  // The preseason league is the one with season-long projections captured, so
  // it is where the depth chart's projection column is actually visible.
  { name: 'preseason-team', path: `/l/${PRESEASON}/teams`, waitFor: 'text=starters ·' },
];

/** The signed-out entry screen, captured before any session exists. */
const SIGNIN_ROUTE = { name: 'signin', path: '/', waitFor: 'text=Sleeper username' };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const routes = args.only ? ROUTES.filter((r) => r.name === args.only) : ROUTES;
const views = args.view ? { [args.view]: VIEWS[args.view] } : VIEWS;

function startServer(PORT) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['tsx', 'src/server/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        SLEEPER_SOURCE: 'fixtures',
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error('server did not start within 30s'));
      }
    }, 30_000);

    proc.stdout.on('data', (d) => {
      const line = d.toString();
      if (line.includes('listening') && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`server exited with code ${code}`));
      }
    });
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const PORT = await freePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  console.log(`starting server (fixtures) on ${PORT}…`);
  const server = await startServer(PORT);

  const problems = [];
  const shots = [];
  let browser;

  try {
    // Prefer the system Chrome already on this box over a Playwright-managed
    // download, so the harness keeps working across playwright version bumps.
    const systemChrome = '/usr/bin/google-chrome';
    const executablePath =
      process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined);

    browser = await chromium.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    });

    for (const [viewName, viewport] of Object.entries(views)) {
      const ctx = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });

      // Capture the signed-out screen first, then sign in through the real form
      // so every later route exercises the same session path a visitor does.
      {
        const page = await ctx.newPage();
        const label = `${SIGNIN_ROUTE.name}@${viewName}`;
        try {
          await page.goto(`${BASE}${SIGNIN_ROUTE.path}`, { waitUntil: 'networkidle', timeout: 30_000 });
          await page.waitForSelector(SIGNIN_ROUTE.waitFor, { timeout: 15_000 });
          await page.evaluate(() => document.fonts.ready);
          const file = join(OUT, `${SIGNIN_ROUTE.name}.${viewName}.png`);
          await page.screenshot({ path: file, fullPage: true });
          shots.push(file);

          await page.fill('#username', 'BenLoe');
          await page.click('button[type=submit]');
          await page.waitForSelector('text=Standings', { timeout: 20_000 });
          console.log(`  ✓ ${label.padEnd(22)} signed in`);
        } catch (err) {
          problems.push(`${label}: ${err.message}`);
          console.log(`  ✗ ${label} — ${err.message}`);
        }
        await page.close();
      }

      for (const route of routes) {
        const page = await ctx.newPage();
        const consoleErrors = [];
        const netErrors = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));
        page.on('requestfailed', (req) => {
          // Avatar images from Sleeper's CDN are expected to fail offline.
          if (req.url().includes('sleepercdn.com')) return;
          netErrors.push(`${req.url()} — ${req.failure()?.errorText}`);
        });
        page.on('response', (res) => {
          if (res.status() >= 400 && res.url().includes('/api/')) {
            netErrors.push(`${res.status()} ${res.url()}`);
          }
        });

        const label = `${route.name}@${viewName}`;
        try {
          await page.goto(`${BASE}${route.path}`, {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });
          if (route.waitFor) {
            await page.waitForSelector(route.waitFor, { timeout: 15_000 });
          }
          // Let webfonts settle so text metrics are stable across runs.
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(250);

          const file = join(OUT, `${route.name}.${viewName}.png`);
          await page.screenshot({ path: file, fullPage: true });
          shots.push(file);

          // Catch layout overflow, the classic dashboard failure.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
          );
          if (overflow > 2) {
            problems.push(`${label}: page scrolls horizontally by ${overflow}px`);
          }

          if (consoleErrors.length) {
            problems.push(`${label}: console errors → ${consoleErrors.slice(0, 3).join(' | ')}`);
          }
          if (netErrors.length) {
            problems.push(`${label}: failed requests → ${netErrors.slice(0, 3).join(' | ')}`);
          }

          console.log(
            `  ${problems.length ? '·' : '✓'} ${label.padEnd(22)} ${viewport.width}×${viewport.height}`
          );
        } catch (err) {
          problems.push(`${label}: ${err.message}`);
          console.log(`  ✗ ${label} — ${err.message}`);
          await page.screenshot({ path: join(OUT, `${route.name}.${viewName}.FAIL.png`) }).catch(() => {});
        }
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    // Always tear the server down, even if the browser never launched.
    if (browser) await browser.close().catch(() => {});
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
  }

  await writeFile(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), problems, shots }, null, 2)
  );

  console.log(`\n${shots.length} screenshots → ${OUT}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('no console errors, no failed requests, no horizontal overflow');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
