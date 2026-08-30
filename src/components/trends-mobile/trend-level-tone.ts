import type { AnomalyLevel } from "@/lib/trend-signals";

/**
 * The level's colour triple, plus the 2px top edge that carries the same state
 * on the card.
 *
 * State is a top edge and a dot and a word. Never a coloured left border, and
 * never a colour on its own: the word is always present, so the level is
 * readable without seeing the hue at all.
 *
 * Rewritten rather than ported. `src/components/trends/anomaly-badge.tsx` is
 * dead code with no consumer, and it draws in raw Tailwind palette classes
 * (`bg-red-100 text-red-700 border-red-300`), title-cases through CSS, and
 * pulses on critical with no reduced-motion gate and no counterpart in the
 * design. None of that survives. Only the level TYPE is reused, and it comes
 * through `@/lib/trend-signals`.
 *
 * FOUR LEVELS, FOUR TONES, ordered as a scale. Ruled by Noah: "Low gets its
 * own tone. Three levels sharing two tones means one is lying about which it
 * is."
 *
 * This is a SET OF FOUR, not an addition of one, and that was forced by the
 * tokens rather than chosen. The badge needs a base, a border, a fill and an
 * ink. Exactly three families carry all four in both themes: red, amber and
 * the neutral set. Gold has a base, a `-edge` and a `goldink` but NO
 * `--c-gold-well`; green has neither a `-edge` nor a `-well`. So the old scale
 * ran red, amber, neutral and had nothing left below neutral: the quiet
 * direction bottoms out at `--c-hair` against `--c-border`, and those two
 * tokens sit three units apart in light and seven in dark. Nobody sees that
 * at 390 on a phone, so "quieter than Medium" was not buildable.
 *
 * The scale therefore descends in HEAT and terminates at no hue:
 *
 *   critical  red      alarm
 *   high      amber    warning
 *   medium    gold     muted warm, the last hue
 *   low       neutral  no hue at all, the terminal step
 *
 * Low did not get a new colour. Low got the neutral terminal to itself, and
 * Medium moved up onto gold, which is the only way to seat four levels on
 * three complete families without inventing a token. THIS RE-TONES MEDIUM, so
 * it repaints the 302 Medium cards as well as the 34 Low ones. That is the
 * consequential half of the change and it is one table to revert.
 *
 * Gold is seated correctly, not swapped. `--c-gold` is a FILL and appears only
 * as the 2px edge and the dot; type takes `--c-goldink`, which is the standing
 * rule at tokens.css:354 ("Gold never touches type at --c-gold ... --c-goldink
 * exists for that and is the only gold on type"). Measured on the rendered
 * badge, `--c-goldink` on `--c-well` is 5.57:1 in light and 7.70:1 in dark,
 * both above Medium's previous 5.50:1, so the word did not get harder to read.
 *
 * Medium keeps the NEUTRAL fill rather than a gold one, because
 * `--c-gold-well` does not exist and inventing it is a design-system change
 * and the owner's call. Hue rides on the edge, border, ink and dot instead.
 * Consequence worth knowing: in dark `--c-amber-edge` and `--c-gold-edge`
 * resolve to the same value, so High and Medium share a badge BORDER there.
 * They still differ on the other four axes.
 *
 * Rejected: giving Low the gold and leaving Medium neutral. It reads as a
 * scale that goes hue, hue, no-hue, hue, and the 2px top edge is the loudest
 * element on the card, so a Low card would have carried a saturated gold band
 * where a Medium card carries a `--c-border` one nobody can see. That inverts
 * the severity order, which is a worse lie than the one this fixes.
 *
 * The prototype writes the Medium dot as a literal hex, which is the
 * light-theme value of `--c-muted`. Tokenised here, so it flips with the theme
 * instead of staying a light-theme value on a card that does not.
 */
export interface LevelTone {
  word: string;
  edge: string;
  border: string;
  fill: string;
  ink: string;
  dot: string;
}

export const LEVEL_TONES: Record<AnomalyLevel, LevelTone> = {
  critical: {
    word: "Critical",
    edge: "var(--c-red)",
    border: "var(--c-red-edge)",
    fill: "var(--c-red-well)",
    ink: "var(--c-redink)",
    dot: "var(--c-red)",
  },
  high: {
    word: "High",
    edge: "var(--c-amber)",
    border: "var(--c-amber-edge)",
    fill: "var(--c-amber-well)",
    ink: "var(--c-amberink)",
    dot: "var(--c-amber)",
  },
  /* The last hue. Gold as fill on the edge and the dot, `goldink` on the
     word, and the neutral well underneath because gold has no `-well`. */
  medium: {
    word: "Medium",
    edge: "var(--c-gold)",
    border: "var(--c-gold-edge)",
    fill: "var(--c-well)",
    ink: "var(--c-goldink)",
    dot: "var(--c-gold)",
  },
  /* The terminal step: no hue anywhere. This is the treatment Medium used to
     carry, now Low's alone, which is what makes the level readable off the
     card instead of only off the word. */
  low: {
    word: "Low",
    edge: "var(--c-border)",
    border: "var(--c-border)",
    fill: "var(--c-well)",
    ink: "var(--c-secondary)",
    dot: "var(--c-muted)",
  },
};
