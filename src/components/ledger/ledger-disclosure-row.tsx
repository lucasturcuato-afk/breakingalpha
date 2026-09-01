import type { ReactNode } from "react";
import { CLAIM_TYPE_SCALE, ClaimAnatomy } from "./claim-anatomy";
import { Chevron } from "./chevron";
import styles from "./ledger.module.css";

/**
 * A ruled row that opens where it stands.
 *
 * A WRAPPER BESIDE `LedgerEntryRow`, NEVER A BRANCH INSIDE IT. That row's whole
 * contract is that the container IS the control and the control goes somewhere:
 * pass `onOpen` and it becomes a `<button>` that navigates, omit it and it is a
 * plain div. Neither shape can carry `aria-expanded`, and a row that opens in
 * place has to. So this is a second component with the same frame and the same
 * anatomy rather than a flag on that one, which is the same call
 * `ledger-claim-card.tsx` and `ledger-entry-row.tsx` already made about each
 * other.
 *
 * THE FIRST IN-PLACE DISCLOSURE IN THIS REPO, and it follows the two hand-rolled
 * precedents rather than inventing a third shape. `evening-wrap-screen.tsx` and
 * `feed-mobile-screen.tsx` both obey one rule and so does this:
 *
 *   A TOGGLE WITH NOTHING BEHIND IT IS A CONTROL THAT LIES ABOUT WHAT IT DOES.
 *
 * Both of those render their toggle only when there is more to show. Here that
 * is `disclosable` below: with no reading and no detail there is nothing behind
 * the control, so the row renders as a plain div with its claim UNCLAMPED. That
 * pairing is the whole rule in one line. The clamp exists to summarise
 * something that can be opened; a clamp with no opener would hide text with no
 * way to reach it, which is worse than the row it replaced.
 *
 * THE CLAIM IS CLAMPED, NOT THE READING, and that inverts the Ledger's card.
 * The card clamps its reading to three lines and puts a right chevron beside it
 * because the reading continues on another screen. On a record the reading is
 * the second paragraph of every row and it is never the thing a reader is
 * scanning for, so it is the half that goes behind the control. What stays is
 * the state word, the instrument and the claim's first clause.
 *
 * THE CHEVRON POINTS DOWN WHEN OPEN AND RIGHT WHEN CLOSED, which is `Chevron`'s
 * own vocabulary used as it is documented: right for a reading that continues,
 * down for one that is now below. There is no up arm in that component and this
 * does not add one.
 *
 * `detail` IS RENDERED OUTSIDE THE BUTTON, on purpose. It carries a link on
 * both screens that consume this, and a link inside a button is nested
 * interactive content: the row's own control would swallow the destination's
 * tap on some engines and announce two controls as one everywhere. The button
 * is the head, the opened body is its sibling, and the container is a plain
 * div. That also keeps the tap target honest: what is drawn as the control is
 * exactly what is bound to the toggle.
 *
 * CONTROLLED, WITH NO STATE OF ITS OWN. The screens hold one open-set between
 * them, which is what lets a screen close every row when its filter changes
 * without this component knowing a filter exists.
 */

export interface LedgerDisclosureRowProps {
  /**
   * The state dot and its word, plus the instrument. Passed rather than derived
   * because one of the two screens draws a row that has no outcome word at all
   * and must not be given one.
   */
  lead: ReactNode;
  /** The claim as it was made. Never rewritten, never truncated. */
  claim: string;
  /**
   * The reading behind the control: how it settled, or what it is watching for.
   * Absent means there is nothing to open, and the row draws no control.
   */
  reading?: ReactNode;
  /** Anything else the opened body carries, e.g. a destination. */
  detail?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** True for the first row under a rule, which carries the top margin. */
  first?: boolean;
}

export function LedgerDisclosureRow({
  lead,
  claim,
  reading,
  detail,
  open,
  onToggle,
  first = false,
}: LedgerDisclosureRowProps) {
  const disclosable = Boolean(reading) || Boolean(detail);
  const s = CLAIM_TYPE_SCALE.row;

  /* `LedgerEntryRow`'s measured frame, unchanged: padding 15px 0, a 1px
     hairline on top, and a 7px column gap. The two row shapes sit in one list
     on both screens, so they cannot be two different frames. */
  const frame: React.CSSProperties = {
    padding: "15px 0",
    borderTop: "1px solid var(--c-hair)",
    marginTop: first ? "10px" : 0,
    display: "flex",
    flexDirection: "column",
    gap: "7px",
  };

  const head = (
    <ClaimAnatomy
      scale="row"
      lead={
        disclosable ? (
          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            {/* flex 1 and min-width 0: the lead is itself a flex row whose
                instrument is pushed right with `margin-left:auto`, and without
                a definite width here a long instrument would push the chevron
                off the row instead of the lead shrinking. */}
            <div style={{ flex: 1, minWidth: 0 }}>{lead}</div>
            <Chevron direction={open ? "down" : "right"} />
          </div>
        ) : (
          lead
        )
      }
      claim={claim}
      claimClassName={disclosable && !open ? styles.clamp1 : undefined}
    />
  );

  if (!disclosable) {
    return <div data-row style={frame}>{head}</div>;
  }

  return (
    <div data-row style={frame}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`${styles.bare} ${styles.focusable}`}
        style={{
          /* The drawn control is 44px whatever the claim wraps to. `.bare`
             zeroes padding and border, so there is no box to grow past the
             min-height and no `content-box` correction to make. */
          minHeight: "44px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "7px",
          textAlign: "left",
        }}
      >
        {head}
      </button>
      {open ? (
        /* The Ledger's own 240ms entrance, which already rests in its drawn
           state and already carries the reduced-motion guard. */
        <div
          className={styles.enter}
          style={{ display: "flex", flexDirection: "column", gap: "9px" }}
        >
          {reading ? (
            /* Drawn from the exported scale rather than from a literal, so the
               opened reading is the same type as an entry row's reading and
               cannot drift from it. */
            <p style={{ margin: 0, font: s.prose, color: "var(--c-body)" }}>{reading}</p>
          ) : null}
          {detail}
        </div>
      ) : null}
    </div>
  );
}
