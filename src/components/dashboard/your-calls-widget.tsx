"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  resolveClaimOutcome,
  isAwaitingOwnVerdict,
  type ClaimOutcomeRow,
} from "@/lib/claim-outcome";

/**
 * YourCallsWidget — the user's OWN calls, from GET /api/radar/claims
 * (user_claims scoped to user_id; the same endpoint /radar/calls renders).
 *
 * Honesty rules, inherited from src/lib/claim-outcome.ts and preserved here:
 *  - A claim's verdict is its OWN user_claim_outcomes row. resolveClaimOutcome
 *    is the only resolver and it cannot see brief-call outcomes by construction,
 *    so an adopted claim never borrows the desk's verdict.
 *  - No outcome row means the claim is genuinely ungraded and renders "open",
 *    never a substituted or inferred result.
 *  - Nothing is fabricated: with no claims the widget states that plainly.
 *
 * Deep link: /radar/calls does NOT read a ?claim= param (it reads draft,
 * thesis, views, adopt), so linking per-claim by id would be a dead link.
 * Every row therefore points at /radar/calls?views=open, which is where the
 * claims list actually lives.
 */

const CALLS_HREF = "/radar/calls?views=open";

interface UserClaim {
  id: string;
  user_claim: string;
  claim_type: string;
  target_symbol: string | null;
  expected_direction: string | null;
  gradeable: boolean | null;
  gradeability_note: string | null;
  status: string;
  source: string | null;
  adopted_from_call_id: string | null;
  created_at: string;
}

interface ClaimsResponse {
  claims?: UserClaim[];
  outcomes?: Record<string, ClaimOutcomeRow | undefined>;
  unavailable?: boolean;
}

function directionTone(dir: string | null): string {
  if (dir === "bullish") return "text-signal-up border-signal-up/30 bg-signal-up/10";
  if (dir === "bearish") return "text-signal-dn border-signal-dn/30 bg-signal-dn/10";
  return "text-text-muted border-border-base bg-parchment-mid";
}

/** Verdict label + tone, only ever from the claim's own outcome row. */
function verdictChip(outcome: ClaimOutcomeRow): { label: string; cls: string } {
  const v = (outcome.verdict ?? "").toLowerCase();
  const clean = (outcome.attribution ?? "").toLowerCase() === "clean";
  if (v === "correct" && clean) return { label: "Right", cls: "text-signal-up" };
  if (v === "wrong" && clean) return { label: "Wrong", cls: "text-signal-dn" };
  if (v === "ungradable") return { label: "Ungradable", cls: "text-text-faint" };
  // partial, or a verdict without a clean attribution: no clean read.
  return { label: "No clean read", cls: "text-text-muted" };
}

export function YourCallsWidget() {
  // undefined = loading
  const [data, setData] = useState<ClaimsResponse | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/radar/claims");
        if (!res.ok) {
          if (!cancelled) setData({ claims: [] });
          return;
        }
        const json = (await res.json()) as ClaimsResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ claims: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[52px] rounded-lg bg-parchment-mid/40 animate-pulse" />
        ))}
      </div>
    );
  }

  const claims = (data.claims ?? []).filter((c) => c.status !== "archived");
  const outcomes = data.outcomes ?? {};

  if (claims.length === 0) {
    return (
      <div>
        <p className="font-sans text-[11px] text-text-muted italic leading-snug py-1">
          {data.unavailable
            ? "Calls are not available yet."
            : "You have not made any calls yet. Commit one in Radar and it will be graded here."}
        </p>
        <Link
          href={CALLS_HREF}
          className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
        >
          Go to Calls →
        </Link>
      </div>
    );
  }

  return (
    <div className="dash-fill-in">
      <div className="space-y-2">
        {claims.slice(0, 4).map((c) => {
          const own = resolveClaimOutcome(c, outcomes);
          const awaiting = isAwaitingOwnVerdict(c, outcomes);
          const chip = own ? verdictChip(own) : null;
          return (
            <Link
              key={c.id}
              href={CALLS_HREF}
              className="group block rounded-lg px-2 py-1.5 -mx-2 hover:bg-parchment-mid transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-1">
                {c.expected_direction && (
                  <span
                    className={cn(
                      "font-data text-[8.5px] font-semibold uppercase px-1.5 py-0.5 rounded border",
                      directionTone(c.expected_direction),
                    )}
                  >
                    {c.expected_direction}
                  </span>
                )}
                {c.target_symbol && (
                  <span className="font-data text-[9.5px] text-text-muted">{c.target_symbol}</span>
                )}
                <span className="font-data text-[9px] text-text-faint ml-auto">
                  {awaiting ? "open" : chip?.label}
                </span>
              </div>
              <p className="font-sans text-[11.5px] text-text-primary leading-snug line-clamp-2 group-hover:text-gold-dark transition-colors m-0">
                {c.user_claim}
              </p>
              {!awaiting && chip && (
                <span className={cn("font-data text-[9.5px] mt-0.5 inline-block", chip.cls)}>
                  {chip.label}
                  {own?.actual_pct_change != null && (
                    <span className="text-text-faint ml-1 tabular-nums">
                      {(own.actual_pct_change * 100).toFixed(2)}%
                    </span>
                  )}
                </span>
              )}
              {awaiting && c.gradeable === false && c.gradeability_note && (
                <span className="font-sans text-[9.5px] text-text-faint italic mt-0.5 inline-block">
                  context only
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <Link
        href={CALLS_HREF}
        className="block mt-2.5 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        All calls →
      </Link>
    </div>
  );
}
