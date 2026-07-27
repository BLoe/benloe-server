import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * End-to-end coverage of the three surfaces: the manager dashboard, the public
 * rating game, and the public lineup page.
 *
 * These run in order against one throwaway database, because the workflow is
 * inherently sequential — you cannot generate a lineup before there is a roster,
 * and you cannot share a link before something is published.
 */

const ROSTER = [
  { name: 'Ana Reyes', gender: 'woman' },
  { name: 'Bex Turner', gender: 'woman' },
  { name: 'Cleo Nakamura', gender: 'woman' },
  { name: 'Dani Okafor', gender: 'woman' },
  { name: 'Edie Marsh', gender: 'nonbinary' },
  { name: 'Frankie Lopez', gender: 'woman' },
  { name: 'Gus Pearson', gender: 'man' },
  { name: 'Hank Ito', gender: 'man' },
  { name: 'Iggy Brandt', gender: 'man' },
  { name: 'Jonah Silva', gender: 'man' },
  { name: 'Kit Alvarez', gender: 'man' },
  { name: 'Levi Osei', gender: 'man' },
  { name: 'Milo Chen', gender: 'man' },
];

test.describe.configure({ mode: 'serial' });

async function openTab(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

/**
 * Opens the rating game as a given player.
 *
 * Each test gets a fresh browser context, so the rater stored in localStorage
 * does not carry over and the picker appears every time. The server-side counts
 * do carry over, which is what the assertions below track.
 */
/** How far the page body scrolls sideways. Anything above 1px is a layout bug. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

async function startGame(page: Page, rater: string) {
  await page.goto('/rate');

  // Wait for the app to settle out of its loading state into one screen or the
  // other before deciding whether the picker needs answering.
  const picker = page.getByRole('heading', { name: "Who's rating?" });
  await expect(picker.or(page.locator('button.card').first())).toBeVisible();

  if (await picker.isVisible()) {
    await page.getByRole('button', { name: rater, exact: true }).click();
  }
  await expect(page.locator('button.card')).toHaveCount(2);
}

test.describe('Dashboard: roster', () => {
  test('starts empty and accepts the whole team', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Roster');

    await expect(page.getByText('No players yet')).toBeVisible();

    for (const player of ROSTER) {
      await page.getByLabel('Name', { exact: true }).first().fill(player.name);
      await page.getByLabel('Counts as').first().selectOption(player.gender);
      await page.getByRole('button', { name: 'Add to roster' }).click();
      await expect(page.getByText(player.name, { exact: true })).toBeVisible();
    }

    await expect(page.getByText(`${ROSTER.length} players`)).toBeVisible();
    // Six of the thirteen count toward the league minimum.
    await expect(page.getByText('You have')).toContainText('6');
  });

  test('records a position opt-out', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Roster');

    const row = page.locator('li').filter({ hasText: 'Milo Chen' }).first();
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'P', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('avoids 1')).toBeVisible();
  });
});

test.describe('Rating game', () => {
  test('asks a question and records the answer', async ({ page }) => {
    await page.goto('/rate');

    await expect(page.getByRole('heading', { name: "Who's rating?" })).toBeVisible();
    await page.getByRole('button', { name: 'Ana Reyes' }).click();

    // The stat prompt is the page heading once the game starts.
    const heading = page.locator('h1.display');
    await expect(heading).toBeVisible();
    const firstPrompt = await heading.textContent();
    expect(firstPrompt?.length).toBeGreaterThan(3);

    // Two distinct players, and the counter starts at zero.
    await expect(page.getByText('0 yours · 0 team')).toBeVisible();

    const cards = page.locator('button.card');
    await expect(cards).toHaveCount(2);
    const firstName = await cards.first().textContent();
    await cards.first().click();

    await expect(page.getByText('1 yours · 1 team')).toBeVisible();
    expect(firstName).toBeTruthy();
  });

  test('accepts a tie and keeps going', async ({ page }) => {
    await startGame(page, 'Ana Reyes');
    // Ana's earlier answer is still on the server.
    await expect(page.getByText('1 yours · 1 team')).toBeVisible();

    await page.getByRole('button', { name: 'Too close to call' }).click();
    await expect(page.getByText('2 yours · 2 team')).toBeVisible();
  });

  test('answers with the keyboard', async ({ page }) => {
    await startGame(page, 'Ana Reyes');

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('3 yours · 3 team')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('4 yours · 4 team')).toBeVisible();
  });

  test('lets you switch who is rating', async ({ page }) => {
    await startGame(page, 'Ana Reyes');

    // The rater's name in the header reopens the picker. Scoped to the header
    // because the same name may also be on one of the matchup cards.
    await page.locator('header').getByRole('button', { name: 'Ana Reyes' }).click();
    await expect(page.getByRole('heading', { name: "Who's rating?" })).toBeVisible();

    await page.getByRole('button', { name: 'Gus Pearson', exact: true }).click();
    // Team total carries over; this rater's own count starts fresh.
    await expect(page.getByText('0 yours · 4 team')).toBeVisible();
  });

  test('feeds the dashboard coverage view', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Ratings');
    await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible();
    await expect(page.getByText('4 total')).toBeVisible();
    await expect(page.getByText('No comparisons yet')).toBeHidden();
  });
});

test.describe('Position fit table', () => {
  /** Player names down the first column, in the order currently displayed. */
  async function columnOrder(page: Page): Promise<string[]> {
    return page.locator('table tbody tr td:first-child').allInnerTexts();
  }

  const fitTable = (page: Page) => page.locator('table').filter({ has: page.getByRole('button', { name: 'Player' }) });

  test('sorts by player name and toggles direction', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Ratings');
    await expect(page.getByRole('heading', { name: 'Position fit' })).toBeVisible();

    const header = fitTable(page).locator('th').first();
    await expect(header).toHaveAttribute('aria-sort', 'none');

    await page.getByRole('button', { name: 'Player' }).click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    const ascending = await columnOrder(page);
    expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b)));

    await page.getByRole('button', { name: 'Player' }).click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(await columnOrder(page)).toEqual([...ascending].reverse());
  });

  test('sorts by a position column, best first', async ({ page, request, baseURL }) => {
    // Position fit is computed from the defensive stats only, and so far the
    // game has recorded nothing but offense. Without this the whole column
    // would be one repeated value and the ordering assertion below would hold
    // no matter how the comparator behaved.
    const roster = (await (await request.get(`${baseURL}/api/public/raters`)).json()).players as {
      id: string;
      name: string;
    }[];
    const idOf = (name: string) => roster.find((p) => p.name === name)!.id;

    for (const [statKey, best] of [
      ['pop_flies', 'Cleo Nakamura'],
      ['infielding', 'Hank Ito'],
    ] as const) {
      const winner = idOf(best);
      for (const other of roster) {
        if (other.id === winner) continue;
        for (let i = 0; i < 3; i++) {
          await request.post(`${baseURL}/api/public/comparison`, {
            data: { statKey, playerA: winner, playerB: other.id, winnerId: winner, raterId: null, passcode: '' },
          });
        }
      }
    }

    await page.goto('/');
    await openTab(page, 'Ratings');
    await expect(page.getByRole('heading', { name: 'Position fit' })).toBeVisible();

    // Shortstop leans on infield fielding (0.35) far more than pop flies
    // (0.15), so the infield specialist seeded above is unambiguously first.
    // Catcher would not do: it weights those two equally, so the two
    // specialists tie there and the name tie-break decides the order.
    const header = fitTable(page).getByRole('columnheader', { name: /^SS/ }).first();
    const button = page.getByRole('button', { name: 'SS', exact: true });
    const values = async () =>
      (await fitTable(page).locator('tbody tr td:nth-child(6)').allInnerTexts()).map(Number);

    await button.click();
    // A position column opens best-first rather than ascending.
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    const descending = await columnOrder(page);
    const descValues = await values();

    expect(descValues).toEqual([...descValues].sort((a, b) => b - a));
    // The column has to actually vary, or the assertion above proves nothing.
    expect(new Set(descValues).size).toBeGreaterThan(1);
    expect(descending[0]).toBe('Hank Ito');

    await button.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(await columnOrder(page)).toEqual([...descending].reverse());
    const ascValues = await values();
    expect(ascValues).toEqual([...ascValues].sort((a, b) => a - b));
    expect(ascValues[ascValues.length - 1]).toBe(Math.max(...ascValues));
  });

  test('column headers read as clickable controls', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Ratings');
    await expect(page.getByRole('heading', { name: 'Position fit' })).toBeVisible();

    const header = page.getByRole('button', { name: 'RF', exact: true });
    // A bare <button> is cursor:default, which makes a sortable header feel
    // like text rather than a control.
    await expect(header).toHaveCSS('cursor', 'pointer');

    const background = () => header.evaluate((el) => getComputedStyle(el).backgroundColor);
    const resting = await background();
    await header.hover();
    await expect.poll(background).not.toBe(resting);
  });

  test('only one column is sorted at a time', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Ratings');
    await expect(page.getByRole('heading', { name: 'Position fit' })).toBeVisible();

    await page.getByRole('button', { name: 'Player' }).click();
    await page.getByRole('button', { name: 'SS', exact: true }).click();

    const sorted = await fitTable(page)
      .locator('th')
      .evaluateAll((cells) => cells.filter((c) => c.getAttribute('aria-sort') !== 'none').length);
    expect(sorted).toBe(1);
  });
});

test.describe('Game workflow', () => {
  test('refuses to generate without enough players', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');

    await page.getByLabel('Date').fill('2026-08-09');
    await page.getByLabel('Opponent').fill('Base Invaders');
    await page.getByRole('button', { name: 'Add game' }).click();

    await expect(page.getByRole('heading', { name: 'Base Invaders' })).toBeVisible();
    // Everyone defaults to available.
    await expect(page.getByText('13 available')).toBeVisible();

    // Knock the roster down below ten and the button should lock.
    for (const name of ['Milo Chen', 'Levi Osei', 'Kit Alvarez', 'Jonah Silva']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await expect(page.getByText('9 available')).toBeVisible();
    await expect(page.getByText('1 more to go')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate lineups' })).toBeDisabled();
  });

  test('generates a full, legal lineup', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();

    // Put everyone back in.
    for (const name of ['Milo Chen', 'Levi Osei', 'Kit Alvarez', 'Jonah Silva']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await expect(page.getByText('13 available')).toBeVisible();

    await page.getByRole('button', { name: 'Generate lineups' }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible({ timeout: 60000 });

    // Everyone kicks.
    const battingRows = page.locator('ol li').filter({ hasText: 'inn' });
    await expect(battingRows).toHaveCount(13);

    // Ten fielders assigned in the first inning, all distinct.
    await expect(page.getByRole('heading', { name: 'Inning 1 assignments' })).toBeVisible();
    const selects = page.locator('select[aria-label*="inning 1"]');
    await expect(selects).toHaveCount(10);
    const assigned = await selects.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLSelectElement).value)
    );
    expect(new Set(assigned).size).toBe(10);

    // Milo opted out of pitching, so he must not be the pitcher in any inning.
    for (let inning = 1; inning <= 6; inning++) {
      if (inning > 1) await page.getByRole('button', { name: `Inning ${inning}` }).click();
      const pitcher = page.locator(`select[aria-label="Pitcher, inning ${inning}"]`);
      await expect(pitcher).toBeVisible();
      expect(await pitcher.locator('option:checked').textContent()).not.toBe('Milo Chen');
    }
  });

  test('refuses to put one player in two places at once', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();

    // Whoever is pitching in inning 1 is already on the field, so putting them
    // at catcher as well has to be rejected.
    const pitcher = await page
      .locator('select[aria-label="Pitcher, inning 1"] option:checked')
      .textContent();
    const catcher = page.locator('select[aria-label="Catcher, inning 1"]');
    await catcher.selectOption({ label: pitcher! });

    await expect(page.getByText(/assigned twice in inning 1/i)).toBeVisible();
    // And the board snaps back rather than storing something unplayable.
    await expect
      .poll(() => page.locator('select[aria-label="Catcher, inning 1"] option:checked').textContent())
      .not.toBe(pitcher);
  });

  test('honours a locked position through a regenerate', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();

    const lockButton = page.getByRole('button', { name: 'Lock Catcher in inning 1' });
    const checkedCatcher = () =>
      page.locator('select[aria-label="Catcher, inning 1"] option:checked').textContent();

    const pinned = await checkedCatcher();
    expect(pinned).toBeTruthy();

    await lockButton.click();
    await expect(lockButton).toHaveText('Locked');

    // Regenerate and wait for the run to actually finish before asserting.
    const generate = page.getByRole('button', { name: 'Generate again' });
    await generate.click();
    await expect(page.getByRole('button', { name: /Working out the lineup/ })).toBeVisible();
    await expect(generate).toBeVisible({ timeout: 60000 });

    await expect(lockButton).toHaveText('Locked');
    expect(await checkedCatcher()).toBe(pinned);
  });

  test('reorders the batting order by hand', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();

    const rows = page.locator('ol li').filter({ hasText: 'inn' });
    const nameAt = (index: number) => rows.nth(index).locator('span.font-medium').innerText();

    const leadoff = await nameAt(0);
    const second = await nameAt(1);
    expect(leadoff).not.toBe(second);

    await rows.nth(1).getByRole('button', { name: `Move ${second} up` }).click();

    await expect.poll(() => nameAt(0)).toBe(second);
    expect(await nameAt(1)).toBe(leadoff);
  });

  test('publishes and produces a share link', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Share link')).toBeVisible();

    const link = page.locator('a[href*="/l/"]').first();
    await expect(link).toBeVisible();
    const url = await link.getAttribute('href');
    expect(url).toMatch(/\/l\/[a-z0-9-]+/);

    await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  });
});

test.describe('Public lineup page', () => {
  async function publishedUrl(page: Page): Promise<string> {
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    const link = page.locator('a[href*="/l/"]').first();
    await expect(link).toBeVisible();
    return (await link.getAttribute('href'))!;
  }

  test('shows the batting order and the defense, with no ratings anywhere', async ({ page }) => {
    const url = await publishedUrl(page);
    await page.goto(url);

    await expect(page.getByRole('heading', { name: /Base Invaders/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();

    // All thirteen kick.
    await expect(page.locator('ol li')).toHaveCount(13);

    // Ten fielders on the diagram.
    await expect(page.locator('svg circle')).toHaveCount(10);

    // The whole-game grid: one row per player, six inning columns.
    await expect(page.getByRole('heading', { name: 'Every inning' })).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(13);

    // Nothing on this page may leak a numeric rating.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(/\brating\b/i);
    expect(body).not.toMatch(/\bconfidence\b/i);
  });

  test('steps through the innings and moves the fielders', async ({ page }) => {
    const url = await publishedUrl(page);
    await page.goto(url);

    await expect(page.getByText('Inning 1 of 6')).toBeVisible();
    const firstInning = await page.locator('svg text').allTextContents();

    await page.getByRole('tab', { name: 'Inning 4' }).click();
    await expect(page.getByText('Inning 4 of 6')).toBeVisible();
    const fourthInning = await page.locator('svg text').allTextContents();

    // Position codes stay put; the names attached to them should change at
    // least somewhere across three innings of substitutions.
    expect(firstInning).not.toEqual(fourthInning);
  });

  test('walks the innings with arrow keys', async ({ page }) => {
    const url = await publishedUrl(page);
    await page.goto(url);
    // The key handler is only bound once the lineup has rendered.
    await expect(page.getByText('Inning 1 of 6')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Inning 2 of 6')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Inning 3 of 6')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Inning 2 of 6')).toBeVisible();
  });

  test('names the striker and the roamer', async ({ page }) => {
    const url = await publishedUrl(page);
    await page.goto(url);
    await expect(page.getByText(/striker/i).first()).toBeVisible();
    await expect(page.getByText(/roamer/i).first()).toBeVisible();
  });

  test('404s on an unknown slug', async ({ page }) => {
    await page.goto('/l/not-a-real-lineup');
    await expect(page.getByRole('heading', { name: 'Lineup not found' })).toBeVisible();
  });

  test('renders on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const url = await publishedUrl(page);
    await page.goto(url);

    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

test.describe('Responsive', () => {
  // Wide content is allowed to scroll inside its own container, but the page
  // body must never scroll sideways on a phone.
  const PHONE = { width: 390, height: 844 };

  test('the dashboard fits a phone on every tab', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    for (const tab of ['Games', 'Roster', 'Ratings', 'Settings']) {
      await openTab(page, tab);
      await expect(page.getByRole('heading').first()).toBeVisible();
      expect(await horizontalOverflow(page), `${tab} tab overflows`).toBeLessThanOrEqual(1);
    }
  });

  test('a generated lineup fits a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await openTab(page, 'Games');
    await page.getByRole('button', { name: /Base Invaders/ }).click();
    await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('the rating game fits a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await startGame(page, 'Ana Reyes');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
