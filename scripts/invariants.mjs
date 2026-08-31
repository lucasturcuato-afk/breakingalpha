#!/usr/bin/env node
/**
 * Dashboard invariant suite.
 *
 * Run:  node scripts/invariants.mjs
 *
 * READ ONLY. Issues SELECTs against PostgREST as service_role plus paged reads
 * of the Auth Admin API. Writes nothing. Safe against prod.
 *
 * WHY THIS REPLACES THE OLD SUITE. DASH-AUDIT.md ran twelve invariants and
 * found NINE of them true by construction: both sides were `count(*) FILTER
 * (...)` over the same rows, inside one statement, under one frozen `now()`.
 * They could not fail for any value of any datum, so they measured nothing.
 * Each is replaced below by an assertion that compares quantities produced by
 * DIFFERENT code paths, different statements, or different source tables.
 *
 * TWO REQUESTS PER ASSERTION, DELIBERATELY. Every replacement issues its two
 * sides as separate HTTP requests. Collapsing an assertion into a single SQL
 * statement re-freezes `now()` across both sides and reinstates the exact
 * defect being removed. Both request timestamps are logged so a drift failure
 * is distinguishable from a logic failure rather than papered over.
 *
 * EXIT CODES, matching scripts/cohort-selftest.mjs
 *   0  all assertions passed
 *   1  an assertion FAILED
 *   2  NOT RUN (credentials or schema absent). Never treat as a pass.
 *
 * SEVEN ASSERTIONS ARE EXPECTED TO FAIL TODAY. NEW-a and NEW-c fail until the
 * loop-fix migration makes the dim_users exclusion canonical; they pass after. That is the point of shipping
 * them: A6, R9, R10, R12 and 12b are live defects, and a suite that went green
 * over them would be measuring nothing again. Four are recorded in
 * DASH-AUDIT.md; R10 is NEW, found by this suite, and is written up in
 * FIXES.md item 6. See the WOULD FAIL WHEN note printed on each.
 */

import { readFileSync } from "node:fs";

function loadEnv() {
  for (const p of [".env.local", ".env", "../../breakingalpha/.env.local"]) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* absent file is fine */
    }
  }
}
loadEnv();

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("NOT RUN: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is absent.");
  console.error("Nothing was measured. This is not a pass.");
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** Frozen boundaries. Every assertion uses the same instants. */
const NOW = new Date();
const iso = (d) => d.toISOString();
const minus = (days) => new Date(NOW.getTime() - days * 86400000);
const D7 = iso(minus(7));
const D28 = iso(minus(28));
const D30 = iso(minus(30));

/** Briefs published per day times this bounds plausible opens per reader. */
const REFRESH_FACTOR = 3;

let requests = 0;
async function rows(path) {
  requests++;
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
/** Pages past the 1000 row cap and verifies the total against the exact count. */
async function allRows(path) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await rows(`${path}${sep}limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) break;
    if (off > 50000) throw new Error(`runaway paging on ${path}`);
  }
  return out;
}
async function exactCount(path) {
  requests++;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${URL_BASE}/rest/v1/${path}${sep}select=*`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = res.headers.get("content-range");
  if (!cr) throw new Error(`no content-range for ${path}`);
  return Number(cr.split("/")[1]);
}

const results = [];
function check(id, name, passed, detail, failureMode) {
  results.push({ id, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${id}  ${name}`);
  console.log(`        ${detail}`);
  if (!passed) console.log(`        WOULD FAIL WHEN: ${failureMode}`);
}
function notRun(why) {
  console.error(`\nNOT RUN: ${why}`);
  console.error("Nothing was measured. This is not a pass.");
  process.exit(2);
}

console.log(`invariant suite, frozen boundaries`);
console.log(`  NOW ${iso(NOW)}\n  7d  ${D7}\n  28d ${D28}\n  30d ${D30}\n`);

// --- shared reads. Each assertion still re-reads its own second side. -------
const summary = (await rows("internal_kpi_summary?select=*&segment_domain=eq.All"))[0];
const tRead1 = iso(new Date());
if (!summary) notRun("internal_kpi_summary returned no All row");

const dimUsers = await allRows("dim_users?select=id,created_at,last_sign_in_at");
const dimIds = new Set(dimUsers.map((r) => r.id));
if (dimIds.size === 0) notRun("dim_users is empty; there is nothing to reconcile");

// ---------------------------------------------------------------------------
// R1 replaces "new_users_7d <= total_users", which was a filtered count against
// its own parent and could not fail.
// ---------------------------------------------------------------------------
{
  const direct = await exactCount(`dim_users?created_at=gte.${D7}`);
  const tRead2 = iso(new Date());
  check(
    "R1",
    "new_users_7d equals a separate count of dim_users created in 7d",
    summary.new_users_7d === direct,
    `view=${summary.new_users_7d} direct=${direct} (read1 ${tRead1}, read2 ${tRead2})`,
    "a signup landing between the two reads; the view being materialized while " +
      "the direct count is live; new_7d rewritten from a rolling boundary to a " +
      "date_trunc week bucket; a TimeZone difference shifting the boundary",
  );
}

// ---------------------------------------------------------------------------
// R2 replaces "weekly_actives <= total_users". Recomputes from the raw event
// table rather than from the view's own pre-joined CTE.
// ---------------------------------------------------------------------------
const events7d = await allRows(`user_events?select=user_id,event_type,created_at&created_at=gte.${D7}`);
{
  const rawActors = new Set(events7d.map((e) => e.user_id).filter(Boolean));
  const inPop = [...rawActors].filter((u) => dimIds.has(u)).length;
  const nullUser = events7d.filter((e) => !e.user_id).length;
  check(
    "R2",
    "weekly_actives equals distinct raw event users intersected with dim_users",
    summary.weekly_actives === inPop,
    `view=${summary.weekly_actives} raw_distinct=${rawActors.size} in_population=${inPop} ` +
      `outside=${rawActors.size - inPop} null_user_id_rows=${nullUser}`,
    "the ev CTE losing its GROUP BY d.id, which fans the LEFT JOIN out to one " +
      "row per event; user_events acquiring NULL user_ids; a second identity " +
      "column on user_events",
  );
}

// ---------------------------------------------------------------------------
// R4 replaces the retention subset chain. Crosses TWO views with genuinely
// different cohort definitions, which is where the real seam is.
// ---------------------------------------------------------------------------
{
  const cohorts = await rows(
    "internal_kpi_retention_cohorts?select=cohort_size,active_last_7d&segment_domain=eq.All",
  );
  const sumActive = cohorts.reduce((a, r) => a + Number(r.active_last_7d), 0);
  const cohort4w = dimUsers.filter((u) => u.created_at <= D28);
  const active7d = new Set(events7d.map((e) => e.user_id));
  const numerator = cohort4w.filter((u) => active7d.has(u.id)).length;
  const young = summary.weekly_actives - numerator;
  check(
    "R4",
    "4w retention numerator plus young actives equals total weekly actives",
    numerator + young === sumActive && numerator <= sumActive,
    `numerator=${numerator} young_actives=${young} sum(active_last_7d)=${sumActive} ` +
      `cohort_size_4w=${cohort4w.length}`,
    "the two views define cohort differently, rolling created_at in the summary " +
      "versus date_trunc week buckets in the cohorts view, so they disagree for " +
      "anyone who signed up between the two boundaries; recent_active losing its " +
      "DISTINCT and fanning out",
  );
}

// ---------------------------------------------------------------------------
// R5 replaces "users_with_watchlist <= total_users".
// ---------------------------------------------------------------------------
{
  const wl = await allRows("watchlist?select=user_id");
  const owners = new Set(wl.map((r) => r.user_id).filter(Boolean));
  const inPop = [...owners].filter((u) => dimIds.has(u)).length;
  check(
    "R5",
    "users_with_watchlist equals distinct watchlist owners inside dim_users",
    summary.users_with_watchlist === inPop,
    `view=${summary.users_with_watchlist} rows=${wl.length} distinct_owners=${owners.size} ` +
      `in_population=${inPop} outside=${owners.size - inPop}`,
    "the wl CTE losing its DISTINCT, which fans the join out to one row per " +
      "watchlist entry; a watchlist row whose owner was deleted from auth.users",
  );
}

// ---------------------------------------------------------------------------
// A6 KEPT VERBATIM. It already fails and it is kept for exactly that reason.
// ---------------------------------------------------------------------------
const briefOpen7d = events7d.filter((e) =>
  ["morning_brief_opened", "evening_wrap_opened"].includes(e.event_type),
);
{
  const openers = new Set(briefOpen7d.map((e) => e.user_id).filter(Boolean));
  const outside = [...openers].filter((u) => !dimIds.has(u));
  check(
    "A6",
    "no brief opener in the window sits outside dim_users",
    outside.length === 0,
    `openers_raw=${openers.size} in_population=${openers.size - outside.length} ` +
      `OUTSIDE=${outside.length} events_raw=${briefOpen7d.length} ` +
      `events_in_population=${briefOpen7d.filter((e) => dimIds.has(e.user_id)).length}`,
    "it fails now. Today's outliers are the excluded founder and test accounts, " +
      "which is a population-definition gap rather than a subset violation. It " +
      "would fail for a REAL reason if the ev CTE were rewritten to start FROM " +
      "user_events and join out to dim_users, admitting out-of-population events",
  );
}

// ---------------------------------------------------------------------------
// A7 KEPT. Genuinely cross-object: two views, two statements.
// ---------------------------------------------------------------------------
{
  const cohorts = await rows(
    "internal_kpi_retention_cohorts?select=cohort_size&segment_domain=eq.All",
  );
  const sum = cohorts.reduce((a, r) => a + Number(r.cohort_size), 0);
  check(
    "A7",
    "sum of per-week cohort_size equals total_users",
    sum === summary.total_users,
    `sum(cohort_size)=${sum} total_users=${summary.total_users} weeks=${cohorts.length}`,
    "a dim_users row with a NULL created_at, giving a NULL signup_week and its " +
      "own bucket; a signup landing between the two reads; the GROUPING SETS " +
      "clause gaining a segment-only set and doubling the sum",
  );
}

// ---------------------------------------------------------------------------
// R8 replaces "All == USC + other", which re-counted one row set twice.
//
// The naive form of this assertion re-evaluates the view's own CASE expression
// against the same rows and is true by construction. Only the regex form uses
// a predicate the view does not use, so only it can catch a third subdomain.
// ---------------------------------------------------------------------------
const authUsers = [];
{
  for (let page = 1; page <= 50; page++) {
    requests++;
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: H,
    });
    if (!res.ok) notRun(`auth admin API returned ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body.users) ? body.users : [];
    authUsers.push(...list);
    if (list.length < 200) break;
  }
  if (authUsers.length === 0) notRun("auth admin API returned no users");

  const KNOWN = ["usc.edu", "marshall.usc.edu"];
  const stray = authUsers.filter((u) => {
    const d = String(u.email ?? "").toLowerCase().split("@")[1] ?? "";
    return /(^|\.)usc\.edu$/.test(d) && !KNOWN.includes(d);
  }).length;
  check(
    "R8",
    "no USC-family domain sits outside the two the segment proxy names",
    stray === 0,
    `auth_users=${authUsers.length} stray_usc_subdomains=${stray} (regex form, not the ` +
      `view's own CASE, which would be true by construction)`,
    "a student signing up at any other usc.edu subdomain, who is then filed " +
      "'other' while the segment arithmetic still balances and nothing notices",
  );
}

// ---------------------------------------------------------------------------
// R9 replaces "brief_opens_7d >= brief_open_users_7d", which applied the same
// FILTER twice. This bounds the ratio instead of merely ordering it.
// ---------------------------------------------------------------------------
{
  let briefsPerDay = null;
  try {
    const briefs = await rows(
      `briefings?select=briefing_type,briefing_date&briefing_date=gte.${D7.slice(0, 10)}`,
    );
    const days = new Set(briefs.map((b) => b.briefing_date)).size;
    briefsPerDay = days ? briefs.length / days : null;
  } catch {
    briefsPerDay = null;
  }
  if (briefsPerDay === null) notRun("could not read briefings, so R9's bound has no source");

  // The MAXIMUM per-opener rate, not the mean. A mean over twelve readers hides
  // one account emitting 195 opens: it dilutes to 2.56 and passes a bound of
  // 5.50 while the defect is untouched. The max is what actually fires.
  const perUser = new Map();
  for (const e of briefOpen7d) {
    if (!dimIds.has(e.user_id)) continue;
    perUser.set(e.user_id, (perUser.get(e.user_id) ?? 0) + 1);
  }
  const counts = [...perUser.values()].sort((a, b) => b - a);
  const opensInPop = counts.reduce((a, b) => a + b, 0);
  const maxPerDay = counts.length ? counts[0] / 7 : 0;
  const bound = briefsPerDay * REFRESH_FACTOR;
  check(
    "R9",
    "no single reader exceeds briefs published per day times a refresh factor",
    maxPerDay <= bound,
    `opens=${opensInPop} openers=${counts.length} top_per_user=[${counts.slice(0, 5).join(", ")}] ` +
      `max_per_day=${maxPerDay.toFixed(2)} bound=${bound.toFixed(2)} ` +
      `(briefs_per_day=${briefsPerDay.toFixed(2)} x refresh_factor=${REFRESH_FACTOR})`,
    "it fails now, because the brief-open emit re-fires on every remount. It " +
      "would also fail if brief supply stopped, driving the bound to zero, which " +
      "is why the bound is computed from the briefings table and not hard-coded",
  );
}

// ---------------------------------------------------------------------------
// R10 replaces "active_30d >= weekly_actives", nested windows that could not
// fail. Set CONTAINMENT, not a count comparison, so it fires on the first user
// whose session never refreshed.
// ---------------------------------------------------------------------------
{
  const events30d = await allRows(`user_events?select=user_id&created_at=gte.${D30}`);
  const actors30 = new Set(events30d.map((e) => e.user_id).filter((u) => dimIds.has(u)));
  const signedIn30 = new Set(
    dimUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at >= D30).map((u) => u.id),
  );
  const orphans = [...actors30].filter((u) => !signedIn30.has(u));
  check(
    "R10",
    "every event-active user in 30d also has a sign-in in 30d",
    orphans.length === 0,
    `event_active_30d=${actors30.size} signed_in_30d=${signedIn30.size} ` +
      `active_without_signin=${orphans.length}`,
    "a long-lived JWT letting a reader emit events for weeks with no new " +
      "sign-in; a bulk import writing auth rows with a NULL last_sign_in_at; " +
      "events backfilled with a created_at predating their own user's signup",
  );
}

// ---------------------------------------------------------------------------
// R12 replaces "companies <= memo rows", which compared disjoint sources and
// was semantically vacuous. Asserts memo rows actually carry a company.
// ---------------------------------------------------------------------------
const memoRows = await allRows(
  "outputs?select=user_id,created_at,tc:content->>target_company&output_type=eq.memo",
);
{
  const withCompany = memoRows.filter((r) => r.tc && String(r.tc).trim()).length;
  check(
    "R12",
    "every memo row carries a resolvable target company",
    withCompany === memoRows.length,
    `memo_rows=${memoRows.length} with_target_company=${withCompany} ` +
      `without=${memoRows.length - withCompany} ` +
      `distinct=${new Set(memoRows.map((r) => (r.tc ?? "").trim().toLowerCase()).filter(Boolean)).size}`,
    "it fails now. It fails harder if the memo generator writes content with no " +
      "target_company key, or moves it to another key, at which point the " +
      "companies-researched card silently drops to the quota table alone",
  );
}

// ---------------------------------------------------------------------------
// 12b KEPT, the assertion the audit ADDED and which already failed. Scoped to
// dim_users on both sides, so a population mismatch cannot explain it away.
// ---------------------------------------------------------------------------
{
  const memoEvents = await allRows("user_events?select=user_id,created_at&event_type=eq.memo_generated");
  const evAll = memoEvents.filter((e) => dimIds.has(e.user_id)).length;
  const arAll = memoRows.filter((r) => dimIds.has(r.user_id)).length;
  const ev30 = memoEvents.filter((e) => dimIds.has(e.user_id) && e.created_at >= D30).length;
  const ar30 = memoRows.filter((r) => dimIds.has(r.user_id) && r.created_at >= D30).length;
  check(
    "12b",
    "memo events reconcile with memo artifacts, like for like inside dim_users",
    evAll === arAll && ev30 === ar30,
    `all_time events=${evAll} artifacts=${arAll} ratio=${arAll ? (evAll / arAll).toFixed(2) : "n/a"}x | ` +
      `30d events=${ev30} artifacts=${ar30}`,
    "it fails now. memo_generated is emitted client-side on open or retry while " +
      "the artifact write is server-side and conditional, so the event " +
      "over-emits; it fails the other way when an artifact is written by a path " +
      "that emits no event, such as a server-side regeneration or a backfill",
  );
}

// ---------------------------------------------------------------------------
// NEW-a. auth.users reconciles to dim_users through the exclusion list.
// ---------------------------------------------------------------------------
{
  const EXPLICIT = [
    "noahhanning03@gmail.com",
    "lucasturcuato@gmail.com",
    "claude-agent@signalera.ai",
  ];
  const DOMAINS = ["signalera-internal.com", "anthropic-test.local"];

  // CANONICAL, matching the dim_users predicate: the local part is truncated at
  // the first '+' before comparing. Plus addressing otherwise defeats an exact
  // NOT IN, which is how the e2e harness account ended up inside the real-user
  // population and produced 195 of 227 brief-open events in one week.
  const canonical = (raw) => {
    const [local = "", domain = ""] = String(raw).toLowerCase().split("@");
    return `${local.split("+")[0]}@${domain}`;
  };

  let byAddress = 0;
  let byDomain = 0;
  let byPlusVariant = 0;
  let nullEmail = 0;
  let padded = 0;
  for (const u of authUsers) {
    const raw = u.email ?? null;
    if (!raw) {
      nullEmail++;
      continue;
    }
    if (raw !== raw.trim()) padded++;
    const e = String(raw).toLowerCase().trim();
    const c = canonical(e);
    if (EXPLICIT.includes(e)) byAddress++;
    else if (EXPLICIT.includes(c)) byPlusVariant++;
    else if (DOMAINS.includes(e.split("@")[1] ?? "")) byDomain++;
  }
  const excluded = byAddress + byPlusVariant + byDomain;
  const expected = authUsers.length - excluded;
  check(
    "NEW-a",
    "auth.users minus the CANONICAL exclusion list equals dim_users exactly",
    expected === dimIds.size,
    `auth_users=${authUsers.length} excluded=${excluded} (by_address=${byAddress} ` +
      `by_plus_variant=${byPlusVariant} by_domain=${byDomain}) expected=${expected} ` +
      `dim_users=${dimIds.size} | null_email=${nullEmail} whitespace_padded=${padded}`,
    "it fails NOW, by 5, because the deployed dim_users matches the FULL address " +
      "while this assertion canonicalizes: five plus-addressed test accounts are " +
      "inside the population. It passes once the loop-fix migration lands. It " +
      "would also fail for a NULL email, which makes NOT IN evaluate to NULL and " +
      "drops the row silently; for an address stored with a trailing space, which " +
      "defeats the equality and readmits a founder account; or for a soft-deleted " +
      "auth row the Admin API still lists",
  );
}

// ---------------------------------------------------------------------------
// NEW-c. No plus-addressed variant of an excluded address is in dim_users.
//
// The sharp form of NEW-a, which can in principle be satisfied by two errors
// cancelling. This one names the exact leak that happened: the exclusion lived
// in the view definition, which is the right place, but it matched the FULL
// address, so every +tag variant walked straight into the real-user population.
// ---------------------------------------------------------------------------
{
  const EXPLICIT_C = [
    "noahhanning03@gmail.com",
    "lucasturcuato@gmail.com",
    "claude-agent@signalera.ai",
  ];
  const canon = (raw) => {
    const [local = "", domain = ""] = String(raw).toLowerCase().split("@");
    return `${local.split("+")[0]}@${domain}`;
  };
  const leaked = authUsers.filter(
    (u) =>
      u.email &&
      String(u.email).includes("+") &&
      EXPLICIT_C.includes(canon(u.email)) &&
      dimIds.has(u.id),
  );
  // Report the +tags, never the addresses.
  const tags = leaked.map((u) => String(u.email).toLowerCase().split("@")[0].split("+")[1]);
  check(
    "NEW-c",
    "no plus-addressed variant of an excluded address is inside dim_users",
    leaked.length === 0,
    `plus_variants_in_dim_users=${leaked.length}` +
      (tags.length ? ` tags=[${tags.join(", ")}]` : ""),
    "a new test address is minted as a +tag on an already-excluded address while " +
      "the predicate matches the full string instead of the canonical one. That " +
      "is what happened: the e2e harness runs on a schedule and produced 195 of " +
      "227 brief-open events in one week from inside the real-user population",
  );
}

// ---------------------------------------------------------------------------
// NEW-b. Cohort roster sums to the cohort summary's All row.
// ---------------------------------------------------------------------------
{
  let members, byCohort;
  try {
    members = await rows("internal_kpi_cohort_members?select=cohort_key,member_count");
    byCohort = await rows("internal_kpi_summary_by_cohort?select=cohort_key,total_users");
  } catch (e) {
    notRun(`cohort views unreadable: ${String(e).slice(0, 160)}`);
  }
  const allRow = byCohort.find((r) => r.cohort_key === "All");
  const sum = members.reduce((a, r) => a + Number(r.member_count), 0);

  // Degenerate guard. One bucket holding everyone makes this equal by
  // circumstance rather than by construction, which is not a measurement.
  if (members.length <= 1) {
    check(
      "NEW-b",
      "cohort roster sums to the cohort summary All row",
      sum === Number(allRow?.total_users),
      `sum(member_count)=${sum} All.total_users=${allRow?.total_users} ` +
        `buckets=${members.length} DEGENERATE: one bucket holds every user, so ` +
        `this is equal by circumstance. It becomes a real test on the first ` +
        `attributed signup.`,
      "a user attributed to two cohort keys, double counting in the sum while " +
        "All deduplicates; a cohort key with no roster row; the roster counting " +
        "auth.users while the summary counts dim_users",
    );
  } else {
    check(
      "NEW-b",
      "cohort roster sums to the cohort summary All row",
      sum === Number(allRow?.total_users),
      `sum(member_count)=${sum} All.total_users=${allRow?.total_users} buckets=${members.length}`,
      "a user attributed to two cohort keys; a cohort key with no roster row; " +
        "the roster and the summary computed over different base populations",
    );
  }
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length} assertions, ${results.length - failed.length} passed, ` +
  `${failed.length} failed, ${requests} HTTP requests`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.id).join(", ")}`);
  const KNOWN = new Set(["A6", "R9", "R10", "R12", "12b", "NEW-a", "NEW-c"]);
  const regressions = failed.filter((r) => !KNOWN.has(r.id)).map((r) => r.id);
  console.error(
    `KNOWN live defects, shipped failing on purpose and recorded in FIXES.md: ` +
      `${[...KNOWN].join(", ")}.`,
  );
  console.error(
    regressions.length
      ? `REGRESSIONS, not previously known: ${regressions.join(", ")}`
      : "No regressions: every failure above is a known defect.",
  );
  process.exit(1);
}
console.log("All invariants passed.");
