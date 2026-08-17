import { ClaimAnatomy } from "./claim-anatomy";
import styles from "./ledger.module.css";

/**
 * A claim on the current day. Bordered, filled, 12px radius, 18px padding,
 * all measured off the rendered prototype.
 *
 * Two controls sit as SIBLINGS rather than nested: the reading region opens
 * the claim, the action opens the commit sheet. The card itself is not
 * focusable, because a container that already contains a focusable control must
 * not be focusable too, or a keyboard user tabs into a control whose
 * accessible name is the entire card before reaching the action inside it.
 *
 * The commit sheet is out of scope for this unit, so `onTrack` is optional and
 * the action renders only when a handler is supplied.
 */

export type ClaimCardVariant =
  /** Not yet on the user's ledger. Carries the action. */
  | "open"
  /** Already on the user's ledger. Carries a marker instead of an action. */
  | "onLedger"
  /** No honest grader exists for this claim type, so nothing can be committed. */
  | "ungradeable";

export interface LedgerClaimCardProps {
  /** Sector or theme. Rendered as the eyebrow. */
  eyebrow: string;
  /** The falsifiable sentence. */
  claim: string;
  /** The desk's reading. Clamped to --v3-clamp lines until the claim is opened. */
  reasoning?: string;
  /** When the claim gets checked, e.g. "reviewed Nov 4". */
  window?: string;
  /** Human reading of the same interval, e.g. "in about a quarter". */
  windowRelative?: string;
  variant?: ClaimCardVariant;
  /** Why nothing can be committed. Rendered only on the ungradeable variant. */
  ungradeableReason?: string;
  /** Opens the claim. Omit and the reading region renders as static text. */
  onOpen?: () => void;
  /** Opens the commit sheet. Omit and no action renders. */
  onTrack?: () => void;
  /** Staggered entrance delay in ms. */
  delayMs?: number;
}

export function LedgerClaimCard({
  eyebrow,
  claim,
  reasoning,
  window: reviewWindow,
  windowRelative,
  variant = "open",
  ungradeableReason,
  onOpen,
  onTrack,
  delayMs = 0,
}: LedgerClaimCardProps) {
  const reading = (
    <ClaimAnatomy
      scale="card"
      lead={
        <span style={{ font: "600 11px/1 Inter, sans-serif", color: "var(--c-secondary)" }}>
          {eyebrow}
        </span>
      }
      claim={claim}
      prose={reasoning ? <span className={styles.clamp}>{reasoning}</span> : undefined}
    />
  );

  return (
    <div
      className={styles.rise}
      style={{
        marginTop: "16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: variant === "ungradeable" ? "var(--c-surface)" : "var(--c-card)",
        padding: "18px",
        animationDelay: `${delayMs}ms`,
      }}
    >
      {onOpen ? (
        <button type="button" onClick={onOpen} className={styles.bare} style={{ width: "100%", textAlign: "left" }}>
          {reading}
        </button>
      ) : (
        reading
      )}

      {variant === "ungradeable" ? (
        <>
          <div style={{ marginTop: "14px", height: "1px", backgroundColor: "var(--c-hair)" }} />
          <p
            style={{
              margin: "12px 0 0",
              font: "400 11.5px/1.5 Inter, sans-serif",
              color: "var(--c-muted)",
            }}
          >
            {ungradeableReason}
          </p>
        </>
      ) : (
        <div
          style={{
            marginTop: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div style={{ font: "400 11.5px/1.4 Inter, sans-serif", color: "var(--c-secondary)" }}>
            {reviewWindow}
            {windowRelative ? (
              <>
                <br />
                <span style={{ color: "var(--c-muted)" }}>{windowRelative}</span>
              </>
            ) : null}
          </div>

          {variant === "onLedger" ? (
            <div
              style={{
                boxSizing: "content-box",
                minHeight: "12px",
                padding: "16px 0",
                margin: "-16px 0",
                display: "flex",
                alignItems: "center",
                font: "600 12px/1 Inter, sans-serif",
                color: "var(--c-muted)",
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden="true" style={{ marginRight: "6px" }}>
                &#9670;
              </span>
              On your ledger
            </div>
          ) : onTrack ? (
            <button
              type="button"
              onClick={onTrack}
              className={styles.bare}
              style={{
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                padding: "0 17px",
                border: "1px solid var(--c-ink)",
                borderRadius: "9px",
                font: "600 13px/1 Inter, sans-serif",
                color: "var(--c-ink)",
                whiteSpace: "nowrap",
              }}
            >
              Track this call
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
