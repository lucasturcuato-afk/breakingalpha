import styles from "./ledger.module.css";

/**
 * The app-wide date rule: an italic Playfair date, a hairline that flexes to
 * fill the row, and an optional trailing control. The same element appears on
 * Dashboard, Evening Wrap and the shared brief, so it is the timeline's day
 * boundary rather than a Ledger-specific device. It repeats per day.
 *
 * WRAP SLOT, per the ruling on open items O1 and O3 in DECISIONS.md.
 *
 * The Ledger keeps its shape all day. The current day's rule already carries
 * the Evening wrap control and a past day's does not, so that control is the
 * slot, and this is a state on an existing element rather than a new one.
 *
 * Before the wrap is published the control reads "Evening wrap" and states no
 * time, which is what the design draws today. Once published it carries the
 * publication time, using the middot the design already uses to attach a time
 * to a label ("MARKET PULSE / 6:45 AM ET").
 *
 * The trigger is the wrap artifact existing, passed in as `wrapPublishedAt`.
 * There is no clock in this file and no inference from a market close: an
 * absent wrap at 6pm reads exactly as an absent wrap at 6am, because the only
 * thing either states is that the desk has not published.
 */

export interface LedgerDateRuleProps {
  /** Rendered verbatim, e.g. "Thursday, August 6". */
  date: string;
  /**
   * Publication time of the evening wrap, already formatted for display, e.g.
   * "4:41 PM ET". Null or absent means not published, and the control states
   * no time. Never derive this from the current time.
   */
  wrapPublishedAt?: string | null;
  /** Opens the wrap. Omit on a past day, which carries no control. */
  onOpenWrap?: () => void;
  /** Past days sit further from the content above them. Measured 26px vs 14px. */
  past?: boolean;
}

export function LedgerDateRule({
  date,
  wrapPublishedAt,
  onOpenWrap,
  past = false,
}: LedgerDateRuleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "11px",
        padding: past ? "26px 0 0" : "14px 0 0",
      }}
    >
      <span
        style={{
          font: "400 italic 13px/1 var(--font-playfair-display), serif",
          color: "var(--c-secondary)",
        }}
      >
        {date}
      </span>
      <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      {onOpenWrap ? (
        <button
          type="button"
          onClick={onOpenWrap}
          className={styles.bare}
          style={{
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            font: "600 11px/1 var(--font-inter), sans-serif",
            color: "var(--c-ink)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            whiteSpace: "nowrap",
          }}
        >
          {wrapPublishedAt ? `Evening wrap · ${wrapPublishedAt}` : "Evening wrap"}
        </button>
      ) : null}
    </div>
  );
}
