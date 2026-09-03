/**
 * Does a `companies` row belong to the registrant the union named?
 *
 * The union answers with a CIK. Looking the CIK up in `companies` inherits
 * whatever that table was stamped with, and the stamping is not always right:
 * prod row b757f7fb is named "Envu" and carries ticker KVUE and cik 1944048,
 * which are Kenvue's. Anchoring a page for "Kenvue" on that row would put
 * Kenvue's filings under the heading "Envu" and pull Envu's article pool. That
 * is the shape this project refuses to ship, so a row must AGREE before it can
 * anchor anything.
 *
 * WHY NOT src/lib/name-agreement.ts. That module is a WRITE gate and it is
 * deliberately generous: it accepts on a difflib ratio of 0.80, and
 * ratio("envu", "kenvue") is exactly 0.80. Measured over the 97 rows this
 * function guards, namesAgree accepts all 97 including the Envu mis-stamp.
 * A gate that accepts everything is not a check.
 *
 * The rule here is containment, not similarity. Either the row name is a
 * LEADING run of the registrant's tokens, or one side is a strict >=3 letter
 * acronym of the other. Measured cost: 6 correct rows rejected (IBKR for
 * Interactive Brokers Group, HWM for Howmet Aerospace, Raytheon for RTX Corp,
 * and Disney for Walt Disney Co on three typed spellings). Every one of those
 * six resolves to nothing today, so the cost is a gain not taken rather than a
 * regression, and it buys the Envu rejection.
 */
import { strongKey } from "./normalize";

function tokensOf(name: string): string[] {
  return strongKey(name).split(" ").filter(Boolean);
}

function isLeadingRun(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return b.slice(0, a.length).join(" ") === a.join(" ");
}

function isAcronym(short: string[], long: string[]): boolean {
  if (short.length !== 1 || long.length < 3) return false;
  const s = short[0];
  if (s.length < 3 || s.length !== long.length) return false;
  return s.split("").sort().join("") === long.map((w) => w[0]).sort().join("");
}

/** True when `rowName` can stand in for `registrantName` on a page heading. */
export function rowMatchesRegistrant(rowName: string | null, registrantName: string): boolean {
  const a = tokensOf(rowName ?? "");
  const b = tokensOf(registrantName);
  if (!a.length || !b.length) return false;
  return isLeadingRun(a, b) || isLeadingRun(b, a) || isAcronym(a, b) || isAcronym(b, a);
}
