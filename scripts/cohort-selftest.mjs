#!/usr/bin/env node
/**
 * Cohort filter self test.
 *
 * Run:  node scripts/cohort-selftest.mjs
 *
 * READ ONLY. Issues SELECTs against PostgREST as service_role and writes
 * nothing. Safe to run against prod.
 *
 * WHAT IT ASSERTS
 *
 *   A1 CONSERVATION. The sum of per-cohort total_users must equal the
 *      unfiltered 'All' total. If a user is in the base population but in no
 *      cohort bucket, or is counted in two, the dashboard is silently losing or
 *      double counting people and every cohort-scoped number is wrong.
 *
 *   A2 NON-EMPTY. Every cohort that demonstrably has members (member_count > 0
 *      in internal_kpi_cohort_members) must return a row from
 *      internal_kpi_summary_by_cohort with a matching total_users. A cohort
 *      offered in the filter that returns nothing is a broken filter, not an
 *      empty cohort.
 *
 *   A3 AGREEMENT WITH THE UNSCOPED CARD. The 'All' row of the cohort view must
 *      equal internal_kpi_summary's 'All' row on total_users. The cohort view
 *      is a filter over the same population, so if the two disagree the metric
 *      expressions have drifted apart and the copies must be re-synced.
 *
 * WHY IT CANNOT PASS BY MEASURING NOTHING
 *
 * If the cohort migration is unapplied the views do not exist. The test then
 * exits 2 as NOT RUN rather than 0. An assertion suite that reports success
 * against absent schema is worse than no suite, because it converts "we never
 * checked" into "we checked and it was fine".
 *
 * EXIT CODES
 *   0  all assertions passed
 *   1  an assertion FAILED
 *   2  NOT RUN (schema absent, or credentials absent). Never treat as a pass.
 */

import { readFileSync } from "node:fs";

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Absent file is fine; fall through to the real environment.
    }
  }
}
loadEnv();

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error(
    "NOT RUN: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is absent.",
  );
  console.error("Nothing was measured. This is not a pass.");
  process.exit(2);
}

async function q(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

function missingRelation(r) {
  return (
    !r.ok &&
    (r.body?.code === "PGRST205" ||
      r.body?.code === "42P01" ||
      /could not find the table|does not exist/i.test(r.body?.message ?? ""))
  );
}

const failures = [];
function check(name, passed, detail) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (detail) console.log(`      ${detail}`);
  if (!passed) failures.push(name);
}

const members = await q("internal_kpi_cohort_members?select=*");
const scoped = await q("internal_kpi_summary_by_cohort?select=cohort_key,total_users");
const unscoped = await q(
  "internal_kpi_summary?select=segment_domain,total_users&segment_domain=eq.All",
);

if (missingRelation(members) || missingRelation(scoped)) {
  console.error("NOT RUN: the cohort views do not exist in this database.");
  console.error(
    "Apply backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql first.",
  );
  console.error("Nothing was measured. This is not a pass.");
  process.exit(2);
}

if (!members.ok || !scoped.ok || !unscoped.ok) {
  console.error("NOT RUN: a query failed for a reason other than absent schema.");
  console.error(JSON.stringify({ members, scoped, unscoped }, null, 1).slice(0, 1200));
  process.exit(2);
}

const memberRows = members.body;
const scopedRows = scoped.body;
const allRow = scopedRows.find((r) => r.cohort_key === "All");
const cohortRows = scopedRows.filter((r) => r.cohort_key !== "All");
const unscopedTotal = Number(unscoped.body?.[0]?.total_users ?? NaN);

console.log(
  `\ncohorts: ${cohortRows.length}   roster rows: ${memberRows.length}   ` +
    `All(cohort view): ${allRow?.total_users}   All(summary): ${unscopedTotal}\n`,
);

// A1 CONSERVATION
const sumCohorts = cohortRows.reduce((a, r) => a + Number(r.total_users), 0);
check(
  "A1 conservation: sum of per-cohort total_users equals the All total",
  allRow !== undefined && sumCohorts === Number(allRow.total_users),
  `sum(cohorts)=${sumCohorts} All=${allRow?.total_users}`,
);

// A2 NON-EMPTY
const scopedByKey = new Map(cohortRows.map((r) => [r.cohort_key, Number(r.total_users)]));
const emptyButPopulated = memberRows
  .filter((m) => Number(m.member_count) > 0)
  .filter((m) => {
    const got = scopedByKey.get(m.cohort_key);
    return got === undefined || got !== Number(m.member_count);
  })
  .map((m) => `${m.cohort_key} roster=${m.member_count} scoped=${scopedByKey.get(m.cohort_key) ?? "NO ROW"}`);
check(
  "A2 non-empty: every cohort with members returns a matching scoped row",
  emptyButPopulated.length === 0,
  emptyButPopulated.length ? emptyButPopulated.join("; ") : "all cohorts resolve",
);

// A3 AGREEMENT
check(
  "A3 agreement: cohort view All equals internal_kpi_summary All",
  Number.isFinite(unscopedTotal) && Number(allRow?.total_users) === unscopedTotal,
  `cohortView=${allRow?.total_users} summary=${unscopedTotal}`,
);

// A guard on the guard: if there is nothing to conserve, say so loudly rather
// than reporting three green checks over an empty table.
if (cohortRows.length === 0) {
  console.error(
    "\nNOT RUN: the views exist but contain zero cohort rows, so A1 and A2 " +
      "were vacuous. Capture has not produced a single attributed signup yet.",
  );
  process.exit(2);
}

if (failures.length) {
  console.error(`\n${failures.length} ASSERTION(S) FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll cohort assertions passed.");
