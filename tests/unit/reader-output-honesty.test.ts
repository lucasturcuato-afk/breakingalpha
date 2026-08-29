/**
 * The house rule, asserted over RENDERED OUTPUT rather than over an authoring
 * file.
 *
 * `design_handoff_signalera_mobile/README.md:316`: "No aggregate accuracy
 * percentage or hit rate anywhere, including seeded content. Counts are
 * permitted; rates are not." Repo-wide, not scoped to a surface.
 *
 * WHY THIS FILE EXISTS. dashboard-honesty.test.ts already owned the right
 * detectors and applied them only to strings authored by src/lib/desk-record.ts
 * and src/lib/your-record.ts. /morning-brief authored its own string inside
 * BriefCallsSection.tsx and was therefore outside the assertion's reach, so
 * `53W · 50L · 41 partial · 37% hit rate across 144 graded calls` rendered to
 * every reader at every width while a test three directories away asserted
 * that call-record.tsx "(59% / 22W 15L) must stay deleted". A rule enforced by
 * authoring file is enforced against the files that already obey it.
 *
 * TWO LEVELS, because neither alone is enough.
 *
 *   1. RENDER. Components are rendered to static markup with react-dom/server
 *      and the detectors run over the HTML. This is the strong half: it sees a
 *      string assembled from parts, which is precisely how `53W · 50L` was
 *      built and precisely what no source scan can see. It is the pattern
 *      src/lib/claim-card.test.ts already established here.
 *
 *   2. SOURCE SCAN. Reader-facing component sources under the directories in
 *      SCANNED_DIRS, comments stripped, checked for banned literals. This is
 *      the backstop for the render half's real weakness: a render test only
 *      covers components somebody remembered to render.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied:
 *   - Any component outside SCANNED_DIRS. /radar/calls, /cross-source and
 *     src/lib/article-signal.tsx all carry live rate figures today and are
 *     owned elsewhere. `npm run design:rates` is the repo-wide net; this file
 *     is the locked contract for the record surfaces.
 *   - Strings assembled at runtime inside a component not rendered below.
 *     Adding a record surface without adding it here buys nothing.
 *   - Server-generated copy: prompt text, emails and the pipeline's own
 *     output are not rendered here.
 *   - The counts themselves. This asserts the vocabulary and the absence of a
 *     rate, never that a number is right.
 *
 * Run: npx tsx --test tests/unit/reader-output-honesty.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WL_SHORTHAND,
  ANY_PERCENT,
  SPORTS_WORDS,
  stripComments,
} from "./honesty-detectors.ts";
import {
  DeskRecordLine,
  type DeskVerdictCounts,
} from "@/components/brief/DeskRecordLine";
import { DESK_RECORD_COPY } from "../../src/lib/desk-record.ts";

// ── level 1: what /morning-brief actually renders ──────────────────────────

/** The live production shape on 2026-08-22, read off the rendered surface. */
const LIVE: DeskVerdictCounts = { correct: 53, wrong: 50, partial: 41, ungradable: 6 };

const SHAPES: [string, DeskVerdictCounts][] = [
  ["live shape", LIVE],
  ["nothing graded", { correct: 0, wrong: 0, partial: 0, ungradable: 0 }],
  ["one supported call", { correct: 1, wrong: 0, partial: 0, ungradable: 0 }],
  ["one challenged call", { correct: 0, wrong: 1, partial: 0, ungradable: 0 }],
  ["only ungraded rows", { correct: 0, wrong: 0, partial: 0, ungradable: 12 }],
  ["a whole number ratio", { correct: 50, wrong: 25, partial: 25, ungradable: 0 }],
];

function markup(record: DeskVerdictCounts): string {
  return renderToStaticMarkup(createElement(DeskRecordLine, { record }));
}

for (const [name, record] of SHAPES) {
  test(`the desk record line carries no rate and no W/L (${name})`, () => {
    const html = markup(record);
    assert.equal(WL_SHORTHAND.test(html), false, `W/L shorthand in: ${html}`);
    assert.equal(ANY_PERCENT.test(html), false, `percentage in: ${html}`);
    assert.equal(SPORTS_WORDS.test(html), false, `sports vocabulary in: ${html}`);
  });
}

test("the desk record line keeps its counts and its provenance", () => {
  const html = markup(LIVE);
  // The counts survive. Removing a figure and leaving a hole is the other
  // failure, and it is not the fix.
  for (const n of ["53", "50", "41", "144"]) {
    assert.ok(html.includes(n), `count ${n} missing from: ${html}`);
  }
  assert.ok(html.includes("graded calls"), "the graded-call count lost its noun");
  assert.ok(
    html.includes("graded by price attribution"),
    "provenance is not a rate and must stay",
  );
});

test("the desk record line reads the shared vocabulary, not a second copy", () => {
  const html = markup(LIVE);
  assert.ok(html.includes(DESK_RECORD_COPY.bucketLabel.supported), "supported label");
  assert.ok(html.includes(DESK_RECORD_COPY.bucketLabel.challenged), "challenged label");
  // partial + clean attribution maps to state `inconclusive` in
  // scored-object-map.ts, which verdict-vocabulary.ts maps to `noCleanRead`.
  assert.ok(html.includes(DESK_RECORD_COPY.bucketLabel.noCleanRead), "no-clean-read label");
});

test("an empty record shows no graded-call count rather than a zero", () => {
  const html = markup({ correct: 0, wrong: 0, partial: 0, ungradable: 0 });
  assert.equal(html.includes("graded calls"), false);
});

// ── level 2: the source backstop ───────────────────────────────────────────

/** The coverage boundary, named. Everything else is design:rates' problem. */
const SCANNED_DIRS = [
  "src/components/brief",
  "src/components/dashboard",
  "src/app/morning-brief",
];

const SCANNED_EXT = new Set([".ts", ".tsx"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (SCANNED_EXT.has(extname(p))) out.push(p);
  }
  return out;
}

test("no reader-facing record surface authors a rate literal", () => {
  const files = SCANNED_DIRS.flatMap((d) => sources(d));
  assert.ok(files.length > 20, `the walk found only ${files.length} files, so it is broken`);

  const hits: string[] = [];
  for (const f of files) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (SPORTS_WORDS.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(hits, [], `rate vocabulary in reader-facing source:\n${hits.join("\n")}`);
});
