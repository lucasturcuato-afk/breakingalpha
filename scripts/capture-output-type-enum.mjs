/**
 * Capture the live members of public.output_type_enum into a committed fixture.
 *
 * READ-ONLY. One HTTP GET against the PostgREST OpenAPI endpoint. It issues no
 * INSERT, UPDATE, DELETE or DDL and touches no row.
 *
 * WHY THIS EXISTS
 * ---------------
 * output_type_enum is not defined anywhere in this repository. It was created
 * directly against the database, so the only authority on its members is the
 * database. src/lib/outputs.ts separately hand-maintains OUTPUT_TYPES, the list
 * of values this codebase writes. Nothing connected the two, so the TS list
 * drifted ahead of the enum ('company_overview'), every insert 22P02'd, and the
 * Coverage Primer cache silently never wrote a row.
 *
 * This script snapshots the database's answer so src/lib/outputs.enum.test.ts
 * can check the TS list against something Postgres wrote rather than against
 * another copy of itself.
 *
 * Run:
 *   set -a; . .env.local; set +a; node scripts/capture-output-type-enum.mjs
 *
 * The snapshot is a point-in-time observation, not a live check. Re-run it when
 * a migration adds an enum member, and move that member from `pending` to
 * `observed` in the same commit that records the new snapshot.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "../tests/fixtures/output-type-enum.json");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/`, {
  method: "GET",
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
});
if (!res.ok) {
  console.error(`OpenAPI fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const schema = await res.json();
const prop = schema?.definitions?.outputs?.properties?.output_type;
if (!prop || prop.format !== "public.output_type_enum" || !Array.isArray(prop.enum)) {
  console.error("Could not locate outputs.output_type enum in the OpenAPI schema.");
  process.exit(1);
}

// Preserve any declared `pending` entries across a re-capture; they are a human
// statement about migrations in flight, not something the database can report.
let pending = [];
try {
  pending = JSON.parse(readFileSync(FIXTURE, "utf8")).pending ?? [];
} catch {
  // First run: no fixture yet.
}
// Anything now present in the database is no longer pending.
pending = pending.filter((p) => !prop.enum.includes(p.value));

const fixture = {
  _comment:
    "Snapshot of public.output_type_enum. `observed` is written by Postgres via " +
    "scripts/capture-output-type-enum.mjs (read-only OpenAPI introspection); do not hand-edit it. " +
    "`pending` is hand-declared for members a committed-but-unapplied migration adds; each entry " +
    "must be backed by a real migration file, which src/lib/outputs.enum.test.ts verifies.",
  captured_at: new Date().toISOString().slice(0, 10),
  source: "GET /rest/v1/ -> definitions.outputs.properties.output_type.enum",
  observed: prop.enum,
  pending,
};

writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${FIXTURE}`);
console.log(`observed (${prop.enum.length}): ${prop.enum.join(", ")}`);
console.log(`pending (${pending.length}): ${pending.map((p) => p.value).join(", ") || "none"}`);
