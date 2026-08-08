"use client";

/**
 * DeskRecordSummary - Signalera's OWN graded call record, on the dashboard.
 *
 * This is the desk's record and it is labeled as the desk's record. It is
 * never rendered inside a block headed "Your ...": the user's own claims live
 * in YourCallsWidget and are a different object entirely.
 *
 * NOT A SECOND PRESENTATION. It reads through fetchDeskRecord (the same two
 * selects /radar/desk-record runs), buckets through buildDeskRecord (the same
 * model), and labels through DESK_RECORD_COPY (the same words). Only the
 * layout is dashboard-sized. The counts on this tile and the counts on
 * /radar/desk-record cannot disagree.
 *
 * HONESTY IS THE LAYOUT, inherited from DeskRecordView:
 *  - Four buckets, one grid, identical weight. Challenged and No clean read
 *    sit beside Supported at the same size.
 *  - No top-line hit rate. No ratio. No W/L. A bare percentage is the number
 *    a research shop games, and it is the opposite of what this record is for.
 *  - Errors and emptiness render as themselves, never as a zeroed scoreboard.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DESK_RECORD_COPY as COPY,
  RESOLUTION_ORDER,
  type DeskRecord,
  type Resolution,
} from "@/lib/desk-record.ts";
import { fetchDeskRecord } from "@/lib/desk-record-query.ts";
import { createBrowserClient } from "@supabase/ssr";

const DESK_RECORD_HREF = "/radar/desk-record";
/** The summary renders counts only; the list lives on the full record page. */
const LIST_LIMIT = 0;

/** Same state tokens the record page and the scored objects use. */
const RESOLUTION_COLOR: Record<Resolution, string> = {
  supported: "var(--signal-up)",
  challenged: "var(--signal-dn)",
  noCleanRead: "var(--text-muted)",
  notGraded: "var(--border-subtle)",
};

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function DeskRecordSummary() {
  const [record, setRecord] = useState<DeskRecord | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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

  if (status === "loading") {
    return <div className="h-[68px] rounded-lg bg-parchment-mid/40 animate-pulse" />;
  }

  if (status === "error") {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug m-0">
        {COPY.errorBody}
      </p>
    );
  }

  if (!record || record.total === 0) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug m-0">
        {COPY.emptyBody}
      </p>
    );
  }

  return (
    <div className="dash-fill-in">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {RESOLUTION_ORDER.map((r) => (
          <div key={r}>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: RESOLUTION_COLOR[r] }}
              />
              <span className="font-data text-[9px] tracking-[0.02em] text-text-faint uppercase">
                {COPY.bucketLabel[r]}
              </span>
            </span>
            <span className="font-data text-[17px] font-semibold text-espresso tabular-nums leading-none block mt-1">
              {record.byResolution[r]}
              <span className="font-data text-[9.5px] font-normal text-text-faint ml-1">
                of {record.total}
              </span>
            </span>
          </div>
        ))}
      </div>

      <p className="font-sans text-[9.5px] text-text-faint italic leading-snug mt-2.5 m-0">
        {COPY.awaitingNote}
      </p>

      <Link
        href={DESK_RECORD_HREF}
        className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        The whole record →
      </Link>
    </div>
  );
}
