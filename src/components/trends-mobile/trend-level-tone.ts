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
 * `low` is not drawn anywhere in the prototype: the design has no Low card and
 * no Low chip, while `strengthToLevel` still produces one for any cluster
 * under 0.4. It takes the same neutral treatment the design gives Medium,
 * which is the only neutral treatment drawn.
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
