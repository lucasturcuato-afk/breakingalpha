/**
 * Every table read through the user's session client must have a policy.
 *
 * WHY. RLS enabled with zero policies does not error: a session read returns
 * [] and a session write is rejected, and the route renders a confident empty
 * state. thesis_notes sat in that state from the day its route shipped (the
 * table held zero rows to the service role on 2026-09-05), and the follow
 * matcher's RPC read content_embeddings the same way. Both fixes are SQL that
 * a human applies; this test is what stops the next one.
 *
 * WHAT IT PINS. For every file that binds a client from getSupabaseWithUser,
 * every table that client `.from()`s must be covered by a CREATE POLICY in a
 * .sql file committed to this repo (any directory), OR sit in the dated
 * allowlist below of tables whose policy was verified live but was created
 * outside the repo. The allowlist is the debt, not the exemption: move a table
 * out of it by committing its policy.
 *
 * It reads files, not the database, so it runs in CI. It cannot see a policy
 * that exists only in Studio, which is exactly why the allowlist carries the
 * date and the method of verification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "venv", ".git", ".claude", "frontend"]);

/**
 * Tables read through the session client whose policy is NOT in repo SQL.
 * Verified 2026-09-05 through PostgREST: an anon-key read returns rows, which
 * is only possible with a permissive SELECT policy (or RLS off, which grants
 * the same read). Owner-scoped tables cannot be verified that way and are
 * listed with the query that settles it.
 */
const POLICY_OUTSIDE_REPO: Record<string, string> = {
  articles: "anon read returns rows, 2026-09-05",
  aliases: "anon read returns rows, 2026-09-05",
  company_mentions: "anon read returns rows, 2026-09-05",
  pattern_library: "anon read returns rows, 2026-09-05",
  source_credibility: "anon read returns rows, 2026-09-05",
  weekly_digests: "anon read returns rows, 2026-09-05",
  outputs:
    "owner-scoped; not provable through PostgREST. Settle with: SELECT policyname, cmd FROM pg_policies WHERE tablename = 'outputs'",
  output_user_feedback:
    "owner-scoped; not provable through PostgREST. Settle with: SELECT policyname, cmd FROM pg_policies WHERE tablename = 'output_user_feedback'",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL_FILES = walk(ROOT);
const SQL_TEXT = ALL_FILES.filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Tables named in a CREATE POLICY anywhere in committed SQL. */
function policiedTables(): Set<string> {
  const out = new Set<string>();
  const re = /CREATE POLICY[\s\S]*?\bON\s+(?:public\.)?"?([a-z_]+)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL_TEXT))) out.add(m[1].toLowerCase());
  return out;
}

/** table -> files, for every `.from("table")` on a client bound from getSupabaseWithUser. */
export function sessionClientReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  const srcFiles = ALL_FILES.filter(
    (f) => f.includes(`${join(ROOT, "src")}/`) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  for (const f of srcFiles) {
    const s = readFileSync(f, "utf8");
    if (!s.includes("getSupabaseWithUser")) continue;
    const names = new Set<string>();
    const bind = /const\s*\{\s*supabase(?:\s*:\s*(\w+))?\s*(?:,[^}]*)?\}\s*=\s*await\s+getSupabaseWithUser\(/g;
    let b: RegExpExecArray | null;
    while ((b = bind.exec(s))) names.add(b[1] ?? "supabase");
    for (const n of names) {
      const from = new RegExp(`\\b${n}\\s*\\.\\s*from\\(\\s*["']([a-z_]+)["']`, "g");
      let m: RegExpExecArray | null;
      while ((m = from.exec(s))) {
        const set = reads.get(m[1]) ?? new Set<string>();
        set.add(relative(ROOT, f));
        reads.set(m[1], set);
      }
    }
  }
  return reads;
}

test("the scanner sees the session client's reads (guards the test itself)", () => {
  const reads = sessionClientReads();
  // thesis_notes is the case this test exists for; if the scanner cannot see
  // it, every other assertion here passes vacuously.
  assert.ok(reads.has("thesis_notes"), "scanner did not find thesis_notes read via the session client");
  assert.ok(reads.has("watchlist"), "scanner did not find the watchlist reads");
});

test("thesis_notes has an owner-scoped policy committed (sql/0039)", () => {
  const p = policiedTables();
  assert.ok(p.has("thesis_notes"), "no CREATE POLICY ... ON thesis_notes in committed SQL");
  assert.match(SQL_TEXT, /CREATE POLICY thesis_notes_owner_select[\s\S]*?auth\.uid\(\) = user_id/);
});

test("every table read through the session client has a policy in repo SQL, or a dated live verification", () => {
  const reads = sessionClientReads();
  const p = policiedTables();
  const missing: string[] = [];
  for (const [table, files] of reads) {
    if (p.has(table)) continue;
    if (table in POLICY_OUTSIDE_REPO) continue;
    missing.push(`${table} (read in ${[...files].join(", ")})`);
  }
  assert.deepEqual(
    missing,
    [],
    "session-client reads of tables with no committed policy. Under RLS these return [] with no error. " +
      "Commit the policy (preferred) or, after verifying it live, add the table to POLICY_OUTSIDE_REPO with the date.",
  );
});

test("the allowlist only names tables that are still read through the session client", () => {
  const reads = sessionClientReads();
  for (const table of Object.keys(POLICY_OUTSIDE_REPO)) {
    assert.ok(reads.has(table), `${table} is allowlisted but no longer read via the session client; drop it`);
  }
});

test("the allowlist never covers a table whose policy IS committed", () => {
  const p = policiedTables();
  for (const table of Object.keys(POLICY_OUTSIDE_REPO)) {
    assert.ok(!p.has(table), `${table} has a committed policy; remove it from the allowlist`);
  }
});
