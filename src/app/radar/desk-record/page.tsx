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
import type { DeskRecord } from "@/lib/desk-record.ts";
import { fetchDeskRecord } from "@/lib/desk-record-query.ts";

/** How many resolved calls the list renders. Counts always cover all rows. */
const LIST_LIMIT = 40;

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function DeskRecordPage() {
  const [record, setRecord] = useState<DeskRecord | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Same loader the dashboard's desk-record summary uses, so the two
        // surfaces cannot disagree about the counts.
        const result = await fetchDeskRecord(getSupabase(), LIST_LIMIT);
        if (cancelled) return;
        if (!result) {
          setStatus("error");
          return;
        }
        setRecord(result);
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
