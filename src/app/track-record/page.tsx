"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { getSectorStyle } from "@/lib/sector-colors";
import { EmptyState } from "@/components/ui/empty-state";
import { VerdictEvolution } from "@/components/track-record/verdict-evolution";

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
  const [gradedTheses, setGradedTheses] = useState<GradedThesis[]>([]);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);
  const [nextCheckAfter, setNextCheckAfter] = useState<string | null>(null);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();

      try {
        const nowIso = new Date().toISOString();
        const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

        // All queries in parallel
        const [
          totalRes,
          confirmedRes,
          invalidatedRes,
          gradedRes,
          patternsRes,
          sourcesRes,
          verdictsRes,
          lastUpdatedRes,
          nextCheckRes,
          overdueWithCheckRes,
          overdueNullCheckRes,
        ] = await Promise.all([
          supabase.from("theses").select("id", { count: "exact", head: true }),
          supabase.from("theses").select("id", { count: "exact", head: true }).eq("outcome", "confirmed"),
          supabase.from("theses").select("id", { count: "exact", head: true }).eq("outcome", "invalidated"),
          supabase.from("theses").select("sector, outcome, adversarial_score").not("outcome", "is", null),
          supabase.from("pattern_library").select("sector, horizon, dominant_signal, win_rate, n_observed, n_confirmed").gte("n_observed", 3).order("win_rate", { ascending: false }).limit(5),
          supabase.from("source_credibility").select("source, win_rate, n_theses").order("win_rate", { ascending: false }).limit(10),
          supabase.from("theses").select("id, title, sector, outcome, outcome_notes, updated_at, ticker").not("outcome", "is", null).order("updated_at", { ascending: false }).limit(10),
          supabase.from("theses").select("updated_at").not("outcome", "is", null).order("updated_at", { ascending: false }).limit(1),
          supabase.from("theses").select("check_after").is("outcome", null).not("check_after", "is", null).order("check_after", { ascending: true }).limit(1),
          supabase.from("theses").select("id", { count: "exact", head: true }).is("outcome", null).lt("check_after", nowIso),
          supabase.from("theses").select("id", { count: "exact", head: true }).is("outcome", null).is("check_after", null).lt("generated_at", thirtyDaysAgoIso),
        ]);

        setTotalCount(totalRes.count ?? 0);
        setConfirmedCount(confirmedRes.count ?? 0);
        setInvalidatedCount(invalidatedRes.count ?? 0);
        setGradedTheses((gradedRes.data as GradedThesis[]) ?? []);
        setPatterns((patternsRes.data as PatternRow[]) ?? []);
        setSources((sourcesRes.data as SourceRow[]) ?? []);
        setVerdicts((verdictsRes.data as VerdictRow[]) ?? []);

        if (lastUpdatedRes.data && lastUpdatedRes.data.length > 0) {
          setLastUpdated(lastUpdatedRes.data[0].updated_at);
        }

        if (nextCheckRes.data && nextCheckRes.data.length > 0) {
          setNextCheckAfter((nextCheckRes.data[0] as { check_after: string | null }).check_after ?? null);
        } else {
          setNextCheckAfter(null);
        }

        setOverdueCount((overdueWithCheckRes.count ?? 0) + (overdueNullCheckRes.count ?? 0));
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

  const formattedNextCheckAfter = useMemo(() => {
    if (!nextCheckAfter) return null;
    try {
      return new Date(nextCheckAfter).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [nextCheckAfter]);

  const showPipelineStatus =
    !loading && totalCount > 0 && confirmedCount === 0 && invalidatedCount === 0;
  const awaitingCount = totalCount - confirmedCount - invalidatedCount;

  const MIN_ROWS = 3;

  return (
    <AppShell pageTitle="Track Record">
      <div className="p-6 space-y-6 max-w-[960px]">
        {/* HEADER */}
        <div>
          <h1 className="font-display text-[28px] font-bold text-espresso leading-tight">
            Signal Track Record
          </h1>
          <p className="font-sans text-[13px] text-text-secondary mt-1">
            How Signalera&apos;s thesis intelligence performs over time.
          </p>
          {formattedLastUpdated && (
            <p className="font-data text-text-faint text-[11px] mt-1">
              Last updated: {formattedLastUpdated}
            </p>
          )}
          {showPipelineStatus && (
            <>
              <p className="font-data text-text-faint text-[11px] mt-1">
                {awaitingCount} {awaitingCount === 1 ? "thesis" : "theses"} awaiting grading
                {overdueCount > 0 ? ` \u00B7 ${overdueCount} overdue` : ""}
              </p>
              <p className="font-data text-text-faint text-[11px] mt-1">
                {formattedNextCheckAfter
                  ? `Next check: ${formattedNextCheckAfter}`
                  : "No thesis has a scheduled grading date yet"}
              </p>
            </>
          )}
        </div>

        {!loading && confirmedCount === 0 && invalidatedCount === 0 ? (
          <div className="py-16">
            <EmptyState
              icon={<Trophy size={32} />}
              title="Track record building"
              description="Thesis outcomes will appear here once the grading pipeline has run. Check back after your first theses are confirmed or invalidated."
            />
          </div>
        ) : (
        <>
        {/* SUMMARY STATS */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Theses" value={String(totalCount)} loading={loading} />
          <StatCard label="Confirmed" value={String(confirmedCount)} loading={loading} />
          <StatCard label="Invalidated" value={String(invalidatedCount)} loading={loading} />
          <StatCard
            label="Confirmation Rate"
            value={confirmationRate !== null ? `${confirmationRate}%` : "--"}
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
                      className={`border-b border-border-base last:border-b-0 ${i === 0 ? "bg-gold/5" : ""}`}
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
                              className="h-full rounded-full bg-gold"
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
                        className="h-full rounded-full bg-gold"
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
                  className="block bg-white rounded-xl border border-border-base p-3 hover:border-gold/40 transition-colors"
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
  gold,
  loading,
}: {
  label: string;
  value: string;
  gold?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-border-base p-4">
      <div className="font-sans text-[10px] uppercase tracking-widest text-text-muted mb-1">
        {label}
      </div>
      {loading ? (
        <div className="h-8 w-16 rounded bg-parchment-mid animate-pulse" />
      ) : (
        <div className={`font-data text-2xl font-bold ${gold ? "text-gold" : "text-espresso"}`}>
          {value}
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
    <div className="flex items-center gap-2 bg-white rounded-xl border border-border-base p-4">
      <span className="w-2 h-2 rounded-full bg-signal-warn animate-pulse flex-shrink-0" />
      <span className="font-sans text-[12px] text-text-secondary">
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
