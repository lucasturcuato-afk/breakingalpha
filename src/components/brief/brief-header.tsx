import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";

type RunStatus = "success" | "stub" | "error" | null;

interface BriefHeaderProps {
  type: "morning" | "evening";
  headline?: string;
  summary?: string;
  marketTone?: string;
  storyCount?: number;
  onGenerateMemo?: () => void;
  onAddThesis?: () => void;
  sourceUrl?: string;
  generatedAt?: string;   // ISO string from briefing.created_at
  isStale?: boolean;      // true when briefing is >20h old (likely prior day)
  lastRunStatus?: RunStatus; // last pipeline_runs.status for this brief type
}

const toneToVariant: Record<string, BadgeVariant> = {
  "RISK-ON": "risk-on",
  "RISK-OFF": "risk-off",
  MIXED: "neutral",
  NEUTRAL: "muted",
};

function formatFullDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${time} · ${date}`;
}

export function BriefHeader({
  type,
  headline = "Markets Navigate Mixed Signals as Policy Uncertainty Rises",
  summary = "Equity markets opened lower as investors weighed new trade restrictions against improving labor data. The S&P 500 tested support at 4,400 before recovering on tech strength.",
  marketTone = "MIXED",
  storyCount = 8,
  onGenerateMemo,
  onAddThesis,
  sourceUrl,
  generatedAt,
  isStale,
  lastRunStatus,
}: BriefHeaderProps) {
  const isMorning = type === "morning";

  return (
    <div className="mb-6">
      {/* Eyebrow */}
      <p
        className="font-sans mb-1"
        style={{ color: 'var(--gold)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
      >
        {isMorning ? "Morning Review" : "Evening Wrap"}
      </p>

      {/* Date title */}
      <h1
        className="font-display text-3xl md:text-[32px] font-bold leading-tight"
        style={{ color: 'var(--espresso)' }}
      >
        {formatFullDate()}
      </h1>

      {/* Subtitle */}
      <p
        className="font-sans text-sm mt-1"
        style={{ color: 'var(--espresso)', opacity: 0.65 }}
      >
        {storyCount} stories worth your attention
        {generatedAt && (
          <span
            className="ml-3"
            style={{ fontSize: '11px', opacity: 0.55 }}
          >
            {lastRunStatus === "success" && !isStale ? "✅ " : ""}
            Generated {formatGeneratedAt(generatedAt)}
          </span>
        )}
      </p>

      {/* Run-status indicator — driven by pipeline_runs.status when available,
          falls back to isStale boolean when pipeline_runs data is missing */}
      {(lastRunStatus === "stub" || lastRunStatus === "error") ? (
        <div
          className="mt-3 px-3 py-2 rounded-lg border font-sans text-[11px]"
          style={{
            borderColor: 'var(--gold)',
            background: 'var(--gold-muted)',
            color: 'var(--espresso)',
            opacity: 0.85,
          }}
        >
          {lastRunStatus === "stub"
            ? "⚠ Last run failed — synthesis error during generation. Showing previous brief."
            : "⚠ Last run failed — pipeline did not complete. Showing previous brief."}
        </div>
      ) : lastRunStatus == null && isStale ? (
        <div
          className="mt-3 px-3 py-2 rounded-lg border font-sans text-[11px]"
          style={{
            borderColor: 'var(--gold)',
            background: 'var(--gold-muted)',
            color: 'var(--espresso)',
            opacity: 0.85,
          }}
        >
          ⚠ Brief may be from a prior session — today&apos;s pipeline run may still be in progress.
        </div>
      ) : null}

      {/* Lead card */}
      <div
        className="relative rounded-2xl border border-border-base p-5 md:p-6 group cursor-pointer overflow-visible mt-5"
        style={{ background: 'var(--parchment-mid)', borderLeft: '4px solid var(--gold)' }}
      >
        <p
          className="font-sans mb-3"
          style={{ color: 'var(--gold)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          Today&apos;s Lead
        </p>
        <div className="flex items-center gap-2 mb-3">
          {marketTone && (
            <Badge variant={toneToVariant[marketTone] ?? "muted"}>
              {marketTone}
            </Badge>
          )}
        </div>
        <h2
          className="font-[family-name:var(--font-playfair-display)] text-xl md:text-2xl font-bold leading-snug mb-3 mt-2"
          style={{ color: 'var(--espresso)' }}
        >
          {headline}
        </h2>
        <p
          className="font-sans text-[13px] leading-relaxed"
          style={{ color: 'var(--espresso)', opacity: 0.75 }}
        >
          {summary}
        </p>

        {/* Hover overlay with actions */}
        {(onGenerateMemo || onAddThesis || sourceUrl) && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 rounded-b-2xl" style={{ background: 'linear-gradient(to top, var(--parchment-mid), transparent)' }}>
            {onGenerateMemo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateMemo();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
              >
                &#10022; Generate Memo
              </button>
            )}
            {onAddThesis && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddThesis();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
              >
                + Add to Thesis Board
              </button>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors ml-auto"
              >
                Read source &#8599;
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
