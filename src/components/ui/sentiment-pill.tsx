export type SentimentTone = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "WATCH";

/**
 * Single source of truth for mapping any raw sentiment string (DB values,
 * "risk-on/off", "positive/negative", etc.) to a SentimentTone. Every surface
 * that renders sentiment should route through this + <SentimentPill/> so the
 * label treatment (title-case, one voice) can never drift per-surface again.
 */
export function sentimentToTone(raw: string | null | undefined): SentimentTone {
  const l = (raw ?? "").toLowerCase();
  if (l.includes("bull") || l === "positive" || l.includes("risk-on")) return "BULLISH";
  if (l.includes("bear") || l === "negative" || l.includes("risk-off")) return "BEARISH";
  if (l.includes("mix")) return "MIXED";
  if (l.includes("watch")) return "WATCH";
  return "NEUTRAL";
}

export type SentimentPillSize = "xs" | "sm" | "md" | "lg";

interface SentimentPillProps {
  tone: SentimentTone;
  /** Override the displayed text while keeping `tone` for color (e.g. a tone
   *  LEVEL label like "Strongly Positive"). Defaults to the tone name. */
  label?: string;
  size?: SentimentPillSize;
  className?: string;
  testId?: string;
}

const toneStyles: Record<SentimentTone, { bg: string; fg: string; bd: string }> = {
  BULLISH: { bg: "var(--pill-bull-bg)", fg: "var(--pill-bull-text)", bd: "var(--pill-bull-border)" },
  BEARISH: { bg: "var(--pill-bear-bg)", fg: "var(--pill-bear-text)", bd: "var(--pill-bear-border)" },
  NEUTRAL: { bg: "var(--pill-neutral-bg)", fg: "var(--pill-neutral-text)", bd: "var(--pill-neutral-border)" },
  MIXED: { bg: "var(--pill-mixed-bg)", fg: "var(--pill-mixed-text)", bd: "var(--pill-mixed-border)" },
  WATCH: { bg: "var(--pill-watch-bg)", fg: "var(--pill-watch-text)", bd: "var(--pill-watch-border)" },
};

const sizeStyles: Record<SentimentPillSize, { font: number; pad: string; tr: string }> = {
  xs: { font: 8.5, pad: "2px 5px", tr: "0.10em" },
  sm: { font: 9, pad: "3px 7px", tr: "0.10em" },
  md: { font: 10, pad: "4px 9px", tr: "0.12em" },
  lg: { font: 11, pad: "5px 11px", tr: "0.14em" },
};

export function SentimentPill({ tone, label, size = "md", className, testId }: SentimentPillProps) {
  const s = toneStyles[tone];
  const z = sizeStyles[size];
  return (
    <span
      className={className}
      data-testid={testId ?? "sentiment-pill"}
      data-size={size}
      data-tone={tone}
      style={{
        display: "inline-block",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: z.font,
        fontWeight: 600,
        letterSpacing: "normal",
        padding: z.pad,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {label ?? tone.charAt(0) + tone.slice(1).toLowerCase()}
    </span>
  );
}
