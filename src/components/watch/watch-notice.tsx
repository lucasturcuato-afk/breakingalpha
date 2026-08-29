import styles from "./watch.module.css";
import { FONT_SANS } from "@/components/mobile/fonts";

/**
 * The notice block, used for every tier's empty, failed and stale state.
 *
 * The prototype draws exactly one of these, the watchlist's empty block at
 * line 722, and draws no error and no stale surface anywhere on Watch. Rather
 * than invent a second anatomy, every non-ready state on this screen reuses
 * that block: a 1px border on --c-border, a 12px radius, --c-surface, 15px by
 * 16px padding, and 13px/1.6 Inter body copy. The states differ in what they
 * say and in whether they offer a retry, never in how they are drawn.
 *
 * The empty-versus-failed distinction is the point of the block existing at
 * all. `radar/following/page.tsx` and `radar/track-record/page.tsx` each carry
 * a dedicated failure surface for this reason; `radar/watchlist/page.tsx` does
 * not, and a failed read there is indistinguishable from an empty watchlist.
 * That defect is not ported here.
 */
export function WatchNotice({
  heading,
  body,
  onRetry,
  retryLabel = "Try again",
  action,
}: {
  /** Present on a failure. Absent on an empty or a stale tier. */
  heading?: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * A real destination, on an empty tier that names one.
   *
   * The empty copy already says these things are added "on the desk". Naming
   * the desk and not going there leaves a phone reader with an instruction and
   * no way to follow it, since `/watch` has no add affordance and is not
   * getting one in this unit. A real `a` element, never a button with a push.
   */
  action?: { href: string; label: string };
}) {
  return (
    <div
      style={{
        marginTop: "12px",
        padding: "15px 16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-surface)",
      }}
    >
      {heading ? (
        <p
          style={{
            margin: 0,
            font: `600 13px/1.6 ${FONT_SANS}`,
            color: "var(--c-ink)",
          }}
        >
          {heading}
        </p>
      ) : null}
      <p
        style={{
          margin: heading ? "5px 0 0" : 0,
          font: `400 13px/1.6 ${FONT_SANS}`,
          color: "var(--c-body)",
          textWrap: "pretty",
        }}
      >
        {body}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={styles.bare}
          /* 44px of target from content-box padding plus a negative margin, so
             the drawn control keeps its size and its position. */
          style={{
            boxSizing: "content-box",
            marginTop: "8px",
            minHeight: "16px",
            padding: "14px 0",
            marginBottom: "-14px",
            display: "inline-flex",
            alignItems: "center",
            font: `600 12.5px/1 ${FONT_SANS}`,
            color: "var(--c-goldink)",
          }}
        >
          {retryLabel}
        </button>
      ) : null}
      {action ? (
        <a
          href={action.href}
          /* Same 44px construction as the retry control above: content-box
             padding plus a negative margin, so the drawn line keeps its size
             and its position while the target does not. */
          style={{
            boxSizing: "content-box",
            marginTop: "8px",
            minHeight: "16px",
            padding: "14px 0",
            marginBottom: "-14px",
            display: "inline-flex",
            alignItems: "center",
            font: `600 12.5px/1 ${FONT_SANS}`,
            color: "var(--c-goldink)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          {action.label}
        </a>
      ) : null}
    </div>
  );
}

/** Shimmer bars standing in for a tier that has not arrived yet. */
export function WatchSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ marginTop: "13px", display: "flex", flexDirection: "column", gap: "10px" }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={styles.sk}
          style={{ height: i === 0 ? "54px" : "38px" }}
        />
      ))}
    </div>
  );
}
