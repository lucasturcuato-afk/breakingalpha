// Unit tests for scripts/read-lint.mjs, the detector for a read that did not
// answer rendering as a read that answered empty.
//
// WHY THIS FILE EXISTS. A lint nobody trusts never gets ratcheted, and the
// only thing that earns trust is a fixture set where the answer is known
// before the script runs. Two halves:
//
//   POSITIVES  the six known instances, reduced to the shape that makes each
//              one an instance. Every one is a real line in this repo at
//              70dd7a18, cited by path above its fixture.
//   NEGATIVES  a sample of the genuinely-optional defaults. These are the
//              reason precision matters more than recall here: there are far
//              more of them than of the positives, and a detector that fires
//              on them gets switched off, at which point it detects nothing.
//
// The negatives are not hypothetical either. Four of them were LIVE FALSE
// POSITIVES of the first working version of this script, found by hand
// checking a sample and then fixed in the detector rather than waved through.
// They are locked here so the fix cannot regress.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lintText } from "../../scripts/read-lint.mjs";

interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

function rules(src: string, file = "fixture.ts"): string[] {
  return (lintText(file, src) as Finding[]).map((f) => f.rule).sort();
}

function clean(src: string, file = "fixture.ts"): void {
  const found = lintText(file, src) as Finding[];
  assert.deepEqual(
    found.map((f) => `${f.rule}@${f.line}`),
    [],
    `expected no findings, got: ${found.map((f) => f.rule).join(", ")}`,
  );
}

/* =====================================================================
   POSITIVES. The six known instances.
   ===================================================================== */

// 1. src/app/share/brief/[id]/page.tsx:117. The most public surface in the
//    product. A stranger opening a link to a brief that EXISTS is told 404
//    when the read faulted.
test("known instance 1: a share page folds a fault and a miss into one 404", () => {
  const src = `
    async function page(id: string) {
      const { data, error } = await supabase
        .from("briefings").select("id, headline").eq("id", id).maybeSingle();
      if (error || !data) {
        return notFound();
      }
      return render(data);
    }
  `;
  assert.deepEqual(rules(src), ["error-or-empty"]);
});

// 2. src/app/company/page.tsx:309. No status check at all, so a 500 draws an
//    empty company list.
test("known instance 2: a fetch whose status is never named defaults to empty", () => {
  const src = `
    async function load() {
      const res = await fetch("/api/companies?limit=500");
      const json = await res.json();
      setCompanies(map(json.companies ?? []));
    }
  `;
  assert.deepEqual(rules(src), ["defaulted-unchecked-read"]);
});

// 3. src/app/api/profile/insights/route.ts:101. Answers with zeros on a failed
//    read, so the caller cannot tell "no activity" from "we could not look".
test("known instance 3: a destructure that takes data and not error", () => {
  const src = `
    async function handler() {
      const { data: events } = await supabase
        .from("user_events").select("event_type").eq("user_id", id).limit(1000);
      const counts: Record<string, number> = {};
      for (const ev of events ?? []) {
        counts[ev.event_type] = (counts[ev.event_type] ?? 0) + 1;
      }
      return json({ counts });
    }
  `;
  assert.deepEqual(rules(src), ["defaulted-unchecked-read"]);
});

// 4. src/app/api/export/watchlist-xlsx/route.ts:64. Ships an empty Articles
//    sheet as a complete file. A file that looks complete and is not is worse
//    than a failed download, because the reader keeps it.
test("known instance 4: an export defaults its rows and writes the file anyway", () => {
  const src = `
    async function handler() {
      const { data: articles } = await supabase
        .from("watchlist_articles").select("identifier, title").limit(2000);
      const rows = [["Identifier", "Title"]];
      for (const a of articles ?? []) rows.push([a.identifier, a.title]);
      return sheet(rows);
    }
  `;
  assert.deepEqual(rules(src), ["defaulted-unchecked-read"]);
});

// 5. src/app/api/export/watchlist-pdf/route.ts:54. The settled-array shape.
//    Nothing anywhere names articlesRes.error, so the printed report simply
//    has no Recent Coverage under any entry.
test("known instance 5: a Promise.all result whose .error is never named", () => {
  const src = `
    async function handler() {
      const [briefsRes, articlesRes] = await Promise.all([
        supabase.from("watchlist_briefs").select("identifier"),
        supabase.from("watchlist_articles").select("identifier, title"),
      ]);
      const byIdent: Record<string, string> = {};
      for (const b of briefsRes.data ?? []) byIdent[b.identifier] = b.identifier;
      return { articles: articlesRes.data ?? [] };
    }
  `;
  assert.deepEqual(rules(src), [
    "defaulted-unchecked-read",
    "defaulted-unchecked-read",
  ]);
});

// 6. src/components/thesis/thesis-detail-panel.tsx:278. A 500 from the memo
//    route draws the literal words "No memo generated." to the reader.
test("known instance 6: a failed POST draws the nothing-here string", () => {
  const src = `
    async function generate() {
      const res = await fetch("/api/memo", { method: "POST" });
      const data = await res.json();
      const text = data.memo || "No memo generated.";
      setMemoContent(text);
    }
  `;
  assert.deepEqual(rules(src), ["defaulted-unchecked-read"]);
});

/* =====================================================================
   POSITIVES, check 3.
   ===================================================================== */

test("a .single() whose error is inspected without PGRST116 is reported", () => {
  const src = `
    async function load(id: string) {
      const { data, error } = await supabase
        .from("theses").select("id, user_id").eq("id", id).single();
      if (error) return null;
      return data;
    }
  `;
  assert.ok(rules(src).includes("single-without-pgrst116"));
});

test("naming PGRST116 in the same scope clears check 3", () => {
  const src = `
    async function load(id: string) {
      const { data, error } = await supabase
        .from("theses").select("id, user_id").eq("id", id).single();
      if (error && error.code !== "PGRST116") throw new Error("read did not answer");
      return data ?? null;
    }
  `;
  assert.ok(!rules(src).includes("single-without-pgrst116"));
});

test("maybeSingle carries no code to discriminate, so check 3 leaves it alone", () => {
  const src = `
    async function load(id: string) {
      const { data, error } = await supabase
        .from("theses").select("id").eq("id", id).maybeSingle();
      if (error) return null;
      return data;
    }
  `;
  assert.ok(!rules(src).includes("single-without-pgrst116"));
});

/* =====================================================================
   NEGATIVES. Genuinely-optional defaults and already-honest sites.
   ===================================================================== */

test("negative: a read that names its error channel is clean however it defaults", () => {
  const src = `
    async function load() {
      const { data, error } = await supabase.from("articles").select("id");
      if (error) return { rows: null, stage: "error" };
      return { rows: data ?? [], stage: "ready" };
    }
  `;
  clean(src);
});

test("negative: a default on a plain local is not a read", () => {
  const src = `
    function widths(input: { size?: number; label?: string }) {
      const size = input.size ?? 12;
      const label = input.label || "Untitled";
      return { size, label };
    }
  `;
  clean(src);
});

test("negative: a default on a function argument is not a read", () => {
  const src = `
    function join(parts: string[] | null, sep?: string) {
      return (parts ?? []).join(sep ?? ", ");
    }
  `;
  clean(src);
});

test("negative: a fetch whose status IS named is clean", () => {
  const src = `
    async function load() {
      const res = await fetch("/api/companies");
      if (!res.ok) throw new Error("read did not answer");
      const json = await res.json();
      return json.companies ?? [];
    }
  `;
  clean(src);
});

// LIVE FALSE POSITIVE, fixed in the detector. src/app/dashboard/page.tsx.
// The error is named on a callback parameter, never on `total`, so a search
// for `total.error` finds nothing and a properly-checked site looked broken.
test("negative: the array idiom counts as consulting the error", () => {
  const src = `
    async function counts() {
      const [total, bull, bear] = await Promise.all([
        supabase.from("articles").select("id", { count: "exact" }),
        supabase.from("articles").select("id", { count: "exact" }),
        supabase.from("articles").select("id", { count: "exact" }),
      ]);
      const failed = [total, bull, bear].filter((r) => r.error);
      if (failed.length > 0) {
        setCountsFailed(true);
        return;
      }
      setStoryCount(total.count ?? 0);
    }
  `;
  clean(src);
});

// LIVE FALSE POSITIVE, fixed in the detector. src/lib/radar-calls-data.ts
// declares four separate `const { data ... }` in one function body. Taking
// the first match made every later use read the first declaration's answer.
test("negative: a later declaration shadows an earlier one of the same name", () => {
  const src = `
    async function load(ids: string[]) {
      const { data } = await supabase.from("outcomes").select("claim_id").in("claim_id", ids);
      const first = data ?? [];
      const { data: rows, error: evErr } = await supabase
        .from("claim_evidence").select("claim_id").in("claim_id", ids);
      if (!evErr) {
        for (const row of rows ?? []) first.push(row);
      }
      return first;
    }
  `;
  // Exactly one finding, on the FIRST read. The second names its error.
  assert.deepEqual(rules(src), ["defaulted-unchecked-read"]);
});

// LIVE FALSE POSITIVE, fixed in the detector. src/lib/internal-kpis.ts.
// A branch that throws is not a rendering. It propagates, and the fault
// survives to whoever owns the stack.
test("negative: a branch that throws conflates nothing", () => {
  const src = `
    async function fetchCohorts() {
      const { data, error } = await supabase.from("kpi_activation").select("*");
      if (error || !data) {
        throw new Error("kpi_activation query did not answer: " + String(error?.message));
      }
      return data;
    }
  `;
  clean(src);
});

// LIVE FALSE POSITIVE, fixed in the detector. src/components/trends-mobile.
// The branch logs error?.message and draws its own failure state, with a
// comment saying a failed read is never an empty list. Firing on the fix
// would train people to stop reading the output.
test("negative: a branch that uses the error is not hiding it", () => {
  const src = `
    function load() {
      query.then(({ data, error }) => {
        if (error || !data) {
          console.error("[trends] read did not answer:", error?.message);
          setFailed(true);
          return;
        }
        setRows(data);
      });
    }
  `;
  clean(src);
});

// A ruling, not an oversight. Both arms mean the same thing to the only
// decision downstream: nobody is signed in, and the request is denied either
// way. There is no third state to separate.
test("negative: an auth presence test is a ruling, not this defect", () => {
  const src = `
    async function guard() {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return { supabase, user: null };
      }
      return { supabase, user };
    }
  `;
  clean(src);
});

// A .single() hanging off a write is not a read, and PGRST116 there means
// the write matched no row, which is a different question.
test("negative: check 3 leaves a write chain alone", () => {
  const src = `
    async function save(id: string) {
      const { data, error } = await supabase
        .from("user_profiles").upsert({ id }, { onConflict: "id" }).select().single();
      if (error) return null;
      return data;
    }
  `;
  assert.ok(!rules(src).includes("single-without-pgrst116"));
});

test("negative: a boolean OR in condition position is not a default", () => {
  const src = `
    async function load() {
      const { data: rows } = await supabase.from("articles").select("id");
      if (!rows || rows.length === 0) {
        return { rows: [], stage: "empty" };
      }
      return { rows, stage: "ready" };
    }
  `;
  // The absence test itself must not be read as a default. The one finding a
  // stricter reader might want here is check 1 on a later use, and there is
  // no later use in this fixture.
  assert.ok(!rules(src).includes("defaulted-unchecked-read"));
});

/* =====================================================================
   The detector's own contract.
   ===================================================================== */

test("findings carry a file and a one-based line", () => {
  const src = [
    "async function f() {",
    '  const { data } = await supabase.from("t").select("id");',
    "  return data ?? [];",
    "}",
  ].join("\n");
  const found = lintText("some/where.ts", src) as Finding[];
  assert.equal(found.length, 1);
  assert.equal(found[0].file, "some/where.ts");
  assert.equal(found[0].line, 3);
});

test("a tsx file parses as tsx", () => {
  const src = `
    function View() {
      const items: string[] = [];
      return <div className="p-4">{items.length}</div>;
    }
  `;
  clean(src, "fixture.tsx");
});
