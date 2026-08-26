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
 *
 * THE BREAKPOINT IS A SUBSCRIPTION, NOT A ONE-TIME QUESTION. The effect used
 * to ask `matchMedia` once and never again, so a page opened on a desktop and
 * then narrowed below `md` never ran these two reads at all. Both record
 * sections were silently absent for the life of that page. It is a real
 * viewport now, read through `useSyncExternalStore`, so narrowing starts the
 * reads and the sections arrive.
 *
 * That subscription is also what lets the state machine be complete without a
 * `setState` in an effect body. See `MobileRecords.status`.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
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
  /**
   * THREE STATES, AND ONLY TWO OF THEM ARE EVER STORED.
   *
   *   "idle"     above `md`. Nothing was asked for, so nothing is pending and
   *              nothing is known. DERIVED from the viewport at return time,
   *              never held in state and never set from anywhere.
   *   "loading"  below `md`, reads outstanding. The stored seed.
   *   "done"     below `md`, both reads answered or the budget expired.
   *
   * The history is worth keeping, because both of the obvious shapes are
   * wrong. "idle" was originally STORED, and the effect moved off it with a
   * `setState` in its own body, which is exactly what
   * `react-hooks/set-state-in-effect` catches and which cost this branch its
   * only new lint warning. Deleting "idle" outright cleared the warning and
   * broke something: above `md` the effect exits early, so nothing was left
   * to move the status off "loading", and a page narrowed from 1440 to 390
   * without a reload sat on a PERMANENT SKELETON. Measured at 28s, 16s past
   * the read budget. A screen showing a state that will never resolve is the
   * defect class this whole branch exists to close, so trading it for a lint
   * warning was not a trade at all.
   *
   * Deriving the third state is what makes the machine complete. `isMobile` is
   * a live subscription, so "idle" is a fact about the current viewport rather
   * than a value someone has to remember to update, the stored half never
   * needs a synchronous transition, and the rule is satisfied by the shape
   * rather than by a disable directive.
   */
  status: "idle" | "loading" | "done";
  yourRecord: { byResolution: Record<Resolution, number>; awaiting: number } | null;
  deskRecord: { byResolution: Record<Resolution, number>; total: number } | null;
  gradedInLastDay: number | null;
}

const PENDING: MobileRecords = {
  status: "loading",
  yourRecord: null,
  deskRecord: null,
  gradedInLastDay: null,
};

/**
 * What the hook gives back above `md`. A module constant, so its identity is
 * stable across renders and the caller's `mobileData` memo is not invalidated
 * on every desktop render by a fresh object.
 */
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

/**
 * The breakpoint as an external store.
 *
 * `useSyncExternalStore` rather than an effect and a `setState`, for two
 * reasons and not only the lint rule. It gives the correct value on the FIRST
 * client render instead of one render later, and it hands React the
 * server snapshot explicitly, so hydration has one answer rather than two.
 */
function subscribeToBreakpoint(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isMobileSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * There is no viewport on the server, and guessing one would make the markup
 * disagree with the first client render. False means "not reading", which is
 * the safe answer either way: it renders no record section rather than an
 * invented one.
 */
function isMobileServerSnapshot(): boolean {
  return false;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function useMobileRecords(): MobileRecords {
  const isMobile = useSyncExternalStore(
    subscribeToBreakpoint,
    isMobileSnapshot,
    isMobileServerSnapshot,
  );
  const [state, setState] = useState<MobileRecords>(PENDING);

  useEffect(() => {
    /* Not a one-time question any more: `isMobile` is a dependency, so
       crossing the breakpoint downwards starts the reads. Crossing it upwards
       tears them down, and the return below stops reporting the stored state
       at all. */
    if (!isMobile) return;

    let cancelled = false;

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
  }, [isMobile]);

  /* The third state, derived. Above `md` no read was asked for, so the answer
     is not "still loading", it is "nothing pending and nothing known", and the
     caller draws every record section as absent rather than as a skeleton that
     would never resolve. */
  return isMobile ? state : IDLE;
}
