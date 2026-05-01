"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import Link from "next/link";
import { Trophy, Clock } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import { EmptyState } from "@/components/ui/empty-state";
import AnimatedNumber from "@/components/ui/animated-number";
import { VerdictEvolution } from "@/components/track-record/verdict-evolution";
import { useLiveMood } from "@/hooks/useLiveMood";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface GradedThesis {
  sector: string;
  outcome: string;
  adversarial_score: number | null;
}

interface RawVerdict {
  thesis_id: string;
  graded_at: string;
  verdict: string;
  confidence: number | null;
}

interface ThesisMeta {
  id: string;
  title: string | null;
  sector: string | null;
  ticker: string | null;
  adversarial_score: number | null;
  generated_at: string | null;
  check_after: string | null;
}

interface PatternRow {
  sector: string | null;
  horizon: string | null;
  dominant_signal: string | null;
  win_rate: number | null;
  n_observed: number | null;
  n_confirmed: number | null;
}

interface SourceRow {
  source: string | null;
  win_rate: number | null;
  n_theses: number | null;
}

interface VerdictRow {
  id: string;
  title: string;
  sector: string | null;
  outcome: string;
  outcome_notes: string | null;
  updated_at: string;
  ticker: string | null;
}

interface SectorGroup {
  sector: string;
  total: number;
  confirmed: number;
  invalidated: number;
  win_rate: number;
  avg_confidence: number;
}

export default function TrackRecordPage() {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [invalidatedCount, setInvalidatedCount] = useState(0);
  const [trackedCount, setTrackedCount] = useState(0);
  const [gradedTheses, setGradedTheses] = useState<GradedThesis[]>([]);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  // Banner mood comes from the shared SSOT hook so this page agrees with
  // the dashboard / live feed / etc. Without this, AppShell falls back to
  // MoodBar's hard-coded "VIX 14.2 / Markets steady / Neutral" defaults.
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();

      try {
        const nowIso = new Date().toISOString();
        const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

        // thesis_verdicts is the authoritative source of truth for graded outcomes.
        // theses.outcome is a nullable mirror that can lag or be empty even when
        // verdicts exist (see PR #118). Derive all counts + lists from thesis_verdicts.
        const [
          totalRes,
          verdictsAllRes,
          thesesMetaRes,
          patternsRes,
          sourcesRes,
        ] = await Promise.all([
          supabase.from("theses").select("id", { count: "exact", head: true }),
          supabase
            .from("thesis_verdicts")
            .select("thesis_id, graded_at, verdict, confidence")
            .order("graded_at", { ascending: false }),
          supabase
            .from("theses")
            .select("id, title, sector, ticker, adversarial_score, generated_at, check_after"),
          supabase.from("pattern_library").select("sector, horizon, dominant_signal, win_rate, n_observed, n_confirmed").gte("n_observed", 3).order("win_rate", { ascending: false }).limit(5),
          supabase.from("source_credibility").select("source, win_rate, n_theses").order("win_rate", { ascending: false }).limit(10),
        ]);

        const rawVerdicts = (verdictsAllRes.data as RawVerdict[] | null) ?? [];
        const thesesMeta = (thesesMetaRes.data as ThesisMeta[] | null) ?? [];
        const thesesById = new Map<string, ThesisMeta>();
        for (const t of thesesMeta) thesesById.set(t.id, t);

        // Latest verdict per thesis (rawVerdicts is sorted graded_at desc, so first wins)
        const latestVerdictByThesis = new Map<string, RawVerdict>();
        for (const v of rawVerdicts) {
          if (!v.thesis_id) continue;
          if (!latestVerdictByThesis.has(v.thesis_id)) {
            latestVerdictByThesis.set(v.thesis_id, v);
          }
        }

        // Build derived state from verdicts+meta
        const derivedGraded: GradedThesis[] = [];
        const derivedRecent: VerdictRow[] = [];
        let confirmed = 0;
        let invalidated = 0;

        for (const [thesisId, v] of latestVerdictByThesis) {
          const meta = thesesById.get(thesisId);
          const outcome = v.verdict || "inconclusive";
          if (outcome === "confirmed") confirmed += 1;
          if (outcome === "invalidated") invalidated += 1;
          derivedGraded.push({
            sector: meta?.sector ?? "Unknown",
            outcome,
            adversarial_score: meta?.adversarial_score ?? null,
          });
          derivedRecent.push({
            id: thesisId,
            title: meta?.title ?? "Untitled thesis",
            sector: meta?.sector ?? null,
            outcome,
            outcome_notes: null,
            updated_at: v.graded_at,
            ticker: meta?.ticker ?? null,
          });
        }

        // Sort Recent Verdicts by graded_at desc and keep top 10
        derivedRecent.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

        // Pending/overdue derived from thesis metadata: "not yet graded" = no entry in
        // latestVerdictByThesis. Walk thesesMeta client-side.
        const gradedIds = new Set(latestVerdictByThesis.keys());
        let overdue = 0;
        for (const t of thesesMeta) {
          if (gradedIds.has(t.id)) continue;
          if (t.check_after && t.check_after < nowIso) {
            overdue += 1;
          } else if (!t.check_after && t.generated_at && t.generated_at < thirtyDaysAgoIso) {
            overdue += 1;
          }
        }

        setTotalCount(totalRes.count ?? 0);
        setConfirmedCount(confirmed);
        setInvalidatedCount(invalidated);
        setTrackedCount(latestVerdictByThesis.size);
        setGradedTheses(derivedGraded);
        setVerdicts(derivedRecent.slice(0, 10));
        setPatterns((patternsRes.data as PatternRow[]) ?? []);
        setSources((sourcesRes.data as SourceRow[]) ?? []);
        setLastUpdated(rawVerdicts[0]?.graded_at ?? null);
        setOverdueCount(overdue);
      } catch (e) {
        console.error("Track record load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const confirmationRate = useMemo(() => {
    const denom = confirmedCount + invalidatedCount;
    if (denom === 0) return null;
    return Math.round((confirmedCount / denom) * 100);
  }, [confirmedCount, invalidatedCount]);

  const sectorGroups = useMemo(() => {
    const map: Record<string, { total: number; confirmed: number; invalidated: number; scores: number[] }> = {};
    for (const t of gradedTheses) {
      const s = t.sector || "Unknown";
      if (!map[s]) map[s] = { total: 0, confirmed: 0, invalidated: 0, scores: [] };
      map[s].total++;
      if (t.outcome === "confirmed") map[s].confirmed++;
      if (t.outcome === "invalidated") map[s].invalidated++;
      if (typeof t.adversarial_score === "number" && t.adversarial_score >= 0) {
        map[s].scores.push(t.adversarial_score);
      }
    }
    const groups: SectorGroup[] = Object.entries(map).map(([sector, d]) => {
      const denom = d.confirmed + d.invalidated;
      return {
        sector,
        total: d.total,
        confirmed: d.confirmed,
        invalidated: d.invalidated,
        win_rate: denom > 0 ? Math.round((d.confirmed / denom) * 100) : 0,
        avg_confidence: d.scores.length > 0 ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0,
      };
    });
    groups.sort((a, b) => b.win_rate - a.win_rate);
    return groups;
  }, [gradedTheses]);

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

  // Next grading run = next 8:10 PM in America/Los_Angeles. The grader is a daily
  // cron; per-thesis theses.check_after values can point far in the future for
  // inconclusive verdicts and are not meaningful for "when does the pipeline run
  // next." Compute purely from the clock.
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

  // "Awaiting grading" = distinct theses that have never received a verdict.
  // A thesis with any verdict (including "inconclusive") counts as tracked.
  const awaitingCount = Math.max(0, totalCount - trackedCount);
  const showPipelineStatus = !loading && awaitingCount > 0;
  const showGradingHeader = !loading && trackedCount > 0;

  const MIN_ROWS = 3;

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
                <span className="font-semibold text-text-primary">{trackedCount}</span>{" "}
                {trackedCount === 1 ? "thesis" : "theses"} tracked
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
                  {awaitingCount === 1 ? "thesis" : "theses"} awaiting grading
                  {overdueCount > 0 ? ` \u00B7 ${overdueCount} overdue` : ""}
                </span>
                <span className="text-text-muted">|</span>
                <span className="font-sans text-[11px] text-text-muted">
                  Next check: {formattedNextRun}
                </span>
              </div>
            </div>
          )}
        </div>

        {!loading && gradedTheses.length === 0 ? (
          <div className="relative rounded-2xl bg-gradient-to-b from-gold-muted/40 to-transparent border border-gold-border/60">
            <EmptyState
              icon={<Trophy size={32} />}
              title="Track record calibrating"
              description="Thesis outcomes will appear here once the grading pipeline has run. Grading runs nightly at 8:10 PM PT."
            />
          </div>
        ) : (
        <>
        {/* SUMMARY STATS */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Theses" value={totalCount} loading={loading} />
          <StatCard label="Confirmed" value={confirmedCount} loading={loading} />
          <StatCard label="Invalidated" value={invalidatedCount} loading={loading} />
          <StatCard
            label="Confirmation Rate"
            value={confirmationRate}
            suffix="%"
            placeholder="--"
            gold
            loading={loading}
          />
        </div>

        {/* SECTOR PERFORMANCE TABLE */}
        <Section title="Sector Performance">
          {sectorGroups.length < MIN_ROWS ? (
            <EmptyBuildingState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-sans text-[12px]">
                <thead>
                  <tr className="border-b border-border-base">
                    {["Sector", "Theses", "Confirmed", "Invalidated", "Win Rate", "Avg Confidence"].map((h) => (
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
                      <td className="py-2 px-2 font-data">{g.confirmed}</td>
                      <td className="py-2 px-2 font-data">{g.invalidated}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <span className="font-data font-semibold">{g.win_rate}%</span>
                          <div className="flex-1 h-1.5 rounded-full bg-gold/20 max-w-[80px]">
                            <div
                              className="bar-sweep-in h-full rounded-full bg-gold"
                              style={{ width: `${g.win_rate}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2 font-data">
                        {g.avg_confidence > 0 ? g.avg_confidence.toFixed(2) : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* VERDICT EVOLUTION */}
        <VerdictEvolution />

        {/* PATTERN LIBRARY */}
        <Section title="What&apos;s Been Working">
          {patterns.length < MIN_ROWS ? (
            <EmptyBuildingState />
          ) : (
            <div className="grid gap-2">
              {patterns.map((p, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-border-base p-3"
                >
                  <div className="font-sans font-semibold text-espresso text-[13px]">
                    {p.sector || "Unknown"}
                  </div>
                  <div className="font-sans text-[12px] text-text-secondary mt-0.5">
                    {p.horizon || "Any horizon"} &middot;{" "}
                    <span className="font-data text-gold font-semibold">
                      {p.win_rate !== null ? `${Math.round(p.win_rate * 100)}%` : "--"} confirm rate
                    </span>{" "}
                    &middot; {p.n_observed ?? 0} samples
                  </div>
                  {p.dominant_signal && (
                    <div className="font-sans text-[11px] text-text-muted mt-0.5">
                      Dominant signal: {p.dominant_signal}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* SOURCE CREDIBILITY */}
        <Section title="Most Reliable Sources">
          {sources.length < MIN_ROWS ? (
            <EmptyBuildingState />
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
                        style={{ width: `${s.win_rate !== null ? Math.round(s.win_rate * 100) : 0}%` }}
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

        {/* RECENT VERDICTS */}
        <Section title="Recent Verdicts">
          {verdicts.length < MIN_ROWS ? (
            <EmptyBuildingState />
          ) : (
            <div className="grid gap-2">
              {verdicts.map((v) => (
                <Link
                  key={v.id}
                  href={`/thesis-board?thesis=${v.id}`}
                  className="card-hover-lift block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-sans font-semibold text-[13px] text-espresso leading-snug">
                        {v.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {v.sector && (
                          <span
                            style={getSectorStyle(v.sector)}
                            className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                          >
                            {v.sector}
                          </span>
                        )}
                        <OutcomeBadge outcome={v.outcome} />
                        {v.ticker && (
                          <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
                            {v.ticker}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-data text-[10px] text-text-faint flex-shrink-0 mt-0.5">
                      {formatDate(v.updated_at)}
                    </span>
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
  placeholder = "--",
  gold,
  loading,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  placeholder?: string;
  gold?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="card-hover-lift bg-white rounded-xl border border-border-base p-4">
      <div className="font-sans text-[10px] uppercase tracking-widest text-text-muted mb-1">
        {label}
      </div>
      {loading ? (
        <div className="skeleton-shimmer h-8 w-16 rounded" />
      ) : value === null ? (
        <div className={`font-data text-2xl font-bold ${gold ? "text-gold" : "text-espresso"}`}>
          {placeholder}
        </div>
      ) : (
        <div className={`font-data text-2xl font-bold ${gold ? "text-gold" : "text-espresso"}`}>
          <AnimatedNumber
            value={value}
            format={(n) => `${Math.round(n)}${suffix ?? ""}`}
          />
        </div>
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

function OutcomeBadge({ outcome }: { outcome: string }) {
  const styles: Record<string, string> = {
    confirmed: "bg-signal-up/10 text-signal-up",
    invalidated: "bg-signal-dn/10 text-signal-dn",
    inconclusive: "bg-signal-warn/10 text-signal-warn",
  };
  const labels: Record<string, string> = {
    confirmed: "Confirmed",
    invalidated: "Invalidated",
    inconclusive: "Inconclusive",
  };
  return (
    <span className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${styles[outcome] || styles.inconclusive}`}>
      {labels[outcome] || outcome}
    </span>
  );
}

function EmptyBuildingState() {
  return (
    <div className="relative flex items-center gap-3 bg-white dark:bg-elevated rounded-xl border border-border-base p-5 overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold rounded-l-xl" />
      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
        <span className="track-record-pending-dot w-1.5 h-1.5 rounded-full bg-gold" />
        <Clock size={13} className="text-gold" />
      </div>
      <span className="font-sans text-[12.5px] text-text-primary leading-snug">
        Building track record &mdash; check back after more theses are graded.
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
