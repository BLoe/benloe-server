/**
 * Visual + runtime verification.
 *
 * Boots Waker against frozen fixtures, walks every route at three viewports,
 * screenshots each, and exits non-zero on a console error, a failed request, or
 * horizontal page overflow.
 *
 *   node verify/verify.mjs
 *   node verify/verify.mjs --only=tape
 *   node verify/verify.mjs --view=mobile
 *
 * Fixture mode is what makes this worth running: the same code always produces
 * the same pixels, so a changed screenshot means the code changed, not that
 * somebody's snap count updated overnight.
 *
 * Two traps that have cost time on the sibling app and will cost it here:
 *
 *   Both responsive layouts live in the DOM at once, so a bare `text=` selector
 *   can latch onto a hidden copy and wait forever. Wait on text only one layout
 *   carries, or use :visible.
 *
 *   Several pages hold a request open while a market or a simulation resolves.
 *   `waitUntil: 'networkidle'` never fires on those.
 */
import { join } from 'node:path';
import {
  OUT,
  VIEWS,
  ensureOut,
  launchBrowser,
  overflows,
  settle,
  signIn,
  startServer,
  watch,
} from './harness.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
);

/**
 * Every surface, with the text that proves it actually rendered.
 *
 * The `waitFor` is deliberately a phrase unique to the page and present in only
 * one responsive layout — not a nav label, which appears in both the rail and
 * the bottom bar and matches before the page has loaded anything.
 */
const ROUTES = [
  { name: 'now', path: '', waitFor: 'text=What needs you' },
  { name: 'season', path: 'season', waitFor: 'text=/playoff|Playoff/' },
  { name: 'horizon', path: 'horizon', waitFor: 'text=The board' },
  { name: 'tape', path: 'tape', waitFor: 'text=/usage|Usage/' },
  // The tide strip in its in-season shape, which the preseason fixture cannot
  // otherwise reach. The clock and week are pinned, so this is deterministic.
  {
    name: 'now-inseason',
    path: '?now=2025-09-14T15:00:00Z&inSeason=1&week=2',
    waitFor: 'text=lineups lock today',
  },
];

const server = await startServer();
const browser = await launchBrowser();
await ensureOut();

let failures = 0;
let shots = 0;

try {
  for (const [viewName, viewport] of Object.entries(VIEWS)) {
    if (args.view && args.view !== viewName) continue;

    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const seen = watch(page);
    const league = await signIn(page, server.base);

    for (const route of ROUTES) {
      if (args.only && args.only !== route.name) continue;

      const before = { errors: seen.errors.length, failures: seen.failures.length };
      const url = route.path.startsWith('?')
        ? `${server.base}/l/${league}${route.path}`
        : `${server.base}/l/${league}/${route.path}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(route.waitFor, { timeout: 45_000 });
        await settle(page);

        const wide = await overflows(page);
        const newErrors = seen.errors.slice(before.errors);
        const newFailures = seen.failures.slice(before.failures);

        await page.screenshot({
          path: join(OUT, `${route.name}.${viewName}.png`),
          fullPage: true,
        });
        shots++;

        const problems = [
          wide && 'scrolls sideways',
          newErrors.length && `${newErrors.length} console error(s): ${newErrors[0]}`,
          newFailures.length && `${newFailures.length} failed request(s): ${newFailures[0]}`,
        ].filter(Boolean);

        if (problems.length) {
          failures++;
          console.log(`  ✗ ${route.name}@${viewName} — ${problems.join('; ')}`);
        } else {
          console.log(`  ✓ ${route.name.padEnd(14)}@${viewName.padEnd(8)} ${viewport.width}×${viewport.height}`);
        }
      } catch (err) {
        failures++;
        console.log(`  ✗ ${route.name}@${viewName} — ${err.message.split('\n')[0]}`);
        await page
          .screenshot({ path: join(OUT, `${route.name}.${viewName}.FAIL.png`) })
          .catch(() => {});
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.stop();
}

console.log(`\n${shots} screenshots → ${OUT}`);
if (failures) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log('no console errors, no failed requests, no horizontal overflow');
