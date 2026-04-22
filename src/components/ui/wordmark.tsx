"use client";

import { cn } from "@/lib/utils";

type WordmarkSize = "sm" | "md" | "lg";

interface WordmarkProps {
  size?: WordmarkSize;
  className?: string;
}

/**
 * Signalera brand wordmark.
 *
 * Renders "Signal" in the display serif at the current foreground color
 * and "era" in the same serif filled with a vertical gold gradient via
 * `background-clip: text`. In dark mode the "era" span gets a subtle
 * drop-shadow glow so the gold reads as richer than flat color.
 *
 * Gradient and glow use CSS custom properties from tokens.css, which
 * already redefine the gold system under `html.dark`, so the wordmark
 * adapts to theme automatically.
 */
export function Wordmark({ size = "md", className }: WordmarkProps) {
  const sizePx: Record<WordmarkSize, string> = {
    sm: "18px",
    md: "22px",
    lg: "26px",
  };

  return (
    <span
      className={cn(
        "font-display font-bold tracking-tight leading-none whitespace-nowrap inline-flex",
        className,
      )}
      style={{ fontSize: sizePx[size], lineHeight: 1 }}
    >
      <span className="text-foreground">Signal</span>
      <span
        className="dark:[filter:drop-shadow(0_0_12px_rgba(212,168,75,0.25))]"
        style={{
          backgroundImage:
            "linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent",
        }}
      >
        era
      </span>
    </span>
  );
}

export default Wordmark;
