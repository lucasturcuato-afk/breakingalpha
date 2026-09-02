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
 *               to a real button. The button is live from the first render:
 *               every surface this control serves ADOPTS, and
 *               `decisions/commit-note-optional-when-adopting.md` reverses the
 *               half of ruling 11 that put a note inside what adopting means.
 *               The field stays and asks; nothing is withheld behind it.
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
import { COMMIT_NOTE_MAX } from "@/components/commit/commit-target";
/* The ruling itself, from the module PR #761 put it in, for the same reason
   the line above names the direct module: `@/components/commit` re-exports the
   sheet. `commit-gate` imports one integer and nothing else. */
import {
  ADOPT_NOTE_HINT,
  ADOPT_NOTE_HINT_WRITTEN,
  noteSatisfiesGate,
} from "@/components/commit/commit-gate";
import { COMMIT_BLOCK_REASON } from "@/lib/commit-legality";

/**
 * The reason to commit. Shown ONCE beneath a section heading, never per card.
 *
 * Describes the STANDARD, not a promised event: the window cannot be moved after
 * the fact, and the bar is the same benchmark attribution the desk's own calls
 * are held to (literally the same grader: backend/grading/price_attribution.py
 * serves both). It deliberately does not say a verdict WILL arrive on any given
 * day, only what standard it is held to. Adopted claims are in the due-scan:
 * backend/grading/grade_user_claims.py reads source in ('authored','adopted')
 * and resolves each over its own window. The parenthetical here used to say
 * they were excluded, which stopped being true when that scan widened.
 *
 * Repeating it above every card turned the strongest sentence in the product
 * into wallpaper. Said once, it is read once and believed.
 */
export const TRACK_TRUST_LINE =
  "Your window is fixed the moment you commit, and misses stay on your record. Same benchmark-attribution bar as the desk's own calls: a move the market explains is not a hit.";

/**
 * Why a call cannot be committed to. Stated, never silently hidden.
 *
 * RE-EXPORTED, not declared. The sentence now lives in `src/lib/commit-legality`
 * beside the predicate that decides when it applies, so a lib and a loader can
 * read it without importing a client component, and the three surfaces that
 * print it cannot drift. The old declaration here was the only copy, which is
 * why the mobile Claim screen had to reach into this file for a string.
 */
export const UNGRADEABLE_REASON = COMMIT_BLOCK_REASON.notPriceable;

/**
 * True when anything has actually been written, once trimmed.
 *
 * THIS IS NOT A GATE AND NOTHING IS LOCKED BELOW IT. It is what the field's
 * border and its hint line respond to, so a reader who writes gets an
 * acknowledgement and a reader who does not is never told they failed a check.
 * Same predicate and same role as `commit-sheet.tsx`'s `hasNote`.
 *
 * Trimmed because that is what gets stored: the adopt route trims before it
 * writes and the column checks `length(btrim(commit_note)) > 0`, so whitespace
 * alone must not light the border for a value that will land as null.
 */
export function noteHasContent(note: string): boolean {
  return note.trim().length > 0;
}

/**
 * Whether the desk's press is live, as a function, so the ruling is assertable
 * with no DOM.
 *
 * THIS IS THE ONE PLACE THE RULING IS APPLIED ON THIS SURFACE, and it applies
 * it by calling the shared module rather than restating it. Every surface this
 * control serves adopts, so `noteSatisfiesGate(_, "adopted")` is constantly
 * true; it is called anyway so the file names which side of the ruling it is
 * on in code that cannot drift from a comment. The only thing that can lock
 * the press is a write already in flight.
 *
 * The predecessor was `noteMeetsGate`, a desk-local copy of the authored
 * branch: `note.trim().length >= COMMIT_NOTE_MIN`, applied on three adopt
 * surfaces. It is gone rather than relaxed, because a second implementation of
 * a rule is how the rule ends up with two answers.
 */
export function trackPressReady(note: string, busy: boolean): boolean {
  return noteSatisfiesGate(note, "adopted") && !busy;
}

/**
 * Whether an adopt response proves THIS caller's note reached the row.
 *
 * The only question a surface may clear its draft on, and it is narrower than
 * it looks. `/api/radar/claims/adopt` answers `noteWritten` on two different
 * branches with two different meanings:
 *
 *   INSERT (route.ts:208)  read back off the row this request just created, so
 *                          true means the caller's own note is on it.
 *   ALREADY ADOPTED (:125) `Boolean(existing.commit_note)`, which is true when
 *                          an OLD note is on the row. The route writes an
 *                          incoming note to an existing row ONLY when that row
 *                          has none (:111), so on a call already adopted with
 *                          a note the caller's text is silently discarded and
 *                          this flag is true anyway. It answers "this row
 *                          carries a note", not "your note was written".
 *
 * So the already-adopted branch can never prove it, and this answers false to
 * every shape of it. A stale draft is a nuisance. A sentence deleted because a
 * flag was read as answering a question it does not answer is the failure this
 * whole control exists to prevent.
 *
 * Making the discard case knowable needs a route change (a distinct flag on
 * the :122 branch). That is proposed in PR #694's body rather than taken
 * there, because the route is shared with the mobile commit sheet.
 */
export function noteLandedOnRow(res: {
  alreadyAdopted?: unknown;
  noteWritten?: unknown;
}): boolean {
  return res.alreadyAdopted !== true && res.noteWritten === true;
}

/* ── The note copy. Still zero new strings, and now two fewer of them ───────
 *
 * The two hint strings are GONE FROM THIS FILE and are imported from
 * `commit-gate` instead. They were byte-identical twins of the sheet's, and
 * one of the pair described a floor that no longer exists: "A sentence is
 * enough." is a statement about a minimum, and there is no minimum on this
 * path any more. PR #761 already argued and replaced that string on the sheet;
 * re-deriving a desk answer would be the second implementation of a decision
 * that has one.
 *
 * The two that remain are desk-specific and are argued below.
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

/**
 * The button, in its one resting state.
 *
 * THERE IS NO SECOND LABEL. "Write your reasoning first" was the gate's voice,
 * naming a step the reader had to take before the control would work. With
 * nothing to take first, a control that still said it would be describing a
 * rule that does not exist. Same deletion the sheet made at
 * `commit-gate.ts`'s ADOPT_PRESS_LABEL, for the same reason.
 *
 * The sheet's own label is NOT reused: it reads "Press to enter this on your
 * ledger" because that control is a press-and-hold, and the desk's is a click.
 * A label naming a gesture the desk does not use would be false.
 */
export const TRACK_PRESS_LABEL = "Track this call";

/** The field's accessible name. It has no visible label by design. */
export const TRACK_NOTE_ARIA_LABEL = "Your reasoning";

/**
 * The note pair. A plain required pair, which is what the union that used to
 * live here said to collapse it to.
 *
 * THE UNION IS GONE. Its second member existed for exactly one caller,
 * `src/app/radar/calls/page.tsx`, which was under the /radar sprint fence and
 * therefore could not be wired; `noteGate: false` bought that page a footer
 * with no field rather than a permanently disabled button. The fence is off,
 * the page is wired, and the carve-out has no member left. Its own comment
 * said to delete this paragraph when that happened.
 *
 * Required, not optional, and that is the whole contract. An older version
 * derived behaviour from `typeof onNoteChange === "function"`, which let a
 * caller pass `note` and forget `onNoteChange` and get a dead read-only field
 * with NO type error. Presence is not a contract. Two required props are.
 */
export interface CallCommitNoteProps {
  /**
   * The reader's note in progress. It lives in the CALLER's state keyed by
   * call id, never in this footer.
   *
   * That placement is the whole failure contract. A footer that owned its own
   * note would lose it the moment a failed adopt re-rendered the card, and the
   * sentence a reader wrote is the one thing on this control that cannot be
   * reconstructed. README: "A call that silently fails to save is the worst
   * possible bug in this product." Kept above, a 500 leaves the sentence on
   * screen and the retry costs a click.
   *
   * It matters MORE now, not less. Nothing withholds the button, so a reader
   * can write a considered sentence and press in one motion, and losing it on
   * a failed write would be losing the only unreconstructable thing on the
   * card at the exact moment the reader is least willing to retype it.
   */
  note: string;
  onNoteChange: (note: string) => void;
}

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
} & CallCommitNoteProps) {
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
  note: string;
  onNoteChange: (note: string) => void;
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

  /* Whether anything has been written. It moves the border and the hint line
     and it locks NOTHING. See `noteHasContent`. */
  const written = noteHasContent(note);

  /* The only thing that can lock the button is a write already in flight.
     `noteSatisfiesGate(_, "adopted")` is constantly true and is called anyway,
     so this file names which side of the ruling it is on at the one place the
     decision is used rather than in a comment that can drift from the code.
     Copied deliberately from `commit-sheet.tsx:145`, which is the shape PR
     #761 left behind. */
  const ready = trackPressReady(note, busy);

  return (
    <div data-testid="track-state-untracked">
      {/* THE NOTE, above the window row and the button.
          Reading order is the decision order: say why, choose how long, commit.
          The field is 72px, which is exactly three line boxes at 15px/1.6 (a
          line box measures 24.00px at both the 468px Radar footer and the
          846px brief footer, so one number serves both surfaces), and it
          clears the 44px tap floor with room over.

          The border goes gold once anything is WRITTEN, which is the signal
          the sheet gives and is no longer the same thing as a gate being met:
          it acknowledges the reader, it does not report a check passing.
          DESK tokens only: --gold, not --c-gold.
          tokens.css:50-53 records that the --c-* family is a set of NEAR
          values, identical on light and divergent on dark, so mixing the two
          families on one surface is the token-role error ruling 10 covers.

          No outline is suppressed here. Unlike the sheet, this field is the
          arrival target for /radar/calls?adopt=<id>, and the gold ring
          globals.css:217 already draws on :focus-visible is what says so. */}
      {/* UNCONDITIONAL. The field used to render only for a caller that opted
          into the gate, which meant dropping the gate would have deleted the
          field from the surfaces that had one and left /radar/calls with
          neither. The ruling keeps the field on every adopt surface and drops
          the gate on every adopt surface, so the two stopped being one flag. */}
      <>
        <div
          className={`mb-2.5 rounded-[9px] border bg-transparent px-3 py-2.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none ${
            written ? "border-[var(--gold)]" : "border-border-default"
          }`}
        >
          <textarea
            data-testid="track-note-field"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            /* readOnly, NOT disabled. A hung request would otherwise lock the
               reader out of the one thing on this card that cannot be
               reconstructed, which is the exact failure this control exists to
               prevent. Read-only still allows select and copy. */
            readOnly={busy}
            maxLength={COMMIT_NOTE_MAX}
            aria-label={TRACK_NOTE_ARIA_LABEL}
            aria-describedby={hintId}
            placeholder={TRACK_NOTE_PROMPT}
            rows={3}
            style={{ minHeight: "72px", resize: "none" }}
            className="w-full rounded-none border-0 bg-transparent p-0 font-sans text-[15px] leading-[1.6] text-text-primary placeholder:text-text-faint read-only:opacity-60"
          />
        </div>
        <p
          id={hintId}
          data-testid="track-note-hint"
          className="mb-3 font-sans text-[11px] leading-snug text-text-muted"
        >
          {written ? ADOPT_NOTE_HINT_WRITTEN : ADOPT_NOTE_HINT}
        </p>
      </>
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
          disabled={!ready}
          onClick={() => onTrack(note)}
          aria-describedby={trustLineId}
          data-testid="track-call-button"
          className="rounded-md border border-border-default bg-transparent px-3 py-1.5 font-sans text-[11px] font-semibold text-text-primary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-gold hover:text-espresso disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Tracking…" : TRACK_PRESS_LABEL}
        </button>
      </div>
      {error ? (
        <p className="mt-2 font-sans text-[11px] text-text-muted">{error}</p>
      ) : null}
    </div>
  );
}
