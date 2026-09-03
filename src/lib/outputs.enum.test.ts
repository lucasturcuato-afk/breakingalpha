/**
 * Schema guard: every output_type this codebase can WRITE must be a value the
 * database will ACCEPT. Pure, deterministic, no network, no DB at test time.
 * Run: npx tsx --test src/lib/outputs.enum.test.ts
 *
 * THE FAILURE THIS EXISTS TO CATCH
 * --------------------------------
 * `outputs.output_type` is `public.output_type_enum`. Postgres rejects a
 * non-member with SQLSTATE 22P02, supabase-js returns that in the result object
 * instead of throwing, and recordOutput logs it to console.error inside a
 * serverless function. So a TS list that claims a value the enum does not have
 * fails silently, forever, at runtime only. 'company_overview' did exactly that
 * and every Coverage Primer page view re-billed a gemini-2.5-flash call.
 *
 * WHY THIS IS NOT A TAUTOLOGY
 * ---------------------------
 * The failure class is "two paths compute one fact and only one is guarded", so
 * naming the writer of each side is the whole point. Three sides, three
 * different writers:
 *
 *   A. OUTPUT_TYPES in src/lib/outputs.ts
 *      written by: a developer editing TypeScript.
 *   B. `observed` in tests/fixtures/output-type-enum.json
 *      written by: Postgres, captured verbatim by
 *      scripts/capture-output-type-enum.mjs from the PostgREST OpenAPI schema.
 *      Not hand-authored.
 *   C. the migration file named by each `pending` entry
 *      written by: whoever wrote the SQL, and it must literally contain an
 *      ALTER TYPE ... ADD VALUE for that exact string.
 *
 * A is checked against B and C. No side is compared to itself, no side is
 * derived from another, and both sides of every assertion are normalized the
 * same way (exact string, no case folding anywhere).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 * -------------------------------------
 * PROVES: OUTPUT_TYPES cannot gain a member unless that member is either
 * already in the database as of the snapshot, or backed by a migration file on
 * disk that adds it. That is precisely the discipline whose absence caused this
 * bug.
 * DOES NOT PROVE: that the live database matches the snapshot right now. The
 * fixture is a point-in-time observation. It goes stale by design; re-capture
 * it when a migration is applied.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { OUTPUT_TYPES } from "./outputs";
import { COMPANY_OVERVIEW_OUTPUT_TYPE } from "./company-overview";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const MIGRATIONS_DIR = resolve(REPO, "supabase/migrations");

interface PendingEntry {
  value: string;
  migration: string;
  why: string;
}
interface EnumFixture {
  observed: string[];
  pending: PendingEntry[];
}

const fixture = JSON.parse(
  readFileSync(resolve(REPO, "tests/fixtures/output-type-enum.json"), "utf8")
) as EnumFixture;

test("fixture is a real snapshot, not an empty stub", () => {
  assert.ok(Array.isArray(fixture.observed), "observed must be an array");
  assert.ok(
    fixture.observed.length >= 10,
    `observed has only ${fixture.observed.length} members; the snapshot looks truncated or unfetched`
  );
});

test("every writable OutputType is accepted by the database enum, or has a migration that adds it", () => {
  const observed = new Set(fixture.observed);
  const pendingByValue = new Map(fixture.pending.map((p) => [p.value, p]));

  const unbacked: string[] = [];
  for (const t of OUTPUT_TYPES) {
    if (observed.has(t)) continue;
    if (pendingByValue.has(t)) continue;
    unbacked.push(t);
  }

  assert.deepEqual(
    unbacked,
    [],
    `OUTPUT_TYPES contains ${unbacked.length} value(s) the database enum will reject with 22P02, ` +
      `and no migration declares them: ${unbacked.join(", ")}. ` +
      `Every write of these silently fails and is logged to a console nobody reads. ` +
      `Add a migration adding the value to output_type_enum and declare it in ` +
      `tests/fixtures/output-type-enum.json under "pending".`
  );
});

test("every pending enum member is backed by a migration file that actually adds it", () => {
  const files = new Set(readdirSync(MIGRATIONS_DIR));

  for (const p of fixture.pending) {
    assert.ok(
      files.has(p.migration),
      `pending enum member "${p.value}" names migration "${p.migration}", which does not exist in supabase/migrations`
    );

    const raw = readFileSync(resolve(MIGRATIONS_DIR, p.migration), "utf8");

    // Match EXECUTABLE SQL only. This migration documents the statement in its
    // header comment, so matching the raw file would let a migration whose only
    // ALTER TYPE is inside a `--` comment satisfy this check: the guard would
    // pass on prose while the database never changed. Strip line comments and
    // block comments first, then match. Assert the mechanism, not the substring.
    const sql = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

    const stmt = new RegExp(
      String.raw`ALTER\s+TYPE\s+(?:public\.)?output_type_enum\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'${p.value}'`,
      "i"
    );
    assert.match(
      sql,
      stmt,
      `migration "${p.migration}" has no EXECUTABLE ALTER TYPE output_type_enum ADD VALUE '${p.value}' statement ` +
        `(a mention inside a SQL comment does not count)`
    );
  }
});

test("pending never claims a member the database already reports", () => {
  const observed = new Set(fixture.observed);
  for (const p of fixture.pending) {
    assert.equal(
      observed.has(p.value),
      false,
      `"${p.value}" is listed as pending but the snapshot already observes it; re-run scripts/capture-output-type-enum.mjs and clear the pending entry`
    );
  }
});

test("company_overview cache constant is a writable OutputType", () => {
  // Ties the Primer cache constant to the same guard as everything else, so the
  // read filter and write payload cannot reference a value the enum rejects.
  assert.ok(
    (OUTPUT_TYPES as readonly string[]).includes(COMPANY_OVERVIEW_OUTPUT_TYPE),
    `${COMPANY_OVERVIEW_OUTPUT_TYPE} is used as an outputs.output_type but is not in OUTPUT_TYPES`
  );
});
