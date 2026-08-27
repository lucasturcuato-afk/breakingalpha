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
 *   untracked   the reader's own reasoning, then the window being committed
 *               to, in words, preselected from the call's OWN span (any number
 *               of days, not one of three buckets) and still changeable, next
 *               to a real button. The button does not unlock until the note
 *               clears COMMIT_NOTE_MIN: ruling 11 puts the note inside what
 *               adopting a call MEANS, so the phone sheet and the two desk
 *               surfaces now ask for the same thing in the same words.
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

import { useId, useState } from "react";
import {
  adoptWindowOptions,
  adoptWindowPhrase,
  adoptWindowValue,
  displayLoggedDate,
  resolutionPhrase,
  type AdoptWindow,
} from "@/lib/call-horizons";
/* The DIRECT module, never "@/components/commit". The barrel re-exports
   CommitSheet and CommitSheetProvider, so importing the two numbers through it
   would drag createPortal and next/navigation into the brief, the wrap and
   /radar/calls bundles to read two integers. commit-target imports nothing. */
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN } from "@/components/commit/commit-target";

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

/**
 * The note gate, as a function, so the twelve is testable with no DOM.
 *
 * Trimmed, because that is what gets stored: the adopt route trims before it
 * writes and the column checks `length(btrim(commit_note)) > 0`. A gate that
 * counted raw characters would unlock on twelve spaces and then write nothing.
 */
export function noteMeetsGate(note: string): boolean {
  return note.trim().length >= COMMIT_NOTE_MIN;
}

/* ── The note copy, all four strings reused verbatim from the commit sheet ──
 *
 * Zero new strings. The sheet is the surface where this requirement was
 * written and argued, and the whole point of ruling 11 is that a reader meets
 * the same demand whichever screen they are on, in the same words.
 *
 * Exported beside the trust line above so a test can assert them the way
 * TrackCallControl.test.ts already asserts TRACK_TRUST_LINE.
 *
 * WHAT IS DELIBERATELY NOT REUSED: the sheet's "Why do you think so?" heading
 * and the paragraph under it. In the sheet they appear ONCE, over one call. On
 * Radar there are twelve untracked footers in the grid, so the heading would
 * appear twelve times. That is the exact failure recorded above for the trust
 * line, and twelve h2s inside a card grid is a heading-outline defect on top
 * of it. The desk field carries no heading. CallsTrustLine already sits once
 * above the grid and every button points at it.
 */

/** The prompt inside the empty field. Teaches the register, asserts nothing. */
export const TRACK_NOTE_PROMPT =
  "What has to be true for this, and what would change your mind.";

/** Under the field before the gate is met. */
export const TRACK_NOTE_HINT = "A sentence is enough.";

/** Under the field once it is. Says what the record is worth, not "valid". */
export const TRACK_NOTE_HINT_READY = "Timestamped before the outcome is known.";

/** The button while the gate is unmet. Names the missing thing, not the rule. */
export const TRACK_NOTE_GATED_LABEL = "Write your reasoning first";

/** The field's accessible name. It has no visible label by design. */
export const TRACK_NOTE_ARIA_LABEL = "Your reasoning";

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
 *
 * `todayIso` is the reader's session date, and it exists because a log date can
 * never be in the future. See displayLoggedDate: the adopt route stamps the
 * window in UTC while the product runs on the US-Pacific session date, so a
 * claim adopted after 17:00 PT is born a day ahead. Omit it and the stored
 * value renders as-is, which is what every caller did before.
 */
export function buildLedgerLine(
  claim: TrackedClaimLike,
  todayIso?: string | null,
): string {
  const logged = displayLoggedDate(claim.resolution_window_start, todayIso ?? null)
    ?? isoDay(claim.resolution_window_start);
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
  today,
}: {
  claim: TrackedClaimLike;
  justStamped?: boolean;
  /** The reader's session date (YYYY-MM-DD). Keeps LOGGED out of the future. */
  today?: string | null;
}) {
  return (
    <p
      data-testid="call-ledger-line"
      className={`mt-2 font-mono text-[10px] leading-snug tracking-tight text-text-muted${
        justStamped ? " call-stamp-in" : ""
      }`}
    >
      {buildLedgerLine(claim, today)}
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
  note,
  onNoteChange,
  onTrack,
  justStamped = false,
  gradeable = true,
  trustLineId = "calls-track-why",
  error,
  today,
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
  /**
   * The reader's note in progress, and its setter. The note lives in the
   * CALLER's state keyed by call id, never in this footer.
   *
   * That placement is the whole failure contract. A footer that owned its own
   * note would lose it the moment a failed adopt re-rendered the card, and the
   * sentence a reader wrote is the one thing on this control that cannot be
   * reconstructed. README: "A call that silently fails to save is the worst
   * possible bug in this product." Held above, a 500 leaves the sentence on
   * screen and the retry costs a click.
   *
   * OPTIONAL IN THE TYPE, AND THAT IS RECORDED DEBT, NOT A DESIGN.
   *
   * Ruling 11 makes the note part of what adopting a call MEANS, so this pair
   * is required on every surface that has adopted it: the morning brief and
   * the evening wrap, both through BriefCallsSection. It is `?` for exactly
   * one reason: src/app/radar/calls/page.tsx is the third surface and it is
   * under the /radar sprint fence, so this branch may not wire it. Required
   * props there would not compile, and a required prop defaulted to "" would
   * disable that page's Track button outright, which is a live regression
   * rather than a deferral.
   *
   * So an unwired caller keeps today's ungated footer, unchanged, and the
   * exact diff that wires it is in this PR's body marked NOT APPLIED. When
   * that lands, delete both `?` and this paragraph. Until then
   * e2e/commit-note-gate.spec.ts keeps the /radar/calls case as a declared
   * expected-failure, so the day it starts passing the suite says so.
   */
  note?: string;
  onNoteChange?: (note: string) => void;
  /** The note as typed. The caller trims it; the column stores it trimmed. */
  onTrack: (note: string) => void;
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
  /**
   * The reader's session date (YYYY-MM-DD), US-Pacific. Both date facts on a
   * tracked card are relative to it: when the window resolves, and whether the
   * stored log date is in the reader's future. Passed in, never read from a
   * clock here, so a server render cannot disagree with the client.
   */
  today?: string | null;
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
          {/* When this window resolves, said relative to TODAY. HorizonChip
              renders a duration, and a duration phrased deictically is wrong
              the day after it was logged: a one-day window read "resolves
              tomorrow" on the day it actually closed. */}
          {resolutionPhrase(tracked.resolution_window_end, today) ? (
            <span
              data-testid="horizon-chip"
              title={`Resolves ${tracked.resolution_window_end}`}
              className="font-sans text-[11px] leading-none text-text-muted"
            >
              {resolutionPhrase(tracked.resolution_window_end, today)}
            </span>
          ) : null}
          {/* Only after the commit. A link, never a redirect. */}
          <a
            href="/radar/calls"
            data-testid="view-in-radar"
            className="ml-auto text-text-muted underline underline-offset-2 hover:text-text-primary"
          >
            View in Radar
          </a>
        </div>
        <CallLedgerLine claim={tracked} justStamped={justStamped} today={today} />
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
      note={note}
      onNoteChange={onNoteChange}
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
  note,
  onNoteChange,
  onTrack,
  busy,
  trustLineId,
  error,
}: {
  window: AdoptWindow;
  onWindowChange: (w: AdoptWindow) => void;
  note?: string;
  onNoteChange?: (note: string) => void;
  onTrack: (note: string) => void;
  busy: boolean;
  trustLineId: string;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const hintId = useId();
  // The call's own window first when it is off-bucket, then the three named
  // alternatives. No date picker.
  const options = adoptWindowOptions(window);
  /* A caller that supplies the setter has adopted ruling 11 and is gated. The
     only caller that does not is the fenced /radar/calls page; see the note
     props on CallCommitFooter for why that carve-out exists and when it goes.
     Keyed on the SETTER, not on the text: a reader who has typed nothing has
     an empty note, which is a wired surface with an unmet gate, not an
     unwired one. */
  const gated = typeof onNoteChange === "function";
  const draft = note ?? "";
  const noteReady = gated ? noteMeetsGate(draft) : true;

  return (
    <div data-testid="track-state-untracked">
      {/* THE NOTE, above the window row and the button.
          Reading order is the decision order: say why, choose how long, commit.
          The field is 72px, which is exactly three line boxes at 15px/1.6 (a
          line box measures 24.00px at both the 468px Radar footer and the
          846px brief footer, so one number serves both surfaces), and it
          clears the 44px tap floor with room over.

          The border goes gold when the gate is met, the same signal the sheet
          gives at commit-sheet.tsx:337. DESK tokens only: --gold, not --c-gold.
          tokens.css:50-53 records that the --c-* family is a set of NEAR
          values, identical on light and divergent on dark, so mixing the two
          families on one surface is the token-role error ruling 10 covers.

          No outline is suppressed here. Unlike the sheet, this field is the
          arrival target for /radar/calls?adopt=<id>, and the gold ring
          globals.css:217 already draws on :focus-visible is what says so. */}
      {gated ? (
      <>
        <div
          className={`mb-2.5 rounded-[9px] border bg-transparent px-3 py-2.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none ${
            noteReady ? "border-[var(--gold)]" : "border-border-default"
          }`}
        >
          <textarea
            data-testid="track-note-field"
            value={draft}
            onChange={(e) => onNoteChange?.(e.target.value)}
            disabled={busy}
            maxLength={COMMIT_NOTE_MAX}
            aria-label={TRACK_NOTE_ARIA_LABEL}
            aria-describedby={hintId}
            placeholder={TRACK_NOTE_PROMPT}
            rows={3}
            style={{ minHeight: "72px", resize: "none" }}
            className="w-full rounded-none border-0 bg-transparent p-0 font-sans text-[15px] leading-[1.6] text-text-primary placeholder:text-text-faint disabled:opacity-50"
          />
        </div>
        <p
          id={hintId}
          data-testid="track-note-hint"
          className="mb-3 font-sans text-[11px] leading-snug text-text-muted"
        >
          {noteReady ? TRACK_NOTE_HINT_READY : TRACK_NOTE_HINT}
        </p>
      </>
      ) : null}
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
          disabled={busy || !noteReady}
          onClick={() => onTrack(draft)}
          aria-describedby={trustLineId}
          data-testid="track-call-button"
          className="rounded-md border border-border-default bg-transparent px-3 py-1.5 font-sans text-[11px] font-semibold text-text-primary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-gold hover:text-espresso disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Tracking…" : noteReady ? "Track this call" : TRACK_NOTE_GATED_LABEL}
        </button>
      </div>
      {error ? (
        <p className="mt-2 font-sans text-[11px] text-text-muted">{error}</p>
      ) : null}
    </div>
  );
}
