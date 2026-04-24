export type SentimentTone = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "WATCH";

interface SentimentPillProps {
  tone: SentimentTone;
  size?: "sm" | "md";
}

const toneStyles: Record<SentimentTone, { bg: string; fg: string; bd: string }> = {
  BULLISH: { bg: "var(--pill-bull-bg)", fg: "var(--pill-bull-text)", bd: "var(--pill-bull-border)" },
  BEARISH: { bg: "var(--pill-bear-bg)", fg: "var(--pill-bear-text)", bd: "var(--pill-bear-border)" },
  NEUTRAL: { bg: "var(--pill-neutral-bg)", fg: "var(--pill-neutral-text)", bd: "var(--pill-neutral-border)" },
  MIXED: { bg: "var(--pill-mixed-bg)", fg: "var(--pill-mixed-text)", bd: "var(--pill-mixed-border)" },
  WATCH: { bg: "var(--pill-watch-bg)", fg: "var(--pill-watch-text)", bd: "var(--pill-watch-border)" },
};

export function SentimentPill({ tone, size = "md" }: SentimentPillProps) {
  const s = toneStyles[tone];
  const font = size === "sm" ? 9 : 10;
  const pad = size === "sm" ? "3px 7px" : "4px 9px";
  const tr = size === "sm" ? "0.10em" : "0.12em";
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: font,
        fontWeight: 700,
        letterSpacing: tr,
        padding: pad,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
      }}
    >
      {tone}
    </span>
  );
}
