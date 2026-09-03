/**
 * Unit tests for the adviser-registry read path.
 *
 * Run: npm run test:unit
 *
 * Every Supabase interaction here is a hand-built stub. Nothing reaches a
 * network or a database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EMPTY_REGISTRY_PROFILE,
  STALE_13F_DAYS,
  daysSince,
  fetchRegistryProfile,
  formatRaum,
  formatReportedAt,
  has13FEvidence,
  hasRaumFigure,
  is13FAttributable,
  is13FCurrent,
  isJurisdictionScoped,
  isTerritorialSlice,
  nameRelation,
  suppliesNumbersPillar,
  type AdviserRegistration,
  type FiledNameRelation,
  type InstitutionalManager,
} from "./adviser-registry";

const NOW = new Date("2026-09-02T00:00:00Z");

function adviser(over: Partial<AdviserRegistration> = {}): AdviserRegistration {
  return {
    crd: 157041,
    businessName: "THOMA BRAVO",
    legalName: "THOMA BRAVO, L.P.",
    matchedName: "THOMA BRAVO",
    raumTotalUsd: 182_900_000_000,
    raumDiscretionaryUsd: 182_900_000_000,
    raumNonDiscretionaryUsd: 0,
    raumTotalAccounts: 42,
    reportedAt: "2026-03-31",
    matchTier: "exact",
    matchConfirmed: false,
    ...over,
  };
}

function manager(over: Partial<InstitutionalManager> = {}): InstitutionalManager {
  return {
    cik: 1103804,
    filerName: "THOMA BRAVO, L.P.",
    matchedName: "THOMA BRAVO, L.P.",
    lastFilingDate: "2026-08-14",
    matchTier: "core",
    matchConfirmed: false,
    ...over,
  };
}

/** Minimal PostgREST stub: table name -> { data, error } or a thrown error. */
function stubClient(byTable: Record<string, { data: unknown; error?: unknown } | "throw">) {
  return {
    from(table: string) {
      const outcome = byTable[table];
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (outcome === "throw") throw new Error("boom");
          return outcome ?? { data: null };
        },
      };
      return chain;
    },
  } as never;
}

describe("hasRaumFigure", () => {
  it("accepts a positive, dated figure", () => {
    assert.equal(hasRaumFigure(adviser()), true);
  });

  it("rejects a filed zero", () => {
    // 605 of 16,876 roster rows report exactly 0.00, including BofA Securities
    // and Needham & Company. "$0" on a company page reads as a data bug.
    assert.equal(hasRaumFigure(adviser({ raumTotalUsd: 0 })), false);
  });

  it("rejects a negative figure", () => {
    assert.equal(hasRaumFigure(adviser({ raumTotalUsd: -1 })), false);
  });

  it("rejects an undated figure", () => {
    // RAUM is an annual self-report. Undated, it invites the reader to treat it
    // as current.
    assert.equal(hasRaumFigure(adviser({ reportedAt: null })), false);
  });

  it("rejects a missing adviser", () => {
    assert.equal(hasRaumFigure(null), false);
  });
});

describe("is13FCurrent", () => {
  it("accepts a filer that reported this quarter", () => {
    assert.equal(is13FCurrent(manager(), NOW), true);
  });

  it("rejects a filer that stopped years ago", () => {
    // Measured in the real index: B Capital Advisors last filed 2006-05-15 and
    // Mercury Real Estate Advisors 2009-04-24. A flag from 2006 is not a
    // statement about size today.
    assert.equal(is13FCurrent(manager({ lastFilingDate: "2006-05-15" }), NOW), false);
  });

  it("rejects an undated filer", () => {
    assert.equal(is13FCurrent(manager({ lastFilingDate: null }), NOW), false);
  });

  it("rejects an unparseable date rather than treating it as current", () => {
    assert.equal(is13FCurrent(manager({ lastFilingDate: "not-a-date" }), NOW), false);
  });

  it("uses the documented window boundary", () => {
    const inside = new Date(NOW.getTime() - STALE_13F_DAYS * 86_400_000).toISOString().slice(0, 10);
    const outside = new Date(NOW.getTime() - (STALE_13F_DAYS + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    assert.equal(is13FCurrent(manager({ lastFilingDate: inside }), NOW), true);
    assert.equal(is13FCurrent(manager({ lastFilingDate: outside }), NOW), false);
  });
});

describe("suppliesNumbersPillar", () => {
  it("is true on either artifact alone", () => {
    assert.equal(
      suppliesNumbersPillar({ adviser: adviser(), manager: null, readFailed: false }, NOW),
      true,
    );
    assert.equal(
      suppliesNumbersPillar({ adviser: null, manager: manager(), readFailed: false }, NOW),
      true,
    );
  });

  it("is false when the only ADV row reports zero and there is no 13F", () => {
    assert.equal(
      suppliesNumbersPillar(
        { adviser: adviser({ raumTotalUsd: 0 }), manager: null, readFailed: false },
        NOW,
      ),
      false,
    );
  });

  it("is false when the only 13F filer is stale", () => {
    assert.equal(
      suppliesNumbersPillar(
        { adviser: null, manager: manager({ lastFilingDate: "2009-04-24" }), readFailed: false },
        NOW,
      ),
      false,
    );
  });

  it("is false on the empty profile", () => {
    assert.equal(suppliesNumbersPillar(EMPTY_REGISTRY_PROFILE, NOW), false);
  });
});

describe("formatRaum", () => {
  it("scales full dollars without losing the number", () => {
    assert.equal(formatRaum(11_100_000_000_000), "$11.1T");
    assert.equal(formatRaum(182_900_000_000), "$182.9B");
    assert.equal(formatRaum(518_600_000), "$518.6M");
  });

  it("prints a sub-million book in full rather than as $0.0M", () => {
    assert.equal(formatRaum(5_500_000), "$5.5M");
    assert.equal(formatRaum(41_633), "$41,633");
  });
});

describe("formatReportedAt", () => {
  it("renders month and year, never the day", () => {
    // RAUM is annual; a day would imply precision the filing does not carry.
    assert.equal(formatReportedAt("2026-05-11"), "May 2026");
  });

  it("returns null for missing or unparseable input", () => {
    assert.equal(formatReportedAt(null), null);
    assert.equal(formatReportedAt("nope"), null);
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    assert.equal(daysSince("2026-09-01", NOW), 1);
    assert.equal(daysSince("2026-09-02", NOW), 0);
  });

  it("returns null rather than NaN for bad input", () => {
    assert.equal(daysSince(null, NOW), null);
    assert.equal(daysSince("garbage", NOW), null);
  });
});

describe("fetchRegistryProfile", () => {
  it("returns the empty profile for a null company id without reading", () => {
    return fetchRegistryProfile(stubClient({}), null).then((p) => {
      assert.deepEqual(p, EMPTY_REGISTRY_PROFILE);
    });
  });

  it("maps PostgREST numeric strings to numbers", async () => {
    const profile = await fetchRegistryProfile(
      stubClient({
        adviser_registrations: {
          data: {
            crd: "157041",
            primary_business_name: "THOMA BRAVO",
            legal_name: "THOMA BRAVO, L.P.",
            raum_total_usd: "182900000000.00",
            raum_discretionary_usd: "182900000000.00",
            raum_non_discretionary_usd: "0.00",
            raum_total_accounts: "42",
            raum_reported_at: "2026-03-31",
            match_tier: "exact",
            match_confirmed: false,
          },
        },
        institutional_managers: { data: null },
      }),
      "abc",
    );
    assert.equal(profile.adviser?.crd, 157041);
    assert.equal(profile.adviser?.raumTotalUsd, 182_900_000_000);
    assert.equal(profile.adviser?.raumTotalAccounts, 42);
    assert.equal(profile.adviser?.matchTier, "exact");
    assert.equal(profile.manager, null);
    assert.equal(profile.readFailed, false);
  });

  it("falls back to the legal name when no primary business name is filed", async () => {
    const profile = await fetchRegistryProfile(
      stubClient({
        adviser_registrations: {
          data: {
            crd: 1,
            primary_business_name: null,
            legal_name: "SOME ADVISER LLC",
            raum_total_usd: 1,
            raum_discretionary_usd: null,
            raum_non_discretionary_usd: null,
            raum_total_accounts: null,
            raum_reported_at: "2026-01-01",
            match_tier: null,
            match_confirmed: false,
          },
        },
        institutional_managers: { data: null },
      }),
      "abc",
    );
    assert.equal(profile.adviser?.businessName, "SOME ADVISER LLC");
    assert.equal(
      profile.adviser?.legalName,
      null,
      "a row with one usable name hides nothing, so it must not report a second",
    );
    assert.equal(nameRelation(profile.adviser!.businessName, profile.adviser!.legalName), "single");
  });

  it("rejects an unknown match_tier rather than passing it through", async () => {
    const profile = await fetchRegistryProfile(
      stubClient({
        institutional_managers: {
          data: {
            cik: 1103804,
            filer_name: "THOMA BRAVO, L.P.",
            files_13f_hr: true,
            last_filing_date: "2026-08-14",
            match_tier: "fuzzy",
            match_confirmed: false,
          },
        },
        adviser_registrations: { data: null },
      }),
      "abc",
    );
    assert.equal(profile.manager?.matchTier, null);
  });

  it("reports a failed read as readFailed, not as an empty registry", async () => {
    // Same distinction financial-facts.ts draws: "we could not read" is not
    // "this company has nothing on file", and collapsing them makes the UI
    // assert something false about the company.
    const profile = await fetchRegistryProfile(
      stubClient({
        adviser_registrations: { data: null, error: { message: "57014" } },
        institutional_managers: { data: null },
      }),
      "abc",
    );
    assert.equal(profile.readFailed, true);
    assert.equal(profile.adviser, null);
  });

  it("never throws out of the page's Promise.all", async () => {
    const profile = await fetchRegistryProfile(
      stubClient({ adviser_registrations: "throw", institutional_managers: "throw" }),
      "abc",
    );
    assert.equal(profile.readFailed, true);
    assert.equal(profile.adviser, null);
    assert.equal(profile.manager, null);
  });
});

// ---------------------------------------------------------------------------
// RULE 5: the filed-name relation
// ---------------------------------------------------------------------------

interface OracleCase {
  note: string;
  shown: string;
  other: string | null;
  relation: FiledNameRelation;
  jurisdiction_scoped: boolean;
}

/**
 * THE SHARED ORACLE. backend/registry/match.py carries the same rule, and
 * backend/tests/test_adviser_registry.py::FiledNameRelationTest asserts
 * against this same file. Its verdicts are hand-written from the SEC filings,
 * so neither implementation is grading its own homework: drift on either side
 * turns the other side's suite red on the identical inputs.
 */
const ORACLE: OracleCase[] = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "backend",
      "tests",
      "fixtures",
      "filed_name_relations.json",
    ),
    "utf8",
  ),
).cases;

describe("nameRelation, against the shared oracle", () => {
  it("exercises all four verdicts and both jurisdiction answers", () => {
    const verdicts = new Set(ORACLE.map((c) => c.relation));
    assert.deepEqual(
      [...verdicts].sort(),
      ["other", "same", "single", "unit"],
      "a fixture that never exercises a verdict cannot catch a drift in it",
    );
    assert.ok(ORACLE.some((c) => c.jurisdiction_scoped));
    assert.ok(ORACLE.some((c) => !c.jurisdiction_scoped));
  });

  for (const c of ORACLE) {
    it(`${c.relation}: ${c.shown} vs ${c.other ?? "(none)"}`, () => {
      assert.equal(nameRelation(c.shown, c.other), c.relation, c.note);
      assert.equal(isJurisdictionScoped(c.shown, c.other), c.jurisdiction_scoped, c.note);
    });
  }
});

describe("isTerritorialSlice", () => {
  it("suppresses the RAUM figure when the legal name scopes it to a territory", () => {
    // Measured: the same June 2026 roster carries INVESCO CAPITAL MANAGEMENT
    // LLC at $941.02B, so this figure is 2.1% of the group's largest single
    // registrant. A caveat under the number cannot fix that; only not drawing
    // it can.
    const invesco = adviser({
      businessName: "INVESCO",
      legalName: "INVESCO CANADA LTD.",
      raumTotalUsd: 19_870_000_000,
      matchTier: "exact",
    });
    assert.equal(isTerritorialSlice(invesco), true);
    assert.equal(hasRaumFigure(invesco), false);
  });

  it("keeps a differently-named adviser entity of the same firm", () => {
    // A16Z CAPITAL MANAGEMENT is Andreessen Horowitz. Its RAUM is the firm's
    // book, so suppressing it would delete correct coverage to fix a label.
    const a16z = adviser({
      businessName: "ANDREESSEN HOROWITZ",
      legalName: "A16Z CAPITAL MANAGEMENT, L.L.C.",
      raumTotalUsd: 106_480_000_000,
    });
    assert.equal(nameRelation(a16z.businessName, a16z.legalName), "other");
    assert.equal(isTerritorialSlice(a16z), false);
    assert.equal(hasRaumFigure(a16z), true);
  });

  it("keeps a legal name that differs only by a suffix or an article", () => {
    const vanguard = adviser({
      businessName: "VANGUARD GROUP INC",
      legalName: "THE VANGUARD GROUP, INC.",
      raumTotalUsd: 11_092_670_000_000,
    });
    assert.equal(nameRelation(vanguard.businessName, vanguard.legalName), "same");
    assert.equal(hasRaumFigure(vanguard), true);
  });

  it("keeps a sub-unit that names no territory, because the book is the firm's", () => {
    const hamiltonLane = adviser({
      businessName: "HAMILTON LANE",
      legalName: "HAMILTON LANE ADVISORS, L.L.C.",
    });
    assert.equal(nameRelation(hamiltonLane.businessName, hamiltonLane.legalName), "unit");
    assert.equal(isTerritorialSlice(hamiltonLane), false);
    assert.equal(hasRaumFigure(hamiltonLane), true);
  });

  it("defers to a human adjudication", () => {
    const confirmed = adviser({
      businessName: "INVESCO",
      legalName: "INVESCO CANADA LTD.",
      matchConfirmed: true,
    });
    assert.equal(isTerritorialSlice(confirmed), false);
    assert.equal(hasRaumFigure(confirmed), true);
  });

  it("still refuses a zero or undated figure regardless of the names", () => {
    assert.equal(hasRaumFigure(adviser({ raumTotalUsd: 0 })), false);
    assert.equal(hasRaumFigure(adviser({ reportedAt: null })), false);
  });
});

describe("is13FAttributable", () => {
  it("refuses a filer whose current name belongs to a different firm", () => {
    const wrong = manager({
      filerName: "LOCKHEED MARTIN INVESTMENT MANAGEMENT CO",
      matchedName: "MARTIN MARIETTA CORP /MD/",
    });
    assert.equal(is13FAttributable(wrong), false);
    assert.equal(is13FCurrent(wrong, NOW), true, "staleness is a separate fact and still passes");
    assert.equal(has13FEvidence(wrong, NOW), false);
  });

  it("keeps a filer that merely renamed itself", () => {
    const renamed = manager({
      filerName: "SOFTBANK GROUP CORP.",
      matchedName: "SOFTBANK CORP",
    });
    assert.equal(is13FAttributable(renamed), true);
    assert.equal(has13FEvidence(renamed, NOW), true);
  });

  it("treats a row with no recorded matched name as attributable", () => {
    // A hand-loaded row, or one written before the column existed. There is no
    // evidence of a conflict, and inventing one suppresses every valid row.
    assert.equal(is13FAttributable(manager({ matchedName: null })), true);
  });

  it("defers to a human adjudication", () => {
    const confirmed = manager({
      filerName: "LOCKHEED MARTIN INVESTMENT MANAGEMENT CO",
      matchedName: "MARTIN MARIETTA CORP /MD/",
      matchConfirmed: true,
    });
    assert.equal(is13FAttributable(confirmed), true);
  });

  it("still refuses a stale filer regardless of the names", () => {
    assert.equal(
      has13FEvidence(manager({ lastFilingDate: "2006-05-15" }), NOW),
      false,
      "the 550-day bound is upstream of attribution and stays upstream",
    );
  });
});

describe("suppliesNumbersPillar carries both suppressions", () => {
  it("a territorial slice alone supplies no pillar", () => {
    assert.equal(
      suppliesNumbersPillar(
        {
          adviser: adviser({ businessName: "ARDIAN", legalName: "ARDIAN US LLC" }),
          manager: null,
          readFailed: false,
        },
        NOW,
      ),
      false,
    );
  });

  it("an unattributable filer alone supplies no pillar", () => {
    assert.equal(
      suppliesNumbersPillar(
        {
          adviser: null,
          manager: manager({
            filerName: "Peak XV Partners Operations LLC",
            matchedName: "SEQUOIA CAPITAL INDIA OPERATIONS II, LLC",
          }),
          readFailed: false,
        },
        NOW,
      ),
      false,
    );
  });
});

describe("the read path selects both names", () => {
  it("carries legal_name and matched_name through instead of dropping them", async () => {
    const profile = await fetchRegistryProfile(
      stubClient({
        adviser_registrations: {
          data: {
            crd: 105618,
            primary_business_name: "INVESCO",
            legal_name: "INVESCO CANADA LTD.",
            matched_name: "INVESCO",
            raum_total_usd: "19870000000.00",
            raum_discretionary_usd: null,
            raum_non_discretionary_usd: null,
            raum_total_accounts: null,
            raum_reported_at: "2026-06-01",
            match_tier: "exact",
            match_confirmed: false,
          },
        },
        institutional_managers: {
          data: {
            cik: 936468,
            filer_name: "LOCKHEED MARTIN INVESTMENT MANAGEMENT CO",
            matched_name: "MARTIN MARIETTA CORP /MD/",
            files_13f_hr: true,
            last_filing_date: "2026-08-14",
            match_tier: "prefix",
            match_confirmed: false,
          },
        },
      }),
      "abc",
    );
    assert.equal(profile.adviser?.businessName, "INVESCO");
    assert.equal(profile.adviser?.legalName, "INVESCO CANADA LTD.");
    assert.equal(profile.manager?.matchedName, "MARTIN MARIETTA CORP /MD/");
    // and neither of them reaches the page
    assert.equal(hasRaumFigure(profile.adviser), false);
    assert.equal(has13FEvidence(profile.manager, NOW), false);
    assert.equal(suppliesNumbersPillar(profile, NOW), false);
  });
});
