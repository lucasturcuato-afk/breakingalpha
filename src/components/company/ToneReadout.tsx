/**
 * Shared tone readout: LEVEL (anchor) + DIRECTION (week-over-week, suppressible)
 * + EVIDENCE (always rendered alongside a level). Rendered by both the Signal
 * Trend rail card and the Price & Tone tab so the two agree by construction; both
 * read the single ToneSummary from getCompanyDetail. No bare -1..+1 scalar is ever
 * shown -- the score drives the level label only.
 */

import type { CSSProperties } from "react";
import {
  formatDirection,
  formatEvidence,
  levelPolarity,
  type ToneDirection,
  type TonePolarity,
  type ToneSummary,
} from "@/lib/tone";

const MONO = "var(--font-mono), ui-monospace, monospace";
const SERIF = "var(--font-display), serif";
const SANS = "var(--font-sans), sans-serif";

const POLARITY_COLOR: Record<TonePolarity, string> = {
  positive: "var(--signal-up)",
  mixed: "var(--espresso)",
  negative: "var(--signal-dn)",
};

const DIRECTION_GLYPH: Record<ToneDirection, string> = {
  improving: "▲",
  deteriorating: "▼",
  steady: "→",
};

const DIRECTION_COLOR: Record<ToneDirection, string> = {
  improving: "var(--signal-up)",
  deteriorating: "var(--signal-dn)",
  steady: "var(--text-faint)",
};

type ToneReadoutScale = "rail" | "panel";

const SCALE: Record<ToneReadoutScale, { level: number; meta: number; evidence: number }> = {
  rail: { level: 16, meta: 11, evidence: 10 },
  panel: { level: 20, meta: 12, evidence: 11 },
};

interface ToneReadoutProps {
  tone: ToneSummary;
  scale?: ToneReadoutScale;
}

export function ToneReadout({ tone, scale = "panel" }: ToneReadoutProps) {
  const z = SCALE[scale];

  // Insufficient coverage: no level (and therefore no count requirement), but
  // still disclose how thin the window is rather than implying silence.
  if (!tone.sufficient || !tone.level) {
    const seen = tone.evidence.total;
    return (
      <div data-testid="tone-readout" data-sufficient="false">
        <div style={{ fontFamily: SERIF, fontSize: z.level, fontWeight: 700, color: "var(--text-faint)" }}>
          Not enough recent coverage
        </div>
        <div style={{ fontFamily: MONO, fontSize: z.evidence, color: "var(--text-faint)", marginTop: 3 }}>
          {seen === 0 ? "No articles in the last 7 days" : `Based on ${seen} ${seen === 1 ? "article" : "articles"} so far`}
        </div>
      </div>
    );
  }

  const levelColor = POLARITY_COLOR[levelPolarity(tone.level)];
  const directionText = formatDirection(tone);

  const levelStyle: CSSProperties = {
    fontFamily: SERIF,
    fontSize: z.level,
    fontWeight: 700,
    color: levelColor,
    letterSpacing: "-0.01em",
  };

  return (
    <div data-testid="tone-readout" data-sufficient="true" data-level={tone.level}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span data-testid="tone-level" style={levelStyle}>{tone.levelLabel}</span>
        {tone.direction && directionText ? (
          <span
            data-testid="tone-direction"
            style={{
              fontFamily: MONO,
              fontSize: z.meta,
              fontWeight: 600,
              color: DIRECTION_COLOR[tone.direction],
            }}
          >
            {DIRECTION_GLYPH[tone.direction]} {directionText}
          </span>
        ) : null}
      </div>
      <div
        data-testid="tone-evidence"
        style={{ fontFamily: SANS, fontSize: z.evidence, color: "var(--text-faint)", marginTop: 4 }}
      >
        {formatEvidence(tone.evidence)}
      </div>
    </div>
  );
}
