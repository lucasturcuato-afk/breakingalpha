import { test } from "node:test";
import assert from "node:assert/strict";
import type { PostgrestSingleResponse } from "@supabase/postgrest-js";
import { fromSingle, fromList, rowOr } from "./read";
import type { Read, ListRead } from "./read";

type Row = { id: string; first_name: string | null };

/* Builders for the two members of `PostgrestSingleResponse`, so each case
   below asserts against the real response shape rather than a hand-written
   object that could drift from it. */
function ok<T>(data: T): PostgrestSingleResponse<T> {
  return { data, error: null, count: null, status: 200, statusText: "OK" };
}

function failure(code: string, message: string): PostgrestSingleResponse<never> {
  return {
    data: null,
    error: Object.assign(new Error(message), {
      name: "PostgrestError",
      message,
      details: "",
      hint: "",
      code,
    }),
    count: null,
    status: 400,
    statusText: "Bad Request",
  };
}

/* ── The discrimination this whole type exists for ── */

test("fromSingle: PGRST116 is missing, not failed", () => {
  // `.single()` reports zero matched rows as an error. Reading that as a
  // failure is what makes a first-visit reader look like a broken database.
  const read = fromSingle<Row>(failure("PGRST116", "JSON object requested, multiple (or no) rows returned"));
  assert.equal(read.state, "missing");
});

test("fromSingle: any other code is failed, and carries it", () => {
  // 42703 is the code the two personalization columns answer with today.
  const read = fromSingle<Row>(failure("42703", "column does not exist"));
  assert.equal(read.state, "failed");
  if (read.state !== "failed") throw new Error("unreachable");
  assert.equal(read.code, "42703");
  assert.equal(read.message, "column does not exist");
});

test("fromSingle: a failure carries plain strings, never the error object", () => {
  /* `PostgrestError extends Error`, and an Error subclass is not a
     serialisable React Server Component prop. A failure that carried the error
     itself would throw at render on the way across the boundary. */
  const read = fromSingle<Row>(failure("42501", "permission denied"));
  assert.equal(read.state, "failed");
  if (read.state !== "failed") throw new Error("unreachable");
  assert.equal(typeof read.code, "string");
  assert.equal(typeof read.message, "string");
  assert.deepEqual(Object.keys(read).sort(), ["code", "message", "state"]);
  assert.equal(JSON.parse(JSON.stringify(read)).message, "permission denied");
});

test("fromSingle: maybeSingle's null row is missing, not failed", () => {
  // `.maybeSingle()` signals no row with `data: null` and NO error, which is
  // the other half of the same three-state problem.
  const read = fromSingle<Row>(ok<Row | null>(null));
  assert.equal(read.state, "missing");
});

test("fromSingle: a row is ok and arrives intact", () => {
  const read = fromSingle<Row>(ok<Row | null>({ id: "u1", first_name: "Maya" }));
  assert.equal(read.state, "ok");
  if (read.state !== "ok") throw new Error("unreachable");
  assert.deepEqual(read.row, { id: "u1", first_name: "Maya" });
});

/* ── Lists: zero rows genuinely IS an answer ── */

test("fromList: an empty list is ok, not missing", () => {
  const read = fromList<Row>(ok<Row[]>([]));
  assert.equal(read.state, "ok");
  if (read.state !== "ok") throw new Error("unreachable");
  assert.deepEqual(read.rows, []);
});

test("fromList: a null body with no error is an empty list", () => {
  const read = fromList<Row>(ok<Row[] | null>(null));
  assert.equal(read.state, "ok");
  if (read.state !== "ok") throw new Error("unreachable");
  assert.deepEqual(read.rows, []);
});

test("fromList: an error is failed and never an empty list", () => {
  // The defect this unit exists to stop: a failed read drawn as a zero.
  const read = fromList<Row>(failure("57014", "canceling statement due to statement timeout"));
  assert.equal(read.state, "failed");
});

test("fromList: PGRST116 on a list is still a failure", () => {
  /* A list read does not use `.single()`, so PGRST116 cannot mean "no rows"
     here. `fromList` therefore does NOT carry the missing-row exemption, and
     copying it across would have re-created the exact confusion on the list
     side. */
  const read = fromList<Row>(failure("PGRST116", "unexpected"));
  assert.equal(read.state, "failed");
});

/* ── The indifferent caller ── */

test("rowOr: one line, and it defaults on BOTH missing and failed", () => {
  const fallback: Row = { id: "u1", first_name: null };
  assert.equal(rowOr(fromSingle<Row>(ok<Row | null>(null)), fallback), fallback);
  assert.equal(rowOr(fromSingle<Row>(failure("42703", "nope")), fallback), fallback);
  const row: Row = { id: "u1", first_name: "Maya" };
  assert.deepEqual(rowOr(fromSingle<Row>(ok<Row | null>(row)), fallback), row);
});

/* ── The type itself, checked by tsc rather than at run time ──
 *
 * These do nothing when the suite runs. They fail the BUILD if the union ever
 * stops being true, because an unused `@ts-expect-error` is itself a tsc error.
 * That makes them a real gate under `npx tsc --noEmit`. */

test("the failure member has no data key, so `?? []` cannot compile", () => {
  const list = fromList<Row>(ok<Row[]>([])) as ListRead<Row>;
  // @ts-expect-error `data` exists on neither member; the one-character habit
  // that turns a failed read into an empty render is a type error here.
  const _bad = list.data ?? [];
  void _bad;

  const read = fromSingle<Row>(ok<Row | null>(null)) as Read<Row>;
  // @ts-expect-error `row` is on the ok member only, so an unbranched read of
  // it does not compile either.
  const _alsoBad = read.row;
  void _alsoBad;

  assert.ok(true);
});
