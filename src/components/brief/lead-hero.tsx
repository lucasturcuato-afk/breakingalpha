"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunStatus = "success" | "stub" | "error" | null;

export interface LeadHeroProps {
  type: "morning" | "evening";
  headline?: string;
  summary?: string;
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
 * Split a summary into a lead pull-quote + body paragraphs.
 *
 * Rules, in order:
 *   1. If the summary contains double newlines, treat the first block as the
 *      pull-quote and the rest as body paragraphs.
 *   2. If there's at least one sentence boundary, the first sentence is the
 *      pull-quote and remaining sentences concatenate into a single body
 *      paragraph.
 *   3. Otherwise the entire summary is the pull-quote with no body.
 *
 * Sentence boundary detection is intentionally simple (ASCII `. ! ?` followed
 * by whitespace). It handles common cases from the Gemini synthesis output
 * which writes 3-4 short sentences. Abbreviations like "U.S." or "vs." may
 * split awkwardly — acceptable rough edge for v1.
 */
function splitSummary(summary: string): { lead: string; body: string[] } {
  const trimmed = summary.trim();
  if (!trimmed) return { lead: "", body: [] };

  if (trimmed.includes("\n\n")) {
    const parts = trimmed
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const [lead, ...body] = parts;
    return { lead: lead ?? "", body };
  }

  // Split on sentence boundaries.
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
  if (!sentences || sentences.length < 2) {
    return { lead: trimmed, body: [] };
  }
  const lead = sentences[0].trim();
  const rest = sentences.slice(1).join(" ").trim();
  return { lead, body: rest ? [rest] : [] };
}

/**
 * LeadHero — editorial replacement for BriefHeader on Morning Brief + Evening Wrap.
 *
 * Treatment (Stratechery-style editorial rhythm):
 *  - "TODAY'S LEAD" / "EVENING WRAP" eyebrow in gold small-caps.
 *  - Serif display headline (28-32px, weight 700).
 *  - Pull-quote: first sentence of summary, serif italic ~22px, 3px gold left border.
 *  - Body: remaining summary as single paragraph with generous line-height.
 *  - Subtle inline `marketTone` badge (max ~80px).
 *  - Meta row: mono timestamp · story count · isStale warning · action buttons.
 *
 * All colors resolve from CSS tokens so light + dark adapt.
 */
export function LeadHero({
  type,
  headline,
  summary = "",
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
  const { lead, body } = splitSummary(summary);

  const resolvedHeadline =
    headline ||
    (isMorning ? "Morning Market Brief" : "Evening Market Wrap");

  return (
    <div className={cn("mb-6", className)}>
      {/* Eyebrow */}
      <p
        className="font-sans mb-2"
        style={{
          color: "var(--gold)",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
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
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--gold)",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "var(--gold-muted)",
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

      {/* Pull-quote (first sentence) */}
      {lead && (
        <blockquote
          className="font-[family-name:var(--font-playfair-display)] italic mb-4"
          style={{
            fontSize: "clamp(19px, 2vw, 22px)",
            lineHeight: 1.55,
            color: "var(--foreground)",
            borderLeft: "3px solid var(--gold)",
            paddingLeft: "1rem",
            letterSpacing: "-0.005em",
          }}
        >
          {lead}
        </blockquote>
      )}

      {/* Body paragraphs */}
      {body.length > 0 && (
        <div className="space-y-3">
          {body.map((para, i) => (
            <p
              key={i}
              className="font-[family-name:var(--font-playfair-display)]"
              style={{
                fontSize: "18px",
                lineHeight: 1.7,
                color: "var(--text-primary)",
                opacity: 0.9,
              }}
            >
              {para}
            </p>
          ))}
        </div>
      )}

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
