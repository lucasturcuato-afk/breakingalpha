"use client";

/**
 * BriefCallsSection — renders a brief's predictive calls as ScoredObjects,
 * resolved against REAL grader outcomes.
 *
 * Data is real end to end: calls come from morning_brief_calls and verdicts
 * from morning_brief_call_outcomes (both public-readable), written by the
 * attribution grader. A call renders a resolved state ONLY when a real
 * outcome row exists; otherwise it is Open (window still live) or an honest
 * "Not graded" (window closed, no credible grade). No verdict is ever
 * fabricated, and the stored LLM confidence is never rendered.
 *
 * Fail-soft on the outcomes read: if the outcomes query errors, calls fall
 * back to the Open state (the least-claiming state) rather than guessing
 * about expiry or verdicts, and the surrounding brief never breaks.
 */

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  openCallProps,
  scoredCallProps,
  type CallOutcomeRow,
} from "@/lib/scored-object-map";

interface BriefCall {
  id: string;
  claim_text: string;
  target_symbol: string | null;
  claim_type: string | null;
  confidence: number | null;
  created_at: string | null;
  brief_date: string | null;
}

type LoadState = "loading" | "loaded" | "error";

export default function BriefCallsSection({
  briefId,
  briefDate,
  heading = "Today's Calls",
}: {
  /** Match calls by their brief_id (morning brief). Takes precedence. */
  briefId?: string | null;
  /** Match calls by brief_date (YYYY-MM-DD) — used on the evening wrap, whose own
   *  briefing id differs from the morning brief that owns the calls. */
  briefDate?: string | null;
  heading?: string;
}) {
  const [calls, setCalls] = useState<BriefCall[]>([]);
  // null = outcomes unavailable (query failed): render Open, claim nothing.
  const [outcomes, setOutcomes] = useState<Map<string, CallOutcomeRow> | null>(null);
  const [todayPt, setTodayPt] = useState<string>("");
  const [status, setStatus] = useState<LoadState>("loading");

  useEffect(() => {
    if (!briefId && !briefDate) {
      setStatus("loaded");
      setCalls([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        let q = sb
          .from("morning_brief_calls")
          .select("id, claim_text, target_symbol, claim_type, confidence, created_at, brief_date");
        q = briefId ? q.eq("brief_id", briefId) : q.eq("brief_date", briefDate as string);
        const { data, error } = await q.order("confidence", { ascending: false });
        if (cancelled) return;
        if (error) {
          setStatus("error");
          return;
        }
        const rows = (data as BriefCall[] | null) ?? [];
        setCalls(rows);
        // Session date for the open-vs-window-closed distinction only.
        setTodayPt(
          new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
        );

        if (rows.length > 0) {
          const { data: outcomeData, error: outcomeError } = await sb
            .from("morning_brief_call_outcomes")
            .select(
              "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
            )
            .in("call_id", rows.map((r) => r.id));
          if (cancelled) return;
          if (outcomeError) {
            setOutcomes(null); // fall back to Open; never guess a verdict
          } else {
            // Latest row per call (no unique constraint on call_id in the DB).
            const byCall = new Map<string, CallOutcomeRow>();
            for (const o of (outcomeData as CallOutcomeRow[] | null) ?? []) {
              const prev = byCall.get(o.call_id);
              if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) {
                byCall.set(o.call_id, o);
              }
            }
            setOutcomes(byCall);
          }
        } else {
          setOutcomes(new Map());
        }
        setStatus("loaded");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [briefId, briefDate]);

  // Loading: render nothing (the brief around it stays intact).
  if (status === "loading") return null;

  return (
    <section>
      <h2 className="font-display text-[15px] font-semibold text-text-primary leading-snug">
        {heading}
      </h2>
      <p className="font-sans text-[12px] text-text-muted mt-0.5 mb-3">
        Predictions from this brief, captured before the outcome and scored
        against the market close with benchmark attribution.
      </p>

      {calls.length === 0 ? (
        // Honest pending/empty state — never faked to look complete.
        <div className="rounded-lg border border-border-subtle bg-elevated px-4 py-4">
          <p className="font-sans text-[13px] text-text-muted">
            {status === "error"
              ? "Calls are momentarily unavailable."
              : "No scored calls were captured for this brief yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {calls.map((c) => (
            <ScoredObject
              key={c.id}
              {...(outcomes && todayPt
                ? scoredCallProps(c, outcomes.get(c.id) ?? null, todayPt)
                : openCallProps(c))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
