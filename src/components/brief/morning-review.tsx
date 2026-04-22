"use client";
import { cn } from "@/lib/utils";

interface SectorReflection {
  sector: string;
  verdict: "correct" | "wrong" | "partial";
  paragraph: string;
}
interface TickerReflection {
  symbol: string;
  verdict: "correct" | "wrong" | "partial";
  paragraph: string;
}

interface MorningReview {
  aggregate_sentence?: string;
  sector_reflections?: SectorReflection[];
  ticker_reflection?: TickerReflection | null;
}

interface Props {
  review?: MorningReview | null;
}

function VerdictPill({ verdict }: { verdict: "correct" | "wrong" | "partial" }) {
  const styles: Record<string, string> = {
    correct: "bg-signal-up/10 text-signal-up border-signal-up/20",
    wrong: "bg-signal-dn/10 text-signal-dn border-signal-dn/20",
    partial: "bg-signal-warn/10 text-signal-warn border-signal-warn/20",
  };
  const labels: Record<string, string> = {
    correct: "Correct",
    wrong: "Wrong",
    partial: "Partial",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center font-data text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border",
        styles[verdict],
      )}
    >
      {labels[verdict]}
    </span>
  );
}

function ReviewHeader() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span
        className="font-data text-[9px] font-bold uppercase tracking-widest"
        style={{ color: "var(--gold)" }}
      >
        Morning Brief Review
      </span>
      <div className="flex-1 h-px bg-gold/15" />
    </div>
  );
}

export function MorningReview({ review }: Props) {
  // Empty / pending state — surface the section so users know to expect it
  // after market close. Placeholder renders whenever we have no review payload
  // OR the payload is missing the aggregate sentence (nothing meaningful to show).
  if (!review || !review.aggregate_sentence) {
    return (
      <section className="mb-6 p-5 rounded-xl border border-border-base bg-white dark:bg-elevated">
        <ReviewHeader />
        <div className="flex items-center gap-2">
          <span
            className="track-record-pending-dot w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0"
            aria-hidden="true"
          />
          <p className="font-sans text-[13px] text-text-muted leading-relaxed">
            Appears after market close (5:00 PM PT daily).
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 p-5 rounded-xl border border-border-base bg-white dark:bg-elevated">
      <ReviewHeader />
      <p className="font-display text-[18px] text-espresso leading-snug mb-4">
        {review.aggregate_sentence}
      </p>
      {(review.sector_reflections ?? []).length > 0 && (
        <div className="space-y-3 mb-4">
          {review.sector_reflections?.map((s) => (
            <div key={s.sector} className="border-l-[3px] border-gold/40 pl-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-sans text-[13px] font-semibold text-text-primary">
                  {s.sector}
                </span>
                <VerdictPill verdict={s.verdict} />
              </div>
              <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
                {s.paragraph}
              </p>
            </div>
          ))}
        </div>
      )}
      {review.ticker_reflection && (
        <div className="mt-4 pt-4 border-t border-border-base">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-data text-[13px] font-semibold text-gold">
              {review.ticker_reflection.symbol}
            </span>
            <VerdictPill verdict={review.ticker_reflection.verdict} />
          </div>
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
            {review.ticker_reflection.paragraph}
          </p>
        </div>
      )}
    </section>
  );
}

export default MorningReview;
