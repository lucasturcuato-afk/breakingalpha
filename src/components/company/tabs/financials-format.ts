/**
 * Cell value formatting for the Financials tab. Pure module (no JSX) so the
 * node:test unit suite can import it directly.
 *
 * NULL/ABSENT cells never reach these formatters: ValueCell (FinancialsTab)
 * renders the em-dash for missing/non-finite cells BEFORE formatting. A true
 * zero is a reported fact and renders "$0" (not "$0K"); all non-zero
 * magnitudes keep the adaptive $K/$M/$B shape, negatives in parentheses.
 */

export type Fmt = "usd" | "eps" | "shares" | "pct";

export function formatValue(v: number, fmt: Fmt): string {
  switch (fmt) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "eps":
      return v < 0 ? `($${Math.abs(v).toFixed(2)})` : `$${v.toFixed(2)}`;
    case "shares":
      return `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
    case "usd": {
      if (v === 0) return "$0"; // a reported zero is "$0", never "$0K"
      const a = Math.abs(v);
      const s =
        a >= 1e9
          ? `$${(a / 1e9).toFixed(2)}B`
          : a >= 1e6
            ? `$${(a / 1e6).toFixed(1)}M`
            : `$${(a / 1e3).toFixed(0)}K`;
      return v < 0 ? `(${s})` : s;
    }
  }
}
