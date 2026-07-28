/**
 * currency-mislabel-guard.ts -- post-generation backstop against a figure
 * labeled in the wrong currency.
 *
 * Third sibling of compliance-language-filter.ts (is it prescriptive) and
 * multi-period-claim-validator.ts (is the arithmetic true). This one asks: is
 * the DENOMINATION true. Same mechanism, split into sentences and drop the
 * offenders, because a mislabeled figure is a false statement of fact about a
 * security and neither existing filter can see it.
 *
 * The failure it exists to prevent: Taiwan Semiconductor reports 2,894,307,700,000
 * TWD of FY2024 revenue. Rendered as "$2.89 trillion" that is off by roughly a
 * factor of 32 and reads as completely plausible. The arithmetic is correct, the
 * compliance language is clean, and only the unit is wrong, so the derived-facts
 * validator passes it.
 *
 * Conservative like its siblings: a sentence carrying a dollar sign or the word
 * "dollars" when the filer reported in something else is stripped, not repaired.
 * We do not rewrite a number we are not certain about.
 *
 * Pure and dependency-free. Unit-testable.
 */

import { splitSentences } from "./compliance-language-filter";

export interface CurrencyFinding {
  sentence: string;
  /** The token that indicated the wrong denomination. */
  marker: string;
  reason: string;
}

export interface CurrencyGuardResult {
  clean: string;
  findings: CurrencyFinding[];
  blocked: boolean;
}

/** Markers that assert US dollars specifically. */
const USD_MARKERS: RegExp[] = [
  /\$/,
  /\bUSD\b/i,
  /\bU\.?S\.?\s+dollars?\b/i,
  /\bdollars?\b/i,
];

/**
 * Strip sentences that denominate a figure in dollars when the filer did not
 * report in USD. A USD filer passes through untouched, so this is a no-op for
 * every domestic company.
 */
export function guardCurrencyMislabel(
  text: string | null | undefined,
  reportingCurrency: string | null,
): CurrencyGuardResult {
  const src = (text ?? "").trim();
  if (!src) return { clean: "", findings: [], blocked: false };

  // Nothing to guard when the filer reports in dollars, or when we do not know
  // the currency at all. In the unknown case the caller should not be
  // generating commentary; see the route gate.
  if (reportingCurrency == null || reportingCurrency === "USD") {
    return { clean: src, findings: [], blocked: false };
  }

  const findings: CurrencyFinding[] = [];
  const kept: string[] = [];
  for (const sentence of splitSentences(src)) {
    const hit = USD_MARKERS.find((re) => re.test(sentence));
    if (hit) {
      findings.push({
        sentence,
        marker: (sentence.match(hit) ?? [""])[0],
        reason: `figure denominated in dollars but the filer reports in ${reportingCurrency}`,
      });
    } else {
      kept.push(sentence);
    }
  }

  const clean = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return { clean, findings, blocked: findings.length > 0 };
}
