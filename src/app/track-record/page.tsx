"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import Link from "next/link";
import { Trophy, Clock, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import { EmptyState } from "@/components/ui/empty-state";
import AnimatedNumber from "@/components/ui/animated-number";
import { VerdictEvolution } from "@/components/track-record/verdict-evolution";
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
  signal_breakdown: Record<string, unknown> | null;
  adversarial_score: number | null;
  // Optional persisted columns (sql/live_score_columns.sql).
  live_score?: number | null;
  live_verdict?: string | null;
  live_score_updated_at?: string | null;
}

interface SourceRow {
  source: string | null;
  win_rate: number | null;
  n_theses: number | null;
}

interface ScoredThesis {
  id: string;
  title: string;
  sector: string | null;
  ticker: string | null;
  conviction: string | null;
  generated_at: string | null;
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
  winRate: number;
}

const TERMINAL_LABELS: ReadonlyArray<string> = ["Confirmed", "Invalidated"];

/**
 * Detect SpaceX-themed theses (ticker incorrectly resolves to SPCE upstream
 * because SpaceX is private — Wave 2 will fix entity resolution; for now we
 * intercept here and render "SpaceX (private)" with no ticker chip).
 */
function isSpaceXThesis(meta: { title?: string | null; ticker?: string | null }): boolean {
  return /spacex/i.test(meta.title ?? "");
}

export default function TrackRecordPage() {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [scored, setScored] = useState<ScoredThesis[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
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
          "outcome, signal_breakdown, adversarial_score, live_score, live_verdict, " +
          "live_score_updated_at";
        const minimalCols =
          "id, title, sector, ticker, conviction, horizon, generated_at, check_after, " +
          "outcome, signal_breakdown, adversarial_score";
        const tryFull = await supabase.from("theses").select(fullCols);
        if (tryFull.error) {
          const fallback = await supabase.from("theses").select(minimalCols);
          thesesMeta = (fallback.data as unknown as ThesisMeta[] | null) ?? [];
        } else {
          thesesMeta = (tryFull.data as unknown as ThesisMeta[] | null) ?? [];
        }

        const [verdictsAllRes, sourcesRes] = await Promise.all([
          supabase
            .from("thesis_verdicts")
            .select(
              "thesis_id, graded_at, verdict, confidence, weighted_sentiment_alignment, supporting_vs_contradicting_ratio",
            )
            .order("graded_at", { ascending: false }),
          supabase
            .from("source_credibility")
            .select("source, win_rate, n_theses")
            .order("win_rate", { ascending: false })
            .limit(10),
        ]);

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
        setSources((sourcesRes.data as SourceRow[]) ?? []);
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
  const confirmationRate = useMemo(() => {
    const denom = trackingConfirmed + trackingInvalidated;
    if (denom === 0) return null;
    return Math.round((trackingConfirmed / denom) * 100);
  }, [trackingConfirmed, trackingInvalidated]);

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
        winRate: denom > 0 ? Math.round((d.tc / denom) * 100) : 0,
      });
    }
    groups.sort((a, b) => b.winRate - a.winRate || b.avgScore - a.avgScore);
    return groups;
  }, [scored]);

  const top3Working = useMemo(
    () => [...scored].sort((a, b) => b.live.score - a.live.score).slice(0, 3),
    [scored],
  );
  const bottom3NotWorking = useMemo(
    () => [...scored].sort((a, b) => a.live.score - b.live.score).slice(0, 3),
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
      pageTitle="Track Record"
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
    >
      <div className="p-6 space-y-6 max-w-[960px]">
        {/* HEADER */}
        <div>
          <h1 className="font-display text-[28px] font-bold text-espresso leading-tight">
            Signal Track Record
          </h1>
          <p className="font-sans text-[13px] text-text-secondary mt-1">
            How Signalera&apos;s thesis intelligence performs over time.
          </p>
          {showGradingHeader && (
            <p className="font-data text-text-muted text-[11px] mt-1.5 inline-flex items-center gap-2 flex-wrap">
              <span>
                <span className="font-semibold text-text-primary">{totalCount}</span>{" "}
                {totalCount === 1 ? "thesis" : "theses"} tracked
              </span>
              {formattedLastUpdated && (
                <>
                  <span className="text-text-faint">·</span>
                  <span>Last graded {formattedLastUpdated}</span>
                </>
              )}
              <span className="text-text-faint">·</span>
              <span className="inline-flex items-center gap-1 text-gold">
                <Clock size={11} className="text-gold" />
                Next run 8:10 PM PT daily
              </span>
            </p>
          )}
          {!showGradingHeader && formattedLastUpdated && (
            <p className="font-data text-text-faint text-[11px] mt-1">
              Last updated: {formattedLastUpdated}
            </p>
          )}
          {showPipelineStatus && (
            <div className="mt-3 inline-flex items-center gap-2.5 bg-gold-muted border border-gold-border rounded-lg px-3 py-2">
              <span className="track-record-pending-dot w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
              <div className="flex items-center gap-3">
                <span className="font-sans text-[11px] text-text-primary">
                  <span className="font-data font-semibold">{awaitingCount}</span>{" "}
                  {awaitingCount === 1 ? "thesis" : "theses"} awaiting first grading run
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
              icon={<Trophy size={32} />}
              title="No theses yet"
              description="Track Record will populate as soon as the thesis pipeline emits its first row."
            />
          </div>
        ) : (
          <>
            {/* SUMMARY STATS */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total" value={totalCount} loading={loading} />
              <StatCard
                label="Tracking Confirmed"
                value={trackingConfirmed}
                loading={loading}
                trend="up"
              />
              <StatCard
                label="Tracking Invalidated"
                value={trackingInvalidated}
                loading={loading}
                trend="down"
              />
              <StatCard
                label="Confirmation Rate"
                value={confirmationRate}
                suffix="%"
                subtext={
                  trackingConfirmed + trackingInvalidated > 0
                    ? `${trackingConfirmed} of ${trackingConfirmed + trackingInvalidated} resolved`
                    : undefined
                }
                placeholder="--"
                gold
                loading={loading}
              />
            </div>

            {/* SECTOR PERFORMANCE TABLE */}
            <Section title="Sector Performance">
              {sectorGroups.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full font-sans text-[12px]">
                    <thead>
                      <tr className="border-b border-border-base">
                        {[
                          "Sector",
                          "Theses",
                          "Tracking ↑",
                          "Tracking ↓",
                          "Win Rate",
                          "Avg Score",
                        ].map((h) => (
                          <th
                            key={h}
                            className="font-sans text-[10px] uppercase tracking-widest text-text-muted font-semibold py-2 px-2 text-left"
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
                          className={`card-hover-lift border-b border-border-base last:border-b-0 ${i === 0 ? "bg-gold/5" : ""}`}
                        >
                          <td className="py-2 px-2">
                            <span
                              style={getSectorStyle(g.sector)}
                              className="font-sans text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                            >
                              {g.sector}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-data">{g.total}</td>
                          <td className="py-2 px-2 font-data text-signal-up">
                            {g.trackingConfirmed}
                          </td>
                          <td className="py-2 px-2 font-data text-signal-dn">
                            {g.trackingInvalidated}
                          </td>
                          <td className="py-2 px-2">
                            {g.trackingConfirmed + g.trackingInvalidated >= 3 ? (
                              <div className="flex items-center gap-2">
                                <span className="font-data font-semibold">{g.winRate}%</span>
                                <div className="flex-1 h-1.5 rounded-full bg-gold/20 max-w-[80px]">
                                  <div
                                    className="bar-sweep-in h-full rounded-full bg-gold"
                                    style={{ width: `${g.winRate}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="font-data text-text-muted" title="Needs ≥3 resolved theses">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <ScoreMuted score={g.avgScore} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* VERDICT EVOLUTION — avg live_score sparkline (last 30d) */}
            {trackingConfirmed + trackingInvalidated >= 20 && (
              <VerdictEvolution scored={scored} />
            )}

            {/* WHAT'S BEEN WORKING */}
            <Section title="What's Been Working">
              {top3Working.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {top3Working.map((t) => (
                    <ThesisRankCard key={t.id} thesis={t} positive />
                  ))}
                </div>
              )}
            </Section>

            {/* WHAT'S NOT */}
            <Section title="What's Not">
              {bottom3NotWorking.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {bottom3NotWorking.map((t) => (
                    <ThesisRankCard key={t.id} thesis={t} positive={false} />
                  ))}
                </div>
              )}
            </Section>

            {/* SOURCE CREDIBILITY */}
            <Section title="Most Reliable Sources">
              {sources.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="space-y-1.5">
                  {sources.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-white rounded-xl border border-border-base px-3 py-2"
                    >
                      <span className="font-data text-text-faint text-[12px] w-5 text-right">
                        #{i + 1}
                      </span>
                      <span className="font-sans font-medium text-[12px] text-espresso flex-1 min-w-0 truncate">
                        {s.source || "Unknown"}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="w-[60px] h-1.5 rounded-full bg-gold/20">
                          <div
                            className="bar-sweep-in h-full rounded-full bg-gold"
                            style={{
                              width: `${s.win_rate !== null ? Math.round(s.win_rate * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <span className="font-data text-[11px] text-text-secondary w-8 text-right">
                          {s.win_rate !== null ? `${Math.round(s.win_rate * 100)}%` : "--"}
                        </span>
                      </div>
                      <span className="font-data text-[10px] text-text-muted flex-shrink-0">
                        {s.n_theses ?? 0} theses
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* RECENT THESES */}
            <Section title="Recent Theses">
              {recentScored.length === 0 ? (
                <EmptyInflightState />
              ) : (
                <div className="grid gap-2">
                  {recentScored.map((t) => (
                    <Link
                      key={t.id}
                      href={`/track-record/${t.id}`}
                      className="card-hover-lift block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-sans font-semibold text-[13px] text-espresso leading-snug">
                            {t.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {t.sector && (
                              <span
                                style={getSectorStyle(t.sector)}
                                className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                              >
                                {t.sector}
                              </span>
                            )}
                            <TickerOrPrivate title={t.title} ticker={t.ticker} />
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <LiveVerdictBadge live={t.live} size="prominent" />
                          <ScoreMuted score={t.live.score} />
                          {t.generated_at && (
                            <span className="font-data text-[10px] text-text-faint">
                              {formatDate(t.generated_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
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

function StatCard({
  label,
  value,
  suffix,
  subtext,
  placeholder = "--",
  gold,
  loading,
  trend,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  subtext?: string;
  placeholder?: string;
  gold?: boolean;
  loading?: boolean;
  trend?: "up" | "down";
}) {
  const trendColor =
    trend === "up" ? "text-signal-up" : trend === "down" ? "text-signal-dn" : "";
  return (
    <div className="card-hover-lift bg-white rounded-xl border border-border-base p-4">
      <div className="font-sans text-[10px] uppercase tracking-widest text-text-muted mb-1 inline-flex items-center gap-1">
        {trend === "up" && <TrendingUp size={10} className="text-signal-up" />}
        {trend === "down" && <TrendingDown size={10} className="text-signal-dn" />}
        <span>{label}</span>
      </div>
      {loading ? (
        <div className="skeleton-shimmer h-8 w-16 rounded" />
      ) : value === null ? (
        <div className={`font-data text-2xl font-bold ${gold ? "text-gold" : "text-espresso"}`}>
          {placeholder}
        </div>
      ) : (
        <div
          className={`font-data text-2xl font-bold ${
            gold ? "text-gold" : trendColor || "text-espresso"
          }`}
        >
          <AnimatedNumber value={value} format={(n) => `${Math.round(n)}${suffix ?? ""}`} />
        </div>
      )}
      {subtext && (
        <div className="font-data text-[10px] text-text-muted mt-0.5">{subtext}</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function LiveVerdictBadge({ live, size = "default" }: { live: LiveScoreResult; size?: "default" | "prominent" }) {
  const isProminent = size === "prominent";
  const chipClasses = liveScoreChipClasses(live.verdict);
  // Strip italic for prominent badges — they should look assertive, not tentative
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
      {live.verdict}
    </span>
  );
}

function ScoreMuted({ score }: { score: number }) {
  const rounded = Math.round(score);
  const sign = rounded > 0 ? "+" : "";
  return (
    <span className="font-data text-[10px] text-text-faint">
      {sign}{rounded} of ±100
    </span>
  );
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
      href={`/track-record/${thesis.id}`}
      className="card-hover-lift block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className={`${iconColor} mt-0.5 flex-shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="font-sans font-semibold text-[12.5px] text-espresso leading-snug">
            {thesis.title}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {thesis.sector && (
              <span
                style={getSectorStyle(thesis.sector)}
                className="font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
              >
                {thesis.sector}
              </span>
            )}
            <LiveVerdictBadge live={thesis.live} size="prominent" />
            <ScoreMuted score={thesis.live.score} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function TickerOrPrivate({
  title,
  ticker,
}: {
  title: string;
  ticker: string | null;
}) {
  if (isSpaceXThesis({ title, ticker })) {
    return (
      <span className="font-sans text-[9px] text-text-muted italic">
        SpaceX (private)
      </span>
    );
  }
  if (!ticker) return null;
  return (
    <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
      {ticker}
    </span>
  );
}

function EmptyInflightState() {
  // Used when a primary surface has zero rows for it specifically (e.g.
  // sources_credibility hasn't materialised yet) — but the page itself has
  // theses, so we DO NOT use the legacy "check back later" copy.
  return (
    <div className="relative flex items-center gap-3 bg-white dark:bg-elevated rounded-xl border border-border-base p-5 overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold rounded-l-xl" />
      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
        <Activity size={13} className="text-gold" />
      </div>
      <span className="font-sans text-[12.5px] text-text-primary leading-snug">
        Scores are in flight — refreshes nightly at 8:10 PM PT.
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
 * Returns the next time the daily grading cron will fire — next 8:10 PM in
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
