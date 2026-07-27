"use client";

/**
 * BriefCallsSection - renders a brief's predictive calls as ScoredObjects,
 * resolved against REAL grader outcomes, each with its resolution horizon and a
 * one-tap control to track it as a claim of your own.
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
 *
 * The track control is the SAME affordance as the Radar calls page: same
 * horizon vocabulary (@/lib/call-horizons), same chip component
 * (@/components/calls/HorizonChip), same POST to /api/radar/claims/adopt.
 * Nothing about adopting is reimplemented here. PR #507 shipped the control to
 * src/app/radar/calls/page.tsx only, and the brief pages render this component
 * instead, so the affordance did not exist where people actually read.
 */

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import { HorizonChip } from "@/components/calls/HorizonChip";
import {
  openCallProps,
  scoredCallProps,
  type CallOutcomeRow,
} from "@/lib/scored-object-map";
import { DEFAULT_ADOPT_HORIZON, type HorizonType } from "@/lib/call-horizons";
import {
  CallLedgerLine,
  TrackCallControl,
  TrackTrustLine,
} from "@/components/calls/TrackCallControl";
import { trackClientEvent } from "@/lib/track-event";

interface BriefCall {
  id: string;
  claim_text: string;
  target_symbol: string | null;
  claim_type: string | null;
  confidence: number | null;
  created_at: string | null;
  brief_date: string | null;
  /** Set at creation from the fixed horizon map. NULL on pre-migration-0014 calls. */
  resolve_on: string | null;
}

/** The subset of a user_claims row this component needs to show tracked state. */
interface TrackedClaim {
  id: string;
  adopted_from_call_id: string | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
}

type LoadState = "loading" | "loaded" | "error";

export default function BriefCallsSection({
  briefId,
  briefDate,
  heading = "Today's Calls",
  surface = "brief",
}: {
  /** Match calls by their brief_id (morning brief). Takes precedence. */
  briefId?: string | null;
  /** Match calls by brief_date (YYYY-MM-DD), used on the evening wrap, whose own
   *  briefing id differs from the morning brief that owns the calls. */
  briefDate?: string | null;
  heading?: string;
  /** Telemetry surface only. Does not change behavior. */
  surface?: "brief" | "wrap";
}) {
  const [calls, setCalls] = useState<BriefCall[]>([]);
  // null = outcomes unavailable (query failed): render Open, claim nothing.
  const [outcomes, setOutcomes] = useState<Map<string, CallOutcomeRow> | null>(null);
  const [todayPt, setTodayPt] = useState<string>("");
  const [status, setStatus] = useState<LoadState>("loading");

  // Tracking state. `tracked` is null until we know: either the user is signed
  // out, or the claims read failed. In that case the control is not rendered at
  // all, because offering a button that can only 401 is worse than omitting it.
  const [tracked, setTracked] = useState<Map<string, TrackedClaim> | null>(null);
  const [horizonFor, setHorizonFor] = useState<Record<string, HorizonType>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<Record<string, string>>({});
  /** Calls committed in THIS session. Drives the one-time stamp only; it is
   *  never what makes a card read tracked (that comes from server data), so a
   *  reload renders the end state with no animation. */
  const [stamped, setStamped] = useState<Set<string>>(new Set());

  /** Read the user's claims so already-tracked calls render as tracked.
   *  Fail-open: any failure leaves `tracked` null and simply hides the control. */
  const loadTracked = useCallback(async () => {
    try {
      const res = await fetch("/api/radar/claims", { credentials: "include" });
      if (!res.ok) {
        setTracked(null); // 401 signed out, or 500: no control, no false state
        return;
      }
      const json = await res.json();
      const map = new Map<string, TrackedClaim>();
      for (const c of (json.claims ?? []) as TrackedClaim[]) {
        if (c.adopted_from_call_id) map.set(c.adopted_from_call_id, c);
      }
      setTracked(map);
    } catch {
      setTracked(null);
    }
  }, []);

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
          .select(
            "id, claim_text, target_symbol, claim_type, confidence, created_at, brief_date, resolve_on",
          );
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
          if (!cancelled) void loadTracked();
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
  }, [briefId, briefDate, loadTracked]);

  /**
   * Track a brief call as a forward claim of the user's own, over `horizon`.
   *
   * Optimistic, then reconciled. The card flips to tracked immediately so the
   * tap feels answered, and the server response replaces the placeholder with
   * the real window. On ANY failure the optimistic row is removed and an honest
   * inline message takes its place: a false tracked state is worse than an
   * error, because the user would believe a claim exists that does not.
   *
   * Never a modal, a toast, or a navigation. The reader stays in the brief.
   */
  const track = async (call: BriefCall, horizon: HorizonType) => {
    setBusy(call.id);
    setTrackError((prev) => {
      const next = { ...prev };
      delete next[call.id];
      return next;
    });

    // Optimistic placeholder. No dates yet, so HorizonChip renders nothing
    // rather than guessing a window the server has not confirmed.
    setTracked((prev) => {
      const next = new Map(prev ?? []);
      next.set(call.id, {
        id: `pending-${call.id}`,
        adopted_from_call_id: call.id,
        resolution_window_start: null,
        resolution_window_end: null,
      });
      return next;
    });

    const revert = (message: string) => {
      setTracked((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        next.delete(call.id);
        return next;
      });
      setStamped((prev) => {
        const next = new Set(prev);
        next.delete(call.id);
        return next;
      });
      setTrackError((prev) => ({ ...prev, [call.id]: message }));
    };

    try {
      const res = await fetch("/api/radar/claims/adopt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: call.id, horizon }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        revert(json.error ?? "Could not track this call.");
        return;
      }
      // Reconcile against the window the server actually stored.
      setTracked((prev) => {
        const next = new Map(prev ?? []);
        next.set(call.id, {
          id: json.id ?? `pending-${call.id}`,
          adopted_from_call_id: call.id,
          resolution_window_start: json.resolution_window_start ?? null,
          resolution_window_end: json.resolution_window_end ?? null,
        });
        return next;
      });
      setStamped((prev) => new Set(prev).add(call.id));
      // Moat event: immediate flush, since a dropped track corrupts the
      // dataset rather than just adding noise.
      trackClientEvent(
        `${surface}.call.tracked`,
        {
          horizon,
          already_tracked: json.alreadyAdopted === true,
          gradeable: json.gradeable ?? null,
          resolution_window_end: json.resolution_window_end ?? null,
          call_resolve_on: call.resolve_on,
          target_symbol: call.target_symbol,
          claim_type: call.claim_type,
        },
        { entity_type: "brief_call", entity_id: call.id, immediate: true },
      );
    } catch {
      revert("Could not track this call.");
    } finally {
      setBusy(null);
    }
  };

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
        // Honest pending/empty state, never faked to look complete.
        <div className="rounded-lg border border-border-subtle bg-elevated px-4 py-4">
          <p className="font-sans text-[13px] text-text-muted">
            {status === "error"
              ? "Calls are momentarily unavailable."
              : "No scored calls were captured for this brief yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {calls.map((c) => {
            const trackedClaim = tracked?.get(c.id) ?? null;
            const chosen = horizonFor[c.id] ?? DEFAULT_ADOPT_HORIZON;
            // The stamp plays once, only for a call committed in THIS session.
            // A claim loaded from the server on mount renders its end state
            // with no animation: a persisted entry is a fact, not an event.
            const justStamped = stamped.has(c.id);
            return (
              <div key={c.id} className={trackedClaim ? "call-tracked-edge" : undefined}>
                <div className="mb-1 flex items-baseline justify-between gap-2 px-1 font-sans text-[11px] text-text-faint">
                  {/* Derived from resolve_on. Absent when the call has none. */}
                  <HorizonChip anchor={c.brief_date} resolveOn={c.resolve_on} />
                  <TrackCallControl
                    callId={c.id}
                    tracked={trackedClaim}
                    available={tracked !== null}
                    busy={busy === c.id}
                    horizon={chosen}
                    onHorizonChange={(h) =>
                      setHorizonFor((prev) => ({ ...prev, [c.id]: h }))
                    }
                    onTrack={() => void track(c, chosen)}
                    justStamped={justStamped}
                  />
                </div>
                <ScoredObject
                  {...(outcomes && todayPt
                    ? scoredCallProps(c, outcomes.get(c.id) ?? null, todayPt)
                    : openCallProps(c))}
                />
                {/* Committed: the ledger entry. Not committed: the reason to. */}
                {trackedClaim ? (
                  <CallLedgerLine claim={trackedClaim} justStamped={justStamped} />
                ) : tracked !== null ? (
                  <TrackTrustLine callId={c.id} />
                ) : null}
                {trackError[c.id] && (
                  <p className="mt-1 px-1 font-sans text-[11px] text-text-muted">
                    {trackError[c.id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
