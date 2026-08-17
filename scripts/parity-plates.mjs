#!/usr/bin/env node
/**
 * parity-plates.mjs
 *
 * One plate per screen per theme: the design on the left, the build on the
 * right, at 390px each, so the comparison is a single image rather than two
 * tabs and a memory.
 *
 * The design side is the parity harness. Note the width: the harness emits
 * `#v3phone{width:Npx;padding:0 var(--v3-pad)}`, and the prototype's real
 * `#v3phone` carries NO padding, so a harness generated at 390 renders the
 * screen 40px narrower than the design does and every text block wraps early.
 * Generating at 430 and clipping the 20px frame off each edge gives a 390px
 * screen with the prototype's own 350px content column. That is why the
 * regenerate step below passes --width 430.
 *
 *   node scripts/parity-plates.mjs http://localhost:3000
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] || 'http://localhost:3000';
const OUT = 'docs/settings-batch-parity';
const SCREENS = ['settings', 'alerts', 'saved', 'learned', 'share'];
const FRAME = 20;   // the harness's own inset, clipped away
const W = 390;

const ROLE_SEL = 'display:flex;flex-direction:column;padding:13px 14px;border-radius:12px;cursor:pointer;border:1px solid var(--c-gold);background-color:var(--c-well)';
const ROLE_OFF = 'display:flex;flex-direction:column;padding:13px 14px;border-radius:12px;cursor:pointer;border:1px solid var(--c-border);background-color:var(--c-card)';
const CHIP_ON = 'min-height:44px;display:flex;align-items:center;padding:0 13px;border-radius:9px;cursor:pointer;font:500 12px/1 Inter,sans-serif;border:1px solid var(--c-gold);background-color:var(--c-well);color:var(--c-goldink)';
const CHIP_OFF = 'min-height:44px;display:flex;align-items:center;padding:0 13px;border-radius:9px;cursor:pointer;font:500 12px/1 Inter,sans-serif;border:1px solid var(--c-border);background-color:var(--c-card);color:var(--c-secondary)';

const values = { rcA: ROLE_SEL };
for (const k of 'BCDEFG') values[`rc${k}`] = ROLE_OFF;
for (const k of '123456') values[`sc${k}`] = '134'.includes(k) ? CHIP_ON : CHIP_OFF;

/* The Alerts switch styles are built in a reduce over `s.alerts`, which the
 * harness's JS subset does not evaluate, so they resolve blank and the design
 * side would show rows with no switches. The four strings below are the
 * prototype's own, at its own default state (Names off, the rest on). */
const SW = (on) => 'flex:none;box-sizing:content-box;width:46px;height:28px;border-radius:99px;padding:8px 2px;margin:-8px 0;display:flex;align-items:center;cursor:pointer;background-clip:content-box;background-color:'
  + (on ? 'var(--c-gold)' : 'var(--c-locked-bg)') + ';justify-content:' + (on ? 'flex-end' : 'flex-start');
const KN = (on) => 'display:block;width:24px;height:24px;border-radius:50%;background:' + (on ? 'var(--c-ongold)' : 'var(--c-bg)');
const alertValues = {};
for (const [k, on] of [['Brief', true], ['Wrap', true], ['Review', true], ['Window', true], ['Names', false]]) {
  alertValues[`sw${k}`] = SW(on);
  alertValues[`kn${k}`] = KN(on);
}

mkdirSync(OUT, { recursive: true });

for (const screen of SCREENS) {
  const args = ['scripts/parity_harness.py', '--screen', screen, '--out', `.parity-${screen}.html`, '--width', String(W + FRAME * 2)];
  if (screen === 'settings') args.push('--values', JSON.stringify(values));
  if (screen === 'alerts') args.push('--values', JSON.stringify(alertValues));
  execFileSync('python3', args, { stdio: 'ignore' });
}

const browser = await chromium.launch();

for (const screen of SCREENS) {
  for (const theme of ['light', 'dark']) {
    const design = await browser.newPage({ viewport: { width: W + FRAME * 2, height: 900 }, deviceScaleFactor: 2 });
    await design.goto(`file://${process.cwd()}/.parity-${screen}.html`);
    await design.evaluate((t) => {
      const phone = document.getElementById('v3phone');
      phone?.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-theme', t);
      // The harness strips #v3phone's own inline background, and the
      // prototype's dark block is scoped to the element carrying data-theme.
      // So the page ground has to be repainted from the phone's own resolved
      // token, or a dark screen renders light ink on a cream field.
      if (phone) {
        const bg = getComputedStyle(phone).getPropertyValue('--c-bg').trim();
        phone.style.backgroundColor = bg;
        document.body.style.backgroundColor = bg;
      }
    }, theme);
    await design.evaluate(() => {
      // The plate is a still. Scrollers must show their whole content.
      document.querySelectorAll('*').forEach((el) => {
        if (getComputedStyle(el).overflowY === 'auto') el.style.overflowY = 'visible';
      });
      const phone = document.getElementById('v3phone');
      if (phone) phone.style.height = 'auto';
    });
    const h = await design.evaluate(() => document.getElementById('v3phone')?.scrollHeight ?? 900);
    await design.setViewportSize({ width: W + FRAME * 2, height: Math.ceil(h) });
    const designShot = await design.screenshot({ clip: { x: FRAME, y: 0, width: W, height: Math.ceil(h) } });
    await design.close();

    const built = await browser.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2 });
    await built.addInitScript((t) => {
      try { window.localStorage.setItem('signalera_theme', t); } catch { /* first-party only */ }
    }, theme);
    await built.goto(`${base}/preview/settings-batch?screen=${screen}&state=ready`, { waitUntil: 'networkidle' });
    await built.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await built.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.overflowY === 'auto') el.style.overflowY = 'visible';
        if (cs.minHeight === '100dvh' || cs.height.endsWith('vh')) el.style.minHeight = 'auto';
      });
    });
    const bh = await built.evaluate(() => document.body.scrollHeight);
    await built.setViewportSize({ width: W, height: Math.ceil(bh) });
    const builtShot = await built.screenshot({ clip: { x: 0, y: 0, width: W, height: Math.ceil(bh) } });
    await built.close();

    const plate = await browser.newPage({ viewport: { width: W * 2 + 60, height: 400 }, deviceScaleFactor: 1 });
    await plate.setContent(`
      <style>
        body { margin:0; padding:20px; background:${theme === 'dark' ? '#0b0906' : '#efe9dd'};
               font:600 11px/1 Inter, system-ui, sans-serif; color:${theme === 'dark' ? '#c9bda6' : '#6f6248'}; }
        .row { display:flex; gap:20px; align-items:flex-start; }
        figure { margin:0; }
        figcaption { padding:0 0 8px; letter-spacing:0.08em; text-transform:uppercase; }
        img { display:block; width:${W}px; }
      </style>
      <div class="row">
        <figure><figcaption>Design &middot; ${screen} &middot; ${theme}</figcaption>
          <img src="data:image/png;base64,${designShot.toString('base64')}"></figure>
        <figure><figcaption>Built &middot; ${screen} &middot; ${theme}</figcaption>
          <img src="data:image/png;base64,${builtShot.toString('base64')}"></figure>
      </div>`);
    const ph = await plate.evaluate(() => document.body.scrollHeight);
    await plate.setViewportSize({ width: W * 2 + 60, height: Math.ceil(ph) });
    await plate.screenshot({ path: `${OUT}/${screen}-390-${theme}.png` });
    await plate.close();

    console.log(`${OUT}/${screen}-390-${theme}.png`);
  }
}

await browser.close();
