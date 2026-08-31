import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARTICLE_DAYS_FAST,
  ARTICLE_DAYS_WIDE,
  ARTICLE_MIN_ROWS,
  escalateArticleWindow,
  preferWiderRows,
} from "../../src/lib/article-window.ts";
import { ARTICLE_FALLBACK_MIN } from "../../src/lib/data-access/getArticleFallback.ts";

// ---------------------------------------------------------------------------
// The head band is the whole point of this test file. The lift from the
// adaptive window is entirely in the tail, and the head must be provably
// untouched, because a reviewer who checks this change on Nvidia will see no
// difference and needs the code to say that is correct rather than broken.
// ---------------------------------------------------------------------------

test("a well-covered company never escalates, so its query is unchanged", () => {
  // Measured floor for the rank-1-100 band on prod (2026-08-31) was 16 rows
  // inside 14 days; the sampled minimum, not a typical value.
  assert.equal(escalateArticleWindow(16), null);
  assert.equal(escalateArticleWindow(50), null);
  assert.equal(escalateArticleWindow(ARTICLE_MIN_ROWS), null);
});

test("a thin company escalates to the wide window", () => {
  assert.equal(escalateArticleWindow(0), ARTICLE_DAYS_WIDE);
  assert.equal(escalateArticleWindow(1), ARTICLE_DAYS_WIDE);
  assert.equal(escalateArticleWindow(ARTICLE_MIN_ROWS - 1), ARTICLE_DAYS_WIDE);
});

test("the floor is exclusive: exactly ARTICLE_MIN_ROWS is enough", () => {
  assert.equal(escalateArticleWindow(ARTICLE_MIN_ROWS - 1), ARTICLE_DAYS_WIDE);
  assert.equal(escalateArticleWindow(ARTICLE_MIN_ROWS), null);
});

test("the thin floor stays tied to the existing definition of a thin tab", () => {
  // getArticleFallback.ts already decides when an article tab is too thin.
  // If that number moves, this one moves with it or the product tells two
  // different stories about the same page.
  assert.equal(ARTICLE_MIN_ROWS, ARTICLE_FALLBACK_MIN);
});

test("the fast rung stays the old fixed window, so nothing regresses on day one", () => {
  assert.equal(ARTICLE_DAYS_FAST, 14);
  assert.ok(ARTICLE_DAYS_WIDE > ARTICLE_DAYS_FAST);
});

test("preferWiderRows only adopts the wide rung when it is strictly additive", () => {
  const fast = [{ id: "a" }, { id: "b" }];
  const wide = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(preferWiderRows(fast, wide), wide);
});

test("preferWiderRows never shrinks a page that already had rows", () => {
  const fast = [{ id: "a" }, { id: "b" }];
  // A wide read that lost rows to a concurrent delete, or returned nothing at
  // all, must not blank a tab that was already rendering.
  assert.deepEqual(preferWiderRows(fast, []), fast);
  assert.deepEqual(preferWiderRows(fast, [{ id: "z" }]), fast);
  // Equal length is not additive either; keep the more recent set.
  assert.deepEqual(preferWiderRows(fast, [{ id: "y" }, { id: "z" }]), fast);
});

test("preferWiderRows fills an empty page from the wide rung", () => {
  const wide = [{ id: "a" }];
  assert.deepEqual(preferWiderRows([], wide), wide);
  assert.deepEqual(preferWiderRows([], []), []);
});
