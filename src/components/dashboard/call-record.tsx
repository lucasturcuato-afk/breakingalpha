"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";

/**
 * CallRecord — the "Your calls" track-record summary, wired to the real
 * call-grader outcomes in `morning_brief_call_outcomes` (public read).
 *
 * Honesty rule (mirrors src/app/radar/calls/page.tsx and scored-object-map):
 * only a CLEAN attribution with a correct/wrong verdict counts toward the
 * record. Confounded, inconclusive, and partial reads are bucketed as
 * "no clean read" and excluded from the hit rate. Rows with a null
 * attribution or an "ungradable" verdict are not yet graded and ignored.
 */

interface OutcomeRow {
  call_id: string;
  verdict: string;
  attribution: string | null;
  graded_at: string;
}

type Bar = "correct" | "wrong" | "neutral";

interface Record {
  right: number;
  wrong: number;
  noCleanRead: number;
  graded: number;
  hitRate: number | null;
  recent: Bar[];
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function CallRecord() {
  // null = loading, "empty" = no graded calls, Record = data
  const [record, setRecord] = useState<Record | null | "empty">(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from("morning_brief_call_outcomes")
          .select("call_id, verdict, attribution, graded_at")
          .order("graded_at", { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (error || !data || data.length === 0) {
          setRecord("empty");
          return;
        }

        // Keep only the latest outcome per call (rows arrive newest-first).
        const seen = new Set<string>();
        const latest: OutcomeRow[] = [];
        for (const r of data as OutcomeRow[]) {
          if (r.call_id && !seen.has(r.call_id)) {
            seen.add(r.call_id);
            latest.push(r);
          }
        }

        let right = 0;
        let wrong = 0;
        let noCleanRead = 0;
        const bars: Bar[] = [];
        for (const o of latest) {
          if (o.verdict === "ungradable" || o.attribution == null) continue; // not graded
          if (o.attribution !== "clean") {
            noCleanRead += 1;
            bars.push("neutral");
          } else if (o.verdict === "correct") {
            right += 1;
            bars.push("correct");
          } else if (o.verdict === "wrong") {
            wrong += 1;
            bars.push("wrong");
          } else {
            noCleanRead += 1; // partial + clean
            bars.push("neutral");
          }
        }

        const graded = right + wrong;
        if (graded === 0 && noCleanRead === 0) {
          setRecord("empty");
          return;
        }
        // `latest` is newest-first; take the most recent 12 and show oldest→newest.
        const recent = bars.slice(0, 12).reverse();
        setRecord({
          right,
          wrong,
          noCleanRead,
          graded,
          hitRate: graded > 0 ? right / graded : null,
          recent,
        });
      } catch {
        if (!cancelled) setRecord("empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (record === null) {
    return <div className="h-9 rounded-lg bg-parchment-mid/40 animate-pulse" />;
  }

  if (record === "empty") {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug">
        No graded calls yet. The record fills in as calls are graded.
      </p>
    );
  }

  const pct = record.hitRate != null ? Math.round(record.hitRate * 100) : null;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span className="font-data text-[22px] font-bold text-espresso tabular-nums leading-none">
          {pct != null ? `${pct}%` : "--"}
          <span className="font-data text-[11px] font-medium text-text-muted ml-1.5">right</span>
        </span>
        <span className="font-data text-[10px] text-text-faint tabular-nums mt-1.5">
          {record.right}W · {record.wrong}L
          {record.noCleanRead > 0 ? ` · ${record.noCleanRead} no clean read` : ""}
        </span>
      </div>
      <div className="flex items-end gap-[3px] h-7" aria-hidden="true">
        {record.recent.map((b, i) => (
          <span
            key={i}
            className={cn(
              "dash-bar w-2 rounded-[1px]",
              b === "correct"
                ? "bg-signal-up"
                : b === "wrong"
                  ? "bg-signal-dn"
                  : "bg-border-base",
            )}
            style={{ height: b === "neutral" ? "55%" : "100%", animationDelay: `${i * 45}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
