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
 * Run against everything, the debt report:
 *   node scripts/design-lint.mjs --all
 * Run as the ratchet, the gate:
 *   node scripts/design-lint.mjs --since origin/main
 *
 * --all reports every violation in src. --since reports a violation only when
 * it lands on a line this branch ADDED. Unchanged lines never fail, however
 * dirty they already are. That is the whole point: the debt is real and large,
 * so the gate has to be about direction, not about the absolute number.
 *
 * Exit 1 on any ERROR. WARN never fails the run but is printed.
 * Exit 2 means the run could not be trusted: a bad ref, or a file in the diff
 * with uncommitted edits. --since refuses rather than answering with a caveat.
 *
 * The allowlist at the bottom is the important part. Every entry is a ruling
 * someone made, not a silent pass. Adding to it should be a visible diff.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

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
  // Stored enum ids, preserved by open-decision ruling 5. The rendered labels
  // became Fund Analyst and Equity Research; the ids stay because role is a
  // TEXT CHECK column and changing them would be a migration plus a backfill
  // for no compliance gain, since an id is never shown to a user.
  // Note this is a line-level exemption: a banned substring elsewhere on a
  // line that also contains one of these ids downgrades to WARN rather than
  // ERROR. It still prints, so it is visible, not silenced.
  { pattern: /\b(buy|sell)_side\b/, why: 'stored enum id, never rendered, ruling 5' },
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
/* Both spellings. `border-radius` in CSS and `borderRadius` in a React inline
   style object are the same declaration, and this rule saw only the first.
   Almost every mobile redesign screen is written in camelCase style objects,
   so a whole programme of PRs reported a clean radius scale that had never
   been checked. Same for the type floor and the fill role below. */
const RADIUS_PX = /(?:border-radius|borderRadius)\s*:\s*([^;{},]+)/gi;
const TW_ROUNDED = /rounded-\[(\d+(?:\.\d+)?)px\]/g;
/* `fontSize: 14` with no unit is px in React, so the unit is optional here.
   Quotes are skipped so `fontSize: "10.5px"` matches too. */
const FONT_SIZE_PX =
  /(?:font-size|fontSize)\s*:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?(?=[,;}\s)]|$)/gim;
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
const INK_AS_FILL = /(background(-color)?|backgroundColor|fill)\s*:\s*[^;{}]*var\(\s*--c-(red|green|amber|gold)ink\s*\)/gi;
const BASE_AS_TEXT = /(^|[;{}\s])color\s*:\s*[^;{}]*var\(\s*--c-(red|green|amber|gold)\s*\)/gi;

/* ------------------------------------------------------------------ */
/* Rule 9. Hardcoded hex where a token exists.                         */
/* The three on-espresso literals are the sanctioned exception.        */
/*                                                                     */
/* Two things this got wrong. `{3,8}` accepted runs of 5 and 7 digits, */
/* which are not colours in any notation, so it matched the leading    */
/* characters of longer identifiers. And a PR reference in a comment   */
/* is a `#` followed by digits, so `#622` read as a three-digit hex    */
/* and failed the branch on a code comment.                            */
/*                                                                     */
/* The digit counts are now the four that exist. The reference case is */
/* excluded on CONTEXT rather than on content: a match is skipped only */
/* when it is all digits AND an issue cue sits immediately before it.  */
/* Requiring a letter a-f instead would have been shorter and wrong,   */
/* because #000, #111, #222, #333, #666 and #999 are all-numeric and   */
/* are exactly the literals people hardcode. Both conditions have to   */
/* hold, so a bare #000 anywhere is still an error and only prose like */
/* "PR #622" or "see #619" goes quiet.                                 */
/* ------------------------------------------------------------------ */
const ON_ESPRESSO = new Set(['#f87171', '#4ade80', '#fbbf24']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const ISSUE_CUE = /\b(?:PRs?|pull|issues?|GH|gh|closes?|fixes?|see|refs?)\s*[#(]?\s*$/i;

/* ------------------------------------------------------------------ */
/* Rule 10. A responsive class defeated by an inline style.            */
/*                                                                     */
/* An inline style attribute beats any class, at every breakpoint. So  */
/* an element carrying both `md:hidden` and style={{display:'flex'}}   */
/* is not responsive at all: the class never applies and the element   */
/* renders at every width. Nothing warns, nothing throws, and the      */
/* wrong layout only shows up on a device.                             */
/*                                                                     */
/* This is structural rather than incidental. The prototype is written */
/* entirely in inline styles and the build is written in Tailwind      */
/* classes, so every screen ported from the handoff walks past this    */
/* trap. It hit the navigation shell twice in one branch, once on      */
/* `display` against md:hidden and once on `paddingBottom` against     */
/* md:pb-0.                                                            */
/*                                                                     */
/* There is no legitimate case, which is why this has no allowlist:    */
/* if the value must be dynamic, drive it with a CSS custom property   */
/* set inline and consume it from a class, or move the whole rule into */
/* classes. Both keep the breakpoint working.                          */
/* ------------------------------------------------------------------ */

/* Tailwind's own breakpoint prefixes, plus the max-* direction. `dark:`
 * and state prefixes like `hover:` are deliberately NOT here: they are
 * defeated by an inline style too, but that is a different bug with a
 * different fix, and widening this rule would bury the layout one. */
const RESPONSIVE_PREFIX = /(?:^|:)(?:max-)?(?:sm|md|lg|xl|2xl):/;

/* Utility to property group. Only the six that actually bite. */
const TW_PROP = [
  [/^(?:hidden|block|inline-block|inline-flex|inline-grid|inline|flex|grid|table|table-[a-z-]+|flow-root|contents|list-item)$/, 'display'],
  [/^-?(?:p|px|py|pt|pr|pb|pl|ps|pe)-/, 'padding'],
  [/^-?(?:m|mx|my|mt|mr|mb|ml|ms|me)-/, 'margin'],
  [/^(?:static|fixed|absolute|relative|sticky)$/, 'position'],
  [/^(?:w|min-w|max-w)-/, 'width'],
  [/^(?:h|min-h|max-h)-/, 'height'],
];

/* React style keys to the same property groups. Longhands count: a
 * responsive `md:pb-0` is defeated by `paddingBottom` just as surely as
 * by `padding`. */
const STYLE_PROP = [
  [/^display$/, 'display'],
  [/^padding(?:Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?$/, 'padding'],
  [/^margin(?:Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?$/, 'margin'],
  [/^position$/, 'position'],
  [/^(?:min|max)?[Ww]idth$/, 'width'],
  [/^(?:min|max)?[Hh]eight$/, 'height'],
];

const propOf = (table, name) => {
  for (const [re, prop] of table) if (re.test(name)) return prop;
  return null;
};

/* Index of the brace matching the one at openIdx, or -1. String aware so
 * a brace inside a quoted value does not shift the depth. */
function matchBrace(text, openIdx) {
  let depth = 0, quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* JSX opening tags, as source slices. Brace and string aware, so a tag
 * holding an object literal or a nested ternary is still one tag. */
function jsxOpeningTags(text) {
  const tags = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '<' || !/[A-Za-z]/.test(text[i + 1] || '')) continue;
    let j = i + 1, depth = 0, quote = null, ok = false;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (quote) {
        if (ch === '\\') { j++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '<' && depth === 0) break;      // not a tag after all
      else if (ch === '>' && depth === 0) { ok = true; break; }
    }
    if (!ok) continue;
    tags.push({ start: i, src: text.slice(i, j + 1) });
    i = j;
  }
  return tags;
}

/* Every string literal inside an attribute value, so cn("a", x && "b")
 * yields both. */
function stringLiterals(src) {
  return (src.match(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g) || [])
    .map(s => s.slice(1, -1));
}

/* Attribute value source for `name`, whether quoted or braced. */
function attrValue(tagSrc, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*`).exec(tagSrc);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (tagSrc[at] === '{') {
    const end = matchBrace(tagSrc, at);
    return end === -1 ? null : { text: tagSrc.slice(at, end + 1), offset: at };
  }
  const q = tagSrc[at];
  if (q !== '"' && q !== "'") return null;
  const end = tagSrc.indexOf(q, at + 1);
  return end === -1 ? null : { text: tagSrc.slice(at, end + 1), offset: at };
}

/* Top-level keys of the style object, with their offset inside the tag.
 * Depth 1 only, so a key of a nested object is not mistaken for a style. */
function styleKeys(styleSrc) {
  const inner = styleSrc.text;
  const open = inner.indexOf('{', 1);
  if (open === -1) return [];
  const close = matchBrace(inner, open);
  if (close === -1) return [];
  const keys = [];
  let depth = 0, quote = null;
  for (let i = open; i <= close; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth !== 1) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(inner.slice(i));
    if (m && !/[\w$]/.test(inner[i - 1] || '')) {
      keys.push({ name: m[1], offset: styleSrc.offset + i });
      i += m[0].length - 1;
    }
  }
  return keys;
}

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
      HEX.lastIndex = 0;
      for (const m of raw.matchAll(HEX)) {
        const h = m[0];
        if (ON_ESPRESSO.has(h.toLowerCase())) continue;
        // An issue reference, not a colour. Both halves are required: all
        // digits, and a cue word immediately before it.
        const allDigits = /^#\d+$/.test(h);
        if (allDigits && ISSUE_CUE.test(raw.slice(0, m.index))) continue;
        add('ERROR', file, n, 'hardcoded-hex', `${h} should be a var()`);
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

  // 10. responsive class defeated by an inline style. JSX only.
  if (/\.(t|j)sx$/.test(file)) {
    for (const tag of jsxOpeningTags(text)) {
      const cls = attrValue(tag.src, 'className');
      const sty = attrValue(tag.src, 'style');
      if (!cls || !sty) continue;

      // Which property groups does a RESPONSIVE class touch here.
      const byProp = new Map();
      for (const literal of stringLiterals(cls.text)) {
        for (const token of literal.split(/\s+/)) {
          if (!token || !RESPONSIVE_PREFIX.test(token)) continue;
          const bare = token.slice(token.lastIndexOf(':') + 1);
          const prop = propOf(TW_PROP, bare);
          if (prop && !byProp.has(prop)) byProp.set(prop, token);
        }
      }
      if (!byProp.size) continue;

      for (const key of styleKeys(sty)) {
        const prop = propOf(STYLE_PROP, key.name);
        if (!prop || !byProp.has(prop)) continue;
        add(
          'ERROR',
          file,
          lineOf(text, tag.start + key.offset),
          'responsive-inline-conflict',
          `inline ${key.name} defeats ${byProp.get(prop)}; the class never applies`,
        );
      }
    }
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

/* A bare invocation used to mean "lint the file list I was given", and an
 * empty file list printed "no files to check" and exited 0. That made
 * `npm run design:lint` a gate that passed without reading a single file,
 * which is the most dangerous shape a gate can take: it is indistinguishable
 * from success in a terminal and in a PR body.
 *
 * No arguments now means the thing every caller actually wanted, which is the
 * ratchet against main. Explicit arguments are still honoured exactly as
 * before, so `--all`, `--since <ref>` and a file list are unchanged. */
const DEFAULT_ARGS = ['--since', 'origin/main'];
const args = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ARGS;
const usedDefault = process.argv.slice(2).length === 0;
const isExcluded = (f) => f.split('/').some(seg => EXCLUDE_DIRS.has(seg));

function git(argv) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...argv], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
}

/* Per-file set of line numbers this branch added, from a zero-context diff.
 * Line numbers are the ones on the NEW side, which is what a finding carries. */
function addedLinesSince(ref) {
  let out;
  try {
    // Three dots: compare against the merge base, so unrelated commits that
    // landed on the ref after the branch started are not counted as ours.
    // --diff-filter=d drops deletions; a removed file has no added lines.
    out = git(['diff', '-U0', '--no-color', '--diff-filter=d', `${ref}...HEAD`]);
  } catch (e) {
    console.error(`design-lint: git diff against ${ref} failed`);
    console.error(String(e.stderr || e.message).trim());
    process.exit(2);
  }

  const added = new Map();
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !added.has(file)) added.set(file, new Set());
      continue;
    }
    if (!file || !line.startsWith('@@')) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    // Absent count means one line. An explicit 0 is a pure deletion hunk,
    // where `start` is the line BEFORE the cut and nothing was added.
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    for (let i = 0; i < count; i++) added.get(file).add(start + i);
  }
  return added;
}

/* The diff numbers lines in HEAD's blob, but lintFile reads the working tree.
 * If a touched file has uncommitted edits the two disagree and the new /
 * pre-existing split silently drifts, which is the one way this gate can lie.
 * A gate that cannot trust its own answer refuses to run. */
function uncommitted(files) {
  if (!files.length) return [];
  try {
    return git(['diff', '--name-only', 'HEAD', '--', ...files]).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const sinceIdx = args.indexOf('--since');
const sinceRef = sinceIdx === -1 ? null : args[sinceIdx + 1];
if (sinceIdx !== -1 && (!sinceRef || sinceRef.startsWith('--'))) {
  console.error('design-lint: --since needs a ref, e.g. --since origin/main');
  process.exit(2);
}

/* Say so, on stderr so it cannot be mistaken for a finding. A reader who
 * pastes this output into a PR body should be able to see which ref the
 * numbers below are measured against without knowing the default. */
if (usedDefault) {
  console.error(`design-lint: no arguments given, defaulting to --since ${sinceRef}`);
}

const addedByFile = sinceRef ? addedLinesSince(sinceRef) : null;

let files;
if (sinceRef) {
  // Refuse before doing any work. Checked across every file in the diff, not
  // just the lintable ones, so the answer is "the tree matches HEAD" rather
  // than "the tree matches HEAD in the places I happened to look".
  const drifted = uncommitted([...addedByFile.keys()]);
  if (drifted.length) {
    console.error(
      `design-lint --since ${sinceRef}: refusing to run. ${drifted.length} file(s) in the ` +
      `diff have uncommitted changes.`);
    console.error(
      'The diff numbers lines in HEAD, this lints the working tree. While they disagree ' +
      'the new / pre-existing split cannot be trusted. Commit or stash, then re-run:');
    for (const d of drifted) console.error(`  ${d}`);
    process.exit(2);
  }
  // Only the touched files, and only ones still on disk and in scope.
  files = [...addedByFile.keys()]
    .filter(f => EXT.has(extname(f)) && !isExcluded(f) && existsSync(f));
} else if (args.includes('--all')) {
  files = walk(SRC);
} else {
  files = args.filter(f => EXT.has(extname(f)) && !isExcluded(f));
}

if (!files.length) {
  /* An empty set in --since mode is a real, honest answer: a branch that
     touches only .md, .sql or .py legitimately has nothing here to lint. That
     stays exit 0.

     An empty set in any other mode is not an answer, it is a question that
     never got asked. Either a file list was passed whose every entry was out
     of scope, or --all walked src/ and found nothing, which means the walk is
     broken. Both used to print a cheerful line and exit 0, so a caller could
     paste "design-lint: no files to check" into a PR body as evidence. */
  if (sinceRef) {
    console.log(`design-lint --since ${sinceRef}: no lintable files touched`);
    process.exit(0);
  }
  console.error('design-lint: refusing to report a pass. No lintable files were checked.');
  if (args.includes('--all')) {
    console.error(`  --all walked ${SRC} and found no file with a lintable extension.`);
    console.error('  That is a broken walk, not a clean tree.');
  } else {
    console.error(`  ${args.length} argument(s) were given and none is a lintable path.`);
    console.error(`  Lintable extensions: ${[...EXT].join(' ')}`);
    console.error(`  Excluded directories: ${[...EXCLUDE_DIRS].join(' ')}`);
  }
  console.error('  To lint this branch against main:  npm run design:lint');
  process.exit(2);
}

for (const f of files) {
  try { lintFile(f); } catch (e) { add('WARN', f, 0, 'unreadable', e.message); }
}

/* In --since mode a finding survives only if it sits on an added line.
 * Line 0 is the file-level slot used for unreadable files, which is not a
 * line anyone can have added and must never be filtered into silence. */
const reported = sinceRef
  ? findings.filter(f => f.line === 0 || addedByFile.get(f.file)?.has(f.line))
  : findings;

const errors = reported.filter(f => f.level === 'ERROR');
const warns = reported.filter(f => f.level === 'WARN');

for (const f of [...errors, ...warns]) {
  console.log(`${f.level}  ${f.file}:${f.line}  [${f.rule}]  ${f.detail}`);
}

if (sinceRef) {
  const preExisting = findings.length - reported.length;
  console.log(`\ndesign-lint --since ${sinceRef}: ${files.length} files touched`);
  console.log(`${reported.length} new, ${preExisting} pre-existing in touched files`);
  console.log(`new: ${errors.length} errors, ${warns.length} warnings`);
} else {
  console.log(`\ndesign-lint: ${files.length} files, ${errors.length} errors, ${warns.length} warnings`);
}

if (warns.length) {
  console.log('Warnings are allowlisted rulings or judgement calls. Read them before merging.');
}
process.exit(errors.length ? 1 : 0);
