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
 * `low` SHARES MEDIUM'S TONE, and that is now a live question rather than a
 * settled one.
 *
 * The original reason no longer holds. This block used to read "the design has
 * no Low card and no Low chip", and that absence was the whole justification
 * for giving `low` the only neutral treatment the prototype draws. Low now
 * ships a chip: it sits directly beside Medium in the row, because
 * `strengthToLevel` has always produced it for any cluster under 0.4 and the
 * chip row was denying a level the card was printing.
 *
 * So the two lenses draw indistinguishable cards. Every value below is
 * byte-identical to `medium` except `word`, which means tapping Medium and
 * tapping Low changes which clusters are listed and changes nothing else on
 * any card. The badge word is the only signal, and by the rule at the top of
 * this file the word is the part that has to carry the level, so this is
 * legible rather than broken. It is still thinner than the other three tiers.
 *
 * DELIBERATELY LEFT SHARED, pending Noah. Whether Low earns its own edge, fill
 * and dot is a design call about the severity scale, not a builder's judgement
 * to make while adding a chip, and this table should not grow a colour on the
 * way past. Give it a tone here when that is answered.
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
  medium: {
    word: "Medium",
    edge: "var(--c-border)",
    border: "var(--c-border)",
    fill: "var(--c-well)",
    ink: "var(--c-secondary)",
    dot: "var(--c-muted)",
  },
  low: {
    word: "Low",
    edge: "var(--c-border)",
    border: "var(--c-border)",
    fill: "var(--c-well)",
    ink: "var(--c-secondary)",
    dot: "var(--c-muted)",
  },
};
