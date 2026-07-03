"use client";

/**
 * BriefCallsSection — renders a brief's predictive calls as OPEN ScoredObjects.
 *
 * Data is REAL (morning_brief_calls, public-readable) but grading is NOT live yet,
 * so every call renders in the Open state only — no verdict, no percentage beyond
 * the real stored confidence, nothing invented. When a brief has no captured calls
 * the section shows an explicit pending note rather than faking completeness.
 *
 * Self-contained + fail-soft: a query error or missing brief id degrades to the
 * pending note and never breaks the surrounding brief.
 */

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import { openCallProps } from "@/lib/scored-object-map";

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
        setCalls((data as BriefCall[] | null) ?? []);
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
        Predictions from this brief, captured before the outcome. Scoring goes live
        once resolution ships.
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
            <ScoredObject key={c.id} {...openCallProps(c)} />
          ))}
        </div>
      )}
    </section>
  );
}
