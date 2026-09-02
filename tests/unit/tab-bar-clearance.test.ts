// The tab-bar clearance has exactly one owner.
//
// WHY THIS FILE EXISTS. `AppShell` reserves the tab bar with a bottom padding
// on `#main-content`, Chrome drops that padding once the scroll container's
// content overflows, and every full-bleed screen that hit it wrote its own
// spacer. By the time anyone counted, ONE declaration existed in four files
// under two shapes: a module-local `TabBarClearance` in `watch-screen.tsx`, a
// second one in `calls-screen.tsx`, and a bare div in `deal-flow/page.tsx` and
// in `prepared-record/record-screen.tsx`. A fifth screen, `claim-screen.tsx`,
// shipped with none of it, and at 320 its "Track this call" control sat 39px
// behind the bar on a page that could not scroll.
//
// FOUR IMPLEMENTATIONS OF ONE RULE IS WHY THE FIFTH SCREEN HAD NONE. A reader
// looking for the rule found a private function in someone else's screen and
// wrote their own, or did not find it at all.
//
// WHAT THIS ASSERTS AND WHAT IT DOES NOT. It asserts that the declaration is
// written once, in the shared module. It does NOT assert that every screen
// renders it, and no static file can: both existing call sites sit in
// mutually exclusive branches, so each of those screens writes the element
// twice in source and renders it exactly once. Counting by grep is what
// produced the belief that watch and calls double-render it. The per-route
// count is a RENDERED fact, measured with the `data-tabbar-clearance` attribute
// the component carries for exactly that purpose, and it is reported in the PR
// rather than asserted here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const OWNER = join("src", "components", "mobile", "tab-bar-clearance.tsx");

/* The declaration, as it is written: a HEIGHT set to the clearance expression.
   Whitespace-insensitive around the `+` so a formatter cannot smuggle a copy
   past this, and `(?<!-)` on the property so the token's own name
   (`--mobile-tabbar-height`) is never mistaken for the property being set.

   A `pb-[calc(...)]` class is deliberately NOT this: the shell's reservation
   and this element are different things, and the second test below asserts the
   shell still carries the first one. */
const DECLARATION =
  /(?<!-)\bheight\s*:\s*["'`]?\s*calc\(\s*var\(--mobile-tabbar-height\)\s*\+\s*env\(\s*safe-area-inset-bottom\s*\)\s*\)/;

/* NEAR COPIES THAT ARE NOT THIS DECLARATION, named rather than pattern-matched.
   Both draw something else and folding either into the shared component would
   change what it draws:

     desk-record-screen.tsx  the clearance PLUS 24px of gap under the last row
     dashboard-screen.tsx    a `0px` fallback passed to `env()`

   They are excluded by their expression, not by their path, so the same file
   still fails if it ever writes the bare declaration. */
const NEAR_COPY = /\+\s*env\(safe-area-inset-bottom,|\)\s*\+\s*\d/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

/* One entry per line that writes the declaration, so a failure names the file
   and the line rather than a count. */
function declarationSites(): { file: string; line: number; text: string }[] {
  const sites: { file: string; line: number; text: string }[] = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (!DECLARATION.test(text)) return;
      if (NEAR_COPY.test(text)) return;
      sites.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return sites;
}

test("the clearance declaration is written in exactly one file", () => {
  const sites = declarationSites();
  const files = [...new Set(sites.map((s) => s.file))];
  assert.deepEqual(
    files,
    [OWNER],
    `the clearance is declared in ${files.length} file(s):\n` +
      sites.map((s) => `  ${s.file}:${s.line}  ${s.text}`).join("\n") +
      `\nRender <TabBarClearance /> from ${OWNER} instead of writing it again.`,
  );
});

test("the shell still reserves the bar, and the component is not a substitute for it", () => {
  // The clearance exists BECAUSE the shell's reservation is dropped at the end
  // of an overflowing scroll, not instead of it. A change that deletes the
  // shell's padding would silently move every non-full-bleed route's last line
  // under the bar, and nothing else in the suite would notice.
  const shell = readFileSync(join("src", "components", "shell", "app-shell.tsx"), "utf8");
  assert.match(shell, /pb-\[calc\(var\(--mobile-tabbar-height\)\+env\(safe-area-inset-bottom\)\)\]/);
});

test("the component is countable in a rendered page", () => {
  // `data-tabbar-clearance` is what lets a geometry harness state a per-route
  // count from the DOM. The element has no fill and no ink, so a screen that
  // renders it twice is 59px shorter of content and looks entirely normal.
  const owner = readFileSync(OWNER, "utf8");
  assert.match(owner, /data-tabbar-clearance/);
  assert.match(owner, /aria-hidden="true"/);
});
