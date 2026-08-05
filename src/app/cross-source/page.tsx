"use client";

/**
 * /cross-source - Stage 1 cross-source OBSERVATION.
 *
 * Two panels, both read-only:
 *   1. Source reliability (Part 1) from the clean price-attribution grader,
 *      with the sample count front and centre and NO rate shown below the bar.
 *   2. Cross-source clusters (Part 2): lead/echo ordering and structural figure
 *      observations.
 *
 * This page makes no accuracy claim about any source and nothing here feeds
 * generation. Failed reads render as errors, never as "nothing here".
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell";
import { AlertTriangle, Clock, Info, RefreshCw, Radio } from "lucide-react";

interface SourceRow {
  identity: string;
  n_clean_outcomes: number;
  n_correct: number;
  n_wrong: number;
  credit_weight: number | null;
  distinct_symbols: number;
  accuracy: number | null;
  wilson_lower_95: number | null;
  confidence: string;
  is_syndicator: boolean;
  ready_for_weighting: boolean;
  attribution_method: string;
  last_outcome_at: string | null;
}

interface ClusterMember {
  article_id: string;
  identity: string;
  publisher: string | null;
  source: string | null;
  title: string | null;
  published_at: string | null;
  role: string;
  rank: number;
  lag_minutes: number | null;
  is_syndicator: boolean;
  timestamp_basis: string;
}

interface FigureFinding {
  kind: string;
  figure_kind: string;
  detail: string;
  members: { id: string; label: string; figures: { raw: string }[] }[];
}

interface ClusterRow {
  cluster_key: string;
  base_key: string;
  article_count: number;
  distinct_identities: number;
  distinct_non_syndicators: number;
  tied_lead: boolean;
  lead_identity: string | null;
  window_start: string | null;
  members: ClusterMember[];
  figure_findings: FigureFinding[];
}

interface FetchError {
  error: string;
  reason?: string;
  code?: string | null;
  detail?: string;
  hint?: string | null;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  insufficient: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30",
  low: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  moderate: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-xs text-sky-200/90">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function ErrorPanel({ err, label }: { err: FetchError; label: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3"
      data-testid={`${label}-error`}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-red-300">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {err.error}
      </div>
      {err.detail ? (
        <p className="mt-1 font-mono text-xs text-red-300/70">
          {err.code ? `[${err.code}] ` : ""}
          {err.detail}
        </p>
      ) : null}
      {err.hint ? <p className="mt-2 text-xs text-red-200/80">{err.hint}</p> : null}
      <p className="mt-2 text-xs text-red-200/60">
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
    </div>
  );
}

function formatLag(minutes: number | null): string {
  if (minutes === null) return "unknown";
  if (minutes < 1) return "same minute";
  if (minutes < 60) return `+${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `+${hours.toFixed(1)}h`;
  return `+${(hours / 24).toFixed(1)}d`;
}

export default function CrossSourcePage() {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [sourceErr, setSourceErr] = useState<FetchError | null>(null);
  const [clusters, setClusters] = useState<ClusterRow[] | null>(null);
  const [clusterErr, setClusterErr] = useState<FetchError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportableMinN, setReportableMinN] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setSourceErr(null);
    setClusterErr(null);

    const [sRes, cRes] = await Promise.allSettled([
      fetch("/api/source-reliability", { cache: "no-store" }),
      fetch("/api/cross-source?limit=25", { cache: "no-store" }),
    ]);

    if (sRes.status === "fulfilled") {
      const body = await sRes.value.json().catch(() => null);
      if (!sRes.value.ok || !body) {
        setSources(null);
        setSourceErr(body ?? { error: "source-reliability request failed" });
      } else {
        setSources(body.sources ?? []);
        if (typeof body.reportable_min_n === "number") {
          setReportableMinN(body.reportable_min_n);
        }
      }
    } else {
      setSources(null);
      setSourceErr({ error: "source-reliability request failed", detail: String(sRes.reason) });
    }

    if (cRes.status === "fulfilled") {
      const body = await cRes.value.json().catch(() => null);
      if (!cRes.value.ok || !body) {
        setClusters(null);
        setClusterErr(body ?? { error: "cross-source request failed" });
      } else {
        setClusters(body.clusters ?? []);
      }
    } else {
      setClusters(null);
      setClusterErr({ error: "cross-source request failed", detail: String(cRes.reason) });
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell pageTitle="Cross-source">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6" data-testid="cross-source-page">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-sky-400" aria-hidden />
              <h1 className="text-xl font-semibold text-neutral-100">Cross-source observation</h1>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </button>
          </div>
          <Banner>
            <strong>Observation only.</strong> Nothing on this page claims a source
            was right or wrong about an event. Figure differences are flagged for a
            human to look at, and two figures in one cluster may simply be
            different quantities. Accuracy resolves later against catalysts. None
            of this is wired into generation.
          </Banner>
        </header>

        <section className="space-y-3" data-testid="source-reliability-panel">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Source reliability
            </h2>
            <span className="text-xs text-neutral-500">
              clean benchmark-attributed outcomes only
            </span>
          </div>
          <Banner>
            Derived from the price-attribution grader: a call counts only when the
            named entity moved beyond <em>both</em> its sector ETF and SPY in the
            predicted direction. Rates are withheld below{" "}
            <strong>n = {reportableMinN}</strong>, so a source with two outcomes
            shows its counts and no percentage. Attribution is brief-level
            fan-out, not clean single-source attribution.
          </Banner>

          {sourceErr ? (
            <ErrorPanel err={sourceErr} label="source-reliability" />
          ) : loading && sources === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : sources && sources.length === 0 ? (
            <p
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-400"
              data-testid="source-reliability-empty"
            >
              Table is present and reachable, but holds no rows yet. Run{" "}
              <code className="text-neutral-300">backend/source_reliability.py</code>{" "}
              to populate it.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">Clean outcomes</th>
                    <th className="px-3 py-2 text-right font-medium">Right / wrong</th>
                    <th className="px-3 py-2 text-right font-medium">Accuracy</th>
                    <th className="px-3 py-2 text-right font-medium">Wilson 95% low</th>
                    <th className="px-3 py-2 text-left font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(sources ?? []).map((s) => (
                    <tr key={s.identity} className="border-t border-neutral-800/70">
                      <td className="px-3 py-2 text-neutral-200">
                        {s.identity}
                        {s.is_syndicator ? (
                          <span
                            className="ml-2 rounded border border-neutral-600 px-1 py-0.5 text-[10px] uppercase text-neutral-400"
                            title="Redistributes other outlets' reporting. Not a quality judgment."
                          >
                            syndicator
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-300">
                        {s.n_clean_outcomes}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-400">
                        {s.n_correct} / {s.n_wrong}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-300">
                        {s.accuracy === null ? (
                          <span
                            className="text-neutral-500"
                            title={`Withheld below n = ${reportableMinN}. Too few outcomes to report a rate.`}
                          >
                            n/a
                          </span>
                        ) : (
                          `${(s.accuracy * 100).toFixed(0)}%`
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-300">
                        {s.wilson_lower_95 === null
                          ? <span className="text-neutral-500">n/a</span>
                          : `${(s.wilson_lower_95 * 100).toFixed(0)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${
                            CONFIDENCE_STYLES[s.confidence] ?? CONFIDENCE_STYLES.insufficient
                          }`}
                        >
                          {s.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3" data-testid="cross-source-panel">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Same-event clusters
            </h2>
            <span className="text-xs text-neutral-500">lead vs echo</span>
          </div>
          <Banner>
            <strong>&ldquo;Lead&rdquo; means first seen in our feeds</strong>, not
            &ldquo;broke the story&rdquo;. We poll on a schedule, Google News adds
            its own indexing lag, and some publishers timestamp only to the minute.
            When two items share the earliest timestamp no lead is named.
          </Banner>

          {clusterErr ? (
            <ErrorPanel err={clusterErr} label="cross-source" />
          ) : loading && clusters === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : clusters && clusters.length === 0 ? (
            <p
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-400"
              data-testid="cross-source-empty"
            >
              Table is present and reachable, but holds no clusters yet. Run{" "}
              <code className="text-neutral-300">backend/cross_source.py</code> to
              populate it.
            </p>
          ) : (
            <ul className="space-y-3">
              {(clusters ?? []).map((c) => (
                <li
                  key={c.cluster_key}
                  className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-neutral-400">{c.base_key}</span>
                    <span className="text-xs text-neutral-500">
                      {c.distinct_identities} outlets · {c.distinct_non_syndicators}{" "}
                      non-syndicator · {c.article_count} items
                    </span>
                  </div>

                  <ol className="mt-3 space-y-1.5">
                    {c.members.map((m) => (
                      <li key={m.article_id} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                            m.role === "lead"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : m.role === "lead_tied"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-neutral-700/40 text-neutral-400"
                          }`}
                        >
                          {m.role === "lead_tied" ? "tied" : m.role}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-500">
                          <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                          {formatLag(m.lag_minutes)}
                        </span>
                        <span className="min-w-0">
                          <span className="text-neutral-200">{m.identity}</span>
                          {m.is_syndicator ? (
                            <span className="ml-1.5 text-[10px] uppercase text-neutral-500">
                              syndicator
                            </span>
                          ) : null}
                          {m.timestamp_basis !== "published_at" ? (
                            <span
                              className="ml-1.5 text-[10px] uppercase text-amber-500/70"
                              title="No publish timestamp; ordered on ingest time instead."
                            >
                              ingest-time
                            </span>
                          ) : null}
                          <span className="ml-2 text-neutral-500">{m.title}</span>
                        </span>
                      </li>
                    ))}
                  </ol>

                  {c.figure_findings.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-neutral-800 pt-3">
                      {c.figure_findings.map((f, i) => (
                        <p key={i} className="text-xs text-neutral-400">
                          <span className="mr-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
                            {f.kind}
                          </span>
                          {f.detail}{" "}
                          <span className="font-mono text-neutral-500">
                            {f.members
                              .map(
                                (m) =>
                                  `${m.label}: ${m.figures.map((x) => x.raw).join(", ")}`,
                              )
                              .join("  |  ")}
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
