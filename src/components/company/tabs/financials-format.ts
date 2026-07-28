/**
 * Cell value formatting for the Financials tab. Pure module (no JSX) so the
 * node:test unit suite can import it directly.
 *
 * NULL/ABSENT cells never reach these formatters: ValueCell (FinancialsTab)
 * renders the em-dash for missing/non-finite cells BEFORE formatting. A true
 * zero is a reported fact and renders "$0" (not "$0K"); all non-zero
 * magnitudes keep the adaptive K/M/B shape, negatives in parentheses.
 *
 * CURRENCY. The prefix is no longer a hardcoded "$". Foreign private issuers
 * report in their own currency (Taiwan Semiconductor in TWD, Novo Nordisk in
 * DKK) and stamping a dollar sign on a TWD figure states a number that is wrong
 * by the exchange rate. The `currency` argument defaults to "USD" so every
 * existing call renders byte-identically to before.
 */

import { currencyPrefix } from "@/lib/reporting-currency";

export type Fmt = "usd" | "eps" | "shares" | "pct";

export function formatValue(v: number, fmt: Fmt, currency: string | null = "USD"): string {
  // Non-USD codes render as "TWD 2.89B" rather than a symbol, because an
  // unfamiliar symbol beside a large number reads as dollars to a US reader.
  const p = currencyPrefix(currency ?? "USD");
  switch (fmt) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "eps":
      return v < 0 ? `(${p}${Math.abs(v).toFixed(2)})` : `${p}${v.toFixed(2)}`;
    case "shares":
      return `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
    case "usd": {
      if (v === 0) return `${p}0`; // a reported zero is "$0", never "$0K"
      const a = Math.abs(v);
      const s =
        a >= 1e9
          ? `${p}${(a / 1e9).toFixed(2)}B`
          : a >= 1e6
            ? `${p}${(a / 1e6).toFixed(1)}M`
            : `${p}${(a / 1e3).toFixed(0)}K`;
      return v < 0 ? `(${s})` : s;
    }
  }
}
