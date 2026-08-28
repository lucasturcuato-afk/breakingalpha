/**
 * The record's month boundary: an italic Playfair month, a hairline that
 * flexes to fill the row, and the count of entries in that month.
 *
 * WHY THIS IS NOT `LedgerDateRule`. Same anatomy, different trailing element,
 * and that is the whole difference. The date rule's trailing slot carries a
 * CONTROL (the Evening wrap link, 44px, underlined, focusable). This one carries
 * a NUMBER, which is not interactive and must not be sized like something that
 * is. Teaching the date rule an alternative trailing slot would be a branch
 * inside a component the Ledger, Dashboard and Evening Wrap all consume. The
 * type differs too, measured off the design: 12px here against the date rule's
 * 13px, and 16px 0 8px of padding against its 14px 0 0.
 *
 * The count is a count. There is no denominator beside it and nothing is
 * derived from it, because a month's entries over the record's entries is a
 * rate and rates do not appear on this product.
 */

import { FONT_DISPLAY, FONT_MONO } from "@/components/mobile/fonts";

export interface RecordMonthRuleProps {
  /** e.g. "February 2027". */
  label: string;
  /** How many entries fall in this month. Derived from the entries themselves. */
  count: number;
}

export function RecordMonthRule({ label, count }: RecordMonthRuleProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "16px 0 8px" }}>
      <span
        style={{
          font: `400 italic 12px/1 ${FONT_DISPLAY}`,
          color: "var(--c-secondary)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      <span
        style={{
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {count}
      </span>
    </div>
  );
}
