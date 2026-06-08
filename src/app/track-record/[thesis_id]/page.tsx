"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { ArrowLeft, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import {
  computeLiveScore,
  liveScoreChipClasses,
  type LiveScoreResult,
  type TerminalVerdict,
} from "@/lib/track-record-live-score";
import { useLiveMood } from "@/hooks/useLiveMood";

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
  evidence_summary: string | null;
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
              "evidence_summary, grader_version",
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
        <div className="p-6 max-w-[720px] space-y-4">
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
        <div className="p-6 max-w-[720px]">
          <Link href="/track-record" className="inline-flex items-center gap-1 text-text-muted hover:text-espresso text-[12px] mb-4">
            <ArrowLeft size={12} /> Back to Track Record
          </Link>
          <p className="text-text-secondary">Thesis not found.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell pageTitle={thesis.title ?? "Thesis Detail"} mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      <div className="p-6 max-w-[720px] space-y-6">
        {/* Back link */}
        <Link href="/track-record" className="inline-flex items-center gap-1 text-text-muted hover:text-espresso text-[12px]">
          <ArrowLeft size={12} /> Back to Track Record
        </Link>

        {/* SECTION 1: Original Call */}
        <section className="bg-white rounded-xl border border-border-base p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-[20px] font-bold text-espresso leading-tight">
              {thesis.title}
            </h1>
            {live && (
              <span className={`flex-shrink-0 font-data text-[11px] font-semibold px-2 py-0.5 rounded ${liveScoreChipClasses(live.verdict)}`}>
                {live.verdict}
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

        {/* SECTION 2: Live Score Summary */}
        {live && (
          <section className="bg-white rounded-xl border border-border-base p-5">
            <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-3">Current Score</h2>
            <div className="flex items-center gap-4">
              <div className={`font-data text-3xl font-bold ${live.score >= 0 ? "text-signal-up" : "text-signal-dn"}`}>
                {live.score > 0 ? "+" : ""}{live.score}
              </div>
              <div className="flex-1 space-y-1 text-[11px] font-data text-text-secondary">
                <ScoreRow label="Price" value={live.components.price} max={50} />
                <ScoreRow label="Sentiment" value={live.components.sentiment} max={25} />
                <ScoreRow label="Ratio" value={live.components.ratio} max={15} />
                <ScoreRow label="Confidence" value={live.components.confidence} max={10} />
                <ScoreRow label="Time decay" value={live.components.timeDecay} max={10} />
              </div>
            </div>
            <div className="mt-2 font-data text-[10px] text-text-muted">
              Age: {live.ageDays}d · Horizon: {live.horizonDays}d · Source: {live.source}
            </div>
          </section>
        )}

        {/* SECTION 3: Grading Timeline */}
        <section className="bg-white rounded-xl border border-border-base p-5">
          <h2 className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-3">
            Grading Timeline
          </h2>
          {verdicts.length === 0 ? (
            <p className="font-sans text-[12px] text-text-muted">
              No verdicts yet — awaiting first grading run.
            </p>
          ) : (
            <div className="space-y-3">
              {verdicts.map((v, i) => (
                <div key={v.id} className="relative pl-5 pb-3 border-l-2 border-border-base last:border-l-0">
                  {/* Timeline dot */}
                  <div className={`absolute -left-[5px] top-1 w-2 h-2 rounded-full ${verdictDotColor(v.verdict)}`} />
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-sans text-[11px] font-semibold ${verdictTextColor(v.verdict)}`}>
                      {capitalize(v.verdict)}
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
                  {v.evidence_summary && (
                    <p className="font-sans text-[11.5px] text-text-secondary leading-snug mt-0.5">
                      {v.evidence_summary}
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

function ScoreRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.abs(value) / max * 100;
  const positive = value >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-text-muted">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-border-base max-w-[100px] relative">
        <div
          className={`h-full rounded-full ${positive ? "bg-signal-up" : "bg-signal-dn"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`w-8 text-right ${positive ? "text-signal-up" : "text-signal-dn"}`}>
        {value > 0 ? "+" : ""}{Math.round(value)}
      </span>
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
