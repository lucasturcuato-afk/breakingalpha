import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInsider } from "./build";
import type { InsiderTransaction } from "@/lib/insider-transactions";
import type { InsiderTransactionsResult } from "@/lib/data-access/getInsiderTransactions";

/**
 * buildInsider, the Form 4 block of the mobile Company Intel screen.
 *
 * THIS IS THE BLOCK THE SPRINT EXISTS FOR. The deleted fixture carried invented
 * Form 4 rows naming real executives, so every row this mapper emits has to be
 * traceable to a stored one. The rows below are REAL, copied off
 * `insider_transactions` through the anon key on 2026-08-29: a titled officer, a
 * filer with a null title (1,397 of 5,052 rows carry none), a code P
 * acquisition, and one row whose `total_value` carries the float noise
 * PostgREST hands back.
 *
 * WHY UNIT AND NOT E2E: `/company/[id]` is a server component, so its reads are
 * resolved before the browser is involved and `page.route()` cannot intercept
 * them. The seam under test is the mapping, and this is where it can be seen.
 */

function tx(over: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    id: "a8e15291-87e2-4af1-920f-e7eefe8d0166",
    accessionNumber: "0000087347-26-000118",
    insiderName: "Le Peuch Olivier",
    insiderTitle: "Chief Executive Officer",
    transactionCode: "S",
    transactionDate: "2026-08-27",
    filedDate: null,
    shares: 5000,
    pricePerShare: 55,
    totalValue: 275000,
    sharesOwnedAfter: 1336328,
    documentUrl: null,
    ...over,
  };
}

function result(transactions: InsiderTransaction[]): InsiderTransactionsResult {
  return { transactions, cik: 1730168 };
}

/** A real row, float noise and all. */
const NOISY = tx({
  id: "01048cca-acc0-48be-b1cc-2290587e59f3",
  insiderName: "Meister Keith A.",
  insiderTitle: null,
  transactionDate: "2026-08-27",
  shares: 24363,
  pricePerShare: 228.64,
  totalValue: 5570356.319999999,
  sharesOwnedAfter: 1088744,
});

/** A real code P row. */
const ACQUISITION = tx({
  id: "edd6b9da-534c-4b46-ba49-7f921f241296",
  accessionNumber: null,
  insiderName: "TILDEN BRADLEY D",
  insiderTitle: "Director",
  transactionCode: "P",
  transactionDate: "2026-05-20",
  shares: 1370,
  pricePerShare: 218.5,
  totalValue: 299345,
  sharesOwnedAfter: 1370,
});

describe("buildInsider: the open-market rows", () => {
  it("copies each field off the stored row", () => {
    const built = buildInsider(result([tx()]));
    assert.equal(built.openMarket.length, 1);
    assert.deepEqual(built.openMarket[0], {
      name: "Le Peuch Olivier",
      role: "Chief Executive Officer",
      date: "AUG 27, 2026",
      code: "S · Open-market sale",
      shares: "5,000",
      price: "$55.00",
      heldAfter: "1,336,328",
    });
  });

  it("keeps the year on the date, and does not shift it across a timezone", () => {
    // transaction_date is date-only. Running it through a zone converter moves
    // a UTC-midnight value back a calendar day for every reader west of UTC.
    const built = buildInsider(result([tx({ transactionDate: "2026-01-01" })]));
    assert.equal(built.openMarket[0].date, "JAN 1, 2026");
  });

  it("states the filed absence rather than inventing a role or a name", () => {
    const built = buildInsider(result([NOISY, tx({ insiderName: null })]));
    assert.equal(built.openMarket.find((r) => r.name === "Meister Keith A.")?.role, "Not stated");
    assert.ok(built.openMarket.some((r) => r.name === "Not stated"));
  });

  it("marks an unpriced row absent rather than zero", () => {
    const built = buildInsider(result([tx({ pricePerShare: null, sharesOwnedAfter: null })]));
    assert.equal(built.openMarket[0].price, "n/a");
    assert.equal(built.openMarket[0].heldAfter, "n/a");
    assert.notEqual(built.openMarket[0].price, "$0.00");
  });

  it("names the code AND what the code means, so P and S are not a guess", () => {
    const built = buildInsider(result([ACQUISITION]));
    assert.equal(built.openMarket[0].code, "P · Open-market purchase");
  });

  it("orders newest first, the desktop order", () => {
    const built = buildInsider(result([ACQUISITION, tx()]));
    assert.deepEqual(
      built.openMarket.map((r) => r.date),
      ["AUG 27, 2026", "MAY 20, 2026"],
    );
  });

  it("never renders the float noise PostgREST hands back", () => {
    // total_value is not on this shape at all, which is why. Pinned so a later
    // edit cannot quietly put "$5570356.319999999" on a card.
    const built = buildInsider(result([NOISY]));
    assert.doesNotMatch(JSON.stringify(built), /319999999/);
    assert.equal(built.openMarket[0].shares, "24,363");
    assert.equal(built.openMarket[0].price, "$228.64");
  });
});

describe("buildInsider: the two structurally empty groups", () => {
  it("gives back no routine and no other rows for real stored data", () => {
    const built = buildInsider(result([tx(), ACQUISITION, NOISY]));
    assert.deepEqual(built.routine, []);
    assert.deepEqual(built.other, []);
  });

  it("gives back an empty record for a company with no rows at all", () => {
    const built = buildInsider({ transactions: [], cik: null });
    assert.deepEqual(built, { openMarket: [], routine: [], other: [] });
  });

  it("cannot leak a non-open-market code under the open-market heading", () => {
    // The heading over openMarket states "SEC codes P and S". Nothing writes an
    // A row today, so this is a guard and not a live case: if the extractor ever
    // does, the row must not arrive wearing a heading that misdescribes it.
    const built = buildInsider(result([tx({ id: "grant", transactionCode: "A" }), tx()]));
    assert.equal(built.openMarket.length, 1);
    assert.equal(built.openMarket[0].code, "S · Open-market sale");
  });
});
