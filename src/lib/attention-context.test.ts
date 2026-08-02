/**
 * Tests for the per-object attention clock.
 *
 * `lastFocus` answers "what was on screen most recently". An action needs
 * "how long had THIS card been in view", and those differ the moment a reader
 * scrolls past a later card before committing to an earlier one. That case is
 * the reason this clock exists, so it is the case that is tested.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/lib/attention-context.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  closeAttentionContext,
  noteObjectInView,
  openAttentionContext,
  readProvenance,
  secondsSinceObjectFirstInView,
} from "./attention-context";

test("an object seen earlier is still timed after a later one scrolls past", () => {
  closeAttentionContext();
  openAttentionContext({ surfaceId: "brief-1", surfaceType: "briefing" });

  noteObjectInView({ entityType: "brief_call", entityId: "call-3", rank: 2 });
  noteObjectInView({ entityType: "brief_call", entityId: "call-5", rank: 4 });

  // The reader taps card 3, not card 5. Both are timed, independently.
  assert.notEqual(secondsSinceObjectFirstInView("brief_call", "call-3"), null);
  assert.notEqual(secondsSinceObjectFirstInView("brief_call", "call-5"), null);

  // Ambient focus is card 5, which is exactly why an action must not rely on it.
  assert.equal(readProvenance().preceding_object_id, "call-5");

  closeAttentionContext();
});

test("an object never in view reports null, never zero", () => {
  closeAttentionContext();
  openAttentionContext({ surfaceId: "brief-1", surfaceType: "briefing" });

  assert.equal(secondsSinceObjectFirstInView("brief_call", "never-seen"), null);
  assert.equal(secondsSinceObjectFirstInView("brief_call", null), null);
  assert.equal(secondsSinceObjectFirstInView("brief_call", undefined), null);

  closeAttentionContext();
});

test("the clock is scoped to a context and cleared when it closes", () => {
  closeAttentionContext();
  openAttentionContext({ surfaceId: "brief-1", surfaceType: "briefing" });
  noteObjectInView({ entityType: "brief_call", entityId: "call-9", rank: 0 });
  assert.notEqual(secondsSinceObjectFirstInView("brief_call", "call-9"), null);

  closeAttentionContext();
  assert.equal(secondsSinceObjectFirstInView("brief_call", "call-9"), null);
});

test("readProvenance contributes nothing when no context is open", () => {
  closeAttentionContext();
  assert.deepEqual(readProvenance(), {});
});
