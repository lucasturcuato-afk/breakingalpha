"use client";

/**
 * The two record reads the mobile Dashboard needs and the desktop page does
 * not already do at page level.
 *
 * The desk's numbers and the reader's own both live inside desktop widgets
 * (`YourCallsWidget`, `DeskRecordSummary`) as component-local state, so there
 * is nothing at page level to thread into the phone. Lifting them would mean
 * rewiring two desktop loaders, which this unit is not permitted to do. So the
 * phone reads the same two sources through the same two shared libraries:
 * `buildYourRecord` over `/api/radar/claims`, and `fetchDeskRecord` over the
 * same two selects `/radar/desk-record` runs. The counts on the phone and the
 * counts on the desk are computed by the same functions and cannot disagree.
 *
 * IT ONLY RUNS BELOW `md`. The mobile screen is composed beside the desktop
 * layout rather than replacing it, so on a desktop viewport the mobile subtree
 * is mounted and merely `display:none`. Firing these two reads there would add
 * two round-trips to every desktop load for a tree nobody can see, so the
 * effect asks `matchMedia` first and does nothing above the breakpoint. The
 * breakpoint string is Tailwind's `md` minus a pixel, which is exactly where
 * `md:hidden` stops applying.
 *
 * Failure is a state, not a blank. A read that fails leaves its record null,
 * the screen draws no record section at all, and nothing claims the reader has
 * an empty record when the truth is that it could not be read.
 */

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  resolveClaimOutcome,
  type ClaimOutcomeRow,
} from "@/lib/claim-outcome";
import { buildYourRecord, type UserClaimLike } from "@/lib/your-record";
import { fetchDeskRecord } from "@/lib/desk-record-query";
import { todayPt } from "@/lib/session-date";
import type { Resolution } from "@/lib/desk-record";

/** Below `md`, where `md:hidden` still applies. */
const MOBILE_QUERY = "(max-width: 767px)";

/**
 * A read that has not answered inside this is treated as answered with
 * nothing, which for a record means null, which the screen draws as no section
 * at all.
 *
 * Exported because the page's own arrival budget uses the same number. Two
 * different ceilings would mean the screen paints once when this one expires
 * and again when the other does.
 */
export const MOBILE_READ_BUDGET_MS = 12_000;
const READ_BUDGET_MS = MOBILE_READ_BUDGET_MS;

export interface MobileRecords {
  /** "idle" above the breakpoint: nothing was asked for, so nothing is pending. */
  status: "idle" | "loading" | "done";
  yourRecord: { byResolution: Record<Resolution, number>; awaiting: number } | null;
  deskRecord: { byResolution: Record<Resolution, number>; total: number } | null;
  gradedInLastDay: number | null;
}

const IDLE: MobileRecords = {
  status: "idle",
  yourRecord: null,
  deskRecord: null,
  gradedInLastDay: null,
};

interface ClaimsResponse {
  claims?: (UserClaimLike & { status?: string | null })[];
  outcomes?: Record<string, ClaimOutcomeRow | undefined>;
  unavailable?: boolean;
}

const DAY_MS = 86_400_000;

/**
 * How many of the reader's own calls carry a grade stamped inside the last day.
 *
 * Only their own outcome rows are counted, through the same resolver the desk
 * uses, which by construction cannot see a morning-brief verdict. An outcome
 * with no `graded_at` is not counted: an ungraded timestamp is not a grade
 * that happened overnight.
 */
export function countGradedInLastDay(
  claims: UserClaimLike[],
  outcomes: Record<string, ClaimOutcomeRow | undefined>,
  nowMs: number,
): number {
  let n = 0;
  for (const claim of claims) {
    const own = resolveClaimOutcome(claim, outcomes);
    if (!own?.graded_at) continue;
    const at = new Date(own.graded_at).getTime();
    if (Number.isNaN(at)) continue;
    if (nowMs - at <= DAY_MS && at <= nowMs) n += 1;
  }
  return n;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function useMobileRecords(): MobileRecords {
  const [state, setState] = useState<MobileRecords>(IDLE);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia(MOBILE_QUERY).matches) return;

    let cancelled = false;
    setState({ ...IDLE, status: "loading" });

    const budget = setTimeout(() => {
      if (!cancelled) setState((prev) => (prev.status === "loading" ? { ...prev, status: "done" } : prev));
    }, READ_BUDGET_MS);

    async function readYours() {
      try {
        const res = await fetch("/api/radar/claims", { credentials: "include" });
        if (!res.ok) return null;
        const json = (await res.json()) as ClaimsResponse;
        if (json.unavailable) return null;
        const claims = (json.claims ?? []).filter((c) => c.status !== "archived");
        const outcomes = json.outcomes ?? {};
        const record = buildYourRecord(claims, outcomes, todayPt());
        return {
          yourRecord: { byResolution: record.byResolution, awaiting: record.awaiting },
          gradedInLastDay: countGradedInLastDay(claims, outcomes, Date.now()),
        };
      } catch {
        return null;
      }
    }

    async function readDesk() {
      try {
        const record = await fetchDeskRecord(getSupabase(), 0);
        if (!record) return null;
        return { byResolution: record.byResolution, total: record.total };
      } catch {
        return null;
      }
    }

    void Promise.all([readYours(), readDesk()]).then(([yours, desk]) => {
      if (cancelled) return;
      setState({
        status: "done",
        yourRecord: yours?.yourRecord ?? null,
        deskRecord: desk,
        gradedInLastDay: yours?.gradedInLastDay ?? null,
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(budget);
    };
  }, []);

  return state;
}
