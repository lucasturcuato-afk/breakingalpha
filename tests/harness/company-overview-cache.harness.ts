/**
 * MEASUREMENT HARNESS for the Coverage Primer overview cache.
 *
 * NOT part of `npm run test:unit`. That script globs `src/**' + '/*.test.ts` and
 * `tests/unit/**' + '/*.test.ts`; this file is in neither, on purpose, because it
 * needs a Node flag the script does not pass. Run it explicitly:
 *
 *   npx tsx --experimental-test-module-mocks --test tests/harness/company-overview-cache.harness.ts
 *   ENUM_HAS_COMPANY_OVERVIEW=1 npx tsx --experimental-test-module-mocks --test tests/harness/company-overview-cache.harness.ts
 *
 * Imports and invokes the REAL POST handler from
 * src/app/api/company-overview/route.ts. Nothing is ported or reimplemented.
 *
 * The REAL @supabase/supabase-js client runs: real query building, real
 * PostgREST URL construction, real error handling (the code path that returns
 * errors in the result object instead of throwing, which is what hid this bug).
 * Only the network is stubbed, at globalThis.fetch, and it replies with the
 * exact PostgREST error bodies captured read-only from production.
 *
 * Stubbed: global fetch, auth (getSupabaseWithUser), Gemini (@google/genai,
 * with a call COUNTER). Everything else is production code.
 *
 * Enum members come from tests/fixtures/output-type-enum.json, captured from
 * the production database, not typed by hand.
 *
 * ENUM_HAS_COMPANY_OVERVIEW=0 models production TODAY (migration not applied).
 * ENUM_HAS_COMPANY_OVERVIEW=1 models production AFTER the migration is applied.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://harness.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-key";
process.env.GEMINI_API_KEY = "harness-key";

const fixture = JSON.parse(
  readFileSync(`${REPO}/tests/fixtures/output-type-enum.json`, "utf8")
) as { observed: string[]; pending: { value: string }[] };

const MIGRATION_APPLIED = process.env.ENUM_HAS_COMPANY_OVERVIEW === "1";
const ENUM_MEMBERS = new Set(
  MIGRATION_APPLIED ? [...fixture.observed, ...fixture.pending.map((p) => p.value)] : fixture.observed
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const counters = {
  geminiCalls: 0,
  httpGet: 0,
  httpPost: 0,
  http400: 0,
  rowsWritten: 0,
};

interface Row {
  id: string;
  output_type: string;
  content: Record<string, unknown>;
  created_at: string;
}
const table: Row[] = [];

function pgrst400(code: string, message: string) {
  return new Response(JSON.stringify({ code, details: null, hint: null, message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// PostgREST-shaped network stub. Enforces exactly the two constraints Postgres
// enforces on this table, with the exact SQLSTATE and message text observed in
// production.
// ---------------------------------------------------------------------------
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? (input as Request).method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? (input as Request).headers);

  // Gemini. The REAL @google/genai client builds and issues this request; we
  // count it at the wire and hand back a well-formed generateContent response.
  // This is the number that costs money.
  if (url.hostname.includes("generativelanguage.googleapis.com")) {
    counters.geminiCalls += 1;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: "NVIDIA designs GPUs and networking silicon for data center and gaming markets.",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (method === "GET") {
    counters.httpGet += 1;
    const typeFilter = url.searchParams.get("output_type");
    if (typeFilter?.startsWith("eq.")) {
      const val = typeFilter.slice(3);
      if (!ENUM_MEMBERS.has(val)) {
        counters.http400 += 1;
        return pgrst400("22P02", `invalid input value for enum output_type_enum: "${val}"`);
      }
    }
    const companyFilter = url.searchParams.get("content->>target_company") ?? "";
    const company = companyFilter.startsWith("eq.") ? companyFilter.slice(3) : null;
    const type = typeFilter?.slice(3);
    const hits = table
      .filter((r) => r.output_type === type && r.content.target_company === company)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({ content: r.content }));
    return new Response(JSON.stringify(hits.slice(0, 1)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (method === "POST") {
    counters.httpPost += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const payload = Array.isArray(body) ? body[0] : body;

    const t = payload.output_type;
    if (!ENUM_MEMBERS.has(t)) {
      counters.http400 += 1;
      return pgrst400("22P02", `invalid input value for enum output_type_enum: "${t}"`);
    }
    if (payload.source_id !== undefined && payload.source_id !== null && !UUID_RE.test(String(payload.source_id))) {
      counters.http400 += 1;
      return pgrst400("22P02", `invalid input syntax for type uuid: "${payload.source_id}"`);
    }

    const row: Row = {
      id: `00000000-0000-4000-8000-${String(table.length + 1).padStart(12, "0")}`,
      output_type: t,
      content: payload.content,
      created_at: new Date(Date.now() + table.length).toISOString(),
    };
    table.push(row);
    counters.rowsWritten += 1;

    const wantsObject = (headers.get("Accept") ?? "").includes("pgrst.object");
    const out = { id: row.id };
    return new Response(JSON.stringify(wantsObject ? out : [out]), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

mock.module(`${REPO}/src/lib/supabase-server.ts`, {
  namedExports: {
    getSupabaseWithUser: async () => ({ user: { id: "11111111-2222-3333-4444-555555555555" } }),
  },
});

const BODY = {
  company: "NVIDIA",
  ticker: "NVDA",
  sector: "Technology",
  industry: "Semiconductors",
  summary:
    "NVIDIA Corporation provides graphics and compute solutions. Its segments include Graphics and Compute & Networking, and it sells GPUs for data center, gaming, and professional visualization markets worldwide.",
};

function req() {
  return new Request("http://localhost:3000/api/company-overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(BODY),
  });
}

test(`two identical Primer loads, migration applied = ${MIGRATION_APPLIED}`, async () => {
  const { POST } = await import(`${REPO}/src/app/api/company-overview/route.ts`);

  const r1 = await POST(req() as never);
  const b1 = await r1.json();
  const afterFirst = { ...counters };

  const r2 = await POST(req() as never);
  const b2 = await r2.json();

  console.log("\n================= MEASUREMENT =================");
  console.log(`migration applied:          ${MIGRATION_APPLIED}`);
  console.log(`enum members in force:      ${ENUM_MEMBERS.size}`);
  console.log(`load 1 response:            ${JSON.stringify(b1)}`);
  console.log(`  gemini calls after load 1: ${afterFirst.geminiCalls}`);
  console.log(`load 2 response:            ${JSON.stringify(b2)}`);
  console.log(`TOTAL gemini calls:         ${counters.geminiCalls}`);
  console.log(`TOTAL PostgREST GET:        ${counters.httpGet}`);
  console.log(`TOTAL PostgREST POST:       ${counters.httpPost}`);
  console.log(`TOTAL PostgREST 400s:       ${counters.http400}`);
  console.log(`rows in outputs at end:     ${table.length}`);
  console.log("===============================================\n");

  if (MIGRATION_APPLIED) {
    assert.equal(counters.geminiCalls, 1, "second load must NOT reach Gemini");
    assert.equal(b2.cached, true, "second load must be served from cache");
    assert.equal(b1.cache_write_ok, true, "first load must land its cache row");
    assert.equal(table.length, 1, "exactly one row per company");
    assert.equal(counters.http400, 0, "no 22P02 once the enum member exists");
  } else {
    assert.equal(counters.geminiCalls, 2, "today every load reaches Gemini");
    assert.equal(b2.cached, false);
    assert.equal(b1.cache_write_ok, false, "today the cache write never lands");
    assert.equal(table.length, 0, "today outputs gains no row");
  }
});
