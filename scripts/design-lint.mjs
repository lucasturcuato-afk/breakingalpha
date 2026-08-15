#!/usr/bin/env node
/**
 * design-lint.mjs
 *
 * Static gate for the Signalera mobile build. Every rule here comes from the
 * design handoff README and is mechanically decidable, so it belongs in a
 * script rather than in a reviewer's attention.
 *
 * Run against changed files:
 *   node scripts/design-lint.mjs $(git diff --name-only origin/main...HEAD)
 * Run against everything:
 *   node scripts/design-lint.mjs --all
 *
 * Exit 1 on any ERROR. WARN never fails the run but is printed.
 *
 * The allowlist at the bottom is the important part. Every entry is a ruling
 * someone made, not a silent pass. Adding to it should be a visible diff.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = 'src';
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.mdx']);

/* Never lint these. The design handoff quotes every banned string it found
 * during design, so linting it is a wall of false hits against the very
 * document that defines the rules. */
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'design_handoff_signalera_mobile']);

/* ------------------------------------------------------------------ */
/* Rule 1. Banned substrings.                                          */
/* README: check as substrings, not words. Every violation found during*/
/* design was inside a longer word. Extends to identifiers and comments*/
/* because a compliance grep over source will hit them.                */
/* ------------------------------------------------------------------ */
const BANNED = ['buy', 'sell', 'hold', 'allocation', 'returns', 'performance'];

/* Substring bans collide with ordinary English and with the platform API.
 * Each exception below is a deliberate ruling. Anything not listed is an
 * error. Keep this list short and argue for every addition. */
const BANNED_ALLOW = [
  // Platform and language surface that cannot be renamed.
  { pattern: /\bReact\.memo\b/, why: 'React API' },
  { pattern: /@returns/, why: 'JSDoc tag, never rendered' },
  // Ordinary words that contain a banned substring and carry no claim.
  { pattern: /\bthreshold(s)?\b/i, why: 'contains hold, no claim about a position' },
  { pattern: /\bhousehold(s)?\b/i, why: 'contains hold' },
  { pattern: /\bstakeholder(s)?\b/i, why: 'contains hold' },
  { pattern: /\bplaceholder(s)?\b/i, why: 'contains hold, DOM attribute' },
  { pattern: /\bwithhold(ing)?\b/i, why: 'contains hold, used in the reportable_min_n pattern' },
];

/* performance.now() is specifically called out in github.md as having been
 * swapped to Date.now(). It is NOT allowlisted. Neither is `holder` on its
 * own, nor `buyer`, nor `shareholder` (github.md logs that one as a real hit). */

/* ------------------------------------------------------------------ */
/* Rule 2. Em-dashes. Anywhere.                                        */
/* ------------------------------------------------------------------ */
const EMDASH = '\u2014';

/* ------------------------------------------------------------------ */
/* Rule 3. Outcome vocabulary.                                         */
/* Exactly supported / challenged / developing / awaiting.             */
/* Flag the forbidden five when they sit next to outcome machinery.    */
/* ------------------------------------------------------------------ */
const OUTCOME_FORBIDDEN = /\b(right|wrong|correct|incorrect|win|won|loss|lost)\b/i;
const OUTCOME_CONTEXT = /(outcome|verdict|status|state|grade|graded|result|resolution|n_correct|n_wrong|badge|pill)/i;

/* ------------------------------------------------------------------ */
/* Rule 4. No aggregate rate.                                          */
/* Counts yes, rates no. Catch the shapes a rate takes in code.        */
/* ------------------------------------------------------------------ */
const RATE_SHAPES = [
  /\baccuracy\b/i,
  /\bhit[_\s-]?rate\b/i,
  /\bwilson\b/i,
  /\*\s*100\s*\)\s*\.toFixed/,          // (x * 100).toFixed(n)
  /\b(pct|percent)(age)?[_A-Za-z]*\s*=/i,
];

/* ------------------------------------------------------------------ */
/* Rule 5. Geometry. Radii 4/6/9/12/14 only. Type floor 10px.          */
/* ------------------------------------------------------------------ */
const RADII_OK = new Set([0, 4, 6, 9, 12, 14]);
const RADIUS_PX = /border-radius\s*:\s*([^;{}]+)/gi;
const TW_ROUNDED = /rounded-\[(\d+(?:\.\d+)?)px\]/g;
const FONT_SIZE_PX = /font-size\s*:\s*(\d+(?:\.\d+)?)px/gi;
const FONT_SHORTHAND = /font\s*:\s*[^;{}]*?(\d+(?:\.\d+)?)px\s*\//gi;
const TW_TEXT_PX = /text-\[(\d+(?:\.\d+)?)px\]/g;

/* ------------------------------------------------------------------ */
/* Rule 6. Forbidden visual treatments.                                */
/* Coloured left borders, frosted glass, surface gradients, all-caps.  */
/* ------------------------------------------------------------------ */
const LEFT_BORDER = /border-left(-width)?\s*:\s*(?!0)(\d*\.?\d+)(px|rem)/gi;
const TW_BORDER_L = /\bborder-l-(\d+)\b/g;
const BACKDROP = /backdrop-filter\s*:|backdrop-blur/gi;
const SURFACE_GRADIENT = /(linear|radial)-gradient\s*\(/gi;
const UPPERCASE = /text-transform\s*:\s*uppercase|\buppercase\b/gi;

/* ------------------------------------------------------------------ */
/* Rule 7. Viewport units. dvh only, never vh.                         */
/* ------------------------------------------------------------------ */
const BARE_VH = /(?<![a-z-])(\d+(?:\.\d+)?)vh\b/gi;

/* ------------------------------------------------------------------ */
/* Rule 8. Token roles.                                                */
/* ink variants are TEXT. base variants are FILLS. Swapping them was   */
/* the single most common defect found during design.                  */
/* ------------------------------------------------------------------ */
const INK_AS_FILL = /(background(-color)?|fill)\s*:\s*[^;{}]*var\(\s*--c-(red|green|amber|gold)ink\s*\)/gi;
const BASE_AS_TEXT = /(^|[;{}\s])color\s*:\s*[^;{}]*var\(\s*--c-(red|green|amber|gold)\s*\)/gi;

/* ------------------------------------------------------------------ */
/* Rule 9. Hardcoded hex where a token exists.                         */
/* The three on-espresso literals are the sanctioned exception.        */
/* ------------------------------------------------------------------ */
const ON_ESPRESSO = new Set(['#f87171', '#4ade80', '#fbbf24']);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/* ------------------------------------------------------------------ */

const findings = [];
function add(level, file, line, rule, detail) {
  findings.push({ level, file, line, rule, detail });
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isAllowlisted(lineText) {
  return BANNED_ALLOW.find(a => a.pattern.test(lineText));
}

function lintFile(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isCss = extname(file) === '.css';
  const isTokens = /tokens(\.reference)?\.css$/.test(file);

  lines.forEach((raw, i) => {
    const n = i + 1;
    const lower = raw.toLowerCase();

    // 1. banned substrings
    for (const word of BANNED) {
      if (lower.includes(word)) {
        const allow = isAllowlisted(raw);
        if (allow) {
          add('WARN', file, n, 'banned-allowlisted', `"${word}" via ${allow.why}`);
        } else {
          add('ERROR', file, n, 'banned-substring', `"${word}" in: ${raw.trim().slice(0, 90)}`);
        }
      }
    }

    // 2. em-dash
    if (raw.includes(EMDASH)) {
      add('ERROR', file, n, 'em-dash', raw.trim().slice(0, 90));
    }

    // 3. outcome vocabulary
    if (OUTCOME_FORBIDDEN.test(raw) && OUTCOME_CONTEXT.test(raw)) {
      add('ERROR', file, n, 'outcome-vocabulary', raw.trim().slice(0, 90));
    }

    // 4. rates
    for (const shape of RATE_SHAPES) {
      if (shape.test(raw)) {
        add('ERROR', file, n, 'aggregate-rate', raw.trim().slice(0, 90));
        break;
      }
    }

    // 6. forbidden treatments
    if (!isTokens) {
      if (/border-left/i.test(raw) && !/border-left\s*:\s*(0|none)/i.test(raw)) {
        add('ERROR', file, n, 'coloured-left-border', raw.trim().slice(0, 90));
      }
      if (TW_BORDER_L.test(raw)) {
        add('ERROR', file, n, 'coloured-left-border', raw.trim().slice(0, 90));
        TW_BORDER_L.lastIndex = 0;
      }
      if (BACKDROP.test(raw)) {
        add('ERROR', file, n, 'frosted-glass', raw.trim().slice(0, 90));
        BACKDROP.lastIndex = 0;
      }
      if (SURFACE_GRADIENT.test(raw)) {
        add('WARN', file, n, 'gradient', 'masthead gradients are sanctioned in px, surfaces are not');
        SURFACE_GRADIENT.lastIndex = 0;
      }
      if (UPPERCASE.test(raw) && !/mono|ledger|eyebrow/i.test(raw)) {
        add('WARN', file, n, 'all-caps', 'capitals survive only in the monospace ledger line');
        UPPERCASE.lastIndex = 0;
      }
    }

    // 7. vh
    let m;
    while ((m = BARE_VH.exec(raw))) {
      add('ERROR', file, n, 'bare-vh', `${m[1]}vh should be ${m[1]}dvh`);
    }
    BARE_VH.lastIndex = 0;

    // 8. token roles
    if (INK_AS_FILL.test(raw)) {
      add('ERROR', file, n, 'token-role', 'ink token used as a fill');
      INK_AS_FILL.lastIndex = 0;
    }
    if (BASE_AS_TEXT.test(raw)) {
      add('ERROR', file, n, 'token-role', 'base token used as text');
      BASE_AS_TEXT.lastIndex = 0;
    }

    // 9. hardcoded hex
    if (!isTokens) {
      const hexes = raw.match(HEX) || [];
      for (const h of hexes) {
        if (!ON_ESPRESSO.has(h.toLowerCase())) {
          add('ERROR', file, n, 'hardcoded-hex', `${h} should be a var()`);
        }
      }
    }
  });

  // 5. geometry, whole-file scans
  let m;
  while ((m = RADIUS_PX.exec(text))) {
    const vals = m[1].match(/(\d+(?:\.\d+)?)px/g) || [];
    for (const v of vals) {
      const px = parseFloat(v);
      if (!RADII_OK.has(px)) {
        add('ERROR', file, lineOf(text, m.index), 'radius-scale', `${px}px not in 4/6/9/12/14`);
      }
    }
  }
  while ((m = TW_ROUNDED.exec(text))) {
    const px = parseFloat(m[1]);
    if (!RADII_OK.has(px)) {
      add('ERROR', file, lineOf(text, m.index), 'radius-scale', `rounded-[${px}px] not in 4/6/9/12/14`);
    }
  }
  for (const re of [FONT_SIZE_PX, FONT_SHORTHAND, TW_TEXT_PX]) {
    while ((m = re.exec(text))) {
      const px = parseFloat(m[1]);
      if (px < 10) {
        add('ERROR', file, lineOf(text, m.index), 'type-floor', `${px}px is below the 10px floor`);
      }
    }
    re.lastIndex = 0;
  }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const isExcluded = (f) => f.split('/').some(seg => EXCLUDE_DIRS.has(seg));
const files = args.includes('--all')
  ? walk(SRC)
  : args.filter(f => EXT.has(extname(f)) && !isExcluded(f));

if (!files.length) {
  console.log('design-lint: no files to check');
  process.exit(0);
}

for (const f of files) {
  try { lintFile(f); } catch (e) { add('WARN', f, 0, 'unreadable', e.message); }
}

const errors = findings.filter(f => f.level === 'ERROR');
const warns = findings.filter(f => f.level === 'WARN');

for (const f of [...errors, ...warns]) {
  console.log(`${f.level}  ${f.file}:${f.line}  [${f.rule}]  ${f.detail}`);
}

console.log(`\ndesign-lint: ${files.length} files, ${errors.length} errors, ${warns.length} warnings`);
if (warns.length) {
  console.log('Warnings are allowlisted rulings or judgement calls. Read them before merging.');
}
process.exit(errors.length ? 1 : 0);
