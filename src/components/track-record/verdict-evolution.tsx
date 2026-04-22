"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { getSectorStyle } from "@/lib/sector-colors";

type VerdictLabel = "confirmed" | "invalidated" | "inconclusive";

interface VerdictPoint {
  graded_at: string;
  confidence: number | null;
  verdict: VerdictLabel;
}

interface VerdictEvolutionRow {
  thesis_id: string;
  thesis_title: string;
  ticker: string | null;
  sector: string | null;
  verdicts: VerdictPoint[];
}

interface RawVerdictRow {
  thesis_id: string;
  graded_at: string;
  verdict: string;
  confidence: number | null;
}

interface ThesisMeta {
  id: string;
  title: string | null;
  ticker: string | null;
  sector: string | null;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function normalizeVerdict(v: string): VerdictLabel {
  if (v === "confirmed" || v === "invalidated" || v === "inconclusive") return v;
  return "inconclusive";
}

function VerdictSparkline({ verdicts }: { verdicts: VerdictPoint[] }) {
  const w = 120;
  const h = 40;
  const pad = 4;
  const denom = Math.max(1, verdicts.length - 1);
  const xs = verdicts.map((_, i) => pad + (i * (w - 2 * pad)) / denom);
  const ys = verdicts.map((v) => {
    const c = v.confidence ?? 0.5;
    const clamped = Math.max(0, Math.min(1, c));
    return pad + (1 - clamped) * (h - 2 * pad);
  });
  const d = xs
    .map((x, i) => (i === 0 ? `M${x.toFixed(2)},${ys[i].toFixed(2)}` : `L${x.toFixed(2)},${ys[i].toFixed(2)}`))
    .join(" ");

  const dotColorClass = (v: VerdictLabel) =>
    v === "confirmed"
      ? "fill-signal-up"
      : v === "invalidated"
      ? "fill-signal-dn"
      : "fill-signal-warn";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible"
      role="img"
      aria-label="verdict confidence over time"
    >
      <path d={d} fill="none" strokeWidth={1.5} className="stroke-gold" />
      {xs.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={ys[i]}
          r={3}
          className={dotColorClass(verdicts[i].verdict)}
        />
      ))}
    </svg>
  );
}

function OutcomeBadge({ verdict }: { verdict: VerdictLabel }) {
  const styles: Record<VerdictLabel, string> = {
    confirmed: "bg-signal-up/10 text-signal-up",
    invalidated: "bg-signal-dn/10 text-signal-dn",
    inconclusive: "bg-signal-warn/10 text-signal-warn",
  };
  const labels: Record<VerdictLabel, string> = {
    confirmed: "Confirmed",
    invalidated: "Invalidated",
    inconclusive: "Inconclusive",
  };
  return (
    <span
      className={`font-sans text-[9px] font-semibold px-1.5 py-0.5 rounded ${styles[verdict]}`}
    >
      {labels[verdict]}
    </span>
  );
}

function VerdictEvolutionPreCalibrationState() {
  return (
    <div className="space-y-2">
      <div className="h-20 rounded-xl bg-parchment-mid animate-pulse" />
      <p className="font-sans text-[12px] text-text-secondary leading-relaxed px-1">
        Confidence evolution appears once theses are re-graded over time.
        Next run: 8:10 PM PT daily.
      </p>
    </div>
  );
}

export function VerdictEvolution() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VerdictEvolutionRow[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const { data: rawVerdicts } = await supabase
          .from("thesis_verdicts")
          .select("thesis_id, graded_at, verdict, confidence")
          .order("graded_at", { ascending: true });

        const grouped = new Map<string, VerdictPoint[]>();
        for (const v of (rawVerdicts as RawVerdictRow[] | null) ?? []) {
          if (!v.thesis_id) continue;
          const arr = grouped.get(v.thesis_id) ?? [];
          arr.push({
            graded_at: v.graded_at,
            confidence: typeof v.confidence === "number" ? v.confidence : null,
            verdict: normalizeVerdict(v.verdict),
          });
          grouped.set(v.thesis_id, arr);
        }

        const multi = [...grouped.entries()].filter(([, a]) => a.length >= 2);
        if (multi.length === 0) {
          setRows([]);
          return;
        }

        const ids = multi.map(([id]) => id);
        const { data: titles } = await supabase
          .from("theses")
          .select("id, title, ticker, sector")
          .in("id", ids);

        const titleMap = new Map<string, ThesisMeta>();
        for (const t of (titles as ThesisMeta[] | null) ?? []) {
          titleMap.set(t.id, t);
        }

        const out: VerdictEvolutionRow[] = multi.map(([thesis_id, verdicts]) => {
          const meta = titleMap.get(thesis_id);
          return {
            thesis_id,
            thesis_title: meta?.title ?? "Untitled thesis",
            ticker: meta?.ticker ?? null,
            sector: meta?.sector ?? null,
            verdicts,
          };
        });
        out.sort((a, b) => {
          const la = a.verdicts[a.verdicts.length - 1]?.graded_at ?? "";
          const lb = b.verdicts[b.verdicts.length - 1]?.graded_at ?? "";
          return lb.localeCompare(la);
        });
        setRows(out);
      } catch (e) {
        console.error("VerdictEvolution load error:", e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const hasRows = useMemo(() => rows.length > 0, [rows]);

  return (
    <div>
      <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
        Verdict Evolution
      </h2>
      {loading ? (
        <div className="h-20 rounded-xl bg-parchment-mid animate-pulse" />
      ) : !hasRows ? (
        <VerdictEvolutionPreCalibrationState />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {rows.map((r) => {
            const latest = r.verdicts[r.verdicts.length - 1];
            return (
              <div
                key={r.thesis_id}
                className="bg-white rounded-xl border border-border-base p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-sans font-semibold text-[13px] text-espresso leading-snug">
                      {r.thesis_title}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {r.sector && (
                        <span
                          style={getSectorStyle(r.sector)}
                          className="font-sans text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
                        >
                          {r.sector}
                        </span>
                      )}
                      {r.ticker && (
                        <span className="font-data text-[9px] text-gold-dark bg-gold-muted px-1.5 py-0.5 rounded">
                          {r.ticker}
                        </span>
                      )}
                      <OutcomeBadge verdict={latest.verdict} />
                      <span className="font-data text-[10px] text-text-faint">
                        {r.verdicts.length} verdicts
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <VerdictSparkline verdicts={r.verdicts} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default VerdictEvolution;
