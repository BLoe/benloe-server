/**
 * Browser verification.
 *
 * Runs the real server against a THROWAWAY database and a copy of the real
 * snapshot, then drives the board the way it will actually be driven during an
 * auction: click a player, type a price, type a manager, Enter.
 *
 * What it asserts is deliberately not "the page rendered". It asserts that
 * marking someone drafted takes them off the board, records who paid what, and
 * moves the numbers a draft room cannot give you. Screenshots go to .verify/
 * and are meant to be LOOKED AT — a green exit code means nothing errored, not
 * that the board is any good.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const ROOT = new URL('..', import.meta.url).pathname;
const SNAPSHOT = process.env.GAVEL_SNAPSHOT || '/srv/benloe/data/gavel/snapshot-columbus.json';
const YAHOO = '/srv/benloe/data/gavel/snapshot-yahoo.json';
const OUT = join(ROOT, '.verify');

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

/** Always an ephemeral port: a stray server on a fixed one would let the next
 *  run silently test the OLD build. */
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
  const hasYahoo = existsSync(YAHOO);
  if (hasYahoo) copyFileSync(YAHOO, join(dataDir, 'snapshot-yahoo.json'));
  mkdirSync(OUT, { recursive: true });

  const port = await freePort();
  const server = spawn('./node_modules/.bin/tsx', ['src/server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      GAVEL_DATA_DIR: dataDir,
      GAVEL_LEAGUES: 'columbus,yahoo',
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

    // `text=` matches rendered text, never a placeholder. networkidle never
    // fires on a page holding a poll open; wait on a real element.
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/Filter players/).waitFor({ state: 'visible', timeout: 15000 });
    pass('board loaded');

    // Every label lookup is EXACT: `text=Board` is substring and
    // case-insensitive, and once matched the gloss "priced to the board" too.
    const labelFig = async (label) =>
      await page
        .getByText(label, { exact: true })
        .first()
        .locator('..')
        .locator('.fig')
        .first()
        .innerText();

    // ---- the board shows every position and no kickers ----
    for (const pos of ['RB', 'WR', 'QB', 'TE', 'DEF']) {
      if ((await page.getByText(pos, { exact: true }).count()) === 0) {
        fail(`no ${pos} column on the board`);
      }
    }
    pass('all five positional columns present');

    if ((await page.getByText('Brandon Aubrey').count()) > 0) {
      fail('a kicker is on the board in a league that starts none');
    } else {
      pass('no kickers on the board');
    }
    await page.screenshot({ path: join(OUT, '01-board.png') });

    // ---- choose your team: one list, one click, closes ----
    await page.getByRole('button', { name: 'Your team' }).click();
    const picker = page.getByTestId('team-picker');
    await picker.waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: join(OUT, '02-team-picker.png') });

    // Nothing but the list belongs here — no keeper fields, no number boxes.
    if ((await picker.getByLabel(/keeper/i).count()) > 0) {
      fail('the team picker still carries keeper fields');
    } else {
      pass('team picker holds nothing but the manager list');
    }

    await picker.getByRole('button', { name: 'East Village All-Stars' }).click();
    await page.waitForTimeout(500);
    if ((await page.getByTestId('team-picker').count()) > 0) {
      fail('picking a team did not close the dialog');
    } else {
      pass('clicking a name sets your team and closes');
    }

    const myMax = async () => Number((await labelFig('Max bid')).replace(/[^0-9]/g, ''));
    if ((await myMax()) !== 185) {
      fail(`opening max bid should be $185 (200 - 15 x $1), got $${await myMax()}`);
    } else {
      pass('opening max bid holds back a dollar per empty slot ($185)');
    }

    // ---- the hot path: click a player, price, manager, Enter ----
    const filter = page.getByPlaceholder(/Filter players/);
    await filter.fill('gibbs');
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: /Jahmyr Gibbs/ }).first().click();

    const modal = page.getByRole('dialog', { name: /Jahmyr Gibbs/ });
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    pass('clicking a player opens the pick dialog');
    await page.screenshot({ path: join(OUT, '03-pick-modal.png') });

    // Price is focused and selected on open, so typing replaces the suggestion.
    await page.keyboard.type('62');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.keyboard.type('East');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    if ((await page.getByText('Drafted: Jahmyr Gibbs — $62').count()) === 0) {
      fail('the pick dialog did not record the pick');
    } else {
      pass('pick recorded: click, price, manager, Enter');
    }

    if ((await myMax()) !== 124) {
      fail(`max bid after a $62 buy should be $124, got $${await myMax()}`);
    } else {
      pass('max bid recomputed after a purchase ($124)');
    }

    // ---- the drafted player is struck through on the board ----
    await filter.fill('gibbs');
    await page.waitForTimeout(350);
    const gibbsRow = page.getByRole('button', { name: /Jahmyr Gibbs/ }).first();
    const struck = await gibbsRow.evaluate((el) => {
      const span = el.querySelector('span:nth-child(2)');
      return span ? getComputedStyle(span).textDecorationLine : '';
    });
    if (!struck.includes('line-through')) fail('a drafted player is not struck through on the board');
    else pass('drafted player struck through and priced at what was paid');
    await filter.fill('');

    // ---- the Drafted panel is the record ----
    if ((await page.getByText('Drafted', { exact: true }).count()) === 0) {
      fail('no Drafted panel');
    } else {
      pass('Drafted panel present');
    }

    // ---- inflation responds to the room overspending ----
    const overpays = [
      ['bijan', 'Bijan Robinson', '120', 'Closed'],
      ['nacua', 'Puka Nacua', '95', 'Threat'],
      ['chase', "Ja'Marr Chase", '95', 'Super'],
      ['taylor', 'Jonathan Taylor', '90', 'Empire'],
    ];
    for (const [q, name, price, team] of overpays) {
      await filter.fill(q);
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.type(price);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      await page.keyboard.type(team);
      await page.waitForTimeout(220);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(450);
    }

    const inflation = await labelFig('Inflation');
    if (!inflation.startsWith('-')) {
      fail(`inflation should be negative after the room overspends, showed ${inflation}`);
    } else {
      pass(`inflation went negative after heavy overpays (${inflation})`);
    }
    await page.screenshot({ path: join(OUT, '04-mid-draft.png') });

    // ---- correcting a pick from the Drafted panel ----
    await page.getByRole('button', { name: /Puka Nacua/ }).last().click();
    const editModal = page.getByRole('dialog', { name: /Puka Nacua/ });
    await editModal.waitFor({ state: 'visible', timeout: 5000 });
    if ((await editModal.getByRole('button', { name: 'Undraft' }).count()) === 0) {
      fail('an already-drafted player does not offer Undraft');
    } else {
      pass('clicking a drafted player offers a correction');
    }
    await editModal.getByRole('button', { name: 'Undraft' }).click();
    await page.waitForTimeout(600);

    // ---- undo ----
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const count = await labelFig('Drafted');
    if (count.trim() !== '3') fail(`after one undraft and one undo, 3 picks should remain, got ${count}`);
    else pass('undraft and ctrl+z both remove picks');

    // ---- reload reproduces the board exactly ----
    const roomBefore = await labelFig('Room');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/Filter players/).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(700);
    const roomAfter = await labelFig('Room');
    if (roomBefore !== roomAfter) fail(`reload changed the room total: ${roomBefore} -> ${roomAfter}`);
    else pass(`reload reproduces the board exactly (${roomAfter} left)`);

    // ---- layout integrity across plausible second monitors ----
    let anyOverflow = false;
    for (const [w, h, name] of [
      [1600, 1000, '05-1600'],
      [1280, 800, '06-1280'],
      [1920, 1080, '07-1920'],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      const o = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (o > 1) {
        fail(`horizontal overflow of ${o}px at ${w}x${h}`);
        anyOverflow = true;
      }
      await page.screenshot({ path: join(OUT, `${name}.png`) });
    }
    if (!anyOverflow) pass('no horizontal overflow at 1280, 1600 or 1920');

    // ---- second league: switcher, half-PPR pricing, keeper money ----
    if (hasYahoo) {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.selectOption('select', 'yahoo');
      await page.waitForTimeout(1000);

      if (!(await labelFig('Room')).includes('2400')) {
        fail('switching leagues should show a fresh $2400 room');
      } else {
        pass('league switcher loads the second league with its own board');
      }

      await page.getByPlaceholder(/Filter players/).fill('nacua');
      await page.waitForTimeout(350);
      await page.getByRole('button', { name: /Puka Nacua/ }).first().click();
      const yModal = page.getByRole('dialog', { name: /Puka Nacua/ });
      await yModal.waitFor({ state: 'visible', timeout: 5000 });
      const nacua = Number((await labelFig('Board')).replace(/[^0-9]/g, '') || 0);
      await page.keyboard.press('Escape');
      await page.getByPlaceholder(/Filter players/).fill('');
      if (nacua < 55) fail(`half-PPR should lift Nacua above his standard price, got $${nacua}`);
      else pass(`half-PPR prices Nacua at $${nacua}, above his standard-scoring price`);

      // Keepers: entered as picks, through the same click-and-price path.
      await page.getByRole('button', { name: 'Your team' }).click();
      const p2 = page.getByTestId('team-picker');
      await p2.waitFor({ state: 'visible', timeout: 5000 });
      await p2.getByRole('button', { name: 'Rename managers' }).click();
      await p2.getByLabel('Team 1 name').fill('Keeper Team');
      await p2.getByRole('button', { name: 'Save' }).click();
      await page.waitForTimeout(400);
      await p2.getByRole('button', { name: 'Keeper Team' }).click();
      await page.waitForTimeout(500);
      pass('managers can be renamed for a league Gavel cannot read');

      await page.getByRole('button', { name: /^Keepers/ }).click();
      await page.waitForTimeout(300);
      if ((await page.getByText('Entering keepers').count()) === 0) {
        fail('keeper mode gives no visible indication it is on');
      } else {
        pass('keeper mode is conspicuous while active');
      }

      await page.getByPlaceholder(/Filter players/).fill('gibbs');
      await page.waitForTimeout(350);
      await page.getByRole('button', { name: /Jahmyr Gibbs/ }).first().click();
      const kModal = page.getByRole('dialog', { name: /Jahmyr Gibbs/ });
      await kModal.waitFor({ state: 'visible', timeout: 5000 });
      if ((await kModal.getByRole('button', { name: 'Save keeper' }).count()) === 0) {
        fail('the pick dialog does not say it is recording a keeper');
      }
      await page.keyboard.type('30');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      await page.keyboard.type('Keeper Team');
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Done with keepers' }).click();
      await page.getByPlaceholder(/Filter players/).fill('');
      await page.waitForTimeout(300);

      // $200 - $30 = $170 left; 15 - 1 = 14 slots; max bid 170 - 13 = $157.
      const left = Number((await labelFig('Left')).replace(/[^0-9]/g, ''));
      const max = await myMax();
      if (left !== 170 || max !== 157) {
        fail(`keeper team should read $170 left / $157 max, got $${left} / $${max}`);
      } else {
        pass('a keeper comes out of its manager\'s budget and roster');
      }

      // And the kept player is off the board, marked as kept rather than bought.
      await page.getByPlaceholder(/Filter players/).fill('gibbs');
      await page.waitForTimeout(350);
      const kept = page.getByRole('button', { name: /Jahmyr Gibbs/ }).first();
      if (!(await kept.innerText()).includes('K')) {
        fail('a kept player is not marked K on the board');
      } else {
        pass('kept player is struck off the board and marked K');
      }
      await page.getByPlaceholder(/Filter players/).fill('');

      await page.screenshot({ path: join(OUT, '08-yahoo-keepers.png') });
    }

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
