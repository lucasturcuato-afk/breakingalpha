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
 * --selector scopes both modes to a subtree, so a component can be diffed
 * against just its counterpart instead of against an entire screen:
 *   node scripts/screen-audit.mjs parity ledger URL --selector "[data-parity=ledger-card]"
 * The design and the build rarely carry the same hooks, so --proto-selector
 * overrides the prototype side when the two differ. A selector matching
 * nothing exits 2 rather than diffing an empty subtree clean against anything.
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

/* Injected into the page. Returns both the violation list and the fingerprint.
 * With a selector, everything below is scoped to that subtree, root included,
 * so a component can be diffed against its counterpart rather than against a
 * whole screen. Without one, the whole document, as before. */
const PROBE = `(sel) => {
  const out = { violations: [], fingerprint: [], missing: false };
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

  const root = sel ? document.querySelector(sel) : null;
  if (sel && !root) { out.missing = true; return out; }
  const all = root ? [root, ...root.querySelectorAll('*')] : document.querySelectorAll('*');
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

async function probe(page, url, theme, selector = null) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('signalera-v3-theme', t); } catch (e) {}
  }, theme);
  await page.waitForTimeout(400);
  return page.evaluate(new Function('return ' + PROBE)(), selector);
}

/* Pull `--name value` out of argv and return the value, so the positional
 * arguments keep their positions however the flags are ordered. */
function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`screen-audit: ${name} needs a value`);
    process.exit(2);
  }
  argv.splice(i, 2);
  return value;
}

/* A selector that matches nothing is the one failure mode that would answer
 * confidently and wrongly: an empty subtree diffs clean against anything. */
function assertFound(result, where, selector) {
  if (result.missing) {
    console.error(`screen-audit: --selector ${selector} matched nothing ${where}`);
    process.exit(2);
  }
}

async function run() {
  const argv = process.argv.slice(2);
  /* Scopes both sides. The prototype and the build rarely carry the same
   * hooks, so --proto-selector overrides the design side when they differ. */
  const selector = takeFlag(argv, '--selector');
  /* Override the three phone widths. The mobile layout has to be verified
     ABSENT above the breakpoint as well as correct below it, and a fixed list
     of phone viewports cannot express that. */
  const widthFlag = takeFlag(argv, '--width');
  const protoSelector = takeFlag(argv, '--proto-selector') || selector;
  const [mode, ...rest] = argv;
  const browser = await chromium.launch();
  let failed = 0;

  if (mode === 'audit') {
    const url = rest[0];
    const viewports = widthFlag
      ? widthFlag.split(',').map((w) => ({ name: w.trim(), width: Number(w), height: 900 }))
      : VIEWPORTS;
    for (const vp of viewports) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        const { violations, missing } = await probe(page, url, theme, selector);
        if (selector) assertFound({ missing }, `at ${url}`, selector);
        // Reduced motion: nothing may be hidden rather than merely unanimated.
        const rm = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          reducedMotion: 'reduce',
        });
        const rmRes = await probe(rm, url, theme, selector);
        const hidden = rmRes.fingerprint.length < violations.length * 0 + Math.floor(
          (await probe(page, url, theme, selector)).fingerprint.length * 0.9);
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
    console.log(`\nscreen-audit: ${failed} violations across ${viewports.length} width(s) and 2 themes`);
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
    const proto = await page.evaluate(new Function('return ' + PROBE)(), protoSelector);
    if (protoSelector) assertFound(proto, 'in the prototype', protoSelector);

    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const impl = await probe(page2, url, 'light', selector);
    if (selector) assertFound(impl, `at ${url}`, selector);

    // Diff on the properties the README calls final: type, colour, geometry.
    /* Text alone collides. Within one tab bar the row and its label carry the
     * same text, and the prototype repeats every pole name in its dev strip.
     * Keying on text alone means last-one-wins, which pairs a label against a
     * dev-strip chip and reports a mismatch that is not real. Key on tag, text
     * and ordinal instead, so the nth occurrence on one side meets the nth on
     * the other. */
    const keyer = () => {
      const seen = new Map();
      return (f) => {
        const base = f.tag + '|' + f.text.slice(0, 24);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return base + '#' + n;
      };
    };
    const protoKey = keyer();
    const key = keyer();
    const pMap = new Map(proto.fingerprint.map(f => [protoKey(f), f]));
    /* Key each built element ONCE. The ordinal counter advances on every call,
     * so keying the same element twice would put it in a different bucket the
     * second time. */
    const implKeyed = impl.fingerprint.map(f => ({ f, k: key(f) }));
    const diffs = [];
    for (const { f, k } of implKeyed) {
      const p = pMap.get(k);
      if (!p) continue;
      for (const prop of ['fs', 'fw', 'ff', 'lh', 'ls', 'color', 'bg', 'radius', 'h']) {
        if (String(p[prop]) !== String(f[prop])) {
          diffs.push(`${f.text.slice(0, 24) || f.tag}  ${prop}: design ${p[prop]}, built ${f[prop]}`);
        }
      }
    }
    /* Unmatched is not automatically a defect: a design `div` that production
     * renders as a real `a` or `button` cannot pair, and should not, since
     * comparing a div's inherited context to an anchor's compares unlike
     * things. Name them anyway. A bare count hides whether the gap is one
     * deliberate element swap or half a screen that never got built. */
    const unmatchedList = implKeyed.filter(({ k }) => !pMap.has(k)).map(({ f }) => f);
    const unmatched = unmatchedList.length;

    writeFileSync(`parity-${screen}.json`, JSON.stringify({ proto: proto.fingerprint, impl: impl.fingerprint, diffs }, null, 2));
    for (const d of diffs) console.log('  ' + d);
    if (unmatched) {
      console.log(`\n  unmatched, present in the build with no design counterpart:`);
      for (const f of unmatchedList.slice(0, 12)) {
        console.log(`    <${f.tag}> ${f.h}px  "${f.text.slice(0, 32)}"`);
      }
      if (unmatched > 12) console.log(`    ...and ${unmatched - 12} more`);
    }
    console.log(`\nparity ${screen}: ${diffs.length} property mismatches, ${unmatched} built elements with no design counterpart`);
    console.log(`full fingerprint written to parity-${screen}.json`);
    failed = diffs.length;
  }

  else {
    console.log('usage: screen-audit.mjs audit <url> [--selector <css>] [--width 390,1440]');
    console.log('       screen-audit.mjs parity <screen> <url> [--selector <css>] [--proto-selector <css>]');
    process.exit(2);
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
}

run();
