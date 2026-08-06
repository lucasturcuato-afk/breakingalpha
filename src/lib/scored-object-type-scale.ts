/**
 * scored-object-type-scale.ts - which type token each part of the resolved
 * verdict zone uses.
 *
 * WHY THIS IS A MODULE AND NOT INLINE STYLES. The card had its hierarchy
 * inverted: the verdict word rendered at 31px in the state color while the
 * attribution line, the actual evidence, sat at 14px italic in text-faint,
 * reading as a footnote. "MSFT +3.27% vs XLK -1.19%, SPY +0.32%" is the whole
 * differentiator of this product. It is the sentence that shows the grade was
 * earned against benchmarks rather than asserted, and it was the quietest thing
 * on the card.
 *
 * Naming the choice here rather than burying it in JSX means the relationship
 * is testable: a test can read the token values out of styles/tokens.css and
 * assert that the evidence outranks the label, so the inversion cannot silently
 * come back. ScoredObject.tsx itself cannot load under `node --test`.
 *
 * Existing tokens only. No new sizes, no new colors.
 */

export interface ZoneType {
  /** CSS custom property holding the font size. */
  sizeVar: string;
  /** CSS custom property holding the font weight. */
  weightVar: string;
}

/**
 * The resolved zone, in reading order and in order of prominence.
 *
 * verdict      a quiet label. It says which bucket, and that is all it needs to
 *              do. State color still carries it at a glance.
 * attribution  the evidence, and now the largest element in the zone. Roman,
 *              not italic: italic is the register of an aside.
 * calibration  the grader's prose. Supporting, below the evidence it explains.
 */
export const RESOLVED_ZONE_TYPE = {
  verdict: {
    sizeVar: "--type-eyebrow-size",
    weightVar: "--type-eyebrow-weight",
  },
  attribution: {
    sizeVar: "--type-claim-size",
    weightVar: "--type-receipt-weight",
  },
  calibration: {
    sizeVar: "--type-receipt-size",
    weightVar: "--type-receipt-weight",
  },
} as const satisfies Record<string, ZoneType>;

/** `var(--x)`, so the component never spells a token name twice. */
export function typeVar(name: string): string {
  return `var(${name})`;
}
