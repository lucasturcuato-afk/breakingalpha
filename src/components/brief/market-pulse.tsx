"use client";

import { cn } from "@/lib/utils";

export interface MarketPulseData {
  sentiment_word: string;
  narrative: string;
  headlines?: Array<{ title: string; href?: string }>;
}

interface MarketPulseProps {
  pulse?: MarketPulseData | null;
  className?: string;
}

/**
 * Market Pulse — editorial hero that opens both Morning Brief and Evening Wrap.
 *
 * Treatment:
 *  - "MARKET PULSE" eyebrow in gold small-caps.
 *  - Pull-quote: "Today the market is <sentiment_word>" where the sentiment
 *    word is rendered in a serif display face with a gold vertical gradient
 *    clipped to the text — matching the Wordmark technique in
 *    `src/components/ui/wordmark.tsx`.
 *  - 2-3 paragraph editorial blurb; narrative is split on `\n\n`.
 *  - Optional inline "Headlines driving this:" row with up to 3 linked titles.
 *
 * Returns null when `pulse` is absent so callers can render unconditionally.
 * All colors resolve from CSS tokens; light + dark mode adapt automatically.
 */
export function MarketPulse({ pulse, className }: MarketPulseProps) {
  if (!pulse || !pulse.sentiment_word || !pulse.narrative) return null;

  const paragraphs = pulse.narrative
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const headlines = (pulse.headlines ?? []).slice(0, 3);

  return (
    <section
      className={cn("mb-8 pb-6", className)}
      style={{
        borderBottom: "1px solid var(--gold-border)",
      }}
      aria-label="Market pulse"
    >
      {/* Eyebrow */}
      <p
        className="font-sans mb-3"
        style={{
          color: "var(--gold)",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Market Pulse
      </p>

      {/* Pull-quote */}
      <h2
        className="font-[family-name:var(--font-playfair-display)] leading-tight mb-5"
        style={{
          fontSize: "clamp(28px, 4vw, 40px)",
          fontWeight: 700,
          color: "var(--foreground)",
          letterSpacing: "-0.01em",
        }}
      >
        <span style={{ color: "var(--foreground)", opacity: 0.92 }}>
          Today the market is{" "}
        </span>
        <span
          className="italic dark:[filter:drop-shadow(0_0_14px_rgba(212,168,75,0.28))]"
          style={{
            backgroundImage:
              "linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }}
        >
          {pulse.sentiment_word}
        </span>
        <span style={{ color: "var(--foreground)", opacity: 0.92 }}>.</span>
      </h2>

      {/* Narrative */}
      <div className="space-y-3.5">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="font-[family-name:var(--font-playfair-display)]"
            style={{
              fontSize: "17px",
              lineHeight: 1.7,
              color: "var(--text-primary)",
              opacity: 0.92,
            }}
          >
            {para}
          </p>
        ))}
      </div>

      {/* Headlines */}
      {headlines.length > 0 && (
        <p
          className="font-sans mt-5"
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <span
            style={{
              color: "var(--gold)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: "10px",
              marginRight: "0.5rem",
            }}
          >
            Headlines driving this:
          </span>
          {headlines.map((h, i) => {
            const sep = i < headlines.length - 1 ? ", " : "";
            const label = h.title;
            if (h.href) {
              return (
                <span key={i}>
                  <a
                    href={h.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 transition-colors"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {label}
                  </a>
                  {sep}
                </span>
              );
            }
            return (
              <span key={i} style={{ color: "var(--text-primary)" }}>
                {label}
                {sep}
              </span>
            );
          })}
        </p>
      )}
    </section>
  );
}

export default MarketPulse;
