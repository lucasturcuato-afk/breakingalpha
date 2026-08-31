/**
 * The failure paths a browser cannot force.
 *
 * OBSTACLE TWO, stated plainly. `/watch`, `/ask`, `/ledger` and `/company/[id]`
 * are Server Components: they read Supabase during the render, on the server,
 * and the browser never issues those requests. `page.route()` intercepts
 * BROWSER traffic, so no amount of route interception can make any of those
 * reads fault. A harness that intercepts something and calls it "the failed
 * read path" is measuring a different request.
 *
 * So the browser walk records those screens' SUCCESS states and says so, and
 * the failed-read branch is covered HERE, at the unit level, by handing the
 * loader a client whose queries fault. That is the honest split: the walk
 * proves the screen renders, this proves the screen has a distinct thing to
 * render when the read is gone.
 *
 * Runner: `npx tsx --test tests/unit/pressure-server-read-failure.test.ts`
 * (the repo's `npm run test:unit` picks it up from tests/unit/**).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWatch } from "../../src/lib/watch-data";
import { loadAskCompanies } from "../../src/lib/ask-companies-data";

const FAULT = { message: "pressure harness: forced read failure", code: "57014" };

/**
 * A Supabase client whose every query resolves to an error.
 *
 * Thenable rather than awaited-at-the-end: the loaders await the builder
 * itself, and several of them chain `.eq`, `.order`, `.limit`, `.not` and
 * `.in` in different orders, so every chaining method returns the same object.
 */
function faultingClient(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "neq", "in", "not", "is", "order", "limit", "gte", "lte", "gt", "lt", "ilike", "or", "range", "maybeSingle", "single", "filter", "contains", "overlaps"]) {
    builder[m] = chain;
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: FAULT, count: null }).then(resolve);
  const client = {
    from: () => builder,
    rpc: () => builder,
  };
  return client as unknown as SupabaseClient;
}

test("loadWatch reports a failed read as failed, never as an empty watchlist", async () => {
  const load = await loadWatch(faultingClient(), "00000000-0000-0000-0000-000000000000");
  assert.equal(load.stage, "ready", "the loader still answers; the FLAGS carry the failure");
  assert.ok(load.data, "data object present");
  assert.equal(load.data!.watchlistRead, "failed");
  assert.equal(load.data!.followingRead, "failed");
  /* The point of the two flags: a faulted read must not be indistinguishable
     from a reader who watches nothing. */
  assert.equal(load.data!.watchlist.length, 0);
  assert.equal(load.data!.following.length, 0);
});

test("loadWatch with no reader is an error stage, not an empty one", async () => {
  const load = await loadWatch(faultingClient(), null);
  assert.equal(load.stage, "error");
  assert.equal(load.data, null);
});

test("loadAskCompanies gives back null data on a faulted directory read, never an empty list", async () => {
  const load = await loadAskCompanies(faultingClient());
  assert.equal(load.stage, "error");
  assert.equal(load.data, null, "null, so the screen can tell a failed read from an empty corpus");
  assert.equal(load.corpusTotal, null);
});
