/**
 * The design's chevron, in the three forms it actually draws.
 *
 * Every one is a 24-unit viewBox with round caps, rendered at 14px beside body
 * copy, 15px on a tail action and 16px on a back control. Three paths, right,
 * down and left. The Ledger draws no left chevron; the screens opened out of it
 * draw one on the control that goes back to it, so the direction is data in the
 * table below rather than a second component.
 *
 * Weight is data for the same reason. The design strokes all 29 of its right
 * and down chevrons at 2 and all 21 of its left ones at 1.8, without exception,
 * so the width sits beside the path instead of being a constant the back
 * control quietly breaks.
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

const PATH: Record<ChevronDirection, { d: string; width: number }> = {
  right: { d: "M9 6l6 6-6 6", width: 2 },
  down: { d: "M6 9l6 6 6-6", width: 2 },
  left: { d: "M15 6l-6 6 6 6", width: 1.8 },
};

export function Chevron({
  direction,
  size = 14,
  stroke = "var(--c-muted)",
  style,
}: {
  direction: ChevronDirection;
  size?: 14 | 15 | 16;
  /** `--c-gold` on the continuity lead row, `--c-muted` everywhere else. */
  stroke?: string;
  style?: React.CSSProperties;
}) {
  const p = PATH[direction];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={p.width}
      strokeLinecap="round"
      aria-hidden="true"
      style={{ flex: "none", ...style }}
    >
      <path d={p.d} />
    </svg>
  );
}
