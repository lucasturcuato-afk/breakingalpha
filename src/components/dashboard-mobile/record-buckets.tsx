import { RESOLUTION_ORDER, DESK_RECORD_COPY, type Resolution } from "@/lib/desk-record";
import { YOUR_RECORD_COPY } from "@/lib/your-record";
import styles from "./dashboard.module.css";
import { BAR_OFFSETS } from "./entrance-ladder";
import { FONT_MONO } from "@/components/mobile/fonts";

/**
 * The four-bucket record grid, in its two drawings.
 *
 * The Dashboard renders this twice, twelve prototype lines apart, from two
 * separate implementations that exist as two separate files on the desk
 * (`desk-record-summary.tsx` and the private `YourRecordSummary` inside
 * `your-calls-widget.tsx`). Building the mobile screen as two components would
 * repeat the split that already made two anatomies out of one idea, and the
 * same grid is the Prepared record and the Entry screen later on. One
 * component, one variant prop.
 *
 * The model is not re-derived. `RESOLUTION_ORDER` fixes the order, so misses
 * are never pushed to the end, and `DESK_RECORD_COPY.bucketLabel` fixes the
 * vocabulary, so the labels here can never drift from the labels on a card.
 *
 * `awaiting` is a separate input rather than a fifth interchangeable cell.
 * The personal record's fourth cell is AWAITING, which in `your-record.ts` is
 * a count of calls still inside their window and sits outside `byResolution`
 * entirely; the desk's fourth cell is NOT GRADED, which is a resolution. They
 * look alike and are not the same figure.
 */

export type RecordVariant = "personal" | "desk";

/** Per-bucket numeral colour on the personal record. The desk draws all four
 *  in `--c-ink` instead, because a bucket there already carries a dot. */
const PERSONAL_INK: Record<Resolution, string> = {
  supported: "var(--c-greenink)",
  challenged: "var(--c-redink)",
  noCleanRead: "var(--c-secondary)",
  notGraded: "var(--c-muted)",
};

/** The desk's leading dot, and the fill of its proportion bar.
 *
 * The design paints the bar with the ink member of each pair and the dot with
 * the base member. Both are fills, and the standing rule is that ink tokens
 * are text and base tokens are fills, never swapped, so both take the base
 * token here. The two neutral buckets have no ink/base pair and are drawn as
 * the design has them. */
const DESK_FILL: Record<Resolution, string> = {
  supported: "var(--c-green)",
  challenged: "var(--c-red)",
  noCleanRead: "var(--c-muted)",
  notGraded: "var(--c-secondary)",
};


function BucketLabel({ text, dot }: { text: string; dot?: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {dot ? (
        <span
          aria-hidden="true"
          style={{
            flex: "none",
            display: "inline-block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: dot,
          }}
        />
      ) : null}
      <span
        style={{
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {text}
      </span>
    </span>
  );
}

type RecordBucketsProps = {
  byResolution: Record<Resolution, number>;
} & (
  | {
      variant: "personal";
      /** Replaces the fourth cell, which on the personal record is never
       *  `notGraded` but the count of calls still inside their window. */
      awaiting: number;
      total?: never;
      /* No bars on the personal drawing, so no anchor to give one. */
      barBaseMs?: never;
    }
  | {
      /** The denominator is not optional here. Every desk cell states it, and
       *  the bars are drawn against it, so a desk call without one would
       *  render four zero-width bars and no denominator rather than fail. */
      variant: "desk";
      total: number;
      /**
       * The delay of the section rule that introduces this record, which is
       * where the four bar sweeps hang off.
       *
       * REQUIRED, and required on the desk variant only, because the bars are
       * the desk drawing and the personal one has none. It used to be absolute
       * and it cannot be: the entrance ladder's length is a property of which
       * sections the reader's data produced, so a bar pinned at 500ms sweeps
       * before its own heading on a short ladder and long after it on a full
       * one. See `entrance-ladder.ts`.
       */
      barBaseMs: number;
      awaiting?: never;
    }
);

export function RecordBuckets({
  variant,
  byResolution,
  awaiting = 0,
  total,
  barBaseMs = 0,
}: RecordBucketsProps) {
  const personal = variant === "personal";
  /* The union guarantees a denominator on the desk variant, but the destructure
     loses that narrowing, and a zero denominator would draw NaN-wide bars. */
  const denominator = total ?? 0;

  /* The personal record's fourth cell is the awaiting count, not a bucket.
     Everything else pairs one to one with RESOLUTION_ORDER. */
  const cells = RESOLUTION_ORDER.map((key, i) => {
    const fourthIsAwaiting = personal && key === "notGraded";
    return {
      key,
      label: (
        fourthIsAwaiting ? YOUR_RECORD_COPY.awaitingLabel : DESK_RECORD_COPY.bucketLabel[key]
      ).toUpperCase(),
      count: fourthIsAwaiting ? awaiting : byResolution[key],
      /* RESOLUTION_ORDER is the source of truth for how many cells there are,
         so the sub-ladder falls back to its last offset rather than emitting
         `undefinedms` if a fifth resolution is ever added. */
      delay: barBaseMs + (BAR_OFFSETS[i] ?? BAR_OFFSETS[BAR_OFFSETS.length - 1]),
    };
  });

  return (
    <div
      style={{
        marginTop: "12px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "14px 12px",
      }}
    >
      {cells.map((cell) => (
        <div key={cell.key}>
          <BucketLabel text={cell.label} dot={personal ? undefined : DESK_FILL[cell.key]} />
          <span
            style={{
              display: "block",
              marginTop: "5px",
              font: `600 ${personal ? 16 : 17}px/1 ${FONT_MONO}`,
              color: personal ? PERSONAL_INK[cell.key] : "var(--c-ink)",
            }}
          >
            {cell.count}
            {!personal ? (
              <span
                style={{
                  font: `400 10px/1 ${FONT_MONO}`,
                  color: "var(--c-muted)",
                  marginLeft: "4px",
                }}
              >
                of {denominator}
              </span>
            ) : null}
          </span>
          {!personal ? (
            <span
              aria-hidden="true"
              style={{
                display: "block",
                marginTop: "7px",
                height: "3px",
                borderRadius: "4px",
                backgroundColor: "var(--c-hair)",
              }}
            >
              {/* Share of the whole record, drawn rather than stated. No
                  figure is rendered from it: the count and its denominator
                  are already both on the cell, and a bar is the same two
                  numbers read at a glance. */}
              <span
                className={styles.bar}
                style={{
                  display: "block",
                  width: denominator > 0 ? `${(cell.count / denominator) * 100}%` : "0%",
                  height: "3px",
                  borderRadius: "4px",
                  backgroundColor: DESK_FILL[cell.key],
                  animationDelay: `${cell.delay}ms`,
                }}
              />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
