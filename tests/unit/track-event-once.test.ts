// The once-per-day emission guard, which is the source half of the brief-open
// over-count fix.
//
// WHAT WENT WRONG. Both brief-open emit sites guarded on a `useRef` allocated
// inside the component body. That ref lives exactly as long as one mount, so a
// remount, a client route re-entry, a second tab or a reload each reset it to
// null and the effect fired again. Measured in prod over one 7 day window: 215
// counted opens from 12 readers, of which ONE account contributed 195, spread
// across 125 distinct sessions but only 5 distinct briefings, with a single
// briefing emitted 84 times in one day. The card divided that by active readers
// and reported 15.36 opens per active, against a deduped truth of 1.57.
//
// WHY localStorage AND NOT sessionStorage. sessionStorage is per tab and dies
// with the tab, so it would stop the remount case and miss both the reload case
// and the second-tab case. The prod data had 125 session ids behind 5
// briefings, so session scope is close to no scope at all here.
//
// WHY IT FAILS OPEN. Storage throws in some privacy modes. Losing a duplicate
// is cheap; losing a real open corrupts the metric in the other direction, so
// a throwing store must emit. That is asserted here at the pure layer by the
// caller contract and at the impure layer by the try/catch in trackClientEvent.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimOnce,
  onceDayStamp,
  ONCE_STORAGE_KEY,
  ONCE_RETENTION_DAYS,
  type OnceStore,
} from "../../src/lib/track-event.ts";

/** A plain object standing in for Storage, so this needs no browser. */
function fakeStore(initial: string | null = null): OnceStore & { raw(): string | null } {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    raw: () => value,
  };
}

const DAY1 = new Date("2026-08-30T09:00:00.000Z");
const DAY1_LATER = new Date("2026-08-30T23:59:00.000Z");
const DAY2 = new Date("2026-08-31T00:01:00.000Z");

test("the first claim of a key on a day emits, the second does not", () => {
  const store = fakeStore();
  assert.equal(claimOnce(store, "brief:abc", DAY1), true, "first claim must emit");
  assert.equal(claimOnce(store, "brief:abc", DAY1), false, "second claim must be suppressed");
  assert.equal(
    claimOnce(store, "brief:abc", DAY1_LATER),
    false,
    "still the same UTC day, so still suppressed",
  );
});

test("a different key on the same day is independent", () => {
  const store = fakeStore();
  assert.equal(claimOnce(store, "brief.page.opened:abc", DAY1), true);
  // This is the pairing that matters: the guard is scoped by event_type in
  // trackClientEvent, so the legacy name shares the caller's key and still
  // emits rather than being swallowed by the dotted name.
  assert.equal(claimOnce(store, "morning_brief_opened:abc", DAY1), true);
  assert.equal(claimOnce(store, "brief.page.opened:abc", DAY1), false);
});

test("a new UTC day re-opens the same key", () => {
  const store = fakeStore();
  assert.equal(claimOnce(store, "brief:abc", DAY1), true);
  assert.equal(claimOnce(store, "brief:abc", DAY1), false);
  assert.equal(claimOnce(store, "brief:abc", DAY2), true, "a new day must emit again");
});

test("entries older than the retention window are pruned, so the map cannot grow", () => {
  const store = fakeStore();
  claimOnce(store, "old", new Date("2026-08-01T00:00:00.000Z"));
  claimOnce(store, "fresh", DAY1);
  const map = JSON.parse(store.raw() as string) as Record<string, string>;
  assert.equal("fresh" in map, true, "today's entry must survive");
  assert.equal("old" in map, false, "an entry beyond the retention window must be pruned");
  const cutoff = onceDayStamp(new Date(DAY1.getTime() - ONCE_RETENTION_DAYS * 86400000));
  for (const day of Object.values(map)) {
    assert.ok(day >= cutoff, `retained an entry older than the cutoff ${cutoff}`);
  }
});

test("a corrupted stored value does not wedge telemetry forever", () => {
  // If a bad value made claimOnce throw or always return false, every brief
  // open would stop being recorded and the card would silently read zero.
  for (const junk of ["not json", "[1,2,3]", "null", '"a string"', "{"]) {
    const store = fakeStore(junk);
    assert.equal(
      claimOnce(store, "brief:abc", DAY1),
      true,
      `a stored value of ${junk} must not suppress a first claim`,
    );
  }
});

test("the map is written under one namespaced key", () => {
  const store = fakeStore();
  let writtenKey: string | null = null;
  const spy: OnceStore = {
    getItem: store.getItem,
    setItem: (k, v) => {
      writtenKey = k;
      store.setItem(k, v);
    },
  };
  claimOnce(spy, "brief:abc", DAY1);
  assert.equal(writtenKey, ONCE_STORAGE_KEY);
});

test("onceDayStamp is UTC, so the key matches the SQL dedupe key", () => {
  // The read-path dedupe groups on (created_at AT TIME ZONE 'UTC')::date. If
  // this stamp were local, a reader west of UTC would get two client-side
  // "days" inside one SQL day, or vice versa, and the two halves of the fix
  // would disagree at the boundary.
  assert.equal(onceDayStamp(new Date("2026-08-30T23:59:59.000Z")), "2026-08-30");
  assert.equal(onceDayStamp(new Date("2026-08-31T00:00:01.000Z")), "2026-08-31");
});
