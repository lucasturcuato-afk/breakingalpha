/**
 * Tests for the provenance a commitment event carries.
 *
 * The load-bearing property is that the LINK BACK TO THE CLAIM survives every
 * way the ambient context can fail. #519's version resolved the call's identity
 * by querying the DOM, and it returned null on every row ever written. So each
 * test here degrades the ambient block a different way and asserts the source
 * id is still there.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/lib/call-track-provenance.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildTrackProvenance } from "./call-track-provenance";

/** A fully instrumented brief page: context open, a story recently in view. */
function ambientFromBrief(): Record<string, unknown> {
  return {
    attn_surface_id: "f6e2a674-643a-4afa-a824-f538a883681b",
    attn_surface_type: "briefing",
    attn_entry_point: "deep_link",
    briefing_id: "f6e2a674-643a-4afa-a824-f538a883681b",
    seconds_since_surface_open: 79.5,
    preceding_story_id: "story-11",
    preceding_story_rank: 2,
    seconds_since_story_in_view: 9.3,
  };
}

// ---------------------------------------------------------------------------

test("a track emitted from the brief carries briefing id, source story id and both timings", () => {
  const p = buildTrackProvenance({
    callId: "14a6b9d9-7d02-4302-8906-0045b6b8aad7",
    briefingId: "f6e2a674-643a-4afa-a824-f538a883681b",
    horizon: "session",
    offeredHorizon: "session",
    readAmbient: ambientFromBrief,
    secondsSinceSourceInView: 4.1,
  });

  assert.equal(p.briefing_id, "f6e2a674-643a-4afa-a824-f538a883681b");
  assert.equal(p.preceding_story_id, "story-11");
  assert.equal(p.preceding_story_rank, 2);
  // Both timings: since the surface opened, and since that story entered view.
  assert.equal(p.seconds_since_surface_open, 79.5);
  assert.equal(p.seconds_since_story_in_view, 9.3);
  // And the claim itself, which is what the whole chain hangs off.
  assert.equal(p.source_object_type, "brief_call");
  assert.equal(p.source_object_id, "14a6b9d9-7d02-4302-8906-0045b6b8aad7");
  assert.equal(p.seconds_since_source_in_view, 4.1);
});

test("a track on an already-scored card still carries identity, not null", () => {
  // An already-tracked card renders no track control, so #519's resolver had
  // nothing to read and the row landed with a null id. Identity is a prop now,
  // so the state of the card cannot reach it.
  const p = buildTrackProvenance({
    callId: "01bcaa24-3abc-4e48-977a-f12b3791122a",
    briefingId: "f6e2a674-643a-4afa-a824-f538a883681b",
    horizon: "week",
    offeredHorizon: "week",
    readAmbient: ambientFromBrief,
    // Never observed entering view: the card was above the fold on load.
    secondsSinceSourceInView: null,
  });

  assert.equal(p.source_object_id, "01bcaa24-3abc-4e48-977a-f12b3791122a");
  assert.notEqual(p.source_object_id, null);
  assert.equal(p.briefing_id, "f6e2a674-643a-4afa-a824-f538a883681b");
  // An unobserved card reports null rather than a fabricated zero.
  assert.equal(p.seconds_since_source_in_view, null);
});

test("provenance resolution failing does not prevent the event from being emitted", () => {
  const throwing = () => {
    throw new Error("attention context blew up");
  };

  // A throwing reader must not propagate to the caller, which is the line that
  // emits the event.
  assert.doesNotThrow(() =>
    buildTrackProvenance({
      callId: "call-9",
      horizon: "three_week",
      readAmbient: throwing,
    }),
  );

  const block = buildTrackProvenance({
    callId: "call-9",
    briefingId: "brief-3",
    horizon: "three_week",
    offeredHorizon: "week",
    readAmbient: throwing,
  });

  // Partial, and still worth having: the claim link and the horizon fact.
  assert.equal(block.source_object_id, "call-9");
  assert.equal(block.briefing_id, "brief-3");
  assert.equal(block.horizon_offered, "week");
  assert.equal(block.horizon_changed, true);
  // Nothing invented in place of the ambient keys.
  assert.equal("preceding_story_id" in block, false);
  assert.equal("seconds_since_surface_open" in block, false);
});

test("no attention context at all still yields the claim link", () => {
  // The evening wrap renders the same section and opens no context.
  const block = buildTrackProvenance({
    callId: "call-wrap-1",
    horizon: "session",
    offeredHorizon: "session",
    readAmbient: () => ({}),
  });

  assert.equal(block.source_object_id, "call-wrap-1");
  assert.equal(block.source_object_type, "brief_call");
  assert.equal(block.horizon_changed, false);
  // No briefing to name, and none is guessed.
  assert.equal(block.briefing_id, null);
});

test("horizon_changed measures against THIS card's offer, not the page default", () => {
  // #535 defaulted the selector to the call's own horizon. The page-level
  // ambient value is still "week", so a reader who accepted a session card was
  // recorded as having edited it. The per-card prop wins.
  const ambient = { ...ambientFromBrief(), horizon_offered: "week" };

  const accepted = buildTrackProvenance({
    callId: "call-1",
    horizon: "session",
    offeredHorizon: "session",
    readAmbient: () => ambient,
  });
  assert.equal(accepted.horizon_offered, "session");
  assert.equal(accepted.horizon_changed, false);

  const edited = buildTrackProvenance({
    callId: "call-1",
    horizon: "three_week",
    offeredHorizon: "session",
    readAmbient: () => ambient,
  });
  assert.equal(edited.horizon_changed, true);
});

test("an unknown offer is null, never a false acceptance", () => {
  const block = buildTrackProvenance({
    callId: "call-2",
    horizon: "week",
    offeredHorizon: null,
    readAmbient: () => ({}),
  });
  assert.equal(block.horizon_offered, null);
  assert.equal(block.horizon_changed, null);
});

test("identity comes from a prop, not a DOM query", () => {
  // The module must not reach for a document. Asserted structurally: the block
  // resolves with no globals available to it at all beyond its input.
  const block = buildTrackProvenance({
    callId: "call-from-prop",
    horizon: "week",
  });
  assert.equal(block.source_object_id, "call-from-prop");
});
