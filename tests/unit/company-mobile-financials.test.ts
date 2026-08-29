/**
 * buildFinancials, proved against reads captured verbatim off the live database.
 *
 * This is the mapper where a wrong number does the most damage, and the screen
 * it feeds previously ran on a transcribed income statement and balance sheet
 * attributed to a real issuer. Every assertion below is against a value the
 * database returned; nothing here was typed from a design.
 *
 * `/company/[id]` is a SERVER component, so `page.route()` observes none of its
 * reads and Playwright interception cannot reach this mapper. Under CLAUDE.md's
 * preflight rule this deterministic proof substitutes for e2e.
 *
 * Run: npx tsx --test tests/unit/company-mobile-financials.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildFinancials } from "@/lib/company-mobile/build";
import type { FinancialsBasis, FinancialsRow } from "@/components/company/mobile/types";

import { ALL_CAPTURED, GS, ASML, GRAB, QNT, ALVOTECH, NO_CIK } from "./captured/index.ts";

/* Escaped rather than written literally: this file asserts that the mappers
   never emit an em dash, and `scripts/design-lint.mjs` bans the character in
   source, so the assertion cannot spell out the thing it forbids. */
const EM_DASH = "\u2014";
const BASES = ["annual", "quarterly"] as const;

function allRows(basis: FinancialsBasis): FinancialsRow[] {
  return basis.bands.flatMap((b) => b.rows);
}

function row(basis: FinancialsBasis, label: string): FinancialsRow {
  const found = allRows(basis).find((r) => r.label === label);
  assert.ok(found, `expected a row labelled "${label}"`);
  return found;
}

function labels(basis: FinancialsBasis): string[] {
  return allRows(basis).map((r) => r.label);
}

/* ── the invariant the shape was widened for ──────────────────────── */

test("every row carries exactly as many values as the basis has periods", () => {
  /* The shape used to be a 2-tuple of periods and a 2-tuple of values. A filer
     with one period had to either lose its only column or gain an invented
     second one, and the pad drew a dash under a period that was never filed,
     which reads as a missing figure rather than as an unfiled period. */
  for (const c of ALL_CAPTURED) {
    const built = buildFinancials(c.financials);
    for (const basis of BASES) {
      const b = built[basis];
      for (const r of allRows(b)) {
        assert.equal(
          r.values.length,
          b.periods.length,
          `${c.slug} ${basis}: "${r.label}" has ${r.values.length} values under ${b.periods.length} periods`,
        );
      }
    }
  }
});

test("the period columns are exactly the periods the read carries, in order", () => {
  for (const c of ALL_CAPTURED) {
    const built = buildFinancials(c.financials);
    for (const basis of BASES) {
      assert.deepEqual(
        built[basis].periods,
        c.financials[basis].periods.map((p) => p.label),
        `${c.slug} ${basis}: period columns must be the read's own labels`,
      );
    }
  }
});

/* ── GRAB: one fact, one period, and it must not become two ───────── */

test("GRAB draws exactly one annual column and no quarterly basis at all", () => {
  /* Measured: cik 1855612 has ONE validated fact in the entire view,
     `cost_of_revenue` FY2022 at USD 68,000,000, and nothing else. A second
     column here would be an invented period. */
  const built = buildFinancials(GRAB.financials);
  assert.deepEqual(built.annual.periods, ["FY2022"]);
  assert.equal(built.annual.periods.length, 1);
  for (const r of allRows(built.annual)) assert.equal(r.values.length, 1);

  assert.deepEqual(built.quarterly.periods, []);
  assert.deepEqual(built.quarterly.bands, []);
});

test("GRAB's single fact reaches the screen instead of an empty section", () => {
  /* `cost_of_revenue` is the one INCOME_ROWS line the design does not draw, and
     it is carried anyway. Without it GRAB has no band, no table, and
     `financialsEmptyCopy(true)` reads "Financials appear after the first
     periodic report" over a company whose figure came off a periodic report.
     That sentence would be false. */
  const built = buildFinancials(GRAB.financials);
  assert.deepEqual(built.annual.bands.map((b) => b.band), ["INCOME STATEMENT"]);
  assert.deepEqual(row(built.annual, "Cost of revenue").values, ["$68.0M"]);
});

/* ── ASML: the currency case ──────────────────────────────────────── */

test("ASML is denominated in EUR and never carries a dollar sign", () => {
  /* `selectReportingCurrency` reads the currency off the fact units. A hardcoded
     USD note, or a bare "$" prefix on a EUR figure, states a number that is
     wrong by the exchange rate, and this repo has no FX source to convert with. */
  assert.equal(ASML.financials.reportingCurrency, "EUR");
  const built = buildFinancials(ASML.financials);

  assert.equal(built.note, "Figures in EUR as reported. Not converted to USD.");

  for (const basis of BASES) {
    for (const r of allRows(built[basis])) {
      for (const v of r.values) {
        assert.ok(
          v === null || !v.includes("$"),
          `ASML ${basis} "${r.label}" rendered a dollar sign: ${v}`,
        );
      }
    }
  }
  assert.equal(row(built.annual, "Revenue").values[0], "EUR 32.67B");
});

test("a USD filer gets the USD note without the conversion caveat", () => {
  assert.equal(GS.financials.reportingCurrency, "USD");
  assert.equal(buildFinancials(GS.financials).note, "Figures in USD as reported.");
});

test("a company with no monetary fact makes no currency claim", () => {
  for (const c of [ALVOTECH, NO_CIK]) {
    assert.equal(c.financials.reportingCurrency, null);
    assert.equal(buildFinancials(c.financials).note, "");
  }
});

/* ── a missing cell is an absence, a reported zero is a figure ────── */

test("a period with no fact renders null, not a zero", () => {
  /* Measured on Goldman Sachs' quarterly view: the two FY-labeled columns are
     fiscal year-end BALANCE SHEETS. No Q4 10-Q exists, so the income lines have
     no fact there. Rendering a zero would claim the bank earned nothing in
     those quarters. `FinancialsSection` draws the null as an en dash. */
  const built = buildFinancials(GS.financials);
  assert.deepEqual(built.quarterly.periods, [
    "Q2 FY2026", "Q1 FY2026", "FY2025", "Q3 FY2025",
    "Q2 FY2025", "Q1 FY2025", "FY2024", "Q3 FY2024",
  ]);

  const eps = row(built.quarterly, "EPS (diluted)");
  assert.equal(eps.values[2], null, "no Q4 income line at the FY2025 year end");
  assert.equal(eps.values[6], null, "no Q4 income line at the FY2024 year end");
  assert.equal(typeof eps.values[0], "string", "Q2 FY2026 was filed and must render");

  // The balance sheet is on file for all eight, so nothing there is null.
  assert.ok(row(built.quarterly, "Total assets").values.every((v) => v !== null));
});

test("a reported zero survives as a figure, so absence and zero stay distinguishable", () => {
  /* Quantinuum tagged `minority_interest` at exactly 0 for Q4 FY2025 and at
     2,592,272,000 for Q2 FY2026, and reported nothing for the other three
     quarters. A mapper that rendered absence as zero would flatten all four of
     those into the same cell. */
  const built = buildFinancials(QNT.financials);
  const nci = row(built.quarterly, "+ Noncontrolling interests");
  assert.equal(nci.values[0], "$2.59B");
  assert.equal(nci.values[1], "$0", "a reported zero is a claim and renders as one");
  assert.equal(nci.values[2], null, "an unreported quarter is an absence");
  assert.equal(nci.values[3], null);
  assert.equal(nci.values[4], null);
});

test("a row with no fact in any shown period is dropped, not dashed", () => {
  /* Goldman Sachs reports no revenue or gross profit line at all, so the whole
     top of the income statement is absent rather than a wall of dashes. Same
     rule as `FinancialsTab`, so the two surfaces drop the same rows. */
  const built = buildFinancials(GS.financials);
  assert.equal(GS.financials.annual.grid.revenue, undefined);
  assert.ok(!labels(built.annual).includes("Revenue"));
  assert.ok(!labels(built.annual).includes("Gross profit"));
  assert.ok(!labels(built.annual).includes("Gross margin"));
  assert.ok(labels(built.annual).includes("Net income"));
});

test("a band with no surviving row is dropped whole, so no heading sits over nothing", () => {
  /* ASML's quarterly view carries balance-sheet metrics only: eight fiscal
     year-end instants and not one income duration. The income band has to
     disappear rather than draw its heading over an empty table. */
  const built = buildFinancials(ASML.financials);
  assert.deepEqual(built.annual.bands.map((b) => b.band), ["INCOME STATEMENT", "BALANCE SHEET"]);
  assert.deepEqual(built.quarterly.bands.map((b) => b.band), ["BALANCE SHEET"]);
  assert.equal(built.quarterly.periods.length, 8);
});

test("a company with no facts at all yields both bases empty and no bands", () => {
  for (const c of [ALVOTECH, NO_CIK]) {
    const built = buildFinancials(c.financials);
    for (const basis of BASES) {
      assert.deepEqual(built[basis].periods, [], `${c.slug} ${basis}`);
      assert.deepEqual(built[basis].bands, [], `${c.slug} ${basis}`);
    }
  }
});

test("Quantinuum has no annual basis and five quarterly columns", () => {
  const built = buildFinancials(QNT.financials);
  assert.deepEqual(built.annual.periods, []);
  assert.deepEqual(built.annual.bands, []);
  assert.deepEqual(built.quarterly.periods, [
    "Q2 FY2026", "Q4 FY2025", "Q2 FY2025", "Q1 FY2025", "Q4 FY2024",
  ]);
});

/* ── the two derived lines ────────────────────────────────────────── */

test("gross margin is gross profit over revenue for that same period", () => {
  /* A ratio of two facts from ONE period. Not an aggregate across periods,
     across companies or across outcomes. */
  const built = buildFinancials(ASML.financials);
  const gm = row(built.annual, "Gross margin");
  assert.equal(gm.derived, true, "a derived line sits one indent in, at the muted scale");

  /* Written out rather than recomputed from the same grid the mapper reads. A
     test that redoes the arithmetic passes whatever the arithmetic does, so the
     expected values are stated instead: ASML's stored revenue and gross profit,
     divided once by hand. */
  assert.deepEqual(gm.values, ["52.8%", "51.3%", "51.3%", "50.5%", "52.7%"]);
  assert.deepEqual(built.annual.periods, ["FY2025", "FY2024", "FY2023", "FY2022", "FY2021"]);
  assert.equal(ASML.financials.annual.grid.revenue["FY-2025"].value, 32667300000);
  assert.equal(ASML.financials.annual.grid.gross_profit["FY-2025"].value, 17258000000);
});

test("gross margin needs both facts, so a period with only one gets no ratio", () => {
  /* Quantinuum reports revenue and no gross profit at all, so the ratio has no
     numerator and the row must not exist. Dividing by a missing gross profit,
     or treating it as zero, would print a 0.0% margin the filer never stated. */
  const built = buildFinancials(QNT.financials);
  assert.ok(QNT.financials.quarterly.grid.revenue);
  assert.equal(QNT.financials.quarterly.grid.gross_profit, undefined);
  assert.ok(labels(built.quarterly).includes("Revenue"));
  assert.ok(!labels(built.quarterly).includes("Gross margin"));
});

test("total equity is parent equity plus the components that are actually on file", () => {
  /* Parent equity alone reads wrong for a filer carrying noncontrolling or
     temporary equity. Measured on Quantinuum's Q2 FY2026: parent 413,082,000
     plus noncontrolling 2,592,272,000 is 3,005,354,000. */
  const built = buildFinancials(QNT.financials);
  assert.deepEqual(
    built.quarterly.bands.find((b) => b.band === "BALANCE SHEET")?.rows.map((r) => r.label),
    [
      "Total assets",
      "Equity (parent)",
      "+ Noncontrolling interests",
      "+ Temporary equity",
      "= Total equity",
    ],
  );
  assert.equal(row(built.quarterly, "Equity (parent)").values[0], "$413.1M");
  assert.equal(row(built.quarterly, "= Total equity").values[0], "$3.01B");
  // Q2 FY2025: parent 299,145,000 + temporary equity 689,107,000.
  assert.equal(row(built.quarterly, "= Total equity").values[2], "$988.3M");
});

test("a component with no fact anywhere never appears, and neither does an empty cash flow line", () => {
  const built = buildFinancials(QNT.financials);
  assert.equal(QNT.financials.quarterly.grid.redeemable_noncontrolling_interest, undefined);
  assert.ok(!labels(built.quarterly).includes("+ Redeemable NCI"));
  assert.equal(QNT.financials.quarterly.grid.operating_cash_flow, undefined);
  assert.ok(!labels(built.quarterly).includes("Operating cash flow"));
});

test("with no components on file the equity block is a single line", () => {
  /* Goldman Sachs carries no noncontrolling, redeemable or temporary equity, so
     parent equity IS the total and the breakdown would be three rows of nothing. */
  const built = buildFinancials(GS.financials);
  assert.ok(labels(built.annual).includes("Total equity"));
  assert.ok(!labels(built.annual).includes("Equity (parent)"));
  assert.ok(!labels(built.annual).includes("= Total equity"));
});

/* ── ordering and hygiene ─────────────────────────────────────────── */

test("row order follows the desktop tab, so the two surfaces cannot disagree", () => {
  const INCOME_ORDER = [
    "Revenue",
    "Cost of revenue",
    "Gross profit",
    "Gross margin",
    "Operating income",
    "Net income",
    "EPS (diluted)",
  ];
  const BALANCE_ORDER = [
    "Total assets",
    "Equity (parent)",
    "Total equity",
    "+ Noncontrolling interests",
    "+ Redeemable NCI",
    "+ Temporary equity",
    "= Total equity",
    "Operating cash flow",
  ];
  const orderFor = (band: string) => (band === "INCOME STATEMENT" ? INCOME_ORDER : BALANCE_ORDER);

  for (const c of ALL_CAPTURED) {
    const built = buildFinancials(c.financials);
    for (const basis of BASES) {
      for (const band of built[basis].bands) {
        const canonical = orderFor(band.band);
        let cursor = -1;
        for (const r of band.rows) {
          const at = canonical.indexOf(r.label, cursor + 1);
          assert.ok(
            at > cursor,
            `${c.slug} ${basis} ${band.band}: "${r.label}" is out of the canonical order`,
          );
          cursor = at;
        }
      }
    }
  }
});

test("nothing the mapper emits carries an em dash, and no cell carries a glyph at all", () => {
  /* `FinancialsTab` renders `&mdash;` for a missing cell, which
     `scripts/design-lint.mjs` rejects outright. A missing cell here is `null`
     and the section chooses the mark, so this mapper cannot reintroduce it. */
  for (const c of ALL_CAPTURED) {
    const built = buildFinancials(c.financials);
    assert.ok(!built.note.includes(EM_DASH));
    for (const basis of BASES) {
      for (const p of built[basis].periods) assert.ok(!p.includes(EM_DASH));
      for (const r of allRows(built[basis])) {
        assert.ok(!r.label.includes(EM_DASH));
        for (const v of r.values) {
          assert.ok(v === null || !v.includes(EM_DASH));
          assert.ok(v !== "-" && v !== "–", "an absent cell is null, never a dash string");
        }
      }
    }
  }
});

test("period labels are unique within a basis, so the header keys cannot collide", () => {
  for (const c of ALL_CAPTURED) {
    const built = buildFinancials(c.financials);
    for (const basis of BASES) {
      const p = built[basis].periods;
      assert.equal(new Set(p).size, p.length, `${c.slug} ${basis}: duplicate period label`);
    }
  }
});

/* ── a read that failed is not a company with nothing on file ────────── */

test("a successful read is never marked as failed, across every capture", () => {
  for (const c of ALL_CAPTURED) {
    assert.equal(buildFinancials(c.financials).readFailed, false, c.slug);
  }
});

test("readFailed is carried off the read, not derived from the emptiness", () => {
  /* This is the whole point. `fetchCompanyFinancials` answers a Postgres 57014
     statement timeout with the SAME empty views a company with no facts gets,
     so the bands cannot tell the two apart. Measured on
     /company/salesforce?tab=financials twenty minutes apart in one session: the
     empty sentence on one pass and the full FY2022 to FY2026 table on the next,
     over a filer whose net_income FY2026 is on file at 7,457,000,000.

     ALVOTECH is the honest empty: a resolved CIK with no validated facts. The
     timeout below is byte-identical to it apart from this flag, which is
     exactly why the flag has to exist. */
  const honestlyEmpty = buildFinancials(ALVOTECH.financials);
  const timedOut = buildFinancials({ ...ALVOTECH.financials, readFailed: true });

  assert.equal(honestlyEmpty.readFailed, false);
  assert.equal(timedOut.readFailed, true);
  // Identical in every other respect, which is the trap.
  assert.deepEqual({ ...timedOut, readFailed: false }, honestlyEmpty);
});

test("a filer WITH figures still reports a failed read as failed", () => {
  // The flag is the read's answer, not a summary of the rows.
  const built = buildFinancials({ ...GS.financials, readFailed: true });
  assert.equal(built.readFailed, true);
  assert.ok(built.annual.periods.length > 0);
});
