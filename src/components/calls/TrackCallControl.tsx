"use client";

/**
 * TrackCallControl - the ONE implementation of committing to a call.
 *
 * Used by both surfaces that offer it: src/components/brief/BriefCallsSection.tsx
 * (the morning brief and evening wrap) and src/app/radar/calls/page.tsx. Neither
 * declares its own copy, so the pre-tap framing, the ledger line, and the stamp
 * transition cannot drift between where a call is read and where it is reviewed.
 *
 * Two states, one decision:
 *   untracked  the horizon you are committing to is visible BEFORE the tap and
 *              editable in one tap, next to the reason anyone accepts being
 *              graded in public.
 *   tracked    a ledger entry: when it was logged, when it is reviewed, and the
 *              terms. Rendered from SERVER data, so it survives a reload.
 *
 * Honesty rules enforced here:
 *   - No claim id is shown. user_claims has only a uuid (no short human id), and
 *     a uuid slice or a hash would be a fabricated identifier, so it is omitted.
 *   - No review date is invented. When the window is unknown the segment is
 *     dropped rather than guessed.
 *   - No confidence or probability is ever rendered.
 */

import { HorizonChip } from "@/components/calls/HorizonChip";
import {
  HORIZON_LABEL,
  HORIZON_TYPES,
  type HorizonType,
} from "@/lib/call-horizons";

/**
 * The reason to commit, shown where the decision is made.
 *
 * Describes the STANDARD, not a promised event: the window cannot be moved after
 * the fact, and the bar is the same benchmark attribution the desk's own calls
 * are held to (literally the same grader: backend/grading/price_attribution.py
 * serves both). It deliberately does not say a verdict will arrive, because
 * adopted claims are not yet in the grading due-scan
 * (backend/grading/grade_user_claims.py filters source = 'authored').
 */
export const TRACK_TRUST_LINE =
  "Your window is fixed the moment you commit, and misses stay on your record. Same benchmark-attribution bar as the desk's own calls: a move the market explains is not a hit.";

/** What the control needs to know about an existing claim. Server-shaped. */
export interface TrackedClaimLike {
  id: string;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
}

/** ISO timestamp or date to YYYY-MM-DD. Null when unusable, never guessed. */
function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * The ledger line, as a plain string so a test can assert it exactly.
 *
 * Segments are joined only when real. No id (none exists on user_claims), and
 * REVIEW is dropped entirely when the window end is unknown rather than filled
 * with today, the horizon default, or any other stand-in.
 */
export function buildLedgerLine(claim: TrackedClaimLike): string {
  const logged = isoDay(claim.resolution_window_start);
  const review = isoDay(claim.resolution_window_end);
  const parts: string[] = [];
  if (logged) parts.push(`LOGGED ${logged}`);
  if (review) parts.push(`REVIEW ${review}`);
  parts.push("Fixed at entry. Reviewed on the desk's own bar.");
  return parts.join("  ·  ");
}

/**
 * The monospace ledger entry, rendered beneath a tracked call's claim.
 *
 * `justStamped` plays the one-time fade-up. On a fresh mount (a reload, or the
 * next visit) it is false, so a persisted claim renders its ledger immediately
 * with no animation: the entry is a fact, not an event.
 */
export function CallLedgerLine({
  claim,
  justStamped = false,
}: {
  claim: TrackedClaimLike;
  justStamped?: boolean;
}) {
  return (
    <p
      data-testid="call-ledger-line"
      className={`mt-1 px-1 font-mono text-[10px] leading-snug tracking-tight text-text-muted${
        justStamped ? " call-stamp-in" : ""
      }`}
    >
      {buildLedgerLine(claim)}
    </p>
  );
}

/**
 * The control itself.
 *
 * Renders nothing when `available` is false (signed out, or the claims read
 * failed): offering a button whose only possible outcome is a 401 is worse than
 * omitting it.
 */
export function TrackCallControl({
  callId,
  tracked,
  available,
  busy,
  horizon,
  onHorizonChange,
  onTrack,
  justStamped = false,
}: {
  callId: string;
  tracked: TrackedClaimLike | null;
  available: boolean;
  busy: boolean;
  horizon: HorizonType;
  onHorizonChange: (h: HorizonType) => void;
  onTrack: () => void;
  justStamped?: boolean;
}) {
  if (!available) return null;

  if (tracked) {
    return (
      <span
        data-testid="track-state-tracked"
        className={`flex items-baseline gap-1.5 text-text-muted${
          justStamped ? " call-stamp-collapse" : ""
        }`}
      >
        Tracked
        <HorizonChip
          anchor={tracked.resolution_window_start}
          resolveOn={tracked.resolution_window_end}
        />
        <a
          href="/radar/calls"
          className="underline underline-offset-2 hover:text-text-primary"
        >
          View in Radar
        </a>
      </span>
    );
  }

  return (
    <span data-testid="track-state-untracked" className="flex items-baseline gap-1.5">
      {/* The window being committed to, visible and editable BEFORE the tap. */}
      <select
        aria-label="Tracking horizon"
        value={horizon}
        disabled={busy}
        onChange={(e) => onHorizonChange(e.target.value as HorizonType)}
        className="cursor-pointer rounded-sm border border-border-subtle bg-transparent px-1 py-px font-mono text-[10px] text-text-muted disabled:opacity-50"
      >
        {HORIZON_TYPES.map((h) => (
          <option key={h} value={h}>
            {HORIZON_LABEL[h]}
          </option>
        ))}
      </select>
      <button
        disabled={busy}
        onClick={onTrack}
        aria-describedby={`track-why-${callId}`}
        className="hover:text-text-primary disabled:opacity-50"
      >
        {busy ? "Tracking…" : "Track this call"}
      </button>
    </span>
  );
}

/**
 * The reason to commit. Sits beside the control, on the untracked state only:
 * once committed it is replaced by the ledger line, which states the same terms
 * as settled fact rather than as a pitch.
 */
export function TrackTrustLine({ callId }: { callId: string }) {
  return (
    <p
      id={`track-why-${callId}`}
      data-testid="track-trust-line"
      className="mt-1 px-1 font-sans text-[11px] leading-snug text-text-muted"
    >
      {TRACK_TRUST_LINE}
    </p>
  );
}
