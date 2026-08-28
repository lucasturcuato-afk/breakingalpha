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
}: {
  first?: boolean;
  last?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
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
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  shape?: ChipShape;
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
        flex: "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
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
 * The centred well the design uses when a section has nothing to draw.
 *
 * It states what is absent and nothing else. An empty state that asserts a fact
 * about the company is not a safe fallback, so every string passed here comes
 * from src/components/company/tabs/empty-state-copy.ts, the pure module the
 * desktop tabs already share, rather than being written again on this screen.
 */
export function EmptyWell({ headline, note }: { headline: string; note?: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
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

/** A shimmer bar. Width is the only thing that varies between them. */
export function SkeletonBar({
  width,
  height = 13,
  marginTop = 0,
}: {
  width: string;
  height?: number;
  marginTop?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={styles.sk}
      style={{ width, height: `${height}px`, marginTop: `${marginTop}px` }}
    />
  );
}
