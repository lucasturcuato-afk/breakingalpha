/**
 * Unit tests for the adviser-registry read path.
 *
 * Run: npm run test:unit
 *
 * Every Supabase interaction here is a hand-built stub. Nothing reaches a
 * network or a database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_REGISTRY_PROFILE,
  STALE_13F_DAYS,
  daysSince,
  fetchRegistryProfile,
  formatRaum,
  formatReportedAt,
  hasRaumFigure,
  is13FCurrent,
  suppliesNumbersPillar,
  type AdviserRegistration,
  type InstitutionalManager,
} from "./adviser-registry";

const NOW = new Date("2026-09-02T00:00:00Z");

function adviser(over: Partial<AdviserRegistration> = {}): AdviserRegistration {
  return {
    crd: 157041,
    filedName: "THOMA BRAVO",
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
    assert.equal(profile.adviser?.filedName, "SOME ADVISER LLC");
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
