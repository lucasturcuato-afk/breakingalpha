/**
 * The design's chevron, in the three forms it actually draws.
 *
 * Every one is a 24-unit viewBox at stroke-width 2 with round caps, rendered at
 * 14px beside body copy and 15px on a tail action.
 *
 * The Ledger draws two, right and down. `left` was added by the Prepared record
 * unit, which is the first screen the design gives a back control to: its
 * masthead opens with a 16px left arrow and the word "Ledger". That is a
 * direction this component did not have, not a second anatomy, so it lands here
 * rather than as a private arrow on one screen. The design strokes the back
 * arrow at 1.8 where every other chevron is 2; kept at 2, since one component
 * drawing one weight is worth more than 0.2 of a pixel.
 *
 * The design strokes most of these with a colour literal whose value is exactly
 * `--c-muted` in both themes. Built with the token, per the same ruling that
 * covers the claim card's chevron: a literal where the token exists is a defect
 * in the design rather than a value to reproduce.
 *
 * Always aria-hidden. A chevron beside a control is decoration on that control,
 * and a chevron beside a clamped paragraph says "there is more" to a sighted
 * reader while the clamp itself says nothing to anyone. Neither is a label, and
 * announcing "chevron" twice per card is worse than announcing nothing.
 */

export type ChevronDirection = "right" | "down" | "left";

const PATH: Record<ChevronDirection, string> = {
  right: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  left: "M15 6l-6 6 6 6",
};

export function Chevron({
  direction,
  size = 14,
  stroke = "var(--c-muted)",
  style,
}: {
  direction: ChevronDirection;
  /** 14 beside body copy, 15 on a tail action, 16 on a back control. */
  size?: 14 | 15 | 16;
  /** `--c-gold` on the continuity lead row, `--c-muted` everywhere else. */
  stroke?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ flex: "none", ...style }}
    >
      <path d={PATH[direction]} />
    </svg>
  );
}
