/**
 * Per-instrument change-display formatting for the markets bar.
 *
 * Two display modes:
 *   - "percent": relative percent change. Adaptive precision so commodity
 *     micro-moves like WTI -0.032% don't truncate to "-0.03%". Sign rendered
 *     as "+/-".
 *   - "bps": basis points, the industry-standard unit for Treasury yield
 *     deltas. 1 bps = 0.01 percentage point. Sign rendered as "▲/▼".
 *
 * The caller decides the unit via the per-symbol display config in the
 * market-indices API. Defaults to "percent" so existing instruments are
 * unchanged.
 */

export type DisplayUnit = "percent" | "bps";

export interface ChangeDisplay {
  /** Full text incl. sign or arrow, ready to render. */
  text: string;
  /** True for >= 0 (used to pick the up/down color). */
  isPositive: boolean;
}

interface FormatChangeOptions {
  /** Relative percent change (e.g. -0.032 means -0.032%). */
  pct: number;
  /**
   * Absolute delta in the same units as the displayed value.
   * Required when `unit === "bps"`. Ignored otherwise.
   * For TNX (yield in percentage points), `change = current - prev`,
   * and bps = change * 100.
   */
  change?: number;
  unit?: DisplayUnit;
}

export function formatChange({ pct, change, unit = "percent" }: FormatChangeOptions): ChangeDisplay {
  if (unit === "bps") {
    const bps = typeof change === "number" ? change * 100 : 0;
    const isPositive = bps >= 0;
    if (bps === 0) {
      return { text: "0.0 bps", isPositive: true };
    }
    const arrow = bps > 0 ? "▲" : "▼";
    return { text: `${arrow} ${Math.abs(bps).toFixed(1)} bps`, isPositive };
  }

  const isPositive = pct >= 0;
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  // 3 decimals for nonzero micro-moves (e.g. WTI -0.032%) so commodity-class
  // ticks don't truncate to "-0.03%". Exact zero falls back to 2 decimals to
  // avoid an ugly "0.000%" placeholder on cards with no change data.
  const abs = Math.abs(pct);
  const precision = abs > 0 && abs < 0.1 ? 3 : 2;
  return { text: `${sign}${abs.toFixed(precision)}%`, isPositive };
}
