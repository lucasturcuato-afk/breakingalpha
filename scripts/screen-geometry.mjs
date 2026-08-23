#!/usr/bin/env node
/**
 * screen-geometry.mjs
 *
 * Three runtime facts `screen-audit.mjs` cannot state, each of which has
 * already shipped as a defect on this redesign at least once.
 *
 *   node scripts/screen-geometry.mjs watch http://localhost:3110/watch
 *   node scripts/screen-geometry.mjs watch http://localhost:3110/watch \
 *       --proto .parity-proto.html
 *
 * 1. THE CONTENT COLUMN, both sides, at 390.
 *
 *    `parity_harness.py` writes `#v3phone{padding:0 var(--v3-pad)}`. The real
 *    prototype's phone element carries no horizontal padding at all, so a
 *    screen that draws its own gutter has that gutter applied twice on the
 *    design side and measures a 310px text column where the design draws 350.
 *    A build that also doubles its gutter then diffs clean, which is exactly
 *    what a parity gate is supposed to make impossible. Measured on this
 *    branch: `ledger-screen.tsx` applies its gutter at both :43 and :52.
 *
 *    A clean parity number at the harness's default width is therefore not
 *    evidence of anything until these two numbers agree. When they do not,
 *    `--width` on the harness is the knob: at a 20px gutter, `--width 430`
 *    gives the design side a 390px content box and a 350px text column.
 *
 * 2. THE MOBILE LAYOUT IS ABSENT ABOVE THE BREAKPOINT, not merely narrow. The
 *    audit at 1440 reports the desktop chrome's own violations and says
 *    nothing about whether the phone layout is still drawn underneath.
 *
 * 3. THE LAST ELEMENT CLEARS THE TAB BAR. Chrome drops a scroll container's
 *    bottom padding once its content overflows, and the shell puts the tab-bar
 *    clearance exactly there (`app-shell.tsx`, the `pb-[calc(...)]` on
 *    #main-content). Two screens in this wave shipped a control behind the bar.
 *
 * Requires: npx playwright install chromium
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const protoIdx = argv.indexOf('--proto');
let proto = null;
if (protoIdx !== -1) {
  proto = argv[protoIdx + 1];
  /* A bare trailing `--proto` left this undefined, which is falsy, which
     skipped the column check in silence and reported 0 problems. A gate that
     can be switched off by a typo is not a gate. */
  if (!proto || proto.startsWith('--')) {
    console.error('screen-geometry: --proto needs a path');
    process.exit(2);
  }
  argv.splice(protoIdx, 2);
}
const [screen, url] = argv;
if (!screen || !url) {
  console.error('usage: screen-geometry.mjs <parity-flag> <url> [--proto <harness.html>]');
  process.exit(2);
}
const SEL = `[data-parity="${screen}"]`;

/* The text column is the width of the first block the screen lays type in,
 * which is the number the gutter decides. Reading the root instead would
 * report the phone width on both sides and always agree. */
const COLUMN = `(sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const first = root.querySelector('h1, h2, p');
  return {
    root: Math.round(root.getBoundingClientRect().width),
    column: first ? Math.round(first.getBoundingClientRect().width) : null,
    columnFrom: first ? first.tagName.toLowerCase() : null,
  };
}`;

const browser = await chromium.launch();
let failed = 0;

if (proto) {
  if (!existsSync(proto)) {
    console.error(`screen-geometry: harness not found at ${proto}`);
    process.exit(2);
  }
  const dp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  /* Resolved rather than concatenated: an absolute --proto built a
     `file:///cwd//abs/path` that loads nothing. */
  await dp.goto(pathToFileURL(proto).href);
  await dp.waitForTimeout(600);
  const design = await dp.evaluate(new Function('return ' + COLUMN)(), SEL);

  const bp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await bp.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await bp.waitForTimeout(1500);
  const build = await bp.evaluate(new Function('return ' + COLUMN)(), SEL);

  if (!design || !build) {
    console.error(`screen-geometry: ${SEL} matched nothing on one side`);
    process.exit(2);
  }
  console.log('content column at 390');
  console.log(`  design  root ${design.root}px, column ${design.column}px (<${design.columnFrom}>)`);
  console.log(`  build   root ${build.root}px, column ${build.column}px (<${build.columnFrom}>)`);
  if (design.column !== build.column) {
    console.log('  MISMATCH. Every wrap and height on the narrower side is wrong.');
    console.log('  Fix the harness with --width, never the layout.');
    failed++;
  } else {
    console.log('  equal, so any parity mismatch on this screen is real');
  }
  await dp.close();
  await bp.close();
}

const wide = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await wide.goto(url, { waitUntil: 'load', timeout: 60_000 });
await wide.waitForTimeout(1200);
const desktop = await wide.evaluate((sel) => {
  const root = document.querySelector(sel);
  const r = root ? root.getBoundingClientRect() : { width: 0, height: 0 };
  const nav = document.querySelector('nav[aria-label="Primary"]');
  return {
    drawn: r.width > 0 || r.height > 0,
    tabBarDrawn: !!nav && nav.getBoundingClientRect().height > 0,
  };
}, SEL);
console.log('\nat 1440');
console.log(`  mobile layout drawn: ${desktop.drawn}`);
console.log(`  tab bar drawn:       ${desktop.tabBarDrawn}`);
if (desktop.drawn || desktop.tabBarDrawn) failed++;

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(url, { waitUntil: 'load', timeout: 60_000 });
await phone.waitForTimeout(1200);
const tail = await phone.evaluate(async (sel) => {
  const scroller = document.getElementById('main-content') || document.scrollingElement;
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise((r) => setTimeout(r, 400));
  const nav = document.querySelector('nav[aria-label="Primary"]');
  if (!nav) return null;
  const navTop = nav.getBoundingClientRect().top;
  const root = document.querySelector(sel);
  /* Guarded. An unrendered or misspelled parity root used to throw inside the
     page and surface as an opaque Playwright error, which is exactly the run
     where the answer matters. */
  if (!root) return { error: `${sel} matched nothing at 390` };
  const nodes = [...root.querySelectorAll('button, a, p, h1, h2, h3')]
    .filter((el) => el.getBoundingClientRect().height > 0);
  if (nodes.length === 0) return { error: `${sel} drew no content at 390` };
  /* The LOWEST node, not the last in document order. The bar is cleared by
     whatever sits furthest down the page, and source order does not decide
     that once anything is floated, ordered or absolutely placed. */
  const last = nodes.reduce((lo, el) =>
    el.getBoundingClientRect().bottom > lo.getBoundingClientRect().bottom ? el : lo,
  );
  const r = last.getBoundingClientRect();
  return {
    navTop: Math.round(navTop),
    last: last.textContent.trim().slice(0, 40),
    lastBottom: Math.round(r.bottom),
    clears: r.bottom <= navTop,
  };
}, SEL);
console.log('\nscrolled to the end at 390');
if (!tail) {
  console.log('  no tab bar on this route, nothing to clear');
} else if (tail.error) {
  console.log(`  ${tail.error}`);
  failed++;
} else {
  console.log(`  tab bar top ${tail.navTop}px, last element bottom ${tail.lastBottom}px`);
  console.log(`  "${tail.last}"`);
  console.log(`  clears the bar: ${tail.clears}`);
  if (!tail.clears) failed++;
}

await browser.close();
console.log(`\nscreen-geometry: ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
