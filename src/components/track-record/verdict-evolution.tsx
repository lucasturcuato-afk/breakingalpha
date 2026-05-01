"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Clock, Activity } from "lucide-react";
import {
  computeLiveScore,
  type LiveScoreResult,
  type TerminalVerdict,
} from "@/lib/track-record-live-score";

interface RawVerdictRow {
  thesis_id: string;
  graded_at: string;
  verdict: string;
  confidence: number | null;
  weighted_sentiment_alignment: number | null;
  supporting_vs_contradicting_ratio: number | null;
}

interface ThesisMeta {
  id: string;
  conviction: string | null;
  horizon: string | null;
  generated_at: string | null;
  signal_breakdown: Record<string, unknown> | null;
  outcome: string | null;
}

interface ScoredThesisLite {
  id: string;
  live: LiveScoreResult;
  generated_at: string | null;
}

interface DailyPoint {
  day: string; // YYYY-MM-DD
  avgScore: number;
  count: number;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const DAYS_BACK = 30;

/**
 * Render a 30-day sparkline of the average live_score across all theses.
 *
 * Two ways to feed this component:
 *   1. Pass `scored` from the parent (Track Record page already computes
 *      live_scores once for stat cards / sector tables / "What's Working").
 *   2. Standalone — fetches theses + verdicts itself and computes inline.
 *
 * Per-day average is reconstructed by walking each thesis's verdict history
 * and computing live_score at the day's wall-clock time. Theses created
 * after a given day contribute 0 weight on that day.
 */
export function VerdictEvolution({ scored }: { scored?: ScoredThesisLite[] } = {}) {
  const [loading, setLoading] = useState(scored === undefined);
  const [internal, setInternal] = useState<ScoredThesisLite[]>([]);
  const [verdictHistory, setVerdictHistory] = useState<Map<string, RawVerdictRow[]>>(new Map());
  const [thesesMeta, setThesesMeta] = useState<Map<string, ThesisMeta>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabase();
      try {
        const [verdictsRes, thesesRes] = await Promise.all([
          supabase
            .from("thesis_verdicts")
            .select(
              "thesis_id, graded_at, verdict, confidence, weighted_sentiment_alignment, supporting_vs_contradicting_ratio",
            )
            .order("graded_at", { ascending: true }),
          supabase
            .from("theses")
            .select("id, conviction, horizon, generated_at, signal_breakdown, outcome"),
        ]);
        if (cancelled) return;

        const grouped = new Map<string, RawVerdictRow[]>();
        for (const v of (verdictsRes.data as RawVerdictRow[] | null) ?? []) {
          if (!v.thesis_id) continue;
          const arr = grouped.get(v.thesis_id) ?? [];
          arr.push(v);
          grouped.set(v.thesis_id, arr);
        }
        const metaMap = new Map<string, ThesisMeta>();
        for (const t of (thesesRes.data as ThesisMeta[] | null) ?? []) {
          metaMap.set(t.id, t);
        }
        setVerdictHistory(grouped);
        setThesesMeta(metaMap);

        if (scored === undefined) {
          // Compute today's live_scores once for the simple "now" rendering.
          const now = new Date();
          const computed: ScoredThesisLite[] = [];
          for (const [id, meta] of metaMap) {
            const history = grouped.get(id) ?? [];
            const latest = history[history.length - 1];
            const live = computeLiveScore(
              {
                conviction: meta.conviction,
                horizon: meta.horizon,
                generated_at: meta.generated_at,
                signal_breakdown: meta.signal_breakdown,
                outcome: (meta.outcome as TerminalVerdict) ?? null,
                latest_weighted_sentiment_alignment: latest?.weighted_sentiment_alignment ?? null,
                latest_supporting_vs_contradicting_ratio:
                  latest?.supporting_vs_contradicting_ratio ?? null,
                latest_confidence: latest?.confidence ?? null,
                latest_verdict:
                  latest?.verdict === "confirmed" || latest?.verdict === "invalidated"
                    ? latest.verdict
                    : null,
              },
              now,
            );
            computed.push({ id, live, generated_at: meta.generated_at });
          }
          setInternal(computed);
        }
      } catch (e) {
        console.error("VerdictEvolution load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [scored]);

  const dailySeries = useMemo<DailyPoint[]>(() => {
    if (thesesMeta.size === 0) return [];
    const days: DailyPoint[] = [];
    const now = new Date();
    for (let i = DAYS_BACK - 1; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 86_400_000);
      const dayIso = day.toISOString().slice(0, 10);
      let sum = 0;
      let n = 0;
      for (const [id, meta] of thesesMeta) {
        if (meta.generated_at && meta.generated_at > day.toISOString()) continue;
        const history = verdictHistory.get(id) ?? [];
        // Use the most recent verdict ≤ day.
        let latest: RawVerdictRow | undefined;
        for (const v of history) {
          if (v.graded_at <= day.toISOString()) latest = v;
          else break;
        }
        const live = computeLiveScore(
          {
            conviction: meta.conviction,
            horizon: meta.horizon,
            generated_at: meta.generated_at,
            signal_breakdown: meta.signal_breakdown,
            outcome: (meta.outcome as TerminalVerdict) ?? null,
            latest_weighted_sentiment_alignment: latest?.weighted_sentiment_alignment ?? null,
            latest_supporting_vs_contradicting_ratio:
              latest?.supporting_vs_contradicting_ratio ?? null,
            latest_confidence: latest?.confidence ?? null,
            latest_verdict:
              latest?.verdict === "confirmed" || latest?.verdict === "invalidated"
                ? latest.verdict
                : null,
          },
          day,
        );
        sum += live.score;
        n += 1;
      }
      days.push({
        day: dayIso,
        avgScore: n > 0 ? sum / n : 0,
        count: n,
      });
    }
    return days;
  }, [thesesMeta, verdictHistory]);

  const todayAvg = useMemo(() => {
    const universe = scored ?? internal;
    if (universe.length === 0) return null;
    return universe.reduce((acc, t) => acc + t.live.score, 0) / universe.length;
  }, [scored, internal]);

  const hasData = !loading && dailySeries.length > 0 && dailySeries.some((d) => d.count > 0);

  return (
    <div>
      <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
        Verdict Evolution
      </h2>
      {loading ? (
        <VerdictSkeletonChart />
      ) : !hasData ? (
        <InflightEmpty />
      ) : (
        <div className="bg-white rounded-xl border border-border-base p-4">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <div className="font-data text-[11px] uppercase tracking-widest text-text-muted">
                Avg live score · last {DAYS_BACK}d
              </div>
              <div className="font-data text-2xl font-bold text-espresso mt-0.5">
                {todayAvg !== null ? formatSignedScore(Math.round(todayAvg)) : "--"}
              </div>
            </div>
            <p className="font-sans text-[11px] text-text-muted inline-flex items-center gap-1.5">
              <Clock size={11} className="text-gold" />
              Next run 8:10 PM PT
            </p>
          </div>
          <Sparkline points={dailySeries} />
          <div className="flex items-center justify-between mt-2 font-data text-[10px] text-text-faint">
            <span>{dailySeries[0]?.day}</span>
            <span>today</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSignedScore(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function Sparkline({ points }: { points: DailyPoint[] }) {
  const w = 600;
  const h = 80;
  const pad = 6;
  if (points.length < 2) return null;

  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1));
  // Map score range [-100, 100] → y range [pad, h-pad] (inverted).
  const yFor = (score: number) => {
    const norm = (score + 100) / 200; // 0..1
    return pad + (1 - norm) * (h - 2 * pad);
  };
  const ys = points.map((p) => yFor(p.avgScore));
  const d = xs
    .map((x, i) => (i === 0 ? `M${x.toFixed(1)},${ys[i].toFixed(1)}` : `L${x.toFixed(1)},${ys[i].toFixed(1)}`))
    .join(" ");
  // Area fill under the curve.
  const baselineY = yFor(0);
  const area = `${d} L${xs[xs.length - 1].toFixed(1)},${baselineY.toFixed(1)} L${xs[0].toFixed(1)},${baselineY.toFixed(1)} Z`;
  const last = points[points.length - 1];
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];
  const positive = last.avgScore >= 0;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="overflow-visible"
      role="img"
      aria-label="Average live_score sparkline (last 30 days)"
    >
      <line
        x1={pad}
        x2={w - pad}
        y1={baselineY}
        y2={baselineY}
        className="stroke-border-base"
        strokeDasharray="2 3"
        strokeWidth={1}
      />
      <path
        d={area}
        className={positive ? "fill-signal-up/10" : "fill-signal-dn/10"}
      />
      <path
        d={d}
        fill="none"
        strokeWidth={1.75}
        className={positive ? "stroke-signal-up" : "stroke-signal-dn"}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={3.5}
        className={positive ? "fill-signal-up" : "fill-signal-dn"}
      />
    </svg>
  );
}

function VerdictSkeletonChart() {
  const heights = [60, 45, 72, 38, 55, 80, 30, 62, 48, 70, 42, 58];
  return (
    <div className="flex items-end gap-1.5 h-24 px-3 py-2 bg-white dark:bg-elevated rounded-lg border border-border-base">
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 skeleton-shimmer animate-pulse bg-parchment-mid rounded-t-sm"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function InflightEmpty() {
  return (
    <div className="relative flex items-center gap-3 bg-white dark:bg-elevated rounded-xl border border-border-base p-5 overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold rounded-l-xl" />
      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
        <Activity size={13} className="text-gold" />
      </div>
      <span className="font-sans text-[12.5px] text-text-primary leading-snug">
        Live scores will appear after the first nightly grading run at 8:10 PM PT.
      </span>
    </div>
  );
}

export default VerdictEvolution;
