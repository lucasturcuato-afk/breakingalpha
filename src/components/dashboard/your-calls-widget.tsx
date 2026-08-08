"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  resolveClaimOutcome,
  isAwaitingOwnVerdict,
  type ClaimOutcomeRow,
} from "@/lib/claim-outcome";
// #542's record view supersedes #543's per-row verdictChip. It still speaks the
// shared observational vocabulary: buildYourRecord buckets through
// RESOLUTION_BY_STATE and its labels are DESK_RECORD_COPY.bucketLabel, both from
// verdict-vocabulary.ts (#543). So VERDICT_WORD is no longer imported directly
// here; the same table reaches this file through your-record.ts.
import {
  buildYourRecord,
  resolutionForClaim,
  YOUR_RECORD_COPY as COPY,
  type UserClaimLike,
  type YourRecord,
} from "@/lib/your-record.ts";
import { RESOLUTION_ORDER, type Resolution } from "@/lib/desk-record.ts";
import { todayPt } from "@/lib/session-date.ts";

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
 *  - Nothing is fabricated: with no claims the widget states that plainly, and
 *    with claims but nothing graded it says THAT plainly too. It never fills
 *    the gap with the desk's numbers. The desk's graded record is a separate,
 *    separately-labeled block (DeskRecordSummary); this file cannot read it.
 *  - Vocabulary is observational (supported, challenged, no clean read,
 *    awaiting), shared with the desk record. No W/L, no hit rate, no
 *    percentage of any kind is computed or rendered over the record.
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

/** Tone per resolution. Colour marks state, not rank. */
const RESOLUTION_CLS: Record<Resolution, string> = {
  supported: "text-signal-up",
  challenged: "text-signal-dn",
  noCleanRead: "text-text-muted",
  notGraded: "text-text-faint",
};

/**
 * The user's record, above their claims. Three honest states and no fourth:
 * no claims at all, claims but nothing resolved, and a real breakdown. The
 * empty states are the point, not a gap to paper over.
 */
function YourRecordSummary({ record }: { record: YourRecord }) {
  if (record.totalClaims === 0) {
    return (
      <div className="mb-3">
        <p className="font-sans text-[11px] text-text-primary leading-snug m-0">
          {COPY.noClaimsTitle}
        </p>
        <p className="font-sans text-[10px] text-text-muted leading-snug mt-1 m-0">
          {COPY.noClaimsBody}
        </p>
      </div>
    );
  }

  if (!record.hasResolved) {
    return (
      <div className="mb-3">
        <p className="font-sans text-[11px] text-text-primary leading-snug m-0">
          {COPY.noneResolvedTitle}
        </p>
        <p className="font-sans text-[10px] text-text-muted leading-snug mt-1 m-0">
          {COPY.noneResolvedBody}
        </p>
        <p className="font-data text-[9.5px] text-text-faint tabular-nums mt-1.5 m-0">
          {COPY.awaitingLabel} {record.awaiting}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2">
      {RESOLUTION_ORDER.map((r) => (
        <div key={r}>
          <span className="font-data text-[9px] tracking-[0.02em] text-text-faint uppercase block">
            {COPY.bucketLabel[r]}
          </span>
          <span
            className={cn(
              "font-data text-[15px] font-semibold tabular-nums leading-none block mt-0.5",
              RESOLUTION_CLS[r],
            )}
          >
            {record.byResolution[r]}
          </span>
        </div>
      ))}
      <div className="col-span-2">
        <span className="font-data text-[9.5px] text-text-faint tabular-nums">
          {COPY.awaitingLabel} {record.awaiting}
        </span>
        <p className="font-sans text-[9.5px] text-text-faint italic leading-snug mt-0.5 m-0">
          {COPY.awaitingNote}
        </p>
      </div>
    </div>
  );
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
  const today = todayPt();
  const record = buildYourRecord(claims as UserClaimLike[], outcomes, today);

  if (data.unavailable) {
    return (
      <p className="font-sans text-[11px] text-text-muted italic leading-snug py-1 m-0">
        {COPY.unavailable}
      </p>
    );
  }

  if (claims.length === 0) {
    return (
      <div>
        <YourRecordSummary record={record} />
        <Link
          href={CALLS_HREF}
          className="block font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
        >
          {COPY.cta}
        </Link>
      </div>
    );
  }

  return (
    <div className="dash-fill-in">
      <YourRecordSummary record={record} />
      <div className="space-y-2">
        {claims.slice(0, 4).map((c) => {
          const own = resolveClaimOutcome(c, outcomes);
          const awaiting = isAwaitingOwnVerdict(c, outcomes);
          const resolution = resolutionForClaim(c as UserClaimLike, outcomes, today);
          const chip = resolution
            ? { label: COPY.bucketLabel[resolution], cls: RESOLUTION_CLS[resolution] }
            : null;
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
                  {awaiting ? COPY.awaitingLabel.toLowerCase() : chip?.label}
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
