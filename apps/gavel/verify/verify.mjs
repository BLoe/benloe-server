/**
 * Browser verification.
 *
 * Runs the real server against a THROWAWAY database and a copy of the real
 * snapshot, then drives the board the way it will actually be driven during an
 * auction: from the keyboard, fast, with no mouse.
 *
 * What it asserts is deliberately not "the page rendered". It asserts that
 * entering a pick changes the numbers that a person would bid against — the
 * team's remaining money, its max bid, the room's inflation — because a board
 * that renders beautifully and prices wrongly is worse than no board.
 *
 * Screenshots are written to .verify/ and are meant to be LOOKED AT. A green
 * exit code here means nothing errored; it does not mean the thing is any good.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const ROOT = new URL('..', import.meta.url).pathname;
const SNAPSHOT = process.env.GAVEL_SNAPSHOT || '/srv/benloe/data/gavel/snapshot-columbus.json';
const OUT = join(ROOT, '.verify');

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

/** Always an ephemeral port: a stray server from an interrupted run holding a
 *  fixed one would let the next run silently test the OLD build. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server never became healthy');
}

async function main() {
  if (!existsSync(SNAPSHOT)) {
    console.error(`No snapshot at ${SNAPSHOT}. Run: npm run snapshot -- <leagueId> columbus`);
    process.exit(1);
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'gavel-verify-'));
  copyFileSync(SNAPSHOT, join(dataDir, 'snapshot-columbus.json'));
  mkdirSync(OUT, { recursive: true });

  const port = await freePort();
  const server = spawn('./node_modules/.bin/tsx', ['src/server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      GAVEL_DATA_DIR: dataDir,
      GAVEL_LEAGUES: 'columbus',
      // The auth bypass, unreachable when NODE_ENV=production.
      GAVEL_TEST_USER: 'below413@gmail.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let browser;
  try {
    const health = await waitForHealth(port);
    console.log(`server up on ${port}; ${health.leagues[0]?.players} players loaded\n`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()}`));
    page.on('response', (r) => {
      if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url()}`);
    });

    // networkidle never fires on a page holding a poll open; use a selector.
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    // `text=` matches rendered text, never a placeholder attribute. Waiting on
    // 'text=Nominate' silently timed out here even though the board was fine.
    await page.getByPlaceholder(/Nominate/).waitFor({ state: 'visible', timeout: 15000 });
    pass('board loaded');

    // ---- the board renders every position column ----
    for (const pos of ['RB', 'WR', 'QB', 'TE', 'DEF']) {
      const count = await page.locator(`text="${pos}"`).count();
      if (count === 0) fail(`no ${pos} column on the board`);
    }
    pass('all five positional columns present');

    // A league with no kicker slot must not show a kicker column.
    if ((await page.getByText('Brandon Aubrey').count()) > 0) {
      fail('a kicker is on the board in a league that starts none');
    } else {
      pass('no kickers on the board');
    }

    await page.screenshot({ path: join(OUT, '01-empty-board.png'), fullPage: false });

    // ---- claim a team, so budget and max bid have a subject ----
    await page.getByRole('button', { name: /East Village All-Stars/ }).first().click();
    await page.waitForTimeout(300);
    const myMax = async () =>
      Number(
        (await page.locator('text=Max bid').locator('..').locator('.fig').first().innerText())
          .replace(/[^0-9]/g, '')
      );
    const before = await myMax();
    if (before !== 185) fail(`opening max bid should be $185 (200 - 15 x $1), got $${before}`);
    else pass('opening max bid holds back a dollar per empty slot ($185)');

    // ---- the hot path: enter a pick entirely from the keyboard ----
    const bar = page.getByPlaceholder(/Nominate/);
    await bar.click();
    await bar.type('gibbs', { delay: 15 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, '02-typeahead.png') });

    await page.keyboard.press('Enter'); // choose the top candidate
    await page.waitForTimeout(150);
    await page.keyboard.type('62', { delay: 15 });
    await page.keyboard.press('Enter'); // move to team
    await page.waitForTimeout(150);
    await page.keyboard.type('East', { delay: 15 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter'); // commit
    await page.waitForTimeout(600);

    if ((await page.getByText('Sold: Jahmyr Gibbs — $62').count()) === 0) {
      fail('keyboard-only entry did not record the pick');
    } else {
      pass('pick entered with keyboard only, no mouse');
    }

    const after = await myMax();
    // $200 - $62 spent = $138 left, 15 slots open, hold back 14 => $124.
    if (after !== 124) fail(`max bid after a $62 buy should be $124, got $${after}`);
    else pass('max bid recomputed correctly after a purchase ($124)');

    // ---- the player is off the board and cannot be double-entered ----
    await bar.click();
    await bar.type('gibbs', { delay: 15 });
    await page.waitForTimeout(250);
    if ((await page.getByText('already sold').count()) === 0) {
      fail('a drafted player is not marked as sold in the typeahead');
    } else {
      pass('drafted player is marked sold rather than silently offered');
    }
    await page.keyboard.press('Escape');

    // ---- inflation responds to the room overspending ----
    const inflationText = async () =>
      (await page.locator('text=Inflation').locator('..').locator('.fig').first().innerText());
    const infBefore = inflationText();

    // Buy four more, all well above the board price, from other teams.
    const overpays = [
      ['bijan', '120', 'Closed'],
      ['nacua', '95', 'Threat'],
      ['chase', '95', 'Super'],
      ['taylor', '90', 'Empire'],
    ];
    for (const [who, price, team] of overpays) {
      await bar.click();
      await bar.type(who, { delay: 10 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      await page.keyboard.type(price, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      await page.keyboard.type(team, { delay: 10 });
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
    }

    const infAfter = await inflationText();
    if (!infAfter.startsWith('-')) {
      fail(`inflation should be negative after the room overspends, showed ${infAfter}`);
    } else {
      pass(`inflation went negative after heavy overpays (${infAfter})`);
    }
    await page.screenshot({ path: join(OUT, '03-mid-draft.png') });

    // ---- undo ----
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    const soldCount = await page.locator('text=/^Sold \\(/').innerText();
    if (!soldCount.includes('(4)')) fail(`undo should leave 4 picks, panel says ${soldCount}`);
    else pass('ctrl+z removes the last pick');

    // ---- reload reproduces the board exactly ----
    const roomBefore = await page.locator('text=Room').locator('..').locator('.fig').first().innerText();
    await page.reload({ waitUntil: 'domcontentloaded' });
    // `text=` matches rendered text, never a placeholder attribute. Waiting on
    // 'text=Nominate' silently timed out here even though the board was fine.
    await page.getByPlaceholder(/Nominate/).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(600);
    const roomAfter = await page.locator('text=Room').locator('..').locator('.fig').first().innerText();
    if (roomBefore !== roomAfter) {
      fail(`reload changed the room total: ${roomBefore} -> ${roomAfter}`);
    } else {
      pass(`reload reproduces the board exactly (${roomAfter} left)`);
    }

    // ---- layout integrity ----
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 1) fail(`page scrolls horizontally by ${overflow}px`);
    else pass('no horizontal overflow at 1600x1000');

    await page.screenshot({ path: join(OUT, '04-after-reload.png') });

    // A second monitor is often a smaller or rotated panel.
    let anyOverflow = false;
    for (const [w, h, name] of [[1280, 800, '05-1280'], [1920, 1080, '06-1920']]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      const o = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (o > 1) {
        fail(`horizontal overflow of ${o}px at ${w}x${h}`);
        anyOverflow = true;
      }
      await page.screenshot({ path: join(OUT, `${name}.png`) });
    }
    if (!anyOverflow) pass('no overflow at 1280x800 or 1920x1080');

    if (consoleErrors.length) fail(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
    else pass('no console errors');
    if (failedRequests.length) fail(`failed requests: ${failedRequests.slice(0, 3).join(' | ')}`);
    else pass('no failed requests');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  console.log(`\nscreenshots in ${OUT}`);
  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
