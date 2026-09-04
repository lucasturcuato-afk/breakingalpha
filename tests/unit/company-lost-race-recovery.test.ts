// Lost-race (23505) recovery on the `companies` insert paths.
//
// THE DEFECT. `companies` carries THREE unique indexes and the old recovery
// probed exactly one of them:
//
//     companies_name_key          UNIQUE (name)
//     companies_name_norm_unique  UNIQUE (lower(btrim(name))) WHERE sec_cik IS NULL
//     companies_sec_cik_unique    UNIQUE (sec_cik)            WHERE sec_cik IS NOT NULL
//
// The two partial ones carry no pg_constraint row, so an audit that reads
// constraints alone reports them as absent. resolveOrCreateCompany inserts with
// sec_cik NULL, so its row sits INSIDE companies_name_norm_unique; a conflict
// there names a row spelled differently in case or whitespace, `.eq("name",
// name)` returned nothing, `maybeSingle()` handed back null, and the function
// answered `not_found` for a company that exists. No error, no log, no counter.
//
// Every fixture uses the live Exxon cluster, because it is the case this hits
// most often and the one where the row that wins the race is itself a duplicate.
//
// Run: npx tsx --test tests/unit/company-lost-race-recovery.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CompanyConflictUnresolvedError,
  INDEX_PROBE_HINT,
  PROBE_EXACT_NAME,
  PROBE_LADDER,
  PROBE_NORM_NAME_ANY,
  PROBE_NORM_NAME_CIK_NULL,
  PROBE_SEC_CIK,
  conflictingIndexName,
  isUniqueViolation,
  probeOrder,
  resolveConflictingCompany,
  type CompanyRow,
} from "../../src/lib/company-conflict.ts";
import { escapeLikePattern } from "../../src/lib/like-escape.ts";

/**
 * resolveOrCreateCompany.ts opens with `import "server-only"`, which Next
 * resolves through a bundler alias rather than from node_modules (the package
 * is not installed). tsx has no such alias, so importing that file statically
 * fails to resolve before a single assertion runs.
 *
 * Pointing that one specifier at a harmless builtin and importing dynamically
 * is what lets the end-to-end tests at the bottom of this file exercise the
 * REAL function rather than a restatement of it. Scoped to this file; nothing
 * in tsconfig and nothing in the build changes.
 */
type ResolveOrCreate = (
  rawQuery: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps?: { svc?: any },
) => Promise<{
  status: string;
  created: boolean;
  company: { id: string; name: string; ticker: string | null } | null;
}>;

let _resolveOrCreate: ResolveOrCreate | null = null;

async function loadResolveOrCreateCompany(): Promise<ResolveOrCreate> {
  if (_resolveOrCreate) return _resolveOrCreate;
  const nodeModule = await import("node:module");
  const M = (nodeModule.default ?? nodeModule) as unknown as {
    _resolveFilename: (...args: unknown[]) => string;
  };
  const orig = M._resolveFilename;
  M._resolveFilename = function (this: unknown, request: unknown, ...rest: unknown[]) {
    if (request === "server-only") return orig.call(this, "node:util", ...rest);
    return orig.call(this, request, ...rest);
  } as typeof M._resolveFilename;
  const mod = await import("../../src/lib/data-access/resolveOrCreateCompany.ts");
  _resolveOrCreate = mod.resolveOrCreateCompany as unknown as ResolveOrCreate;
  return _resolveOrCreate;
}

// Read from prod 2026-09-04, SELECT only. Note the inversion: the busier row is
// the one with NO ticker and NO cik.
const EXXONMOBIL: CompanyRow = {
  id: "ab4bcf16-d848-43a8-9020-5d012a812f89",
  name: "ExxonMobil",
  ticker: null,
  sec_cik: null,
};
const EXXON: CompanyRow = {
  id: "3fdd6b31-746b-4605-9da5-5bbff329eec1",
  name: "Exxon",
  ticker: "XOM",
  sec_cik: 34088,
};

/**
 * Postgres ILIKE semantics, faithfully enough for the escape to matter.
 *
 * A BARE `%` or `_` is a WILDCARD; `\\%`, `\\_` and `\\\\` are literals. The fake has
 * to model this rather than just strip the escapes: a fake that treats an
 * unescaped `%` as a literal makes escapeLikePattern untestable, because
 * deleting the escape changes nothing it can see. Found by mutation, which is
 * the only way a fidelity gap like this shows up.
 */
function ilikeRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (ch === "%") out += "[\\s\\S]*";
    else if (ch === "_") out += "[\\s\\S]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

type Filter = [kind: string, col: string, val: unknown];
type Call = { table: string; op: string; filters: Filter[]; payload?: unknown };

/**
 * A `companies` table that answers each probe the way Postgres would.
 *
 * `rows` is the table. The router evaluates each probe's filters against it, so
 * the test never hand-feeds an answer per probe: the fixture is the DATA and
 * which probe finds what falls out of it. Hand-fed answers would pass no matter
 * which probes ran.
 */
class FakeDb {
  calls: Call[] = [];
  insertError: { code: string; message: string } | null = null;
  readError: string | null = null;
  /**
   * Rows that appear ONLY once the companies insert has fired. That is what a
   * lost race IS: every read before the insert saw an empty table, and the row
   * existed by the time the insert landed. Without it the guards in
   * resolveOrCreateCompany find the row first and step 4 is never reached, so
   * the test passes while proving nothing. Caught by mutation: reverting the
   * recovery to the old exact-name select left this test green.
   */
  appearsOnInsert: CompanyRow[] = [];

  constructor(public rows: CompanyRow[]) {}

  from = (table: string) => {
    const call: Call = { table, op: "", filters: [] };
    const chain = {
      select() {
        if (!call.op) call.op = "select";
        return chain;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        return chain;
      },
      upsert(payload: unknown) {
        call.op = "upsert";
        call.payload = payload;
        return chain;
      },
      eq(col: string, val: unknown) {
        call.filters.push(["eq", col, val]);
        return chain;
      },
      ilike(col: string, val: unknown) {
        call.filters.push(["ilike", col, val]);
        return chain;
      },
      is(col: string, val: unknown) {
        call.filters.push(["is", col, val]);
        return chain;
      },
      in(col: string, val: unknown) {
        call.filters.push(["in", col, val]);
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return chain.then((r: { data: unknown; error: unknown }) => ({
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
          error: r.error,
        }));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (resolve: any, reject?: any) =>
        Promise.resolve(this.answer(call)).then(resolve, reject),
    };
    return chain;
  };

  answer(call: Call): { data: unknown; error: unknown } {
    this.calls.push(call);
    if (call.op === "insert") {
      if (call.table === "companies" && this.insertError) {
        this.rows = [...this.rows, ...this.appearsOnInsert];
        this.appearsOnInsert = [];
        return { data: null, error: this.insertError };
      }
      return { data: [], error: null };
    }
    if (call.op === "upsert") return { data: [], error: null };
    if (call.table !== "companies") return { data: [], error: null };
    if (this.readError) {
      return { data: null, error: { code: "XX000", message: this.readError } };
    }
    let out = [...this.rows];
    for (const [kind, col, val] of call.filters) {
      const key = col as keyof CompanyRow;
      if (kind === "eq") out = out.filter((r) => r[key] === val);
      else if (kind === "is") out = out.filter((r) => r[key] === null);
      else if (kind === "ilike") {
        const rx = ilikeRegex(String(val));
        out = out.filter((r) => rx.test(String(r[key] ?? "")));
      }
    }
    return { data: out, error: null };
  }

  selects() {
    return this.calls.filter((c) => c.op === "select" && c.table === "companies");
  }
  writes() {
    return this.calls.filter((c) => c.op === "insert" || c.op === "upsert");
  }
}

function normIndexError() {
  return {
    code: "23505",
    message:
      'duplicate key value violates unique constraint "companies_name_norm_unique"',
  };
}
function nameKeyError() {
  return {
    code: "23505",
    message: 'duplicate key value violates unique constraint "companies_name_key"',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSvc = (db: FakeDb) => db as any;

// --- The row the exact-name probe cannot see -------------------------------

test("a norm-index conflict resolves a row the exact-name probe misses", async () => {
  // We tried to insert "EXXONMOBIL"; the winner is stored as "ExxonMobil".
  // `error: null` so no index hint reorders the ladder and the exact-name probe
  // runs FIRST, exactly as the old code did. It returns zero rows.
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  const row = await resolveConflictingCompany(asSvc(db), { name: "EXXONMOBIL" });
  assert.equal(row.id, EXXONMOBIL.id);

  const exact = db
    .selects()
    .filter((c) => c.filters.some(([k, col, v]) => k === "eq" && col === "name" && v === "EXXONMOBIL"));
  assert.equal(exact.length, 1, "the exact-name probe must actually have run");
  assert.deepEqual(
    (db.answer(exact[0]).data as CompanyRow[]),
    [],
    "and it must actually have missed",
  );
});

test("whitespace-only difference resolves, because the needle is trimmed", async () => {
  const db = new FakeDb([EXXONMOBIL]);
  const row = await resolveConflictingCompany(asSvc(db), {
    name: "  ExxonMobil  ",
    error: normIndexError(),
  });
  assert.equal(row.id, EXXONMOBIL.id);
});

test("the index hint skips straight to the probe that can answer", async () => {
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  const row = await resolveConflictingCompany(asSvc(db), {
    name: "EXXONMOBIL",
    error: normIndexError(),
  });
  assert.equal(row.id, EXXONMOBIL.id);
  assert.equal(db.selects().length, 1);
});

// --- What happens when the winner is itself a duplicate --------------------

test("recovery resolves to the conflicting row, never to the better duplicate", async () => {
  // "ExxonMobil" (no ticker, no cik) and "Exxon" (XOM, cik 34088) are one
  // company in two rows. A lost race on "ExxonMobil" resolves to "ExxonMobil".
  // Resolving to "Exxon" would be a merge, and a merge has no defensible
  // default here: the busier row is the identifier-less one.
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  const row = await resolveConflictingCompany(asSvc(db), {
    name: "ExxonMobil",
    error: nameKeyError(),
  });
  assert.equal(row.id, EXXONMOBIL.id);
  assert.equal(row.name, "ExxonMobil");
  assert.equal(row.ticker, null);
  assert.equal(row.sec_cik, null);
});

test("recovery performs no writes, so it cannot deepen an existing duplicate", async () => {
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  await resolveConflictingCompany(asSvc(db), {
    name: "EXXONMOBIL",
    error: normIndexError(),
  });
  assert.deepEqual(db.writes(), []);
});

test("the cik-null probe disambiguates a pair the broad probe cannot", async () => {
  // Two rows share a normalized name; one carries a cik and is therefore
  // OUTSIDE companies_name_norm_unique. Our insert writes sec_cik NULL, so the
  // row we collided with is the one inside the index.
  const twin: CompanyRow = { ...EXXONMOBIL, id: "twin-id", sec_cik: 99999 };
  const db = new FakeDb([EXXONMOBIL, twin]);
  const row = await resolveConflictingCompany(asSvc(db), {
    name: "exxonmobil",
    error: normIndexError(),
  });
  assert.equal(row.id, EXXONMOBIL.id);
});

test("an ambiguous probe result is refused rather than guessed", async () => {
  const a: CompanyRow = { ...EXXONMOBIL, id: "dup-a", sec_cik: 111 };
  const b: CompanyRow = { ...EXXONMOBIL, id: "dup-b", sec_cik: 222 };
  const db = new FakeDb([a, b]);
  await assert.rejects(
    () => resolveConflictingCompany(asSvc(db), { name: "exxonmobil" }),
    CompanyConflictUnresolvedError,
  );
});

// --- Loud failure ----------------------------------------------------------

test("an unrecovered conflict throws and never resolves to null", async () => {
  const db = new FakeDb([]);
  await assert.rejects(
    () =>
      resolveConflictingCompany(asSvc(db), {
        name: "Nowhere Corp",
        error: normIndexError(),
      }),
    (e: unknown) => {
      assert.ok(e instanceof CompanyConflictUnresolvedError);
      assert.match(e.message, /UNRECOVERED/);
      assert.match(e.message, /Nowhere Corp/);
      assert.ok(e.probes.some((p) => p.startsWith(PROBE_EXACT_NAME)));
      assert.ok(e.probes.some((p) => p.startsWith(PROBE_NORM_NAME_CIK_NULL)));
      return true;
    },
  );
});

test("a failed probe read is surfaced, not read as zero rows", async () => {
  // supabase-js returns read errors in the result object. An unchecked `error`
  // is indistinguishable from "no rows", which is the same silent-miss shape
  // one layer down.
  const db = new FakeDb([EXXONMOBIL]);
  db.readError = "statement timeout";
  await assert.rejects(
    () =>
      resolveConflictingCompany(asSvc(db), {
        name: "ExxonMobil",
        error: nameKeyError(),
      }),
    /statement timeout/,
  );
});

test("isUniqueViolation reads SQLSTATE, not the message", () => {
  assert.equal(isUniqueViolation({ code: "23505", message: "anything" }), true);
  assert.equal(
    isUniqueViolation({
      code: "40001",
      message: "could not serialize access due to conflict",
    }),
    false,
  );
  assert.equal(isUniqueViolation(null), false);
});

// --- Ladder shape ----------------------------------------------------------

test("probeOrder hints first but still runs every probe", () => {
  const order = probeOrder("companies_name_norm_unique");
  assert.equal(order[0], PROBE_NORM_NAME_CIK_NULL);
  assert.deepEqual([...order].sort(), [...PROBE_LADDER].sort());
});

test("an unknown index runs the full ladder in its declared order", () => {
  // The order is spelled out, not compared to PROBE_LADDER. Comparing
  // probeOrder's output to the constant probeOrder returns is a tautology: it
  // passes for every possible order. Reordering the ladder left this green
  // until the literal went in.
  const expected = [
    PROBE_EXACT_NAME,
    PROBE_NORM_NAME_CIK_NULL,
    PROBE_NORM_NAME_ANY,
    PROBE_SEC_CIK,
  ];
  assert.deepEqual(probeOrder("some_index_we_do_not_model"), expected);
  assert.deepEqual(probeOrder(null), expected);
});

test("the ladder matches the order declared in backend/company_conflict.py", () => {
  // Parity with the Python half. Two runtimes cannot share one implementation,
  // so they share one written order and each side asserts it. This does NOT
  // cross-check the languages; it makes a reorder on this side go red here.
  assert.deepEqual(
    [...PROBE_LADDER],
    [
      PROBE_EXACT_NAME,
      PROBE_NORM_NAME_CIK_NULL,
      PROBE_NORM_NAME_ANY,
      PROBE_SEC_CIK,
    ],
  );
});

test("every hinted probe is in the ladder", () => {
  for (const [indexName, probe] of Object.entries(INDEX_PROBE_HINT)) {
    assert.ok(PROBE_LADDER.includes(probe), indexName);
  }
});

test("conflictingIndexName reads the index off the message", () => {
  assert.equal(
    conflictingIndexName(normIndexError()),
    "companies_name_norm_unique",
  );
  assert.equal(conflictingIndexName(nameKeyError()), "companies_name_key");
  assert.equal(conflictingIndexName({ code: "23505", message: "no index" }), null);
});

// --- Forward cover for the widening PR -------------------------------------

test("a winner carrying a cik is still found after the predicate widens", async () => {
  // Today companies_name_norm_unique is partial on `sec_cik IS NULL`, so the
  // cik-null probe matches its predicate exactly. If that predicate is dropped,
  // the winner may carry a cik and that probe goes blind. PROBE_NORM_NAME_ANY
  // covers it, which is why the handler can land BEFORE the widening.
  const db = new FakeDb([EXXON]);
  const row = await resolveConflictingCompany(asSvc(db), {
    name: "EXXON",
    error: normIndexError(),
  });
  assert.equal(row.id, EXXON.id);
  const cikNull = db
    .selects()
    .filter((c) => c.filters.some(([k, col]) => k === "is" && col === "sec_cik"));
  assert.equal(cikNull.length, 1);
  assert.deepEqual(db.answer(cikNull[0]).data as CompanyRow[], []);
});

test("the sec_cik probe is skipped when the insert carried no cik", async () => {
  // Both live insert paths write sec_cik NULL. Probing eq(sec_cik, null) would
  // match every identifier-less row in the table.
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  await assert.rejects(() =>
    resolveConflictingCompany(asSvc(db), { name: "Nowhere Corp", secCik: null }),
  );
  const cikProbes = db
    .selects()
    .filter((c) => c.filters.some(([k, col]) => k === "eq" && col === "sec_cik"));
  assert.deepEqual(cikProbes, []);
});

// --- Works under either normalizer -----------------------------------------

test("the probe needle is the raw trimmed name, not a normalizer key", async () => {
  // v1 (normalizeLookupKey) would lowercase this; v2 would additionally delete
  // the dot and strip the "Inc" suffix, yielding "acme". Either key sent as an
  // ILIKE needle finds nothing, because the stored value is the raw name. The
  // needle must be the name itself, trimmed, and Postgres does the case fold.
  const db = new FakeDb([]);
  await assert.rejects(() =>
    resolveConflictingCompany(asSvc(db), {
      name: "  Acme Inc.  ",
      error: normIndexError(),
    }),
  );
  const needles = db
    .selects()
    .flatMap((c) => c.filters.filter(([k]) => k === "ilike").map(([, , v]) => v));
  assert.ok(needles.length > 0);
  for (const needle of needles) {
    assert.equal(needle, "Acme Inc.");
    assert.notEqual(needle, "acme inc."); // v1
    assert.notEqual(needle, "acme"); // v2
  }
});

test("the needle escape is the same function the read path uses", () => {
  // Not a re-implementation. A recovery that escapes differently from the read
  // path it recovers into would find nothing and report the company as absent.
  assert.equal(escapeLikePattern("50% off"), "50\\% off");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
  assert.equal(escapeLikePattern("\\%"), "\\\\\\%");
});

test("a name with a wildcard cannot widen into a wrong answer", async () => {
  // "Exxon%" unescaped would ILIKE-match all three Exxon rows. Escaped, it
  // matches none, so the ladder raises instead of returning one at random.
  const db = new FakeDb([EXXONMOBIL, EXXON]);
  await assert.rejects(
    () =>
      resolveConflictingCompany(asSvc(db), {
        name: "Exxon%",
        error: normIndexError(),
      }),
    CompanyConflictUnresolvedError,
  );
});

// --- End to end through the real read-path write ---------------------------

function stubFinnhub(symbol: string, description: string) {
  const original = globalThis.fetch;
  process.env.FINNHUB_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        result: [
          { symbol, displaySymbol: symbol, description, type: "Common Stock" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("resolveOrCreateCompany recovers a lost race the old exact-name select missed", async () => {
  // The whole defect, end to end. Finnhub resolves "XOM" -> name "Exxonmobil"
  // (titleCase of the description). Nothing in the table matches that spelling
  // exactly, so the guards miss and the insert runs. It loses to
  // companies_name_norm_unique against the stored "ExxonMobil". The old code
  // re-selected on `.eq("name", "Exxonmobil")`, got null, and returned
  // not_found. It must now return the existing row.
  const restore = stubFinnhub("XOM", "EXXONMOBIL");
  try {
    // The table is EMPTY for every read the guards make, and the winner exists
    // by the time the insert lands. That is what a lost race is, and it is the
    // only way to reach step 4: with the row already present, resolveAlias
    // finds it case-insensitively at step 3b and the insert never runs.
    const db = new FakeDb([]);
    db.appearsOnInsert = [EXXONMOBIL];
    db.insertError = normIndexError();
    const resolveOrCreateCompany = await loadResolveOrCreateCompany();
    const outcome = await resolveOrCreateCompany("Exxonmobil Holdings", {
      svc: asSvc(db),
    });
    assert.equal(outcome.status, "exists");
    assert.equal(outcome.created, false);
    assert.equal(outcome.company?.id, EXXONMOBIL.id);
    assert.equal(outcome.company?.name, "ExxonMobil");
  } finally {
    restore();
  }
});

test("resolveOrCreateCompany throws rather than answering not_found on an unrecoverable conflict", async () => {
  // A not_found here is an EmptyState with nothing logged. The route above
  // turns a throw into a logged 500, which is the outcome that gets noticed.
  const restore = stubFinnhub("ZZZZ", "NOWHERE CORP");
  try {
    const resolveOrCreateCompany = await loadResolveOrCreateCompany();
    const db = new FakeDb([]);
    db.insertError = normIndexError();
    await assert.rejects(
      () => resolveOrCreateCompany("Nowhere Corp", { svc: asSvc(db) }),
      CompanyConflictUnresolvedError,
    );
  } finally {
    restore();
  }
});

test("resolveOrCreateCompany still rethrows a non-unique insert error", async () => {
  const restore = stubFinnhub("ZZZZ", "NOWHERE CORP");
  try {
    const resolveOrCreateCompany = await loadResolveOrCreateCompany();
    const db = new FakeDb([]);
    db.insertError = { code: "42501", message: "permission denied for table companies" };
    // Rethrown verbatim, which is the pre-existing contract: supabase-js hands
    // back a plain error object on this path, not an Error instance, so the
    // assertion reads its fields rather than a message regex.
    await assert.rejects(
      () => resolveOrCreateCompany("Nowhere Corp", { svc: asSvc(db) }),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        assert.equal(err.code, "42501");
        assert.match(String(err.message), /permission denied/);
        return true;
      },
    );
  } finally {
    restore();
  }
});
