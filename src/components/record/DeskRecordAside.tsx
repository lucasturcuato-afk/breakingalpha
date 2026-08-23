"use client";

/**
 * The desk's graded record, rendered BESIDE an empty personal one.
 *
 * Why this exists: two accounts have ever committed a call, so every surface
 * that shows a user their own record is empty for everyone else. The empty
 * personal record used to render as a zeroed scoreboard, which reads as a score
 * of zero rather than as an absence. The dashboard already solved this by
 * putting "Signalera's record" beside "Your calls"; this is that same move,
 * packaged for the three other places it was missing.
 *
 * THE RULE THIS COMPONENT ENFORCES: the heading always names the desk. There is
 * no prop that lets a caller relabel these numbers as the reader's own, and the
 * counts come from the same fetchDeskRecord loader the dashboard tile and the
 * full record page use, so the three cannot disagree. Nothing here is
 * estimated: on an error or an empty record it says so and renders no numbers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import {
  DESK_RECORD_COPY as COPY,
  RESOLUTION_ORDER,
  type DeskRecord,
} from "@/lib/desk-record.ts";
import { fetchDeskRecord } from "@/lib/desk-record-query.ts";

const DESK_RECORD_HREF = "/radar/desk-record";
/** Counts only. The list lives on the full record page. */
const LIST_LIMIT = 0;

/** Always names the desk. Never parameterised. */
export const DESK_ASIDE_HEADING = "The desk's record";

/**
 * Said once, next to the numbers: what the record is, and that the reader can
 * be measured the same way. This is the sentence that turns a demonstration
 * into an invitation without borrowing a single number.
 */
export const DESK_ASIDE_BODY =
  "These are Signalera's own calls, graded against the close with benchmark attribution, misses included. Take any call as your own and it is scored on the same bar.";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export interface DeskRecordAsideProps {
  /**
   * "light" for the app shell, "dark" for the onboarding wizard's espresso
   * panel. Layout and copy are identical; only the palette differs.
   */
  tone?: "light" | "dark";
  /** Rendered under the counts. Omitted where the caller supplies its own CTA. */
  showLink?: boolean;
  className?: string;
}

export function DeskRecordAside({
  tone = "light",
  showLink = true,
  className = "",
}: DeskRecordAsideProps) {
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

  const dark = tone === "dark";
  const shell = dark
    ? "rounded-xl border border-white/12 bg-white/[0.03] px-4 py-3.5"
    : "rounded-xl border border-border-subtle bg-elevated px-4 py-3.5";
  const headingCls = dark
    ? "font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c0a870]"
    : "font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted";
  const bodyCls = dark
    ? "font-sans text-[11.5px] leading-relaxed text-[#c0a870] mt-1.5 m-0"
    : "font-sans text-[11.5px] leading-relaxed text-text-secondary mt-1.5 m-0";
  const labelCls = dark
    ? "font-data text-[9px] tracking-[0.02em] uppercase text-[#8a7a60]"
    : "font-data text-[9px] tracking-[0.02em] uppercase text-text-faint";
  const numberCls = dark
    ? "font-data text-[17px] font-semibold tabular-nums leading-none block mt-1 text-[#f5f0e8]"
    : "font-data text-[17px] font-semibold tabular-nums leading-none block mt-1 text-espresso";
  const ofCls = dark
    ? "font-data text-[9.5px] font-normal ml-1 text-[#8a7a60]"
    : "font-data text-[9.5px] font-normal ml-1 text-text-faint";
  const mutedCls = dark
    ? "font-sans text-[11px] italic leading-snug m-0 text-[#8a7a60]"
    : "font-sans text-[11px] italic leading-snug m-0 text-text-muted";

  const header = (
    <>
      <p className={headingCls}>{DESK_ASIDE_HEADING}</p>
      <p className={bodyCls}>{DESK_ASIDE_BODY}</p>
    </>
  );

  if (status === "loading") {
    return (
      <div className={`${shell} ${className}`}>
        {header}
        <div
          className={`mt-3 h-[46px] rounded-lg animate-pulse ${
            dark ? "bg-white/5" : "bg-parchment-mid/40"
          }`}
        />
      </div>
    );
  }

  // An unreadable or empty record renders as itself. No zeros stand in for it.
  if (status === "error") {
    return (
      <div className={`${shell} ${className}`}>
        {header}
        <p className={`${mutedCls} mt-3`}>{COPY.errorBody}</p>
      </div>
    );
  }

  if (!record || record.total === 0) {
    return (
      <div className={`${shell} ${className}`}>
        {header}
        <p className={`${mutedCls} mt-3`}>{COPY.emptyBody}</p>
      </div>
    );
  }

  return (
    <div className={`${shell} ${className}`}>
      {header}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {RESOLUTION_ORDER.map((r) => (
          <div key={r}>
            <span className={labelCls}>{COPY.bucketLabel[r]}</span>
            <span className={numberCls}>
              {record.byResolution[r]}
              <span className={ofCls}>of {record.total}</span>
            </span>
          </div>
        ))}
      </div>
      {showLink && (
        <Link
          href={DESK_RECORD_HREF}
          className="block mt-2.5 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
        >
          The whole record →
        </Link>
      )}
    </div>
  );
}
