#!/usr/bin/env node
/**
 * parity_shot.mjs
 *
 * The side-by-side capture: the design on the left, the build on the right, one
 * image per theme. This is the check that catches what the fingerprint cannot,
 * because a diff of computed style can only compare elements that pair, and an
 * element the build never drew has nothing to pair with. Every gap found by eye
 * on this screen (the ticker strip, the pulse card's corner glow, six missing
 * chevrons, an unfilled continuity card) was invisible to parity and obvious
 * here.
 *
 * Usage, with the harness already written by parity_harness.py:
 *
 *   python3 scripts/parity_harness.py --screen ledger
 *   node scripts/parity_shot.mjs ledger http://localhost:3000/ledger
 *
 * Writes docs/<screen>-parity/<screen>-390-light.png and -dark.png.
 *
 * Requires: npx playwright install chromium
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const PROTOTYPE = process.env.SIG_PROTOTYPE || '.parity-proto.html';
const WIDTH = Number(process.env.SIG_SHOT_WIDTH || 390);
const SCALE = 2;

const [screen, url, selectorArg] = process.argv.slice(2);
if (!screen || !url) {
  console.error('usage: parity_shot.mjs <screen> <url> [selector]');
  process.exit(2);
}
const SELECTOR = selectorArg || `[data-parity="${screen}"]`;
if (!existsSync(PROTOTYPE)) {
  console.error(`parity-shot: harness not found at ${PROTOTYPE}`);
  console.error(`  write it first: python3 scripts/parity_harness.py --screen ${screen}`);
  process.exit(2);
}

/* The design is authored in both themes and the gaps hold in both, so both are
 * captured. The prototype themes off an attribute on any ancestor; the build
 * themes off the documentElement and its own stored key. Set all three rather
 * than guess which side is which.
 *
 * Both sides are captured SCOPED to the screen, the same selector the parity
 * diff scopes to, for two reasons. The design harness carries no app shell, so
 * a full-page capture of the build would put its tab bar and topbar beside a
 * design that has neither and call the difference a gap. And a full-page
 * capture of the build does not work at all: the shell holds the document at
 * viewport height and scrolls an inner element, so `fullPage` returns one
 * screen and silently drops everything below the fold. That failure looks like
 * a screenshot rather than an error, which is the kind that gets published.
 */
const APPLY_THEME = (t) => {
  const dark = t === 'dark';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.classList.toggle('dark', dark);
  const phone = document.getElementById('v3phone');
  if (phone) phone.setAttribute('data-theme', t);
  try {
    localStorage.setItem('signalera-v3-theme', t);
    localStorage.setItem('signalera_theme', t);
  } catch (e) {}
};

async function shoot(page, target, theme, selector) {
  await page.goto(target, { waitUntil: 'load', timeout: 60_000 });
  /* Both mechanisms, then a reload so the build's provider mounts already in
     the theme rather than reading its key and undoing the class. The design
     switches on [data-theme] and the build on html.dark; setting one of the
     two captures the design in dark beside the build in light, which is what
     this produced before it was fixed. */
  await page.evaluate(APPLY_THEME, theme);
  await page.reload({ waitUntil: 'load', timeout: 60_000 });
  await page.evaluate(APPLY_THEME, theme);
  /* Long enough for client effects that mount content, the ticker's first
   * quote among them, so the strip is captured carrying data rather than
   * mid-flight and empty. */
  await page.waitForTimeout(1500);

  /* Grow the VIEWPORT to the screen's own height rather than unpick the scroll
   * container. The shell holds the document at viewport height and scrolls an
   * inner element, so a capture at 900px tall stops at the fold.
   *
   * The obvious alternative, walking up from the target clearing overflow and
   * height, is wrong and quietly so: measured here it took the screen from
   * 390x2529 to 1853x1917, because releasing the scroll container lets an
   * intrinsic width inside the screen (the ticker track is `width: max-content`)
   * push the whole column out. A taller viewport changes no layout the screen
   * depends on, and every width-dependent rule still resolves at 390. */
  const height = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? Math.ceil(el.getBoundingClientRect().height) : 0;
  }, selector);
  if (!height) {
    console.error(`parity-shot: ${selector} matched nothing, or drew no box, at ${target}`);
    process.exit(2);
  }
  await page.setViewportSize({ width: WIDTH, height: Math.min(height + 80, 30_000) });
  await page.waitForTimeout(500);

  /* A marquee never settles on its own. Disabling animation rests every
   * animated rule in its drawn state, which is the frame worth comparing. */
  return page.locator(selector).screenshot({ animations: 'disabled' });
}

const COMPOSE = (left, right, theme) => `
<style>
  body { margin:0; background:${theme === 'dark' ? '#0c0906' : '#fffdf9'};
         font:600 11px/1 -apple-system, system-ui, sans-serif;
         color:${theme === 'dark' ? '#a2937a' : '#786a52'}; }
  .row { display:flex; align-items:flex-start; gap:18px; padding:14px; }
  .col { display:flex; flex-direction:column; gap:7px; }
  img { display:block; width:${WIDTH}px; height:auto;
        outline:1px solid ${theme === 'dark' ? '#3a2c1a' : '#e8e0d2'}; }
  .cap { letter-spacing:0.08em; text-transform:uppercase; }
</style>
<div class="row">
  <div class="col"><span class="cap">design</span><img src="data:image/png;base64,${left}"></div>
  <div class="col"><span class="cap">built</span><img src="data:image/png;base64,${right}"></div>
</div>`;

const browser = await chromium.launch();
const outDir = `docs/${screen}-parity`;
mkdirSync(outDir, { recursive: true });

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: 900 },
    deviceScaleFactor: SCALE,
  });
  const design = await shoot(page, 'file://' + process.cwd() + '/' + PROTOTYPE, theme, SELECTOR);
  const built = await shoot(page, url, theme, SELECTOR);
  await page.close();

  const stage = await browser.newPage({
    viewport: { width: WIDTH * 2 + 50, height: 900 },
    deviceScaleFactor: SCALE,
  });
  await stage.setContent(
    COMPOSE(design.toString('base64'), built.toString('base64'), theme),
    { waitUntil: 'load' },
  );
  const shot = await stage.screenshot({ fullPage: true, animations: 'disabled' });
  const path = `${outDir}/${screen}-${WIDTH}-${theme}.png`;
  writeFileSync(path, shot);
  console.log(`parity-shot: wrote ${path}  (${(shot.length / 1024).toFixed(0)} KB)`);
  await stage.close();
}

await browser.close();
