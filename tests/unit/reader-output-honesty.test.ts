/**
 * The house rule, asserted over RENDERED OUTPUT rather than over an authoring
 * file.
 *
 * `design_handoff_signalera_mobile/README.md:316` forbids any aggregate rate
 * figure anywhere, seeded content included, and permits counts. Repo-wide, not
 * scoped to a surface. Read the line there rather than a paraphrase here.
 *
 * WHY THIS FILE EXISTS. dashboard-honesty.test.ts already owned the right
 * detectors and applied them only to strings authored by src/lib/desk-record.ts
 * and src/lib/your-record.ts. /morning-brief authored its own string inside
 * BriefCallsSection.tsx and was therefore outside the assertion's reach, so a
 * summary rate figure and W/L shorthand rendered to every reader at every
 * width while a test three directories away asserted that a component deleted
 * for that exact format stays deleted. A rule enforced by authoring file is
 * enforced against the files that already obey it.
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
 *     Adding a record surface without adding it here gains nothing.
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
  ANY_RATE_FIGURE,
  SPORTS_WORDS,
  stripComments,
} from "./honesty-detectors.ts";
import {
  DeskRecordLine,
  type DeskResolutionCounts,
} from "@/components/brief/DeskRecordLine";
import { DESK_RECORD_COPY } from "../../src/lib/desk-record.ts";

// ── level 1: what /morning-brief actually renders ──────────────────────────

/** Field names are the shared resolution buckets, which is what the
 *  component's prop counts. They used to be the values the grader stores, and
 *  that was the second half of the same defect: a row the grader could not
 *  separate from its sector still carried a directional grade, so this line
 *  filed it under Supported while every other surface filed it under No clean
 *  read. Built here rather than written inline so the vocabulary question
 *  stays in DeskRecordLine, where it is answered. */
function counts(a: number, b: number, c: number, d = 0): DeskResolutionCounts {
  return { supported: a, challenged: b, noCleanRead: c, notGraded: d };
}

/** The live production shape on 2026-08-29, read off the rendered surface at
 *  390x844 once the brief read through fetchDeskRecord. The same four figures
 *  render on /desk-record, which is the point: they are one answer now. */
const LIVE = counts(42, 30, 54, 46);

const SHAPES: [string, DeskResolutionCounts][] = [
  ["live shape", LIVE],
  ["an empty record", counts(0, 0, 0)],
  ["one supported call", counts(1, 0, 0)],
  ["one challenged call", counts(0, 1, 0)],
  ["nothing but not-graded rows", counts(0, 0, 0, 12)],
  ["a whole number ratio", counts(50, 25, 25)],
];

function markup(record: DeskResolutionCounts): string {
  return renderToStaticMarkup(createElement(DeskRecordLine, { record }));
}

for (const [name, record] of SHAPES) {
  test(`the desk record line carries no rate and no W/L (${name})`, () => {
    const html = markup(record);
    assert.equal(WL_SHORTHAND.test(html), false, `W/L shorthand in: ${html}`);
    assert.equal(ANY_RATE_FIGURE.test(html), false, `percentage in: ${html}`);
    assert.equal(SPORTS_WORDS.test(html), false, `sports vocabulary in: ${html}`);
  });
}

test("the desk record line keeps its counts and its provenance", () => {
  const html = markup(LIVE);
  // The counts survive. Removing a figure and leaving a hole is the other
  // failure, and it is not the fix.
  for (const n of ["42", "30", "54", "126"]) {
    assert.ok(html.includes(n), `count ${n} missing from: ${html}`);
  }
  assert.ok(html.includes("graded calls"), "the roll-up count has no noun");
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

test("the roll-up counts the resolved buckets and not the absence", () => {
  const html = markup(LIVE);
  // 42 + 30 + 54. The not-graded rows are an absence, and rolling them into a
  // noun that says `graded` would be the same overstatement in a new place.
  assert.ok(html.includes("126 graded calls"), `roll-up does not match in: ${html}`);
  assert.equal(html.includes("172"), false, "not-graded rows counted as graded");
});

test("an empty record shows no roll-up count rather than a zero", () => {
  const html = markup(counts(0, 0, 0));
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
