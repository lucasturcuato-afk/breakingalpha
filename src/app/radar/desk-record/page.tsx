"use client";

/**
 * Radar / Desk record - how Signalera's own morning-brief calls resolved.
 *
 * Distinct from the "Record" hero on /radar/calls, which is the USER's record
 * of their own claims. This page is the desk's record: every predictive call
 * the morning brief published, graded against real price benchmarks by
 * backend/grading and stored in morning_brief_call_outcomes.
 *
 * READ ONLY. Two selects, no writes, no schema dependency beyond the columns
 * the brief surfaces already read. Both tables are public-readable.
 *
 * FAIL OPEN: if either query errors the page renders the honest error panel;
 * if the join is empty it renders the empty state. It never estimates, never
 * partially counts, and never renders a broken surface.
 */

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import { DeskRecordView } from "@/components/record/DeskRecordView";
import { buildDeskRecord, type DeskCallRow, type DeskRecord } from "@/lib/desk-record.ts";
import type { CallOutcomeRow } from "@/lib/scored-object-map";

/** Newest graded calls. Generous enough to hold the whole record today while
 *  still bounding the read; the counts are over exactly what is fetched, and
 *  the window label on the page states the span covered. */
const OUTCOME_LIMIT = 500;
/** How many resolved calls the list renders. Counts always cover all rows. */
const LIST_LIMIT = 40;

interface BriefCallRow {
  id: string;
  claim_text: string;
  claim_type: string | null;
  target_symbol: string | null;
  brief_date: string | null;
  created_at: string | null;
  confidence: number | null;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Today's US-Pacific session date. Used only for the live-window check. */
function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export default function DeskRecordPage() {
  const [record, setRecord] = useState<DeskRecord | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabase();

        const { data: outcomeData, error: outcomeError } = await supabase
          .from("morning_brief_call_outcomes")
          .select(
            "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
          )
          .order("graded_at", { ascending: false })
          .limit(OUTCOME_LIMIT);
        if (cancelled) return;
        if (outcomeError) {
          setStatus("error");
          return;
        }

        // Latest outcome per call (no unique constraint on call_id in the DB).
        const byCall = new Map<string, CallOutcomeRow>();
        for (const o of (outcomeData as CallOutcomeRow[] | null) ?? []) {
          const prev = byCall.get(o.call_id);
          if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) byCall.set(o.call_id, o);
        }

        if (byCall.size === 0) {
          setRecord(buildDeskRecord([], todayPt(), LIST_LIMIT));
          setStatus("ready");
          return;
        }

        const { data: callData, error: callError } = await supabase
          .from("morning_brief_calls")
          .select("id, claim_text, claim_type, target_symbol, brief_date, created_at, confidence")
          .in("id", [...byCall.keys()]);
        if (cancelled) return;
        if (callError) {
          setStatus("error");
          return;
        }

        // Only calls whose text we actually have. A grade with no claim behind
        // it is dropped rather than rendered as an anonymous verdict.
        const rows: DeskCallRow[] = [];
        for (const c of (callData as BriefCallRow[] | null) ?? []) {
          const outcome = byCall.get(c.id);
          if (!outcome || !c.claim_text) continue;
          rows.push({ call: c, outcome });
        }

        setRecord(buildDeskRecord(rows, todayPt(), LIST_LIMIT));
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell pageTitle="Radar">
      <div data-radar-page className="motion-page-enter p-6 max-w-[1080px]">
        <RadarTabs active="desk-record" />
        <DeskRecordView record={record} status={status} />
      </div>
    </AppShell>
  );
}
