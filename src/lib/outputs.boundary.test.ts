/**
 * recordOutput rejects the two 22P02 shapes BEFORE they reach Postgres.
 * Run: npx tsx --test src/lib/outputs.boundary.test.ts
 *
 * THE FAILURE THIS EXISTS TO CATCH
 * --------------------------------
 * `outputs.output_type` is an enum and `outputs.source_id` is a uuid column
 * (both confirmed read-only against production via PostgREST OpenAPI
 * introspection). Postgres rejects a non-member and a non-uuid with SQLSTATE
 * 22P02, and supabase-js returns that in the result object instead of throwing,
 * so the whole insert dies inside a log line in a serverless function.
 *
 * TypeScript is no help on either. `OutputType` is erased at compile time, so a
 * route that types a request body as `{ output_type: OutputType }` is asserting
 * rather than checking; and `source_id` is typed `string`, which a company name
 * satisfies perfectly. Both of those are how the Coverage Primer cache lost
 * every row, twice over and independently.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The MECHANISM, not a symptom: that no insert is issued at all. The stub
 * client counts calls, so a guard that merely reordered the error handling
 * would still fail these. `null` alone would not prove it, because null is also
 * what a real 22P02 round trip returns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { recordOutput, isOutputType, isUuid, OUTPUT_TYPES } from "./outputs";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = "11111111-2222-4333-8444-555555555555";

/** Minimal supabase-js shape, counting how many inserts were attempted. */
function stubClient() {
  const state = { inserts: 0, lastPayload: null as Record<string, unknown> | null };
  const client = {
    from() {
      return {
        insert(payload: Record<string, unknown>) {
          state.inserts += 1;
          state.lastPayload = payload;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: UUID }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, state };
}

test("isOutputType accepts every declared type and nothing else", () => {
  for (const t of OUTPUT_TYPES) assert.equal(isOutputType(t), true, t);
  assert.equal(isOutputType("not_a_type"), false);
  assert.equal(isOutputType(""), false);
  assert.equal(isOutputType(null), false);
  assert.equal(isOutputType(42), false);
  assert.equal(isOutputType({ toString: () => "memo" }), false, "an object is not a member");
});

test("isUuid accepts a uuid and rejects a company name", () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
  assert.equal(isUuid("NVIDIA"), false, "the exact value that 22P02'd the Primer cache write");
  assert.equal(isUuid("Apple Inc."), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(null), false);
});

test("recordOutput issues NO insert for an output_type the enum will reject", async () => {
  const { client, state } = stubClient();
  const id = await recordOutput(client, {
    // Deliberately not an OutputType. This is what an untrusted request body
    // can carry, and what the union cannot stop at runtime.
    output_type: "definitely_not_in_the_enum" as never,
    content: { hello: "world" },
  });
  assert.equal(id, null, "must fail closed");
  assert.equal(state.inserts, 0, "the row must never be sent; a rejected enum kills the whole insert");
});

test("recordOutput issues NO insert when source_id is not a uuid", async () => {
  const { client, state } = stubClient();
  const id = await recordOutput(client, {
    output_type: "memo",
    content: { hello: "world" },
    source_table: "companies",
    // The Coverage Primer bug verbatim: a company NAME into a uuid column.
    source_id: "NVIDIA",
  });
  assert.equal(id, null, "must fail closed");
  assert.equal(
    state.inserts,
    0,
    "a bad source_id takes the WHOLE insert down at the database, so it must not be sent"
  );
});

test("recordOutput still writes a well-formed row, source_id and all", async () => {
  const { client, state } = stubClient();
  const id = await recordOutput(client, {
    output_type: "thesis",
    content: { a: 1 },
    source_table: "theses",
    source_id: UUID,
  });
  assert.equal(id, UUID);
  assert.equal(state.inserts, 1);
  assert.equal(state.lastPayload?.output_type, "thesis");
  assert.equal(state.lastPayload?.source_id, UUID);
});

test("recordOutput writes a row with no source_id at all", async () => {
  // The Primer cache row shape: keyed by name in content, no source_id.
  const { client, state } = stubClient();
  const id = await recordOutput(client, {
    output_type: "company_overview",
    content: { target_company: "NVIDIA", overview: "x", source_hash: "abc" },
    source_table: "companies",
  });
  assert.equal(id, UUID);
  assert.equal(state.inserts, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(state.lastPayload ?? {}, "source_id"),
    false,
    "absent source_id must stay absent, not become null"
  );
});
