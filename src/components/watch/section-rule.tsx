import type { CSSProperties } from "react";
import { FONT_DISPLAY, FONT_MONO } from "@/components/mobile/fonts";

/**
 * The section rule. The layout spine of the Watch screen and of the two thesis
 * screens beside it: a lowercase italic serif label, a 1px hairline that eats
 * the remaining width, and an optional right-aligned mono count.
 *
 * Extracted rather than forked off either desktop heading. The nearest repo
 * analogues are `radar/track-record/page.tsx`'s `Section` (an 11px semibold
 * uppercase sans label with no rule and no count) and `radar/following`'s group
 * heading (uppercase 12px sans with the border UNDER the label). This is
 * neither: the rule sits inline beside the label, not beneath it.
 *
 * Every value is measured off the rendered prototype, which draws this shape
 * nine times across the three screens and draws it identically each time.
 *
 * The count is a string because both shapes it takes are strings: a bare
 * integer, and a two-part split with a middot. Both are derived from counts by
 * the caller and never typed, so the figure and the list it describes cannot
 * drift apart.
 */
export interface SectionRuleProps {
  label: string;
  /** Right slot. Absent on the tracker's sections, present on every Watch tier. */
  count?: string;
  /** 0 for the first rule in a scroll region, 26px between sections. */
  marginTop?: CSSProperties["marginTop"];
}

export function SectionRule({ label, count, marginTop = 0 }: SectionRuleProps) {
  return (
    <div style={{ marginTop, display: "flex", alignItems: "center", gap: "11px" }}>
      <span
        style={{
          font: `400 italic 12.5px/1 ${FONT_DISPLAY}`,
          color: "var(--c-secondary)",
        }}
      >
        {label}
      </span>
      {/* The hairline is the element that makes this a rule rather than a
          heading. It carries no text, so it is hidden from assistive tech
          rather than announced as an empty region. */}
      <span
        aria-hidden="true"
        style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }}
      />
      {count ? (
        <span
          style={{
            font: `400 10.5px/1 ${FONT_MONO}`,
            letterSpacing: "0.045em",
            color: "var(--c-muted)",
          }}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}
