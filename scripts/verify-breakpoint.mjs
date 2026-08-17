#!/usr/bin/env node
/**
 * verify-breakpoint.mjs
 *
 * One question, measured rather than argued: does the mobile layout actually
 * disappear above the breakpoint, and is it actually there below it?
 *
 * `screen-audit audit --width 1440` runs the rules at desktop width, but a
 * subtree that is `display:none` has no boxes, so a screen that leaks to
 * desktop and a screen that is correctly hidden both audit clean. This reads
 * the computed `display` of the `md:hidden` wrapper directly, which is the
 * only fact that settles it.
 *
 *   node scripts/verify-breakpoint.mjs http://localhost:3000/settings/profile [...]
 *
 * Exit 1 if any URL fails either half.
 */

import { chromium } from 'playwright';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: verify-breakpoint.mjs <url> [url...]');
  process.exit(2);
}

const browser = await chromium.launch();
let failed = 0;

for (const url of urls) {
  for (const [label, width] of [['390', 390], ['1440', 1440]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle' });

    const seen = await page.evaluate(() => {
      const mobile = document.querySelector('.md\\:hidden');
      const desktop = document.querySelector('.hidden.md\\:block');
      const read = (el) => (el ? getComputedStyle(el).display : 'ABSENT');
      return { mobile: read(mobile), desktop: read(desktop) };
    });

    const want = width === 1440
      ? { mobile: 'none', desktopNot: 'none' }
      : { mobileNot: 'none', desktop: 'none' };

    const ok = width === 1440
      ? seen.mobile === 'none' && seen.desktop !== 'none' && seen.desktop !== 'ABSENT'
      : seen.mobile !== 'none' && seen.mobile !== 'ABSENT' && seen.desktop === 'none';

    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}px  mobile=${seen.mobile} desktop=${seen.desktop}  ${url}`,
    );
    void want;
    await page.close();
  }
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
