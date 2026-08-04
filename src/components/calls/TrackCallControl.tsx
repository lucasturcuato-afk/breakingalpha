"use client";

/**
 * TrackCallControl - the ONE implementation of committing to a call.
 *
 * Used by both surfaces that offer it: src/components/brief/BriefCallsSection.tsx
 * (the morning brief and evening wrap) and src/app/radar/calls/page.tsx. Neither
 * declares its own copy, so the framing, the ledger line, and the stamp
 * transition cannot drift between where a call is read and where it is reviewed.
 *
 * WHERE IT LIVES. The affordance is the card's FOOTER, passed to ScoredObject
 * and rendered inside its border. It used to float in the gutter above the card
 * next to a monospace horizon token, which made the most consequential control
 * in the product read as debug output attached to nothing. The card is the unit:
 * entity and status, the claim, the verdict or the awaiting state, then the
 * commitment.
 *
 * Three states, one decision:
 *   untracked   the window being committed to, in words, preselected from the
 *               call's OWN span (any number of days, not one of three buckets)
 *               and still changeable, next to a real button.
 *   ungradeable no control at all, and a sentence saying why. Offering a commit
 *               the system cannot resolve is worse than offering nothing.
 *   tracked     a ledger entry: when it was logged, when it is reviewed, the
 *               terms, and a quiet way through to Radar. Rendered from SERVER
 *               data, so it survives a reload.
 *
 * Honesty rules enforced here:
 *   - No claim id is shown. user_claims has only a uuid (no short human id), and
 *     a uuid slice or a hash would be a fabricated identifier, so it is omitted.
 *   - No review date is invented. When the window is unknown the segment is
 *     dropped rather than guessed.
 *   - No confidence or probability is ever rendered.
 *   - View in Radar appears only AFTER the commit. Before it, it competes with
 *     the decision. It is a link the reader may take, never a redirect.
 */

import { useState } from "react";
import { HorizonChip } from "@/components/calls/HorizonChip";
import {
  adoptWindowOptions,
  adoptWindowPhrase,
  adoptWindowValue,
  type AdoptWindow,
} from "@/lib/call-horizons";

/**
 * The reason to commit. Shown ONCE beneath a section heading, never per card.
 *
 * Describes the STANDARD, not a promised event: the window cannot be moved after
 * the fact, and the bar is the same benchmark attribution the desk's own calls
 * are held to (literally the same grader: backend/grading/price_attribution.py
 * serves both). It deliberately does not say a verdict will arrive, because
 * adopted claims are not yet in the grading due-scan
 * (backend/grading/grade_user_claims.py filters source = 'authored').
 *
 * Repeating it above every card turned the strongest sentence in the product
 * into wallpaper. Said once, it is read once and believed.
 */
export const TRACK_TRUST_LINE =
  "Your window is fixed the moment you commit, and misses stay on your record. Same benchmark-attribution bar as the desk's own calls: a move the market explains is not a hit.";

/** Why a call cannot be committed to. Stated, never silently hidden. */
export const UNGRADEABLE_REASON =
  "No honest grader for this claim type yet, so there is nothing to commit to.";

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
 * The monospace ledger entry, rendered beneath a tracked call's claim. The only
 * monospace left on the card: here it signals a record entry, which is exactly
 * what it is.
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
      className={`mt-2 font-mono text-[10px] leading-snug tracking-tight text-text-muted${
        justStamped ? " call-stamp-in" : ""
      }`}
    >
      {buildLedgerLine(claim)}
    </p>
  );
}

/**
 * The trust line, once per section, under the heading.
 *
 * `id` is what each card's button points at with aria-describedby, so the
 * relationship a screen reader needs survives the copy appearing only once.
 */
export function CallsTrustLine({ id = "calls-track-why" }: { id?: string }) {
  return (
    <p
      id={id}
      data-testid="track-trust-line"
      className="font-sans text-[11px] leading-snug text-text-muted"
    >
      {TRACK_TRUST_LINE}
    </p>
  );
}

/**
 * Whether the footer would render anything at all.
 *
 * ScoredObject draws a rule above its footer, so passing a footer that renders
 * null would leave a rule floating under the card with nothing beneath it. Both
 * surfaces ask this first and pass no footer when the answer is no.
 */
export function hasCommitFooter({
  tracked,
  available,
  gradeable = true,
}: {
  tracked: TrackedClaimLike | null | undefined;
  available: boolean;
  gradeable?: boolean;
}): boolean {
  if (tracked) return true;
  if (!gradeable) return true;
  return available;
}

/**
 * The card footer.
 *
 * Renders nothing when `available` is false (signed out, or the claims read
 * failed): offering a button whose only possible outcome is a 401 is worse than
 * omitting it, and an empty footer would leave a rule floating under the card.
 */
export function CallCommitFooter({
  callId,
  tracked,
  available,
  busy,
  window,
  onWindowChange,
  onTrack,
  justStamped = false,
  gradeable = true,
  trustLineId = "calls-track-why",
  error,
}: {
  callId: string;
  tracked: TrackedClaimLike | null;
  available: boolean;
  busy: boolean;
  /**
   * The window being committed to. Preselected from the call's OWN span, which
   * is why this is an AdoptWindow and not a HorizonType: a 13-day call has no
   * bucket, and defaulting it to "1 week" is the exact defect #535 fixed.
   */
  window: AdoptWindow;
  onWindowChange: (w: AdoptWindow) => void;
  onTrack: () => void;
  justStamped?: boolean;
  /**
   * False when the grader cannot resolve this claim type. The control is not
   * rendered at all and the reason is stated: inviting a commitment the system
   * cannot settle is the one thing worse than not offering it.
   */
  gradeable?: boolean;
  /** id of the section's single trust line, for aria-describedby. */
  trustLineId?: string;
  /** Adopt failure, rendered in place. The optimistic state has already been
   *  reverted by the caller; this only says what happened. */
  error?: string | null;
}) {
  if (tracked) {
    return (
      <div data-testid="track-state-tracked">
        <div
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 font-sans text-[11px] text-text-secondary${
            justStamped ? " call-stamp-collapse" : ""
          }`}
        >
          <span className="font-medium text-text-primary">Tracked</span>
          <HorizonChip
            anchor={tracked.resolution_window_start}
            resolveOn={tracked.resolution_window_end}
            variant="phrase"
          />
          {/* Only after the commit. A link, never a redirect. */}
          <a
            href="/radar/calls"
            data-testid="view-in-radar"
            className="ml-auto text-text-muted underline underline-offset-2 hover:text-text-primary"
          >
            View in Radar
          </a>
        </div>
        <CallLedgerLine claim={tracked} justStamped={justStamped} />
      </div>
    );
  }

  if (!gradeable) {
    return (
      <p
        data-testid="track-state-ungradeable"
        className="font-sans text-[11px] leading-snug text-text-faint"
      >
        {UNGRADEABLE_REASON}
      </p>
    );
  }

  if (!available) return null;

  return (
    <UntrackedFooter
      window={window}
      onWindowChange={onWindowChange}
      onTrack={onTrack}
      busy={busy}
      trustLineId={trustLineId}
      error={error ?? null}
    />
  );
}

/**
 * The untracked footer, split out because it holds edit-toggle state.
 *
 * The horizon is SYSTEM-INFERRED, not user-guessed: the preselected window is
 * the call's own span (its resolve_on, fixed at creation from the claim's
 * nature - an event reaction gets days, a structural thesis gets weeks). The
 * reader is TOLD the window as a sentence ("resolves in about a week") instead
 * of being handed a menu they have no basis to pick from. "Change" reveals the
 * old selector for anyone who deliberately wants a different span; picking one
 * keeps the text presentation with the new value.
 */
function UntrackedFooter({
  window,
  onWindowChange,
  onTrack,
  busy,
  trustLineId,
  error,
}: {
  window: AdoptWindow;
  onWindowChange: (w: AdoptWindow) => void;
  onTrack: () => void;
  busy: boolean;
  trustLineId: string;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  // The call's own window first when it is off-bucket, then the three named
  // alternatives. No date picker.
  const options = adoptWindowOptions(window);

  return (
    <div data-testid="track-state-untracked">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {editing ? (
          <label className="flex items-center gap-1.5 font-sans text-[11px] text-text-muted">
            <span className="sr-only">Tracking horizon</span>
            <select
              aria-label="Tracking horizon"
              data-testid="track-horizon-select"
              value={adoptWindowValue(window)}
              disabled={busy}
              autoFocus
              onChange={(e) => {
                const picked = options.find((o) => o.value === e.target.value);
                if (picked) {
                  onWindowChange(picked.window);
                  setEditing(false);
                }
              }}
              onBlur={() => setEditing(false)}
              className="cursor-pointer rounded-md border border-border-subtle bg-transparent px-2 py-1 font-sans text-[11px] text-text-secondary disabled:opacity-50"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="flex items-baseline gap-2 font-sans text-[11px] text-text-muted">
            <span data-testid="track-horizon-phrase">{adoptWindowPhrase(window)}</span>
            <button
              type="button"
              data-testid="track-horizon-change"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="cursor-pointer text-text-faint underline underline-offset-2 hover:text-text-primary disabled:opacity-50"
            >
              change
            </button>
          </span>
        )}
        {/* A real button: bordered, padded, hit-target sized. Existing tokens
            only, no new color. Restraint is the point; this is a record entry,
            not a purchase. */}
        <button
          type="button"
          disabled={busy}
          onClick={onTrack}
          aria-describedby={trustLineId}
          data-testid="track-call-button"
          className="rounded-md border border-border-default bg-transparent px-3 py-1.5 font-sans text-[11px] font-semibold text-text-primary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-gold hover:text-espresso disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Tracking…" : "Track this call"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 font-sans text-[11px] text-text-muted">{error}</p>
      ) : null}
    </div>
  );
}
