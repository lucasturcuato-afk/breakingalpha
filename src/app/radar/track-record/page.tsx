"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import Link from "next/link";
import { LineChart, Clock, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import { EmptyState } from "@/components/ui/empty-state";
import { VerdictEvolution } from "@/components/track-record/verdict-evolution";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import { openThesisProps } from "@/lib/scored-object-map";
import {
  computeLiveScore,
  liveScoreChipClasses,
  neutralizeThesisTitle,
  verdictDisplayLabel,
  verdictLean,
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

interface RawVerdict {
  thesis_id: string;
  graded_at: string;
  verdict: string;
  confidence: number | null;
  weighted_sentiment_alignment: number | null;
  supporting_vs_contradicting_ratio: number | null;
}

interface ThesisMeta {
  id: string;
  title: string | null;
  sector: string | null;
  ticker: string | null;
  conviction: string | null;
  horizon: string | null;
  generated_at: string | null;
  check_after: string | null;
  outcome: string | null;
  confidence: number | null;
  signal_breakdown: Record<string, unknown> | null;
  adversarial_score: number | null;
  // Optional persisted columns (sql/live_score_columns.sql).
  live_score?: number | null;
  live_verdict?: string | null;
  live_score_updated_at?: string | null;
}

interface ScoredThesis {
  id: string;
  title: string;
  sector: string | null;
  ticker: string | null;
  conviction: string | null;
  generated_at: string | null;
  check_after: string | null;
  horizon: string | null;
  confidence: number | null;
  outcome: TerminalVerdict;
  live: LiveScoreResult;
}

interface SectorGroup {
  sector: string;
  total: number;
  trackingConfirmed: number;
  trackingInvalidated: number;
  trackingNeutral: number;
  avgScore: number;
  supportRate: number;
}

const TERMINAL_LABELS: ReadonlyArray<string> = ["Confirmed", "Invalidated"];

export default function TrackRecordPage() {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [scored, setScored] = useState<ScoredThesis[]>([]);
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [awaitingCount, setAwaitingCount] = useState<number>(0);

  // Banner mood comes from the shared SSOT hook so this page agrees with
  // the dashboard / live feed / etc. Without this, AppShell falls back to
  // MoodBar's hard-coded "VIX 14.2 / Markets steady / Neutral" defaults.
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const now = new Date();
      const nowIso = now.toISOString();
      const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

      try {
        // Defensive select: optional live_score columns may not exist yet
        // (sql/live_score_columns.sql is a one-time DDL). If the column-laden
        // select fails, fall back to a minimal column set.
        let thesesMeta: ThesisMeta[] = [];
        const fullCols =
          "id, title, sector, ticker, conviction, horizon, generated_at, check_after, " +
          "outcome, confidence, signal_breakdown, adversarial_score, live_score, live_verdict, " +
          "live_score_updated_at";
        const minimalCols =
          "id, title, sector, ticker, conviction, horizon, generated_at, check_after, " +
          "outcome, confidence, signal_breakdown, adversarial_score";
        const tryFull = await supabase.from("theses").select(fullCols);
        if (tryFull.error) {
          const fallback = await supabase.from("theses").select(minimalCols);
          thesesMeta = (fallback.data as unknown as ThesisMeta[] | null) ?? [];
        } else {
          thesesMeta = (tryFull.data as unknown as ThesisMeta[] | null) ?? [];
        }

        const verdictsAllRes = await supabase
          .from("thesis_verdicts")
          .select(
            "thesis_id, graded_at, verdict, confidence, weighted_sentiment_alignment, supporting_vs_contradicting_ratio",
          )
          .order("graded_at", { ascending: false });

        const rawVerdicts = (verdictsAllRes.data as RawVerdict[] | null) ?? [];
        const latestByThesis = new Map<string, RawVerdict>();
        for (const v of rawVerdicts) {
          if (!v.thesis_id) continue;
          if (!latestByThesis.has(v.thesis_id)) latestByThesis.set(v.thesis_id, v);
        }

        const scoredAll: ScoredThesis[] = thesesMeta.map((t) => {
          const latest = latestByThesis.get(t.id);
          const live = computeLiveScore(
            {
              conviction: t.conviction,
              horizon: t.horizon,
              generated_at: t.generated_at,
              signal_breakdown: t.signal_breakdown,
              outcome: (t.outcome as TerminalVerdict) ?? null,
              latest_weighted_sentiment_alignment: latest?.weighted_sentiment_alignment ?? null,
              latest_supporting_vs_contradicting_ratio:
                latest?.supporting_vs_contradicting_ratio ?? null,
              latest_confidence: latest?.confidence ?? null,
              latest_verdict:
                latest?.verdict === "confirmed" || latest?.verdict === "invalidated"
                  ? latest.verdict
                  : null,
              live_score: t.live_score ?? null,
              live_verdict: t.live_verdict ?? null,
            },
            now,
          );
          return {
            id: t.id,
            title: t.title ?? "Untitled thesis",
            sector: t.sector,
            ticker: t.ticker,
            conviction: t.conviction,
            check_after: t.check_after,
            horizon: t.horizon,
            confidence: t.confidence,
            generated_at: t.generated_at,
            outcome: (t.outcome as TerminalVerdict) ?? null,
            live,
          };
        });

        // Theses with at least one verdict are "tracked"; the rest are
        // "awaiting first grading run". Header counts everything once.
        const gradedIds = new Set(latestByThesis.keys());
        let overdue = 0;
        let awaiting = 0;
        for (const t of thesesMeta) {
          if (gradedIds.has(t.id)) continue;
          awaiting += 1;
          if (t.check_after && t.check_after < nowIso) {
            overdue += 1;
          } else if (!t.check_after && t.generated_at && t.generated_at < thirtyDaysAgoIso) {
            overdue += 1;
          }
        }

        setScored(scoredAll);
        setLastUpdated(rawVerdicts[0]?.graded_at ?? null);
        setOverdueCount(overdue);
        setAwaitingCount(awaiting);
      } catch (e) {
        console.error("Track record load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Header counts are now all derived from the same `scored` universe so
  // "12 tracked" and "1 confirmed" can never diverge again.
  const totalCount = scored.length;
  const trackingConfirmed = useMemo(
    () =>
      scored.filter(
        (t) => t.live.verdict === "Confirmed" || t.live.verdict === "Tracking confirmed",
      ).length,
    [scored],
  );
  const trackingInvalidated = useMemo(
    () =>
      scored.filter(
        (t) => t.live.verdict === "Invalidated" || t.live.verdict === "Tracking invalidated",
      ).length,
    [scored],
  );
  const confirmedExamples = useMemo(
    () => scored.filter((t) => t.live.verdict === "Confirmed" || t.live.verdict === "Tracking confirmed").slice(0, 2),
    [scored],
  );
  const invalidatedExamples = useMemo(
    () => scored.filter((t) => t.live.verdict === "Invalidated" || t.live.verdict === "Tracking invalidated").slice(0, 2),
    [scored],
  );

  const sectorGroups = useMemo<SectorGroup[]>(() => {
    const map = new Map<
      string,
      { total: number; tc: number; ti: number; tn: number; scores: number[] }
    >();
    for (const t of scored) {
      const s = t.sector || "Unknown";
      const cur = map.get(s) ?? { total: 0, tc: 0, ti: 0, tn: 0, scores: [] };
      cur.total += 1;
      if (t.live.verdict === "Confirmed" || t.live.verdict === "Tracking confirmed") cur.tc += 1;
      else if (t.live.verdict === "Invalidated" || t.live.verdict === "Tracking invalidated")
        cur.ti += 1;
      else cur.tn += 1;
      cur.scores.push(t.live.score);
      map.set(s, cur);
    }
    const groups: SectorGroup[] = [];
    for (const [sector, d] of map) {
      const denom = d.tc + d.ti;
      groups.push({
        sector,
        total: d.total,
        trackingConfirmed: d.tc,
        trackingInvalidated: d.ti,
        trackingNeutral: d.tn,
        avgScore: d.scores.length ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0,
        supportRate: denom > 0 ? Math.round((d.tc / denom) * 100) : 0,
      });
    }
    groups.sort((a, b) => b.supportRate - a.supportRate || b.avgScore - a.avgScore);
    return groups;
  }, [scored]);

  const top3Working = useMemo(
    () =>
      scored
        .filter((t) => verdictLean(t.live.verdict) === "supportive")
        .sort((a, b) => b.live.score - a.live.score)
        .slice(0, 3),
    [scored],
  );
  const bottom3NotWorking = useMemo(
    () =>
      scored
        .filter((t) => verdictLean(t.live.verdict) === "against")
        .sort((a, b) => a.live.score - b.live.score)
        .slice(0, 3),
    [scored],
  );

  const recentScored = useMemo(
    () =>
      [...scored]
        .filter((t) => t.generated_at)
        .sort((a, b) => (b.generated_at ?? "").localeCompare(a.generated_at ?? ""))
        .slice(0, 10),
    [scored],
  );

  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) return null;
    try {
      return new Date(lastUpdated).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [lastUpdated]);

  const formattedNextRun = useMemo(() => {
    const nextRun = getNextGradingRunPT(new Date());
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(nextRun);
  }, []);

  const showPipelineStatus = !loading && awaitingCount > 0;
  const showGradingHeader = !loading && totalCount > 0;
  const isFirstPaintEmpty = !loading && totalCount === 0;

  return (
    <AppShell
      pageTitle="Thesis Tracker"
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
    >
      <div className="p-6 space-y-6 max-w-[960px]">
        <RadarTabs active="calls" context="Thesis Tracker" />
        {/* HEADER */}
        <div>
          <h1 className="font-display text-[28px] font-bold text-espresso leading-tight">
            Thesis Tracker
          </h1>
          <p className="font-sans text-[13px] text-text-secondary mt-1">
            How market theses are developing as events unfold.
          </p>
          {showGradingHeader && (
            <p className="font-sans text-text-muted text-[11px] mt-1.5 inline-flex items-center gap-2 flex-wrap">
              <span>
                <span className="font-semibold text-text-primary">{totalCount}</span>{" "}
                {totalCount === 1 ? "thesis" : "theses"} tracked
              </span>
              {formattedLastUpdated && (
                <>
                  <span className="text-text-faint">·</span>
                  <span>Last reviewed against evidence {formattedLastUpdated}</span>
                </>
              )}
              <span className="text-text-faint">·</span>
              <span className="inline-flex items-center gap-1 text-gold">
                <Clock size={11} className="text-gold" />
                Next review 8:10 PM PT daily
              </span>
            </p>
          )}
          {!showGradingHeader && formattedLastUpdated && (
            <p className="font-sans text-text-faint text-[11px] mt-1">
              Last updated: {formattedLastUpdated}
            </p>
          )}
          {showPipelineStatus && (
            <div className="mt-3 inline-flex items-center gap-2.5 bg-gold-muted border border-gold-border rounded-lg px-3 py-2">
              <span className="track-record-pending-dot w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
              <div className="flex items-center gap-3">
                <span className="font-sans text-[11px] text-text-primary">
                  <span className="font-display font-semibold">{awaitingCount}</span>{" "}
                  {awaitingCount === 1 ? "thesis" : "theses"} awaiting first review
                  {overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
                </span>
                <span className="text-text-muted">|</span>
                <span className="font-sans text-[11px] text-text-muted">
                  Next check: {formattedNextRun}
                </span>
              </div>
            </div>
          )}
        </div>

        {isFirstPaintEmpty ? (
          // Only the literally-empty case keeps the legacy "check back" copy.
          <div className="relative rounded-2xl bg-gradient-to-b from-gold-muted/40 to-transparent border border-gold-border/60">
            <EmptyState
              icon={<LineChart size={32} />}
              title="No theses yet"
              description="Thesis Tracker will populate as soon as the thesis pipeline emits its first row."
            />
          </div>
        ) : (
          <>
            {/* STATUS SCOREBOARD */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatusCard
                label="Theses tracked"
                loading={loading}
                headline={`${totalCount} active ${totalCount === 1 ? "thesis" : "theses"}`}
                subline={awaitingCount > 0 ? `${awaitingCount} awaiting first review${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}` : undefined}
                footer="Daily updates at 8:10 PM PT"
              />
              <StatusCard
                label="Where evidence supports"
                loading={loading}
                headline={trackingConfirmed > 0 ? `${trackingConfirmed} with supporting evidence` : "None with supporting evidence yet"}
                subline={confirmedExamples.length > 0 ? confirmedExamples.map(t => neutralizeThesisTitle(t.title)).join(" · ") : undefined}
                tint="positive"
              />
              <StatusCard
                label="Where evidence is mixed or against"
                loading={loading}
                headline={trackingInvalidated > 0 ? `${trackingInvalidated} with evidence against` : "None with evidence against yet"}
                subline={invalidatedExamples.length > 0 ? invalidatedExamples.map(t => neutralizeThesisTitle(t.title)).join(" · ") : undefined}
                tint={trackingInvalidated > 0 ? "negative" : undefined}
              />
            </div>

            {/* THESES BY SECTOR TABLE */}
            <Section title="Theses by sector">
              {sectorGroups.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full font-sans text-[12px]">
                    <thead>
                      <tr className="border-b border-border-base">
                        {["Sector", "Status", "Count"].map((h) => (
                          <th
                            key={h}
                            className="font-sans text-[11px] text-text-muted font-semibold py-2 px-2 text-left"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sectorGroups.map((g, i) => (
                        <tr
                          key={g.sector}
                          className={`border-b border-border-base last:border-b-0 ${i === 0 ? "bg-gold/5" : ""}`}
                        >
                          <td className="py-2.5 px-2">
                            <span
                              style={getSectorStyle(g.sector)}
                              className="font-sans text-[10px] font-semibold px-2 py-0.5 rounded"
                            >
                              {g.sector}
                            </span>
                          </td>
                          <td className="py-2.5 px-2">
                            <SectorStatus group={g} />
                          </td>
                          <td className="py-2.5 px-2 font-sans text-text-secondary">
                            {g.total} {g.total === 1 ? "thesis" : "theses"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* VERDICT EVOLUTION: avg live_score sparkline (last 30d) */}
            {trackingConfirmed + trackingInvalidated >= 20 && (
              <VerdictEvolution scored={scored} />
            )}

            {/* WHERE EVIDENCE SUPPORTS THE THESIS */}
            <Section title="Where evidence supports the thesis">
              {top3Working.length === 0 ? (
                <div className="bg-white rounded-xl border border-border-base p-4 font-sans text-[12px] text-text-muted leading-snug">
                  No theses with evidence leaning supportive yet. This builds as coverage accumulates.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {top3Working.map((t) => (
                    <ThesisRankCard key={t.id} thesis={t} positive />
                  ))}
                </div>
              )}
            </Section>

            {/* WHERE EVIDENCE IS MIXED OR AGAINST */}
            <Section title="Where evidence is mixed or against">
              {bottom3NotWorking.length === 0 ? (
                <div className="bg-white rounded-xl border border-border-base p-4 font-sans text-[12px] text-text-muted leading-snug">
                  No theses with evidence leaning against yet. This builds as coverage accumulates.
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {bottom3NotWorking.map((t) => (
                    <ThesisRankCard key={t.id} thesis={t} positive={false} />
                  ))}
                </div>
              )}
            </Section>

            {/* RECENT THESES */}
            <Section title="Recent theses">
              {recentScored.length === 0 ? (
                <EmptyInflightState />
              ) : (
                // HYBRID (design rollout): open theses (no terminal outcome) render
                // as the Open ScoredObject; already-resolved theses keep their real
                // LiveVerdictBadge unchanged so no real verdict is hidden. Both sit in
                // the same grid with aligned spacing. Unifying resolved theses onto
                // ScoredObject's resolved states is a separate task (needs the real
                // resolution model) — Track Record intentionally shows two treatments
                // until then.
                <div className="grid gap-2">
                  {recentScored.map((t) =>
                    t.outcome == null ? (
                      <Link
                        key={t.id}
                        href={`/radar/track-record/${t.id}`}
                        className="card-hover-lift block rounded-lg"
                      >
                        <ScoredObject
                          {...openThesisProps({
                            claim: neutralizeThesisTitle(t.title),
                            sector: t.sector,
                            generated_at: t.generated_at,
                            check_after: t.check_after,
                            horizon: t.horizon,
                            confidence: t.confidence,
                          })}
                        />
                      </Link>
                    ) : (
                      <Link
                        key={t.id}
                        href={`/radar/track-record/${t.id}`}
                        className="card-hover-lift block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-sans font-semibold text-[13px] text-espresso leading-snug">
                              {neutralizeThesisTitle(t.title)}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {t.sector && (
                                <span
                                  style={getSectorStyle(t.sector)}
                                  className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded"
                                >
                                  {t.sector}
                                </span>
                              )}
                              <TickerOrPrivate ticker={t.ticker} />
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <LiveVerdictBadge live={t.live} size="prominent" />
                            {t.generated_at && (
                              <span className="font-sans text-[10px] text-text-faint">
                                {formatDate(t.generated_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ),
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ── Sub-components ── */

function StatusCard({
  label,
  headline,
  subline,
  footer,
  tint,
  loading,
}: {
  label: string;
  headline: string;
  subline?: string;
  footer?: string;
  tint?: "positive" | "negative";
  loading?: boolean;
}) {
  const borderAccent =
    tint === "positive" ? "border-l-signal-up" :
    tint === "negative" ? "border-l-signal-dn" :
    "border-l-gold";
  return (
    <div className={`bg-white rounded-xl border border-border-base border-l-[3px] ${borderAccent} p-4`}>
      <div className="font-sans text-[11px] text-text-muted mb-1.5">
        {label}
      </div>
      {loading ? (
        <div className="skeleton-shimmer h-5 w-40 rounded" />
      ) : (
        <div className="font-sans text-[13px] font-semibold text-espresso leading-snug">
          {headline}
        </div>
      )}
      {subline && (
        <div className="font-sans text-[11px] text-text-muted mt-1 leading-snug line-clamp-2">
          {subline}
        </div>
      )}
      {footer && (
        <div className="font-sans text-[10px] text-text-faint mt-2">{footer}</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-sans text-[11px] font-semibold text-text-muted mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function LiveVerdictBadge({ live, size = "default" }: { live: LiveScoreResult; size?: "default" | "prominent" }) {
  const isProminent = size === "prominent";
  const chipClasses = liveScoreChipClasses(live.verdict);
  // Strip italic for prominent badges; they should look assertive, not tentative
  const classes = isProminent ? chipClasses.replace(" italic", "") : chipClasses;
  return (
    <span
      className={`font-sans font-semibold rounded ${
        isProminent ? "text-[11px] px-2 py-1" : "text-[10px] px-1.5 py-0.5"
      } ${classes}`}
      title={
        TERMINAL_LABELS.includes(live.verdict)
          ? `Terminal verdict (score ${live.score} of ±100)`
          : `In-flight verdict (score ${live.score} of ±100)`
      }
    >
      {verdictDisplayLabel(live.verdict)}
    </span>
  );
}

function SectorStatus({ group }: { group: SectorGroup }) {
  if (group.trackingConfirmed > 0 && group.trackingInvalidated === 0) {
    return <span className="font-sans text-[11px] text-signal-up">Evidence currently supportive</span>;
  }
  if (group.trackingInvalidated > 0 && group.trackingConfirmed === 0) {
    return <span className="font-sans text-[11px] text-signal-dn">Evidence currently against</span>;
  }
  if (group.trackingConfirmed > 0 && group.trackingInvalidated > 0) {
    return <span className="font-sans text-[11px] text-text-secondary">Mixed evidence, {group.trackingConfirmed} supportive, {group.trackingInvalidated} against</span>;
  }
  return <span className="font-sans text-[11px] text-text-muted">Awaiting enough data to assess</span>;
}

function scoreToDescriptor(live: LiveScoreResult): string {
  if (live.verdict === "Confirmed") return "Evidence supports the thesis";
  if (live.verdict === "Invalidated") return "Evidence cuts against the thesis";
  if (live.verdict === "Tracking confirmed") return "Evidence leaning supportive";
  if (live.verdict === "Tracking invalidated") return "Evidence leaning against";
  if (live.verdict.startsWith("Inconclusive")) return "Inconclusive so far";
  return "Still developing";
}

function ThesisRankCard({
  thesis,
  positive,
}: {
  thesis: ScoredThesis;
  positive: boolean;
}) {
  const Icon = positive ? TrendingUp : TrendingDown;
  const iconColor = positive ? "text-signal-up" : "text-signal-dn";
  return (
    <Link
      href={`/radar/track-record/${thesis.id}`}
      className="card-hover-lift block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className={`${iconColor} mt-0.5 flex-shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="font-sans font-semibold text-[12.5px] text-espresso leading-snug">
            {neutralizeThesisTitle(thesis.title)}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {thesis.sector && (
              <span
                style={getSectorStyle(thesis.sector)}
                className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded"
              >
                {thesis.sector}
              </span>
            )}
            <LiveVerdictBadge live={thesis.live} size="prominent" />
            <span className="font-sans text-[10px] text-text-muted">{scoreToDescriptor(thesis.live)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function TickerOrPrivate({
  ticker,
}: {
  ticker: string | null;
}) {
  if (!ticker) return null;
  return (
    <span className="font-display text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
      {ticker}
    </span>
  );
}

function EmptyInflightState() {
  // Used when a primary surface has zero rows for it specifically (e.g. a
  // sector group hasn't materialised yet), but the page itself has
  // theses, so we DO NOT use the legacy "check back later" copy.
  return (
    <div className="relative flex items-center gap-3 bg-white dark:bg-elevated rounded-xl border border-border-base p-5 overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold rounded-l-xl" />
      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
        <Activity size={13} className="text-gold" />
      </div>
      <span className="font-sans text-[12.5px] text-text-primary leading-snug">
        Scores are in flight, refreshes nightly at 8:10 PM PT.
      </span>
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Returns the next time the daily grading cron will fire, the next 8:10 PM in
 * America/Los_Angeles. Handles PST/PDT transitions correctly by resolving
 * LA-local "YYYY-MM-DD HH:MM" components first, then converting to UTC using
 * the LA offset at the target instant.
 */
export function getNextGradingRunPT(now: Date, hour = 20, minute = 10): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const laY = p("year");
  const laM = p("month"); // 1-12
  const laD = p("day");
  const laH = p("hour");
  const laMin = p("minute");

  const currentLaMinutes = laH * 60 + laMin;
  const targetLaMinutes = hour * 60 + minute;
  const dayOffset = currentLaMinutes >= targetLaMinutes ? 1 : 0;

  // Pretend the target LA wall-clock is UTC, then shift by LA's actual offset
  // at that moment (handles DST: PST = UTC-8, PDT = UTC-7).
  const pseudoUtcMs = Date.UTC(laY, laM - 1, laD + dayOffset, hour, minute, 0);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(pseudoUtcMs));
  const tzName = offsetParts.find((x) => x.type === "timeZoneName")?.value ?? "GMT-8";
  const m = tzName.match(/GMT([+-]?)(\d+)/);
  const sign = m?.[1] === "+" ? 1 : -1;
  const offsetHours = sign * Number(m?.[2] ?? 8);
  return new Date(pseudoUtcMs - offsetHours * 60 * 60 * 1000);
}
