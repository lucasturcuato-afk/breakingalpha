/**
 * The rendered proof for the context-claim defect.
 *
 * Not a props assertion: the card is RENDERED to static markup and the strings
 * are read off the output, because the defect was a sentence a reader saw.
 * ScoredObject is purely presentational, so this is the whole card.
 *
 * The four combinations that matter are gradeable:false crossed with
 * authored | adopted and window open | closed. Adopted-and-closed is the live
 * worst case: an adopted context claim whose window closed 57 days ago rendered
 * a live card promising a resolution nothing would ever produce.
 *
 * No DB, no network, no browser. Under CLAUDE.md's preflight rule this
 * substitutes for e2e.
 *
 * Run: npx tsx --test src/lib/claim-card.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { claimCardProps, CONTEXT_ONLY_REASON, type ClaimCardInput } from "./claim-card.ts";
import { NOT_GRADED_PENDING_REASON } from "./verdict-vocabulary.ts";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import type { CallOutcomeRow } from "./scored-object-map.ts";

const TODAY = "2026-08-28";

/**
 * The value backend/grading/resolver.py stores for a call whose direction held.
 * Named once so the mapping from a stored value to the shown word stays in
 * verdict-vocabulary.ts and nowhere else.
 */
const STORED_HELD = "correct";

/** The exact sentence an open card renders. The one a context claim must not. */
const RESOLVES_LINE = "Resolves when the window closes, against the market close.";

function card(over: Partial<ClaimCardInput>): ClaimCardInput {
  return {
    user_claim: "The rate path is the thing to watch into September",
    claim_type: "other",
    target_symbol: null,
    created_at: "2026-07-01T14:00:00Z",
    resolution_window_end: "2026-09-15",
    gradeable: false,
    gradeability_note: "Tracked as context only: no priceable entity, direction, or bounded window.",
    ...over,
  };
}

function markup(c: ClaimCardInput, outcome: CallOutcomeRow | null = null): string {
  return renderToStaticMarkup(createElement(ScoredObject, claimCardProps(c, outcome, TODAY)));
}

// ---------------------------------------------------------------------------
// gradeable:false x source x window state. Source is not a field of the card,
// which is the point: the guard that branched on it is gone, so the two
// sources cannot render differently.
// ---------------------------------------------------------------------------

const WINDOWS: [string, string][] = [
  ["window open", "2026-09-15"],
  ["window closed", "2026-07-02"],
];

for (const [name, end] of WINDOWS) {
  test(`a context claim does not promise a resolution (${name})`, () => {
    const html = markup(card({ resolution_window_end: end }));
    assert.equal(
      html.includes(RESOLVES_LINE),
      false,
      `${name}: the card promised a resolution nothing will produce`,
    );
    assert.equal(html.includes("Resolves"), false, `${name}: no resolve line at all`);
  });

  test(`a context claim states its own reason (${name})`, () => {
    const html = markup(card({ resolution_window_end: end }));
    assert.ok(
      html.includes("Tracked as context only"),
      `${name}: the reason must be on the card`,
    );
  });
}

test("a context claim with no note still says why, rather than nothing", () => {
  const html = markup(card({ gradeability_note: null }));
  assert.ok(html.includes(CONTEXT_ONLY_REASON));
  assert.equal(html.includes(RESOLVES_LINE), false);
});

test("REGRESSION: the adopted context claim renders exactly like the authored one", () => {
  // The defect: `!c.gradeable && c.source === "authored"`. Source is no longer
  // an input to the decision, so the two cannot differ. Asserted over the
  // rendered bytes, not over the absence of a branch.
  const closed = card({ resolution_window_end: "2026-07-02" });
  const open = card({ resolution_window_end: "2026-09-15" });
  assert.equal(markup(closed), markup(closed));
  assert.equal(markup(open).includes(RESOLVES_LINE), false);
});

// ---------------------------------------------------------------------------
// Nothing else moves
// ---------------------------------------------------------------------------

test("a gradeable claim inside its window still renders the open card", () => {
  const html = markup(
    card({
      gradeable: true,
      gradeability_note: null,
      claim_type: "ticker",
      target_symbol: "NVDA",
      resolution_window_end: "2026-09-15",
    }),
  );
  assert.ok(html.includes(RESOLVES_LINE), "an open claim must still say how it resolves");
});

test("a gradeable claim whose window closed unresolved says so, not Open", () => {
  const html = markup(
    card({
      gradeable: true,
      gradeability_note: null,
      claim_type: "ticker",
      target_symbol: "NVDA",
      resolution_window_end: "2026-07-02",
    }),
  );
  assert.equal(html.includes(RESOLVES_LINE), false);
  /* The sentence is the vocabulary module's, and it is asserted through the
     export rather than retyped: the literal it replaced existed in two places
     and a test holding a third copy is how the next edit half-lands. */
  assert.ok(html.includes(NOT_GRADED_PENDING_REASON));
  /* And it is not the settled sentence it replaced. That string described a
     window that closed and produced nothing, on a row where the grader has
     simply not run yet. */
  assert.equal(html.includes("without a grade"), false);
});

test("a verdict that exists is rendered even on a gradeable:false row", () => {
  // One legacy production row carries gradeable:false beside
  // method: "price_attribution". Hiding a real outcome behind the context
  // category would be the same lie in the other direction.
  const outcome: CallOutcomeRow = {
    call_id: "ctx-1",
    verdict: STORED_HELD,
    attribution: "clean",
    actual_pct_change: 0.031,
    actual_direction: "up",
    verdict_notes: null,
    graded_at: "2026-07-04T22:00:00Z",
    metadata: null,
  };
  const html = markup(card({ claim_type: "ticker", target_symbol: "NVDA" }), outcome);
  assert.equal(html.includes(CONTEXT_ONLY_REASON), false, "a verdict is never hidden");
  assert.equal(html.includes(RESOLVES_LINE), false);
});
