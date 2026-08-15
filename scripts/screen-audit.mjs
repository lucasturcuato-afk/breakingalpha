#!/usr/bin/env node
/**
 * screen-audit.mjs
 *
 * The static linter cannot see a rendered box. This can.
 *
 * Two modes:
 *
 *   audit   Run the runtime rules against a URL, both themes.
 *             node scripts/screen-audit.mjs audit http://localhost:3000/ledger
 *
 *   parity  Fingerprint the prototype screen and the implemented route, diff.
 *             node scripts/screen-audit.mjs parity ledger http://localhost:3000/ledger
 *
 * Parity is the point. The handoff states every measurement in the README was
 * taken with getComputedStyle / getBoundingClientRect, which means the design
 * ships with machine-readable ground truth. Comparing numbers beats comparing
 * screenshots, and it survives the fact that screenshots come back blank
 * through the Chrome MCP path.
 *
 * Requires: npx playwright install chromium
 */

import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const PROTOTYPE = process.env.SIG_PROTOTYPE
  || 'design_handoff_signalera_mobile/Signalera Mobile v3.dc.html';

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
];

const RADII_OK = [0, 4, 6, 9, 12, 14];

/* Injected into the page. Returns both the violation list and the fingerprint. */
const PROBE = `() => {
  const out = { violations: [], fingerprint: [] };
  const push = (rule, detail, el) => out.violations.push({
    rule, detail,
    at: el ? (el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''))
      : null,
    text: el ? (el.textContent || '').trim().slice(0, 48) : null,
  });

  const lum = (c) => {
    const m = c.match(/[\\d.]+/g);
    if (!m) return null;
    const [r, g, b, a] = m.map(Number);
    if (a !== undefined && a < 1) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const all = document.querySelectorAll('*');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;

    const tag = el.tagName.toLowerCase();
    const interactive = tag === 'button' || tag === 'a' || tag === 'input'
      || tag === 'select' || tag === 'textarea'
      || el.getAttribute('role') === 'button'
      || el.hasAttribute('onclick');

    // A cursor:pointer element with no handler is a defect. README, Accessibility.
    if (cs.cursor === 'pointer' && !interactive && !el.closest('button,a,[role=button]')) {
      push('dead-pointer', 'cursor:pointer with no control', el);
    }

    // 44px minimum, no exceptions. Inline citation anchors are the one
    // sanctioned carve-out and carry data-inline-cite.
    if (interactive && r.height > 0 && r.height < 44 && !el.hasAttribute('data-inline-cite')) {
      push('tap-target', Math.round(r.height) + 'px tall, needs 44', el);
    }

    // A container that already holds a focusable control must not be focusable.
    if (el.hasAttribute('tabindex') && el.querySelector('[tabindex],a[href],button')) {
      push('nested-focus', 'focusable wrapper contains a control', el);
    }

    // Scale floor is 10px. No rendered type below it anywhere.
    const fs = parseFloat(cs.fontSize);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && fs < 10) push('type-floor', fs + 'px', el);

    // Radii 4 / 6 / 9 / 12 / 14 only.
    for (const corner of ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']) {
      const v = parseFloat(cs[corner]);
      if (v && !cs[corner].includes('%') && !${JSON.stringify(RADII_OK)}.includes(v)) {
        push('radius-scale', corner + ' ' + v + 'px', el);
      }
    }

    // Coloured left borders are forbidden. State is a 2px top edge.
    const bl = parseFloat(cs.borderLeftWidth);
    if (bl > 0 && cs.borderLeftStyle !== 'none') {
      const bt = parseFloat(cs.borderTopWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      if (bl > br || (bl >= 3 && bt === 0)) push('left-border', bl + 'px left rule', el);
    }

    // Frosted glass.
    if (cs.backdropFilter && cs.backdropFilter !== 'none') push('frosted-glass', cs.backdropFilter, el);

    // Contrast. Body >= 4.5, large >= 3.
    if (hasText) {
      const cr = ratio(cs.color, bgOf(el));
      const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700);
      const floor = large ? 3 : 4.5;
      if (cr !== null && cr < floor) {
        push('contrast', cr.toFixed(2) + ':1 at ' + fs + 'px, needs ' + floor, el);
      }
    }

    // Fingerprint: the numbers the README says were measured.
    if (hasText || interactive) {
      out.fingerprint.push({
        tag,
        text: (el.textContent || '').trim().slice(0, 40),
        fs: cs.fontSize,
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        lh: cs.lineHeight,
        ls: cs.letterSpacing,
        color: cs.color,
        bg: cs.backgroundColor,
        radius: cs.borderTopLeftRadius,
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }

  // Any element sized in vh rather than dvh will jump when the address bar
  // moves. Catch the authored value, not the resolved pixels.
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules || []) {
      if (rule.cssText && /(?<![a-z-])\\d+(\\.\\d+)?vh\\b/.test(rule.cssText)) {
        out.violations.push({ rule: 'bare-vh', detail: rule.cssText.slice(0, 90), at: null, text: null });
      }
    }
  }
  return out;
}`;

async function probe(page, url, theme) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('signalera-v3-theme', t); } catch (e) {}
  }, theme);
  await page.waitForTimeout(400);
  return page.evaluate(new Function('return ' + PROBE)());
}

async function run() {
  const [mode, ...rest] = process.argv.slice(2);
  const browser = await chromium.launch();
  let failed = 0;

  if (mode === 'audit') {
    const url = rest[0];
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        const { violations } = await probe(page, url, theme);
        // Reduced motion: nothing may be hidden rather than merely unanimated.
        const rm = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          reducedMotion: 'reduce',
        });
        const rmRes = await probe(rm, url, theme);
        const hidden = rmRes.fingerprint.length < violations.length * 0 + Math.floor(
          (await probe(page, url, theme)).fingerprint.length * 0.9);
        if (hidden) violations.push({ rule: 'reduced-motion', detail: 'content missing under prefers-reduced-motion', at: null, text: null });
        await rm.close();

        const uniq = new Map();
        for (const v of violations) uniq.set(v.rule + '|' + v.at + '|' + v.detail, v);
        if (uniq.size) {
          console.log(`\n--- ${vp.name}px ${theme} ---`);
          for (const v of uniq.values()) {
            console.log(`  [${v.rule}] ${v.at || ''} ${v.detail}${v.text ? '  "' + v.text + '"' : ''}`);
          }
          failed += uniq.size;
        }
        await page.close();
      }
    }
    console.log(`\nscreen-audit: ${failed} violations across 3 widths and 2 themes`);
  }

  else if (mode === 'parity') {
    const [screen, url] = rest;
    if (!existsSync(PROTOTYPE)) {
      console.error(`prototype not found at ${PROTOTYPE}; set SIG_PROTOTYPE`);
      process.exit(2);
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    await page.goto('file://' + process.cwd() + '/' + PROTOTYPE);
    await page.waitForTimeout(800);
    // The prototype holds one flat state object with a `screen` key.
    await page.evaluate((s) => {
      const root = document.getElementById('v3phone') || document.body;
      const key = Object.keys(root).find(k => k.startsWith('__react'));
      // Fall back to clicking the dev strip if the instance is not reachable.
      const btn = [...document.querySelectorAll('button,[role=button]')]
        .find(b => (b.textContent || '').trim().toLowerCase() === s.toLowerCase());
      if (btn) btn.click();
    }, screen);
    await page.waitForTimeout(600);
    const proto = await page.evaluate(new Function('return ' + PROBE)());

    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const impl = await probe(page2, url, 'light');

    // Diff on the properties the README calls final: type, colour, geometry.
    const key = (f) => f.text.slice(0, 24);
    const pMap = new Map(proto.fingerprint.map(f => [key(f), f]));
    const diffs = [];
    for (const f of impl.fingerprint) {
      const p = pMap.get(key(f));
      if (!p) continue;
      for (const prop of ['fs', 'fw', 'ff', 'lh', 'ls', 'color', 'bg', 'radius', 'h']) {
        if (String(p[prop]) !== String(f[prop])) {
          diffs.push(`${key(f) || f.tag}  ${prop}: design ${p[prop]}, built ${f[prop]}`);
        }
      }
    }
    const unmatched = impl.fingerprint.filter(f => !pMap.has(key(f))).length;

    writeFileSync(`parity-${screen}.json`, JSON.stringify({ proto: proto.fingerprint, impl: impl.fingerprint, diffs }, null, 2));
    for (const d of diffs) console.log('  ' + d);
    console.log(`\nparity ${screen}: ${diffs.length} property mismatches, ${unmatched} built elements with no design counterpart`);
    console.log(`full fingerprint written to parity-${screen}.json`);
    failed = diffs.length;
  }

  else {
    console.log('usage: screen-audit.mjs audit <url> | screen-audit.mjs parity <screen> <url>');
    process.exit(2);
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
}

run();
