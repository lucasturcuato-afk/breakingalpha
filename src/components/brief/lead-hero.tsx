"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunStatus = "success" | "stub" | "error" | null;

export interface LeadHeroProps {
  type: "morning" | "evening";
  headline?: string;
  summary?: string;
  /**
   * Structured body fields from the new synthesis schema. When all three are
   * populated they replace `summary` for rendering. If any are missing the
   * component falls back to `summary` rendered as one or more paragraphs
   * split on double newlines.
   */
  leadParagraph?: string;
  supportingContext?: string;
  whatToWatch?: string;
  marketTone?: string;
  storyCount?: number;
  generatedAt?: string;
  isStale?: boolean;
  lastRunStatus?: RunStatus;
  onGenerateMemo?: () => void;
  onAddThesis?: () => void;
  className?: string;
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${time} · ${date}`;
}

/**
 * LeadHero — editorial replacement for BriefHeader on Morning Brief + Evening Wrap.
 *
 * Layout (clean, no pull-quote treatment):
 *  - "TODAY'S LEAD" / "EVENING WRAP" eyebrow in gold small-caps.
 *  - Serif display headline (28-32px, weight 700).
 *  - Body (preferred path): structured three-part layout
 *      lead_paragraph  (serif ~17-18px, tight leading)
 *      supporting_context (sans ~15px, generous leading)
 *      what_to_watch  (sans ~14px, subtle gold left accent bar)
 *  - Body (fallback path): `summary` split on double newlines and rendered
 *    as a stack of plain paragraphs.
 *  - Subtle inline `marketTone` badge (max ~80px).
 *  - Meta row: mono timestamp · story count · isStale warning · action buttons.
 *
 * All colors resolve from CSS tokens so light + dark adapt.
 */
export function LeadHero({
  type,
  headline,
  summary = "",
  leadParagraph,
  supportingContext,
  whatToWatch,
  marketTone,
  storyCount,
  generatedAt,
  isStale,
  lastRunStatus,
  onGenerateMemo,
  onAddThesis,
  className,
}: LeadHeroProps) {
  const isMorning = type === "morning";
  const eyebrow = isMorning ? "Today's Lead" : "Evening Wrap";

  const lead = (leadParagraph || "").trim();
  const context = (supportingContext || "").trim();
  const watch = (whatToWatch || "").trim();
  const hasStructured = Boolean(lead && context && watch);

  // Fallback rendering: prefer explicit paragraph breaks; if the summary is a
  // single block (older briefs pre-structured-body synthesis), split at
  // sentence boundaries into ~3 roughly-balanced chunks so the wall of text
  // gets visual pacing. Only kicks in when structured fields aren't present.
  const fallbackParagraphs = (() => {
    const trimmed = summary.trim();
    if (!trimmed) return [] as string[];
    const byBreaks = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (byBreaks.length > 1) return byBreaks;
    // Single-block summary under 240 chars: render as-is (one paragraph).
    if (trimmed.length < 240) return byBreaks;
    // Sentence-split heuristic — sentences ending in . ! ? followed by whitespace.
    const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [trimmed];
    if (sentences.length <= 2) return byBreaks;
    const chunkSize = Math.ceil(sentences.length / 3);
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += chunkSize) {
      chunks.push(sentences.slice(i, i + chunkSize).join("").trim());
    }
    return chunks.filter(Boolean);
  })();

  const resolvedHeadline =
    headline ||
    (isMorning ? "Morning Market Brief" : "Evening Market Wrap");

  return (
    <div className={cn("mb-6", className)}>
      {/* Eyebrow */}
      <p
        className="font-sans mb-2"
        style={{
          color: "var(--text-muted)",
          fontSize: "10px",
          fontWeight: 700,
        }}
      >
        {eyebrow}
      </p>

      {/* Headline */}
      <h1
        className="font-[family-name:var(--font-playfair-display)] leading-tight mb-4"
        style={{
          fontSize: "clamp(26px, 3.2vw, 32px)",
          fontWeight: 700,
          color: "var(--foreground)",
          letterSpacing: "-0.015em",
        }}
      >
        {resolvedHeadline}
      </h1>

      {/* Sentiment inline badge — subtle, not a pill */}
      {marketTone && (
        <div className="mb-4">
          <span
            className="inline-flex items-center font-sans"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "var(--parchment-mid)",
              border: "1px solid var(--gold-border)",
              maxWidth: "80px",
            }}
          >
            {marketTone}
          </span>
        </div>
      )}

      {/* Run-status banner (error / stub / stale) — matches existing brief-header semantics */}
      {lastRunStatus === "stub" || lastRunStatus === "error" ? (
        <div
          className="mb-4 px-3 py-2 rounded-lg font-sans text-[11px]"
          style={{
            borderLeft: "2px solid var(--gold)",
            background: "var(--gold-muted)",
            color: "var(--text-primary)",
          }}
        >
          {lastRunStatus === "stub"
            ? "Last run failed — synthesis error during generation. Showing previous brief."
            : "Last run failed — pipeline did not complete. Showing previous brief."}
        </div>
      ) : lastRunStatus == null && isStale ? (
        <div
          className="mb-4 px-3 py-2 rounded-lg font-sans text-[11px]"
          style={{
            borderLeft: "2px solid var(--gold)",
            background: "var(--gold-muted)",
            color: "var(--text-primary)",
          }}
        >
          Brief may be from a prior session — today&apos;s pipeline run may still be in progress.
        </div>
      ) : null}

      {/* Body — structured three-part layout when all fields present. */}
      {hasStructured ? (
        <div className="flex flex-col" style={{ gap: "22px" }}>
          {/* Lead paragraph — serif, slightly larger body */}
          <p
            className="font-[family-name:var(--font-playfair-display)]"
            style={{
              fontSize: "clamp(16.5px, 1.6vw, 18px)",
              lineHeight: 1.65,
              color: "var(--foreground)",
              letterSpacing: "-0.005em",
            }}
          >
            {lead}
          </p>

          {/* Supporting context — sans, generous leading */}
          <p
            className="font-sans"
            style={{
              fontSize: "15px",
              lineHeight: 1.75,
              color: "var(--text-primary)",
              opacity: 0.9,
            }}
          >
            {context}
          </p>

          {/* What to watch — subtle gold left accent bar, smaller forward-looking note */}
          <p
            className="font-sans"
            style={{
              fontSize: "14px",
              lineHeight: 1.7,
              color: "var(--text-secondary)",
              borderLeft: "2px solid var(--gold)",
              paddingLeft: "12px",
            }}
          >
            {watch}
          </p>
        </div>
      ) : fallbackParagraphs.length > 0 ? (
        <div className="flex flex-col" style={{ gap: "20px" }}>
          {fallbackParagraphs.map((para, i) => (
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
      ) : null}

      {/* Meta row */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--gold-border)" }}>
        {generatedAt && (
          <span
            className="font-data"
            style={{
              fontSize: "10.5px",
              color: "var(--text-muted)",
              letterSpacing: "0.02em",
            }}
          >
            {lastRunStatus === "success" && !isStale ? "Published " : "Generated "}
            {formatGeneratedAt(generatedAt)}
          </span>
        )}
        {typeof storyCount === "number" && storyCount > 0 && (
          <span
            className="font-sans"
            style={{ fontSize: "11px", color: "var(--text-secondary)" }}
          >
            {storyCount} {storyCount === 1 ? "story" : "stories"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {onGenerateMemo && (
            <Button variant="secondary" size="md" onClick={onGenerateMemo}>
              Generate Memo
            </Button>
          )}
          {onAddThesis && (
            <Button variant="secondary" size="md" onClick={onAddThesis}>
              Add Thesis
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default LeadHero;
