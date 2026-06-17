"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { ArrowLeft, ChevronDown, Clock } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import {
  computeLiveScore,
  liveScoreChipClasses,
  neutralizeThesisTitle,
  verdictDisplayLabel,
  type LiveScoreResult,
  type TerminalVerdict,
} from "@/lib/track-record-live-score";
import { useLiveMood } from "@/hooks/useLiveMood";
import { componentBreakdown, SCORE_SCALE } from "@/lib/score-presentation";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface ThesisRow {
  id: string;
  title: string | null;
  sector: string | null;
  ticker: string | null;
  conviction: string | null;
  horizon: string | null;
  generated_at: string | null;
  check_after: string | null;
  outcome: string | null;
  rationale: string | null;
  catalyst: string | null;
  catalyst_note: string | null;
  signal_breakdown: Record<string, unknown> | null;
  adversarial_score: number | null;
  bear_case: string | null;
  live_score?: number | null;
  live_verdict?: string | null;
}

interface VerdictRow {
  id: string;
  thesis_id: string;
  graded_at: string;
  verdict: string;
  confidence: number | null;
  weighted_sentiment_alignment: number | null;
  supporting_vs_contradicting_ratio: number | null;
  notes: string | null;
  grader_version: string | null;
}

export default function ThesisDetailPage() {
  const params = useParams();
  const thesisId = params.thesis_id as string;
  const [loading, setLoading] = useState(true);
  const [thesis, setThesis] = useState<ThesisRow | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  useEffect(() => {
    async function load() {
      const sb = getSupabase();
      try {
        const [thesisRes, verdictsRes] = await Promise.all([
          sb
            .from("theses")
            .select(
              "id, title, sector, ticker, conviction, horizon, generated_at, check_after, " +
              "outcome, rationale, catalyst, catalyst_note, signal_breakdown, " +
              "adversarial_score, bear_case, live_score, live_verdict",
            )
            .eq("id", thesisId)
            .limit(1)
            .single(),
          sb
            .from("thesis_verdicts")
            .select(
              "id, thesis_id, graded_at, verdict, confidence, " +
              "weighted_sentiment_alignment, supporting_vs_contradicting_ratio, " +
              "notes, grader_version",
            )
            .eq("thesis_id", thesisId)
            .order("graded_at", { ascending: true }),
        ]);

        if (thesisRes.data) setThesis(thesisRes.data as unknown as ThesisRow);
        setVerdicts((verdictsRes.data as VerdictRow[] | null) ?? []);
      } catch (e) {
        console.error("Thesis detail load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [thesisId]);

  const live = useMemo<LiveScoreResult | null>(() => {
    if (!thesis) return null;
    const latest = verdicts[verdicts.length - 1];
    return computeLiveScore(
      {
        conviction: thesis.conviction,
        horizon: thesis.horizon,
        generated_at: thesis.generated_at,
        signal_breakdown: thesis.signal_breakdown,
        outcome: (thesis.outcome as TerminalVerdict) ?? null,
        latest_weighted_sentiment_alignment: latest?.weighted_sentiment_alignment ?? null,
        latest_supporting_vs_contradicting_ratio: latest?.supporting_vs_contradicting_ratio ?? null,
        latest_confidence: latest?.confidence ?? null,
        latest_verdict:
          latest?.verdict === "confirmed" || latest?.verdict === "invalidated"
            ? latest.verdict
            : null,
        live_score: thesis.live_score ?? null,
        live_verdict: thesis.live_verdict ?? null,
      },
      new Date(),
    );
  }, [thesis, verdicts]);

  if (loading) {
    return (
      <AppShell pageTitle="Thesis Detail" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
        <div className="p-6 max-w-[960px] space-y-4">
          <div className="skeleton-shimmer h-6 w-48 rounded" />
          <div className="skeleton-shimmer h-32 w-full rounded-xl" />
          <div className="skeleton-shimmer h-48 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (!thesis) {
    return (
      <AppShell pageTitle="Thesis Detail" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
        <div className="p-6 max-w-[960px]">
          <Link href="/track-record" className="inline-flex items-center gap-1 text-text-muted hover:text-espresso text-[12px] mb-4">
            <ArrowLeft size={12} /> Back to Thesis Tracker
          </Link>
          <p className="text-text-secondary">Thesis not found.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell pageTitle={thesis.title ? neutralizeThesisTitle(thesis.title) : "Thesis Detail"} mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      <div className="p-6 max-w-[960px] space-y-6">
        {/* Back link */}
        <Link href="/track-record" className="inline-flex items-center gap-1 text-text-muted hover:text-espresso text-[12px]">
          <ArrowLeft size={12} /> Back to Thesis Tracker
        </Link>

        {/* SECTION 1: Original Thesis */}
        <section className="bg-white rounded-xl border border-border-base p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-[20px] font-bold text-espresso leading-tight">
              {neutralizeThesisTitle(thesis.title)}
            </h1>
            {live && (
              <span className={`flex-shrink-0 font-data text-[11px] font-semibold px-2 py-0.5 rounded ${liveScoreChipClasses(live.verdict)}`}>
                {verdictDisplayLabel(live.verdict)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {thesis.sector && (
              <span style={getSectorStyle(thesis.sector)} className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide">
                {thesis.sector}
              </span>
            )}
            {thesis.conviction && (
              <span className="font-data text-[9px] text-text-secondary bg-parchment-mid px-1.5 py-0.5 rounded">
                {thesis.conviction}
              </span>
            )}
            {thesis.ticker && (
              <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
                {thesis.ticker}
              </span>
            )}
            {thesis.horizon && (
              <span className="font-data text-[9px] text-text-muted">
                Horizon: {thesis.horizon}
              </span>
            )}
          </div>

          {/* Timestamps */}
          <div className="flex items-center gap-3 text-[10px] font-data text-text-muted">
            {thesis.generated_at && (
              <span className="inline-flex items-center gap-1">
                <Clock size={10} />
                Generated {formatDateTime(thesis.generated_at)}
              </span>
            )}
            {thesis.check_after && (
              <span>Check after {formatDate(thesis.check_after)}</span>
            )}
          </div>

          {/* Rationale */}
          {thesis.rationale && (
            <div>
              <h3 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-1">Rationale</h3>
              <p className="font-sans text-[12.5px] text-text-primary leading-relaxed">{thesis.rationale}</p>
            </div>
          )}

          {/* Catalyst */}
          {(thesis.catalyst || thesis.catalyst_note) && (
            <div>
              <h3 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-1">Catalyst</h3>
              <p className="font-sans text-[12.5px] text-text-primary leading-relaxed">
                {thesis.catalyst_note || thesis.catalyst}
              </p>
            </div>
          )}

          {/* Bear case */}
          {thesis.bear_case && (
            <div>
              <h3 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-1">Bear Case</h3>
              <p className="font-sans text-[12.5px] text-text-secondary leading-relaxed">{thesis.bear_case}</p>
            </div>
          )}
        </section>

        {/* SECTION 2: What Signalera monitors */}
        <section className="bg-white rounded-xl border border-border-base p-5 space-y-3">
          <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            What Signalera monitors for this thesis
          </h2>
          <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
            Signalera reviews this thesis daily on these dimensions:
          </p>
          <ol className="font-sans text-[12px] text-text-primary leading-relaxed space-y-1.5 list-decimal list-inside">
            <li><span className="font-semibold">Price action</span>: daily price movement of {thesis.ticker || "the asset"} at each review</li>
            <li><span className="font-semibold">News sentiment</span>: directional lean across supporting articles</li>
            <li><span className="font-semibold">Supporting evidence</span>: count of articles supporting vs contradicting the thesis</li>
            <li><span className="font-semibold">Grader confidence</span>: computed only when a terminal verdict is reached</li>
            <li><span className="font-semibold">Time elapsed</span>: proximity to the {thesis.horizon || "30d"} horizon</li>
          </ol>
          <p className="font-sans text-[11px] text-text-muted leading-relaxed">
            Each contributes to a daily composite score (-100 to +100).
            Terminal verdicts (Supported/Challenged) are made by Signalera&apos;s grader using
            its judgment of accumulated evidence; they are not triggered by the score crossing
            a fixed threshold.
          </p>
        </section>

        {/* SECTION 3: Verdict Reasoning (terminal only) */}
        {live && <VerdictReasoning live={live} verdicts={verdicts} />}

        {/* SECTION 4: Current Signal */}
        {live && (
          <section className="bg-white rounded-xl border border-border-base p-5 space-y-4">
            <div>
              <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-2">Current Signal</h2>
              <div className="flex items-center gap-3">
                <span className={`font-sans text-[12px] font-semibold px-2.5 py-1 rounded ${liveScoreChipClasses(live.verdict).replace(" italic", "")}`}>
                  {verdictDisplayLabel(live.verdict)}
                </span>
                <span className="font-data text-[12px] text-text-secondary">
                  {live.score > 0 ? "+" : ""}{live.score} of ±{SCORE_SCALE}
                </span>
              </div>
            </div>

            {/* Plain-language breakdown */}
            <div>
              <h3 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-2">What we&apos;re seeing</h3>
              <SignalBreakdown live={live} thesis={thesis} verdicts={verdicts} />
            </div>

            {/* What we're watching for */}
            <WatchingFor live={live} thesis={thesis} verdicts={verdicts} />

            <div className="font-data text-[10px] text-text-faint">
              Age: {live.ageDays}d · Horizon: {live.horizonDays}d
            </div>

            {/* About this score (collapsible) */}
            <ScoreExplainer />
          </section>
        )}

        {/* SECTION 5: Review Timeline */}
        <section className="bg-white rounded-xl border border-border-base p-5">
          <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-3">
            Review Timeline
          </h2>
          {verdicts.length === 0 ? (
            <p className="font-sans text-[12px] text-text-muted">
              No verdicts yet, awaiting first review.
            </p>
          ) : (
            <div className="space-y-3">
              {verdicts.map((v, i) => (
                <div key={v.id} className="relative pl-5 pb-3 border-l-2 border-border-base last:border-l-0">
                  {/* Timeline dot */}
                  <div className={`absolute -left-[5px] top-1 w-2 h-2 rounded-full ${verdictDotColor(v.verdict)}`} />
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-sans text-[11px] font-semibold ${verdictTextColor(v.verdict)}`}>
                      {verdictDisplayLabel(capitalize(v.verdict))}
                    </span>
                    <span className="font-data text-[10px] text-text-muted">
                      {formatDateTime(v.graded_at)}
                    </span>
                    {v.confidence !== null && (
                      <span className="font-data text-[10px] text-text-faint">
                        conf: {Math.round(v.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {v.notes && (
                    <p className="font-sans text-[11.5px] text-text-secondary leading-snug mt-0.5">
                      {v.notes}
                    </p>
                  )}
                  {v.grader_version && (
                    <span className="font-data text-[9px] text-text-faint">{v.grader_version}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* ── Helpers ── */

function SignalBreakdown({ live, thesis, verdicts }: { live: LiveScoreResult; thesis: ThesisRow; verdicts: VerdictRow[] }) {
  const signalBreakdown = (thesis.signal_breakdown || {}) as Record<string, unknown>;
  const latest = verdicts[verdicts.length - 1] ?? null;
  const sentences = componentBreakdown(live.components, {
    priceChangePct: typeof signalBreakdown.price_change_pct === "number" ? signalBreakdown.price_change_pct : null,
    ticker: thesis.ticker,
    conviction: thesis.conviction,
    ageDays: live.ageDays,
    horizonDays: live.horizonDays,
    latestConfidence: latest?.confidence ?? null,
    latestVerdict: live.terminal,
    rawSentimentAlignment: latest?.weighted_sentiment_alignment ?? null,
    rawSupportingRatio: latest?.supporting_vs_contradicting_ratio ?? null,
  });

  return (
    <ul className="space-y-2">
      {sentences.map((s) => (
        <li key={s.label} className="flex items-start gap-2">
          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            s.sentiment === "positive" ? "bg-signal-up" :
            s.sentiment === "negative" ? "bg-signal-dn" :
            "bg-text-faint"
          }`} />
          <div>
            <span className="font-sans text-[12px] text-text-primary leading-snug">
              {s.sentence}
            </span>
            <span className="font-data text-[10px] text-text-faint ml-1.5">
              ({s.value > 0 ? "+" : ""}{Math.round(s.value)})
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ScoreExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border-base pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 font-sans text-[11px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        About this score
      </button>
      {open && (
        <p className="font-sans text-[11px] text-text-secondary leading-relaxed mt-2 max-w-[640px]">
          Signalera scores each thesis daily on a scale from -100 to +100, combining
          daily price action, news sentiment across supporting articles, supporting-vs-contradicting
          article ratio, grader confidence (terminal only), and time elapsed against the
          thesis horizon. Positive scores indicate market behavior is tracking the thesis.
          Negative scores indicate the evidence may be turning against the thesis.
          Final verdicts (Supported / Challenged) are made by Signalera&apos;s grader
          based on accumulated evidence; they reflect judgment, not a fixed score threshold.
        </p>
      )}
    </div>
  );
}

function VerdictReasoning({ live, verdicts }: { live: LiveScoreResult; verdicts: VerdictRow[] }) {
  if (live.terminal !== "confirmed" && live.terminal !== "invalidated") return null;

  // Find the terminal verdict row (the one with verdict matching terminal state)
  const terminalRow = [...verdicts].reverse().find(
    (v) => v.verdict === live.terminal,
  );
  const notes = terminalRow?.notes;
  const gradedAt = terminalRow?.graded_at;
  const isConfirmed = live.terminal === "confirmed";
  const label = isConfirmed ? "Why evidence supports this" : "Why evidence challenges this";
  const borderColor = isConfirmed ? "border-l-signal-up" : "border-l-signal-dn";
  const bgColor = isConfirmed ? "bg-signal-up/5" : "bg-signal-dn/5";

  return (
    <section className={`rounded-xl border border-border-base border-l-[3px] ${borderColor} ${bgColor} p-5 space-y-2`}>
      <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold">
        {label}
      </h2>
      {notes ? (
        <p className="font-sans text-[13px] text-text-primary leading-relaxed">
          {notes}
        </p>
      ) : (
        <p className="font-sans text-[12px] text-text-muted leading-relaxed">
          This thesis reached a terminal verdict{gradedAt ? ` on ${formatDateTime(gradedAt)}` : ""}.
        </p>
      )}
      {gradedAt && notes && (
        <p className="font-data text-[10px] text-text-faint">
          {verdictDisplayLabel(isConfirmed ? "Confirmed" : "Invalidated")} by Signalera&apos;s grader on {formatDateTime(gradedAt)}
        </p>
      )}
    </section>
  );
}

function WatchingFor({ live, thesis, verdicts }: { live: LiveScoreResult; thesis: ThesisRow; verdicts: VerdictRow[] }) {
  const isTerminal = live.terminal === "confirmed" || live.terminal === "invalidated";

  if (isTerminal) {
    const terminalRow = [...verdicts].reverse().find(
      (v) => v.verdict === live.terminal,
    );
    const gradedAt = terminalRow?.graded_at;
    const daysAtVerdict = terminalRow?.graded_at && thesis.generated_at
      ? Math.floor((new Date(terminalRow.graded_at).getTime() - new Date(thesis.generated_at).getTime()) / 86_400_000)
      : null;

    return (
      <div className="border-t border-border-base pt-3 space-y-1.5">
        <h3 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          This thesis has reached a terminal verdict
        </h3>
        <ul className="font-sans text-[12px] text-text-secondary leading-relaxed space-y-1">
          <li className="flex items-start gap-2">
            <span className="text-text-faint mt-0.5">•</span>
            <span>
              {verdictDisplayLabel(capitalize(live.terminal!))}
              {gradedAt ? ` on ${formatDateTime(gradedAt)}` : ""}
              {daysAtVerdict !== null ? ` · ${daysAtVerdict} days into the ${live.horizonDays}d horizon` : ""}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-text-faint mt-0.5">•</span>
            <span>Score at verdict: {live.score > 0 ? "+" : ""}{live.score} of ±{SCORE_SCALE}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-text-faint mt-0.5">•</span>
            <span>Will remain on the track record permanently</span>
          </li>
        </ul>
      </div>
    );
  }

  // Active thesis
  const daysRemaining = Math.max(0, live.horizonDays - live.ageDays);
  const pastHorizon = live.ageDays > live.horizonDays;

  return (
    <div className="border-t border-border-base pt-3 space-y-1.5">
      <h3 className="font-sans text-[10px] uppercase tracking-widest text-gold font-semibold">
        What we&apos;re watching for
      </h3>
      <ul className="font-sans text-[12px] text-text-secondary leading-relaxed space-y-1">
        <li className="flex items-start gap-2">
          <span className="text-text-faint mt-0.5">•</span>
          <span>
            {pastHorizon
              ? `${live.ageDays - live.horizonDays} days past the ${live.horizonDays}d horizon`
              : `${daysRemaining} days remaining on the ${live.horizonDays}d horizon`}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-text-faint mt-0.5">•</span>
          <span>Next review: tonight at 8:10 PM PT (global daily run)</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-text-faint mt-0.5">•</span>
          <span>
            Signalera&apos;s grader reaches a terminal verdict (Supported or Challenged) when
            it has accumulated sufficient evidence, typically requires multiple supporting
            articles and consistent price action across reviews
          </span>
        </li>
      </ul>
    </div>
  );
}

function verdictDotColor(verdict: string): string {
  if (verdict === "confirmed") return "bg-signal-up";
  if (verdict === "invalidated") return "bg-signal-dn";
  return "bg-signal-warn";
}

function verdictTextColor(verdict: string): string {
  if (verdict === "confirmed") return "text-signal-up";
  if (verdict === "invalidated") return "text-signal-dn";
  return "text-signal-warn";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
