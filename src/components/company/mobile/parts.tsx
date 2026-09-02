import type { CSSProperties, ReactNode } from "react";

import styles from "./company-mobile.module.css";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * The small shapes the five Company Intel sections share. Each one is measured
 * off the rendered prototype through scripts/parity_harness.py.
 *
 * These live beside the screen rather than under src/components/ledger/. The
 * anatomy there is the claim anatomy, which this screen consumes unchanged for
 * the one object that is a claim. Everything below is company furniture and
 * belongs to this screen.
 */

/** Italic Playfair section rule. "business overview", "key figures". */
export function SectionRule({ children, marginTop }: { children: string; marginTop: number }) {
  return (
    <div
      style={{
        marginTop: `${marginTop}px`,
        font: `400 italic 12.5px/1 ${FONT_DISPLAY}`,
        color: "var(--c-secondary)",
      }}
    >
      {children}
    </div>
  );
}

/** A ruled paragraph row. The design separates these with hairlines, not cards. */
export function RuledRow({
  first,
  last,
  children,
  style,
  marker,
}: {
  first?: boolean;
  last?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  /**
   * A `data-` attribute name to stamp on the row, empty-valued.
   *
   * A named prop rather than a `...rest` spread. A spread here would let any
   * caller push arbitrary DOM attributes, including a second `style`, through
   * a component whose whole job is that its rows cannot drift apart.
   */
  marker?: string;
}) {
  return (
    <div
      {...(marker ? { [marker]: "" } : {})}
      style={{
        marginTop: first ? "8px" : undefined,
        padding: "13px 0",
        borderTop: "1px solid var(--c-hair)",
        borderBottom: last ? "1px solid var(--c-hair)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type ChipShape = "square" | "pill";

/**
 * A section chip or a filter chip. A real button, 44px tall via min-height
 * rather than by growing the type, so the tap target is the drawn box.
 *
 * SHAPE. The design draws the section chips at 6px and the filing filters at
 * 99px, a full pill. 99 is not on the sanctioned radius scale, which is
 * 4/6/9/12/14, and both scripts/design-lint.mjs and scripts/screen-audit.mjs
 * reject it. The handoff README settles the conflict against its own prototype
 * at line 178: "Cards 12, wells and heroes 14, pills 4, buttons 9." So a pill
 * here is 4px. Recorded in the PR body as a deviation from the drawing.
 */
export function Chip({
  label,
  active,
  disabled,
  shape = "square",
  grow,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  shape?: ChipShape;
  /**
   * Take an equal share of the row's leftover width instead of sizing to the
   * label. OPT IN, and only the section row opts in.
   *
   * WHY IT EXISTS. Five section chips need 418.21px on one line and the widest
   * phone offers 390 of content, so the row wraps at every width and the
   * orphan MOVES: three-plus-two at 320 and 375, four-plus-one at 390 and 430.
   * A row whose shape depends on the handset is an artifact. The section row
   * now declares its own break and grows each chip to fill the line, so both
   * rows are flush and the shape is the same on every phone.
   *
   * The filing filter row does NOT opt in. Its chip count varies with the
   * filings on file, so growing them would restate a different width per
   * company for the same control.
   */
  grow?: boolean;
  onClick: () => void;
}) {
  const size = shape === "pill" ? "11.5px" : "12px";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={styles.bare}
      style={{
        /* `1 1 auto` and never `1`: the basis stays the label's own width, so
           the leftover is shared on top of content rather than replacing it,
           and a long label can never be compressed below itself. */
        flex: grow ? "1 1 auto" : "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: grow ? "center" : undefined,
        padding: "0 12px",
        borderRadius: shape === "pill" ? "4px" : "6px",
        whiteSpace: "nowrap",
        border: active ? "1px solid var(--c-ink)" : "1px solid var(--c-border)",
        font: active
          ? `600 ${size}/1 ${FONT_SANS}`
          : `500 ${size}/1 ${FONT_SANS}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Grows to fill the section box, and centres what is in it.
 *
 * A section whose whole body is one short block is the case this exists for. It
 * is NOT a spacer: the leading gap and the trailing gap come out equal, which
 * is the measurable signature of a centred short state and the thing that tells
 * a reader the section is finished rather than still loading. Measured on this
 * screen, the trailing gap then exceeds the leading gap by exactly the scroll
 * body's own bottom padding, 24px of design plus the 59px tab bar the shell
 * does not reserve for.
 *
 * Never used mid-section. A block that grows with content under it pushes that
 * content down instead of centring anything.
 */
export const SECTION_FILL = {
  flexGrow: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
} as const;

/**
 * The centred well the design uses when a section has nothing to draw.
 *
 * It states what is absent and nothing else. An empty state that asserts a fact
 * about the company is not a safe fallback, so every string passed here comes
 * from src/components/company/tabs/empty-state-copy.ts, the pure module the
 * desktop tabs already share, rather than being written again on this screen.
 *
 * `fill` is OPT IN, and it has to be. A well that IS the section's body should
 * take the height the section was given; a well sitting mid-section, like the
 * primer's key figures with recent developments under it, must not, because
 * growing there shoves the rest of the primer down the screen.
 */
export function EmptyWell({
  headline,
  note,
  fill,
}: {
  headline: string;
  note?: string | null;
  fill?: boolean;
}) {
  return (
    <div
      /* Named so the void harness can measure the gap above the copy against
         the gap below it. A centred short state is a claim, and this is what
         makes it a measurable one. */
      data-empty-well={fill ? "fill" : "inline"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: fill ? "center" : undefined,
        flexGrow: fill ? 1 : undefined,
        gap: "8px",
        padding: "34px 20px",
      }}
    >
      <div style={{ font: `600 13px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
        {headline}
      </div>
      {note ? (
        <p
          style={{
            margin: 0,
            maxWidth: "260px",
            textAlign: "center",
            font: `400 12px/1.5 ${FONT_SANS}`,
            color: "var(--c-secondary)",
          }}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The closing caveat every section that carries a caveat uses. */
export function SectionNote({ children, marginTop = 12 }: { children: ReactNode; marginTop?: number }) {
  return (
    <p
      style={{
        margin: `${marginTop}px 0 0`,
        font: `400 11px/1.55 ${FONT_SANS}`,
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/* THE SHIMMER BAR IS GONE WITH THE SKELETON IT BUILT. `/company/[id]` is a
   server component that awaits all four reads before it renders, so nothing is
   ever in flight when a reader arrives, and the only thing that raised the
   skeleton was the `?stage=loading` parameter this PR removed. Its `.sk` class
   stays in `company-mobile.module.css` and costs nothing; the day this screen
   grows a read of its own, that is where the bar comes back from. */
