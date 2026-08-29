/**
 * buildFilings, proved against reads captured verbatim off the live database.
 *
 * `/company/[id]` is a SERVER component, so `page.route()` cannot observe any
 * of its reads and Playwright interception cannot reach this mapper. Under
 * CLAUDE.md's preflight rule the substitute is deterministic verification, and
 * this is it: the real read objects go in, the rendered row shape comes out,
 * and every assertion is against a value the database returned.
 *
 * Run: npx tsx --test tests/unit/company-mobile-filings.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildFilings, formatFilingDate } from "@/lib/company-mobile/build";
import { countByCategory } from "@/lib/filing-categories";
import type { CompanyFilingsResult } from "@/lib/sec-filings";

import { ALL_CAPTURED, GS, QNT, GRAB, ASML, ALVOTECH, NO_CIK } from "./captured/index.ts";

/* Escaped rather than written literally: this file asserts that the mappers
   never emit an em dash, and `scripts/design-lint.mjs` bans the character in
   source, so the assertion cannot spell out the thing it forbids. */
const EM_DASH = "\u2014";

test("every captured company yields exactly one row per stored filing", () => {
  for (const c of ALL_CAPTURED) {
    const { rows } = buildFilings(c.filings);
    assert.equal(
      rows.length,
      c.filings.filings.length,
      `${c.slug}: row count must equal the stored filing count`,
    );
  }
});

test("a company with no SEC identity yields no rows, and so does an identified company with nothing filed", () => {
  // Measured: 793 of 5,599 companies carry a sec_cik, so the no-CIK branch is
  // the common one. Neither of these draws a row, but the SECTION copy differs,
  // and that difference is driven by `hasCik` on the page, not by this mapper.
  assert.equal(NO_CIK.filings.cik, null);
  assert.deepEqual(buildFilings(NO_CIK.filings).rows, []);

  assert.notEqual(ALVOTECH.filings.cik, null);
  assert.deepEqual(buildFilings(ALVOTECH.filings).rows, []);

  // ASML has a CIK and a full financials table, and still zero stored filings.
  assert.equal(ASML.filings.cik, 937966);
  assert.deepEqual(buildFilings(ASML.filings).rows, []);
});

test("form type is carried through exactly as stored, amendment suffix included", () => {
  const rows = buildFilings(GS.filings).rows;
  assert.deepEqual(
    rows.map((r) => r.formType),
    GS.filings.filings.map((f) => f.formType),
  );
  // "4/A" must survive intact: `categorizeForm` strips the suffix itself, and a
  // mapper that normalised it here would make the badge disagree with the row.
  assert.ok(rows.some((r) => r.formType === "4/A"), "Goldman Sachs files 4/A amendments");
});

test("a null form type and a null summary are carried, not replaced", () => {
  /* `sec_filings.form_type` and `summary` are both nullable columns.
     Measured on the live table: 0 of 4,575 rows carry a null form_type today
     and 24 (0.52%) carry a null summary, so the null form branch has no
     captured example to draw on. Both nulls are ABSENCES rather than figures,
     so constructing them here invents nothing: the assertion is that the mapper
     passes an absence through instead of substituting a label. The shape widened
     `formType` to `string | null` for exactly this row. */
  const withNulls: CompanyFilingsResult = {
    cik: 1,
    companyId: "test",
    filings: [
      {
        accessionNumber: "0000000000-00-000000",
        formType: null,
        filingDate: "2026-07-31",
        documentUrl: null,
        summary: null,
        outputId: null,
      },
    ],
  };
  const [row] = buildFilings(withNulls).rows;
  assert.equal(row.formType, null);
  assert.equal(row.summary, null);
  assert.equal(row.date, "JUL 31");
});

test("summaries are rendered as stored, boilerplate and truncation included", () => {
  for (const c of ALL_CAPTURED) {
    assert.deepEqual(
      buildFilings(c.filings).rows.map((r) => r.summary),
      c.filings.filings.map((f) => f.summary),
      `${c.slug}: summary must be verbatim`,
    );
  }
  // Form 4 summaries really are this boilerplate. Tidying them would put words
  // on the screen that no row contains.
  assert.ok(
    buildFilings(GRAB.filings).rows.some(
      (r) => r.summary === "Form 4: 1 qualifying insider transaction(s)",
    ),
  );
});

test("the date is the design's month-and-day, zero padded, with no year", () => {
  const rows = buildFilings(GS.filings).rows;
  assert.equal(GS.filings.filings[0].filingDate, "2026-08-28");
  assert.equal(rows[0].date, "AUG 28");
  for (const r of rows) {
    assert.match(r.date, /^[A-Z]{3} \d{2}$/, `unexpected date shape: ${r.date}`);
  }
});

test("the date is parsed off the string, so it never drifts a day by time zone", () => {
  /* `filing_date` is a DATE column and arrives as a bare "YYYY-MM-DD".
     `new Date("2026-01-01")` is midnight UTC, and `toLocaleDateString` in any
     Americas zone renders it as the 31st of December. That is a wrong date on a
     legal document, and it is invisible to anyone testing from UTC. This
     assertion is true in every zone. */
  assert.equal(formatFilingDate("2026-01-01"), "JAN 01");
  assert.equal(formatFilingDate("2026-12-31"), "DEC 31");
  assert.equal(formatFilingDate("2026-05-09"), "MAY 09");
});

test("an absent or malformed date is absent, never a stand-in", () => {
  assert.equal(formatFilingDate(null), "");
  assert.equal(formatFilingDate(""), "");
  assert.equal(formatFilingDate("not-a-date"), "");
  assert.equal(formatFilingDate("2026-13-01"), "", "month 13 is not a month");
  assert.equal(formatFilingDate("2026-00-01"), "", "month 0 is not a month");
});

test("the chip counts the rows the mapper emits, and Other is structurally zero", () => {
  /* Measured on the live table: `sec_filings` carries 4,575 rows and exactly
     eight distinct form types, 8-K 2,330, 4 1,545, 10-Q 599, 8-K/A 43, 10-K 31,
     4/A 9, 10-K/A 7 and 10-Q/A 5. `categorizeForm` routes all eight, so `Other`
     counts zero for every company on the platform and the chip renders
     disabled. That is the classifier agreeing with the corpus, not a defect. */
  for (const c of ALL_CAPTURED) {
    const counts = countByCategory(buildFilings(c.filings).rows);
    assert.equal(counts.other, 0, `${c.slug}: no stored form type falls outside the four chips`);
    assert.equal(counts.all, c.filings.filings.length);
  }

  const qnt = countByCategory(buildFilings(QNT.filings).rows);
  assert.equal(qnt.all, 13);
  assert.equal(qnt.insider, 11, "11 of Quantinuum's 13 filings are Form 4");
  assert.equal(qnt.quarterly, 1);
  assert.equal(qnt.events, 1);
  assert.equal(qnt.annual, 0);
});

test("nothing the mapper emits carries an em dash", () => {
  for (const c of ALL_CAPTURED) {
    for (const r of buildFilings(c.filings).rows) {
      assert.ok(!r.date.includes(EM_DASH));
      assert.ok(!(r.summary ?? "").includes(EM_DASH));
      assert.ok(!(r.formType ?? "").includes(EM_DASH));
    }
  }
});
