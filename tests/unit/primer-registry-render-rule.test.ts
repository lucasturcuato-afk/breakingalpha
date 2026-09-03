// THE RENDER RULE, proved on the rendered markup rather than by reading the
// component.
//
// The rule: a dollar figure in the SEC registrations block never appears
// without (a) the entity that filed it, (b) the as-of month, and (c) a
// statement of how the company was linked to that entity. #806 wrote that rule
// into three docstrings and then broke it three ways at once:
//
//   1. `(primary_business_name || legal_name)` printed one of the row's two
//      names and dropped the other. On 80 of the 380 companies that render a
//      RAUM figure the dropped name is a substantively different entity.
//   2. the as-of month lived inside the TOTAL's own label, so the
//      discretionary dollars printed beside it carried no date at all.
//   3. `tierNote` returned null for `exact` and `core`, so 163 of the 380
//      figures stated no provenance, and silence reads as "no name matching
//      was involved" rather than "matched exactly".
//
// WHY UNIT AND NOT E2E. PrimerRegulatoryFilings is mounted from exactly one
// place, `PrimerTab`, itself mounted from exactly one place,
// `src/app/company/[id]/page.tsx`, which is a server component whose Supabase
// reads never cross the browser boundary. Playwright can show one real
// company; it cannot drive the row shapes that break the rule. Every fixture
// below is a REAL pair of names off the SEC June 2026 roster or the EDGAR
// submissions index.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrimerRegulatoryFilings } from "../../src/components/company/tabs/primer/PrimerRegulatoryFilings.tsx";
import type {
  AdviserRegistration,
  InstitutionalManager,
} from "../../src/lib/adviser-registry.ts";

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
    reportedAt: "2026-05-11",
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

function render(
  a: AdviserRegistration | null,
  m: InstitutionalManager | null,
): string {
  return renderToStaticMarkup(
    createElement(PrimerRegulatoryFilings, { adviser: a, manager: m }),
  );
}

/** Any compact dollar amount the block can print: $182.9B, $11.1T, $41,633. */
const DOLLAR_FIGURE = /\$[\d,]+(?:\.\d+)?[MBT]?/;
/** "As of May 2026." */
const AS_OF = /As of [A-Z][a-z]{2} \d{4}\./;
/** The provenance sentence, whichever tier produced it. */
const PROVENANCE = /Linked to this company by/;

// Every shape the block can be handed, each one lifted off a real filing.
const SHAPES: Array<[string, AdviserRegistration | null, InstitutionalManager | null]> = [
  ["adviser only, names agree", adviser(), null],
  [
    "adviser only, legal name is a different entity (Andreessen Horowitz)",
    adviser({
      crd: 148578,
      businessName: "ANDREESSEN HOROWITZ",
      legalName: "A16Z CAPITAL MANAGEMENT, L.L.C.",
      raumTotalUsd: 106_480_000_000,
      raumDiscretionaryUsd: 106_480_000_000,
      raumTotalAccounts: 0,
      matchTier: "exact",
    }),
    null,
  ],
  [
    "adviser only, legal name is a narrower unit (Morgan Stanley)",
    adviser({
      crd: 149777,
      businessName: "MORGAN STANLEY",
      legalName: "MORGAN STANLEY SMITH BARNEY LLC",
      raumTotalUsd: 1_961_890_000_000,
      matchTier: "exact",
    }),
    null,
  ],
  [
    "adviser only, prefix tier (BNP Paribas Asset Management USA)",
    adviser({
      crd: 105455,
      businessName: "BNP PARIBAS ASSET MANAGEMENT USA, INC.",
      legalName: null,
      matchedName: "BNP PARIBAS ASSET MANAGEMENT USA, INC.",
      raumTotalUsd: 48_400_000_000,
      raumDiscretionaryUsd: null,
      raumTotalAccounts: 7,
      matchTier: "prefix",
    }),
    null,
  ],
  [
    "adviser only, no discretionary split and no account count",
    adviser({ raumDiscretionaryUsd: null, raumTotalAccounts: null }),
    null,
  ],
  ["adviser only, sub-million book prints in full", adviser({ raumTotalUsd: 41_633, raumDiscretionaryUsd: null }), null],
  ["manager only", null, manager()],
  [
    "manager only, linked under a former name (SoftBank)",
    null,
    manager({
      cik: 1065521,
      filerName: "SOFTBANK GROUP CORP.",
      matchedName: "SOFTBANK CORP",
      matchTier: "core",
    }),
  ],
  ["both blocks at once", adviser(), manager()],
];

/**
 * The RAUM block alone. Scoped on purpose: the 13F copy quotes the statutory
 * $100M threshold, which is a fact about the FORM and not a figure about this
 * company, and folding the two together would let a real undated company
 * figure hide behind a sentence about the rule.
 */
function raumBlock(html: string): string | null {
  const start = html.indexOf('data-testid="primer-raum"');
  if (start === -1) return null;
  const end = html.indexOf('data-testid="primer-13f"');
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

for (const [name, a, m] of SHAPES) {
  test(`render rule: every dollar figure is named, dated and sourced (${name})`, () => {
    const html = render(a, m);
    const block = raumBlock(html);
    if (block !== null && DOLLAR_FIGURE.test(block)) {
      assert.ok(AS_OF.test(block), `dollar figure with no as-of month: ${block}`);
      assert.ok(
        block.includes(a!.businessName),
        `dollar figure with no filed entity name: ${block}`,
      );
      assert.ok(
        PROVENANCE.test(block),
        `a figure whose link provenance is not stated: ${block}`,
      );
    }
    // Provenance is stated on EVERY tier, not only the affiliate-shaped one.
    if (a?.matchTier || m?.matchTier) {
      assert.ok(PROVENANCE.test(html), `a match tier that states no provenance: ${html}`);
    }
    // The 13F block carries a date of its own, and it is the last filing date.
    if (m !== null) {
      assert.match(html, /most recently [A-Z][a-z]{2} \d{4}/);
      assert.ok(html.includes(m.filerName), "the 13F block must name its filer");
    }
  });
}

test("render rule: the discretionary figure is not left undated", () => {
  // The old markup put the as-of inside the TOTAL's label only, so a second
  // dollar amount sat beside it with no date of its own. The date now governs
  // the whole grid, which is the only arrangement that survives adding a
  // fourth figure later.
  const html = render(adviser(), null);
  assert.ok(html.includes("Discretionary"));
  assert.match(html, AS_OF);
  assert.ok(
    !/Reg\. AUM \(/.test(html),
    "the as-of must not be back inside a single figure's label",
  );
});

test("render rule: a substantively different legal name is PRINTED, not summarised away", () => {
  const html = render(
    adviser({
      businessName: "PRINCIPAL ASSET MANAGEMENT",
      legalName: "PRINCIPAL GLOBAL INVESTORS, LLC",
      raumTotalUsd: 427_710_000_000,
      matchTier: "exact",
    }),
    null,
  );
  assert.ok(html.includes("PRINCIPAL ASSET MANAGEMENT"), "business name missing");
  assert.ok(
    html.includes("PRINCIPAL GLOBAL INVESTORS, LLC"),
    "the legal name is the entity that filed and it has to appear",
  );
  assert.ok(html.includes("Registered legal name"), "the second name needs its own label");
});

test("render rule: a legal name that is the same entity is NOT printed twice", () => {
  // "THOMA BRAVO" and "THOMA BRAVO, L.P." are one firm. Printing both would
  // train the reader to ignore the line that matters on the 80 rows where the
  // two names really are different entities.
  const html = render(adviser(), null);
  assert.ok(!html.includes("Registered legal name"), `noise on a same-entity row: ${html}`);
});

test("render rule: a 13F block linked under a former name says so", () => {
  const html = render(
    null,
    manager({
      filerName: "SOFTBANK GROUP CORP.",
      matchedName: "SOFTBANK CORP",
    }),
  );
  assert.ok(html.includes("SOFTBANK GROUP CORP."));
  assert.ok(html.includes("SOFTBANK CORP"));
  assert.ok(html.includes("Linked under"));
});

test("render rule: 13F copy never implies a portfolio", () => {
  const html = render(null, manager());
  assert.ok(html.includes("Position detail is not shown here"));
  assert.ok(!/holdings worth|portfolio value|assets of \$/i.test(html));
});
