/**
 * Captured reads. Real `CompanyFilingsResult` and `CompanyFinancialsResult`
 * objects, taken verbatim off the live database on 2026-08-29.
 *
 * WHY THESE EXIST AND WHY THEY ARE NOT INVENTED. `/company/[id]` is a SERVER
 * component, so `page.route()` sees none of its reads and Playwright
 * interception cannot reach the mappers under test at all. Under CLAUDE.md's
 * preflight rule the substitute for e2e is deterministic verification, and the
 * only deterministic proof worth having here is one that runs the mappers
 * against exactly what the database produces. The screen these mappers feed
 * previously ran on a hand-transcribed income statement and balance sheet
 * attributed to a real issuer; a hand-written stand-in here would be the same
 * mistake one layer down.
 *
 * HOW THEY WERE MADE. `fetchCompanyFilings(supabase, { name }, 100)` and
 * `fetchCompanyFinancials(supabase, { name })`, the exact two calls
 * `src/app/company/[id]/page.tsx` makes, serialised straight to JSON. Read
 * only. Nothing was written, no model was called, and not one field was edited
 * afterwards, so every figure below is a value the database returned.
 *
 * WHY THESE SIX. Each one is a branch that the deleted 2-tuple shape could not
 * represent, or a real emptiness the screen has to draw honestly:
 *
 *   goldman-sachs  cik 886982. 15 filings across four form types, 5 annual and
 *                  8 quarterly columns. The dense case, and the one that
 *                  carries genuinely missing cells: the two fiscal year-end
 *                  columns in the quarterly view have a balance sheet and no
 *                  income lines, because no Q4 10-Q exists.
 *   asml           cik 937966. Reports in EUR. Zero filings but 5 annual and 8
 *                  quarterly columns, and its quarterly view carries balance
 *                  sheet metrics only, so a whole band has to disappear.
 *   grab           cik 1855612. Exactly ONE validated fact in the entire view,
 *                  `cost_of_revenue` FY2022. One annual column, zero quarterly.
 *                  This is the company a fixed pair of period columns could not
 *                  express without inventing a second period.
 *   quantinuum     cik 2110105. Zero annual columns, five quarterly, and it
 *                  carries `minority_interest` and `temporary_equity`, so its
 *                  balance band takes the equity-breakdown path. 13 filings, 11
 *                  of them Form 4.
 *   alvotech       cik 1898416. A resolved SEC identity with zero filings and
 *                  zero facts. Empty is not the same claim as unidentified.
 *   mistral-ai     no cik at all. Measured: 793 of 5,599 companies carry a
 *                  `sec_cik` (14.2%), so this branch is the common one.
 */

import type { CompanyFinancialsResult } from "@/lib/financial-facts";
import type { CompanyFilingsResult } from "@/lib/sec-filings";

import alvotech from "./alvotech.json";
import asml from "./asml.json";
import goldmanSachs from "./goldman-sachs.json";
import grab from "./grab.json";
import mistralAi from "./mistral-ai.json";
import quantinuum from "./quantinuum.json";

export interface CapturedRead {
  slug: string;
  name: string;
  filings: CompanyFilingsResult;
  financials: CompanyFinancialsResult;
}

/* The JSON is untyped on the way in, so each capture is adapted to the
   interface the page passes. A structural mismatch here would mean the read
   shape has moved and the capture is stale, which is worth a compile error.

   `readFailed: false` IS SET HERE AND NOT IN THE JSON, on purpose. The files
   are verbatim serialisations of what the database returned and nothing in
   them was edited afterwards, which is the only reason they are worth having.
   The flag postdates the captures and is `false` for every one of them by
   construction: a read that failed gives back empty views, and each capture below
   carries the rows it was taken from. Editing the JSON to add it would break
   the one property that makes these files evidence. */
function captured(raw: unknown): CapturedRead {
  const r = raw as CapturedRead;
  return { ...r, financials: { ...r.financials, readFailed: false } };
}

export const GS = captured(goldmanSachs);
export const ASML = captured(asml);
export const GRAB = captured(grab);
export const QNT = captured(quantinuum);
export const ALVOTECH = captured(alvotech);
export const NO_CIK = captured(mistralAi);

export const ALL_CAPTURED: CapturedRead[] = [GS, ASML, GRAB, QNT, ALVOTECH, NO_CIK];
