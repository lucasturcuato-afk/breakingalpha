"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdoptWindow } from "@/lib/call-horizons";
/* `./fixture` is NOT imported here and must never be. This is a client
   component, so a value import from that module is a download of the invented
   draft, the invented note and both invented proposals: the gate stops the
   render and not the download. Everything below is content-free, and the seed
   arrives as a required prop, built on the server by
   `src/app/compose/page.tsx` behind `COMPOSE_FIXTURE_ENABLED`. */
import { COMPOSE_FIXTURE_ENABLED } from "./fixture-gate";
import {
  DRAFT_MIN_CHARS,
  EMPTY_SEED,
  MAX_CLAIM_CHARS,
  MAX_NOTE_CHARS,
  NOTE_MIN_CHARS,
  composeWindowChoices,
  composeWindowEnd,
  composeWindowFor,
  composeWindowKey,
  composeWindowLabel,
  composeWindowPhrase,
  longDate,
  type ComposeProposal,
  type ComposeSeed,
  type ComposeStage,
  type Direction,
} from "./compose-data";
import styles from "./compose.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Compose. "Write your own call": the free-text composer promoted from a
 * section inside /radar/calls to a screen of its own.
 *
 * WIRED. One control, two presses, two requests, in this order and never
 * folded together:
 *
 *   1. "Read it back" POSTs the draft to `/api/radar/claims/author`, which
 *      runs Gemini and answers with a proposal. This is the LONGEST-LIVED
 *      state on the screen and it has its own: the route tries gemini-2.5-pro
 *      and falls back to gemini-2.5-flash inside a catch, with no timeout and
 *      no abort signal, so a reader waits for pro and, on the fallback path,
 *      for pro's timeout PLUS a whole flash call. Hiding that inside the
 *      commit press would be several silent seconds on the press that writes.
 *   2. "Track it" POSTs to `/api/radar/claims`, which is the authored insert.
 *
 * Gradeability is SERVER-gated. The prototype computes it in the browser from a
 * hardcoded instrument list; reproducing that would put a client-side verdict
 * on a screen whose whole argument is that the desk checks the claim. So no
 * branch below reads the draft text to decide whether a claim can be graded.
 *
 * WHAT A FAILED WRITE MUST NOT TOUCH: anything. On `save-error` the phase is
 * the only thing that moves. Two of the values on screen cannot be
 * reconstructed at any price. The note is the reader's own sentence and exists
 * nowhere else. The proposal costs another multi-second model call. The fields
 * stay mounted because `readOnly` rather than a branch keeps them there, so
 * this survives by construction as long as no handler reaches for a reset.
 *
 * AND A FAILED WRITE OFFERS NO RETRY. See `saveFailed` below.
 */

const PAD = "var(--v3-pad)";

const EYEBROW = {
  marginTop: "20px",
  font: `400 10px/1 ${FONT_MONO}`,
  letterSpacing: "0.07em",
  color: "var(--c-muted)",
  display: "block",
} as const;

const CARD = {
  marginTop: "20px",
  padding: "15px 16px",
  border: "1px solid var(--c-border)",
  borderRadius: "12px",
  backgroundColor: "var(--c-surface)",
} as const;

const DIRECTION_LABEL: Record<Direction, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const DIRECTIONS: Direction[] = ["bullish", "bearish", "neutral"];

/**
 * Where the screen is in its own lifecycle.
 *
 * NOT `ComposeStage`. That type enumerates the nine states a reader can be
 * SHOWN, and four of them are distinguished by the proposal rather than by the
 * phase: gradeable and context differ only in `proposal.gradeable`, and so do
 * committed and committed-context. The phase carries what a request is doing;
 * the proposal carries what the desk said. Collapsing them is how a screen
 * ends up with two sources of truth for one pixel.
 */
type ComposePhase =
  | "idle"
  | "analyzing"
  | "analyze-error"
  | "saving"
  | "save-error"
  | "committed";

/**
 * The phase a SEEDED stage opens on. Dev and preview only, behind
 * COMPOSE_FIXTURE_ENABLED, and the only way a runtime audit can stand in front
 * of `saving` or `save-error` without a real row and a real refusal.
 */
function phaseForStage(stage: ComposeStage): ComposePhase {
  switch (stage) {
    case "analyzing":
      return "analyzing";
    case "analyze-error":
      return "analyze-error";
    case "saving":
      return "saving";
    case "save-error":
      return "save-error";
    case "committed":
    case "committed-context":
      return "committed";
    default:
      return "idle";
  }
}

/**
 * A read-back, read off the author route's answer.
 *
 * Validated rather than cast. The route already enforces every rule that
 * matters (gradeability, the window bounds, the alternative's shape), so this
 * is not a second opinion about the claim: it is the narrow check that the
 * thing on the wire has the fields this screen branches on. Anything it cannot
 * read comes back null, and null is drawn as an analyze error rather than as a
 * half-populated card.
 */
function readProposal(payload: unknown): ComposeProposal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = (payload as { proposal?: unknown }).proposal;
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;

  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const dir = (v: unknown): Direction | null =>
    v === "bullish" || v === "bearish" || v === "neutral" ? v : null;

  return {
    claim_type: str(p.claim_type) ?? "other",
    target_symbol: str(p.target_symbol),
    expected_direction: dir(p.expected_direction),
    resolution_window_start: str(p.resolution_window_start),
    resolution_window_end: str(p.resolution_window_end),
    evidence_entities: Array.isArray(p.evidence_entities)
      ? p.evidence_entities.filter((e): e is string => typeof e === "string")
      : [],
    confidence_in_reduction:
      typeof p.confidence_in_reduction === "number" ? p.confidence_in_reduction : null,
    gradeable: p.gradeable === true,
    gradeability_note: str(p.gradeability_note),
    gradeable_alternative: readAlternative(p.gradeable_alternative),
  };
}

/** The proxy reduction, when the route offered one that survived its own rules. */
function readAlternative(raw: unknown): ComposeProposal["gradeable_alternative"] {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const symbol = typeof a.target_symbol === "string" ? a.target_symbol : "";
  const start = typeof a.resolution_window_start === "string" ? a.resolution_window_start : "";
  const end = typeof a.resolution_window_end === "string" ? a.resolution_window_end : "";
  const rationale = typeof a.rationale === "string" ? a.rationale : "";
  const direction =
    a.expected_direction === "bullish" ||
    a.expected_direction === "bearish" ||
    a.expected_direction === "neutral"
      ? a.expected_direction
      : null;
  /* Every field is drawn on the "Make it gradeable" control, so a partial
     alternative would render a control with a gap in its own label. */
  if (!symbol || !start || !end || !rationale || !direction) return null;
  return {
    claim_type: typeof a.claim_type === "string" ? a.claim_type : "other",
    target_symbol: symbol,
    expected_direction: direction,
    resolution_window_start: start,
    resolution_window_end: end,
    rationale,
  };
}

export function ComposeScreen({
  stage = "empty",
  /**
   * What the composer opens on. REQUIRED and NULLABLE, never optional and
   * never defaulted. The caller resolves the gate and passes `seedFor(stage)`
   * or null; leaving the prop off is a build failure rather than an invented
   * call in front of a reader.
   */
  seed,
  /**
   * The reader's US-Pacific session date, ISO. REQUIRED, and passed in rather
   * than read off a clock here, so a server render and a client render cannot
   * disagree about which day it is. `commit-target.ts` states the same rule
   * for the commit sheet and `src/lib/ledger-data.ts` supplies it to /ledger.
   *
   * This is not a display nicety. Every window on this screen resolves from
   * it: the settlement date the reader agrees to, and the
   * `resolution_window_end` the write carries. A window resolved off a fixed
   * anchor in the past is refused by `/api/radar/claims` POST, which requires
   * `resolution_window_end > todayIso`, and refused SILENTLY: the row is
   * written with `gradeable: false` and the screen reads as though it worked.
   */
  sessionIso,
}: {
  stage?: ComposeStage;
  seed: ComposeSeed | null;
  sessionIso: string;
}) {
  /* Re-checked here, not trusted from the page. `EMPTY_SEED` is two blank
     fields and no proposal, which asserts nothing: it is what a real composer
     opens on and what production draws. */
  const seeded = COMPOSE_FIXTURE_ENABLED && seed !== null;
  const opening = seeded ? seed : EMPTY_SEED;
  const [draft, setDraft] = useState(opening.draft);
  const [note, setNote] = useState(opening.note);
  const [proposal, setProposal] = useState<ComposeProposal | null>(opening.proposal);
  const [direction, setDirection] = useState<Direction>(
    opening.proposal?.expected_direction ?? "bullish",
  );
  /* THE DESK'S OWN SPAN, derived from the proposal's window and never
     transcribed. A chip that is hardcoded agrees with `resolution_window_end`
     only by coincidence, and stops agreeing the moment the window moves.

     An `AdoptWindow`, NOT a bare `HorizonType`. The author route infers spans
     the four buckets do not name, and a bucket-typed selection silently
     rounded every one of them to the mount default: measured, seven of eleven
     spans were written wrong, including every structural claim. See
     `composeWindowFor`. */
  const [span, setSpan] = useState<AdoptWindow>(
    composeWindowFor(
      opening.proposal?.resolution_window_start,
      opening.proposal?.resolution_window_end,
    ),
  );

  /* REAL LIFECYCLE STATE, driven by the two requests below. `stage` seeds it
     and then never touches it again: the URL is a dev and preview way IN to a
     state, not the thing that keeps it. Outside the fixture gate the seed is
     always `idle`, whatever the URL says. */
  const [phase, setPhase] = useState<ComposePhase>(
    seeded ? phaseForStage(stage) : "idle",
  );

  const committed = phase === "committed";
  const busy = phase === "saving";
  const analyzing = phase === "analyzing";
  const saveFailed = phase === "save-error";
  const draftOk = draft.trim().length >= DRAFT_MIN_CHARS;
  const noteOk = note.trim().length >= NOTE_MIN_CHARS;
  const gradeable = proposal?.gradeable === true;

  const error =
    phase === "analyze-error"
      ? "Could not analyze the claim."
      : saveFailed
        ? "The desk did not acknowledge this call, so it may or may not be on your ledger. Everything you wrote is still here."
        : null;

  const hint = analyzing
    ? "Analyzing…"
    : !draftOk
      ? "A sentence is enough."
      : proposal === null
        ? "Signalera has not read this back yet."
        : gradeable
          ? "Signalera can check this."
          : "Signalera cannot check this one as written.";

  const count = draft.trim().length ? `${draft.trim().length} characters` : "";

  /*
    NO RETRY AFTER AN UNACKNOWLEDGED WRITE, and this is a ruling rather than an
    omission.

    The commit sheet can safely offer "Try again" because /api/radar/claims/adopt
    is IDEMPOTENT: it keys on adopted_from_call_id, finds the existing row, and
    hands it back. /api/radar/claims POST has no such guard and an authored
    claim has no natural key to build one from, so a second press after a
    dropped connection creates a SECOND row on the reader's ledger, describing
    the same view twice. That is worse than a write the reader has to go and
    check on, because it is silent and it is permanent.

    So `saveFailed` closes the control for the rest of this mount and the error
    routes the reader to /ledger instead. Editing the draft does not reopen it:
    the first write may well have landed, and the reader needs to look before
    writing anything else.

    IT CLOSES THE READ-BACK TOO, and that conjunct is not decoration. Editing
    the draft clears `proposal`, which on its own made `readyToRead` true again
    and handed back an ENABLED control still labelled "Not acknowledged": it
    would have spent a model call and then dead-ended, because the commit half
    stays shut. One state, one answer. The e2e spec asserts it.

    THE EVENTUAL FIX is a client-generated idempotency key on the insert, which
    is a second API change and was scoped out of this one. It is named in the
    PR body as the known limitation this paragraph describes.
  */
  const readyToCommit =
    draftOk && noteOk && proposal !== null && !committed && !busy && !saveFailed;
  const readyToRead = draftOk && noteOk && proposal === null && !analyzing && !saveFailed;

  const submitLabel = committed
    ? gradeable
      ? "◆ On your ledger"
      : "◆ Tracked as context"
    : busy
      ? "Saving…"
      : /* In flight, the same way `busy` is. Without this branch the control
           fell through to the locked "Write the claim and your reasoning" on
           ?stage=analyzing, telling the user to write the thing they had just
           submitted, directly under a hint reading "Analyzing…". */
        analyzing
        ? "Reading it back…"
        : saveFailed
          ? /* Locked, and saying why it is locked. Falling through to "Write
               the claim and your reasoning" would tell a reader who has just
               written both to write them again. */
            "Not acknowledged"
          : readyToCommit
        ? gradeable
          ? "Track it"
          : "Track as context"
        : readyToRead
          ? "Read it back"
          : "Write the claim and your reasoning";

  const unlocked = readyToCommit || readyToRead;

  /*
    PRESS ONE. The draft goes to the author route and comes back a proposal.

    Nothing is persisted by this request, so a failure is freely retryable:
    `proposal` is still null afterwards, which puts the control back on "Read
    it back" with no further branch needed.
  */
  async function readItBack() {
    setPhase("analyzing");
    try {
      const res = await fetch("/api/radar/claims/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_text: draft.trim() }),
      });
      if (!res.ok) {
        setPhase("analyze-error");
        return;
      }
      const read = readProposal(await res.json().catch(() => null));
      if (!read) {
        setPhase("analyze-error");
        return;
      }
      setProposal(read);
      /* The chips PRESELECT from the read-back and are the reader's from then
         on. Direction only moves when the route actually said something; a
         null direction leaves the current chip alone rather than snapping it
         to a value the reader did not choose.

         THE SPAN IS SET UNCONDITIONALLY, and that is the whole repair. The
         desk inferred a length from the claim, and `composeWindowFor` keeps it
         verbatim as `as-called` when it is not one of the four buckets. There
         is no fallback here to fall through to any more. */
      if (read.expected_direction) setDirection(read.expected_direction);
      setSpan(composeWindowFor(read.resolution_window_start, read.resolution_window_end));
      setPhase("idle");
    } catch {
      setPhase("analyze-error");
    }
  }

  /*
    PRESS TWO. The write.

    THE BODY IS BUILT FROM THE CHIPS, NOT FROM THE PROPOSAL. `direction` and
    `span` are independent state: the two chip rows call setDirection and
    setSpan and never touch `proposal`, so sending proposal.expected_direction
    and proposal.resolution_window_end would discard every edit the reader made
    to the read-back, silently, on the one press that matters.

    The other half of that rule is that an UNEDITED chip must still carry the
    desk's own answer. `span` is seeded from the proposal's real span rather
    than snapped to a bucket, so "built from the chips" and "the desk's window
    survives" are the same statement rather than competing ones.

    And the window resolves from `sessionIso`, never from the fixture anchor.
    See the prop's own comment for what that costs when it is wrong.
  */
  async function commit() {
    if (!proposal) return;
    setPhase("saving");

    /* The chip rows render only on a gradeable proposal. On a context claim
       there is no direction chip and no RESOLVES chip on screen, so `direction`
       is still its mount default and there is no window the reader agreed to.
       Sending either would be inventing a decision they were never offered, so
       the proposal's own values go instead, which for a context claim is a
       null direction and no window. */
    const expectedDirection = gradeable ? direction : proposal.expected_direction;
    const windowEnd = gradeable
      ? composeWindowEnd(sessionIso, span)
      : proposal.resolution_window_end;

    try {
      const res = await fetch("/api/radar/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_claim: draft.trim(),
          claim_type: proposal.claim_type,
          target_symbol: proposal.target_symbol,
          expected_direction: expectedDirection,
          /* Sent explicitly rather than left to the route's `?? todayIso`
             fallback. The two agree today; an audit of the request should not
             have to read the route to know what day the window opened. */
          resolution_window_start: sessionIso,
          resolution_window_end: windowEnd,
          evidence_entities: proposal.evidence_entities,
          confidence_in_reduction: proposal.confidence_in_reduction,
          gradeable: proposal.gradeable,
          gradeability_note: proposal.gradeability_note,
          /* The reasoning. Trimmed here and trimmed again in the route, which
             is what the column's own length(btrim(...)) check depends on.
             `commit_note_at` is deliberately NOT sent: the route stamps the
             moment, in the same object as the note, so the pair cannot come
             apart. */
          commit_note: note.trim(),
        }),
      });
      if (!res.ok) {
        setPhase("save-error");
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      const id =
        body !== null && typeof body === "object" && "id" in body
          ? (body as { id?: unknown }).id
          : null;
      /* A 200 with no row id is not an acknowledgement. Treating it as one is
         how a write that did not happen becomes a screen that says it did.
         Copied from commit-sheet.tsx, which is the only surface in the repo
         that has ever got this right. */
      if (typeof id !== "string" || !id) {
        setPhase("save-error");
        return;
      }
      setPhase("committed");
    } catch {
      /* A thrown fetch and a non-ok response land in the same place. A dropped
         connection and a refusal are indistinguishable to a reader and must
         not be told apart on screen, because neither one proves the row is
         absent. */
      setPhase("save-error");
    }
  }

  return (
    <div
      data-parity="compose"
      style={{
        backgroundColor: "var(--c-bg)",
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: "none",
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          padding: `0 ${PAD}`,
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <Link
          href="/ledger"
          className={styles.focusable}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: `500 13px/1 ${FONT_SANS}`,
            color: "var(--c-secondary)",
            textDecoration: "none",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Ledger
        </Link>
      </div>

      <div style={{ flex: 1, padding: `22px ${PAD} 24px` }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.15 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Write your own call
        </h1>
        <p
          style={{
            margin: "9px 0 0",
            font: `400 13px/1.6 ${FONT_SANS}`,
            color: "var(--c-body)",
            textWrap: "pretty",
          }}
        >
          Say it in your own words. Signalera reads it back as a claim it can
          check, and if it cannot be checked it says so and offers a version
          that can. Graded exactly the same way as the desk&apos;s.
        </p>

        <label htmlFor="compose-claim" style={EYEBROW}>
          IN YOUR OWN WORDS
        </label>
        <div
          style={{
            marginTop: "10px",
            padding: "13px 14px",
            border: `1px solid ${draftOk ? "var(--c-gold)" : "var(--c-border)"}`,
            borderRadius: "12px",
            backgroundColor: "var(--c-bg)",
            transition: "border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <textarea
            id="compose-claim"
            className={`${styles.field} ${styles.focusable}`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              /* A read-back describes the sentence it was handed. Editing that
                 sentence invalidates it, so the READ AS card must not keep
                 describing text the user has already replaced, and the control
                 must not still offer "Track it" over it. The repo composer
                 makes the same move behind its "Edit words" control at
                 src/app/radar/calls/page.tsx line 1176. */
              if (proposal !== null) setProposal(null);
            }}
            maxLength={MAX_CLAIM_CHARS}
            /* `analyzing` locks it too, and that is not tidiness. The read-back
               describes the sentence it was HANDED, and the author route has no
               timeout and no abort signal, so an edit made while it is in
               flight would be answered seconds later by a READ AS card about
               text the reader had already replaced. The onChange guard below
               cannot catch that: it clears a proposal that exists, and during
               the request there is not one yet. The control reads "Reading it
               back…" and the hint reads "Analyzing…" throughout, so the screen
               already says why the field is closed. */
            readOnly={committed || busy || analyzing}
            placeholder="In your own words, e.g. NVDA gives back the ramp hype by earnings"
            style={{
              minHeight: "78px",
              font: `500 16px/1.45 ${FONT_DISPLAY}`,
              color: "var(--c-ink)",
            }}
          />
        </div>
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span
            aria-live="polite"
            style={{ font: `400 11px/1.4 ${FONT_SANS}`, color: "var(--c-muted)" }}
          >
            {hint}
          </span>
          <span
            style={{
              font: `400 10.5px/1 ${FONT_MONO}`,
              letterSpacing: "0.045em",
              color: "var(--c-muted)",
            }}
          >
            {count}
          </span>
        </div>

        {analyzing ? <AnalyzingCard /> : null}

        {error ? (
          <div role="alert" className={styles.enter} style={{ marginTop: "16px" }}>
            <p
              style={{
                margin: 0,
                font: `400 12.5px/1.55 ${FONT_SANS}`,
                color: "var(--c-redink)",
                textWrap: "pretty",
              }}
            >
              {error}
            </p>
            {/* The one way forward after an unacknowledged write, and it is a
                real link rather than a control that would post again. See the
                ruling beside `readyToCommit`. */}
            {saveFailed ? (
              <Link
                href="/ledger"
                className={styles.focusable}
                style={{
                  marginTop: "4px",
                  minHeight: "44px",
                  display: "inline-flex",
                  alignItems: "center",
                  font: `600 12.5px/1.4 ${FONT_SANS}`,
                  color: "var(--c-goldink)",
                }}
              >
                Open your ledger and check
              </Link>
            ) : null}
          </div>
        ) : null}

        {proposal && !gradeable ? (
          <div className={styles.enter} style={CARD}>
            <div
              style={{
                font: `400 10px/1 ${FONT_MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              NOT CHECKABLE AS WRITTEN
            </div>
            <p
              style={{
                margin: "10px 0 0",
                font: `400 13.5px/1.65 ${FONT_SANS}`,
                color: "var(--c-body)",
                textWrap: "pretty",
              }}
            >
              No instrument was found in this sentence, so there is nothing a
              grader could measure. Name a company or a ticker and it becomes a
              call. Leave it as it is and it goes on as context, which is never
              graded.
            </p>
            {proposal.gradeable_alternative && !committed ? (
              <>
                <p
                  style={{
                    margin: "11px 0 0",
                    font: `400 12px/1.55 ${FONT_SANS}`,
                    color: "var(--c-muted)",
                    textWrap: "pretty",
                  }}
                >
                  Proxy that captures the intent:{" "}
                  {proposal.gradeable_alternative.rationale}
                </p>
                <button
                  type="button"
                  className={styles.focusable}
                  onClick={() => {
                    const alt = proposal.gradeable_alternative;
                    if (!alt) return;
                    /* Propose-and-confirm, not reject. The same local swap the
                       repo control makes at radar/calls line 1145: the user's
                       words stay the headline and only the resolution moves. No
                       request is made here either. */
                    setProposal({
                      ...proposal,
                      claim_type: alt.claim_type,
                      target_symbol: alt.target_symbol,
                      expected_direction: alt.expected_direction,
                      resolution_window_start: alt.resolution_window_start,
                      resolution_window_end: alt.resolution_window_end,
                      gradeable: true,
                      gradeability_note: null,
                      gradeable_alternative: null,
                    });
                    setDirection(alt.expected_direction);
                    /* The proxy's OWN span, kept the same way the primary
                       read-back's is. The alternatives the route offers are
                       bounded only by MAX_WINDOW_DAYS, so most of them are
                       off-bucket and a bucket-typed swap rounded them away. */
                    setSpan(
                      composeWindowFor(
                        alt.resolution_window_start,
                        alt.resolution_window_end,
                      ),
                    );
                  }}
                  style={{
                    marginTop: "12px",
                    width: "100%",
                    minHeight: "44px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 12px",
                    borderRadius: "9px",
                    border: "1px solid var(--c-gold)",
                    backgroundColor: "var(--c-well)",
                    font: `600 12.5px/1.3 ${FONT_SANS}`,
                    color: "var(--c-goldink)",
                    cursor: "pointer",
                    textWrap: "pretty",
                  }}
                >
                  {/* THE DATE THIS CONTROL NAMES IS THE DATE PRESSING IT
                      WRITES. It used to state the alternative's stored
                      `resolution_window_end`, which is measured from the
                      route's own anchor, while the press resolved a window
                      from the reader's session date. A reader accepted a proxy
                      labelled Oct 12 and the row carried Sep 4, one press from
                      the write with nothing in between. Both sides now go
                      through `composeWindowEnd` from `sessionIso`. */}
                  {`Make it gradeable: ${proposal.gradeable_alternative.target_symbol} \u00b7 ${DIRECTION_LABEL[proposal.gradeable_alternative.expected_direction]} \u00b7 by ${longDate(
                    composeWindowEnd(
                      sessionIso,
                      composeWindowFor(
                        proposal.gradeable_alternative.resolution_window_start,
                        proposal.gradeable_alternative.resolution_window_end,
                      ),
                    ),
                  )}`}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {proposal && gradeable ? (
          <>
            <div className={styles.enter} style={CARD}>
              <div
                style={{
                  font: `400 10px/1 ${FONT_MONO}`,
                  letterSpacing: "0.07em",
                  color: "var(--c-muted)",
                }}
              >
                READ AS
              </div>
              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ font: `500 13px/1 ${FONT_MONO}`, color: "var(--c-ink)" }}>
                  {proposal.target_symbol}
                </span>
                <Dot />
                <span style={{ font: `600 12.5px/1 ${FONT_SANS}`, color: "var(--c-ink)" }}>
                  {DIRECTION_LABEL[direction]}
                </span>
                <Dot />
                <span style={{ font: `400 12px/1 ${FONT_SANS}`, color: "var(--c-body)" }}>
                  {/* The REAL span, not a bucket it was rounded into. A 45-day
                      structural claim reads "resolves in 45 days" here. */}
                  {composeWindowPhrase(span)}
                </span>
              </div>
              <p
                style={{
                  margin: "11px 0 0",
                  font: `400 12px/1.55 ${FONT_SANS}`,
                  color: "var(--c-body)",
                  textWrap: "pretty",
                }}
              >
                Measured against its sector and the market on the settlement date. Change anything below that the reading got wrong.
              </p>
            </div>

            <div id="compose-direction" style={EYEBROW}>
              DIRECTION
            </div>
            <div
              role="group"
              aria-labelledby="compose-direction"
              style={{ marginTop: "10px", display: "flex", gap: "12px", flexWrap: "wrap" }}
            >
              {DIRECTIONS.map((d) => (
                <Chip
                  key={d}
                  on={direction === d}
                  label={DIRECTION_LABEL[d]}
                  disabled={committed || busy}
                  onSelect={() => setDirection(d)}
                />
              ))}
            </div>

            <div id="compose-resolves" style={EYEBROW}>
              RESOLVES
            </div>
            <div
              role="group"
              aria-labelledby="compose-resolves"
              style={{ marginTop: "10px", display: "flex", gap: "12px", flexWrap: "wrap" }}
            >
              {/* The desk's own span leads the row when it is off-bucket, so
                  the reader can see what was inferred and can still choose
                  something else. Pressing a chip overrides it, which is the
                  reader's decision and wins. */}
              {composeWindowChoices(span).map((w) => (
                <Chip
                  key={composeWindowKey(w)}
                  on={composeWindowKey(w) === composeWindowKey(span)}
                  label={composeWindowLabel(w)}
                  spoken={composeWindowPhrase(w)}
                  disabled={committed || busy}
                  onSelect={() => setSpan(w)}
                />
              ))}
            </div>
            <p
              style={{
                margin: "10px 0 0",
                font: `400 11.5px/1.55 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              {/* Resolved from `sessionIso`, the same value and the same
                  function the write below resolves `resolution_window_end`
                  with. The date the reader agrees to IS the date the row
                  carries, because there is one anchor and one call. */}
              Settles {longDate(composeWindowEnd(sessionIso, span))}. Fixed at
              entry and cannot be moved afterwards.
            </p>
          </>
        ) : null}

        <label htmlFor="compose-note" style={EYEBROW}>
          WHY YOU THINK SO
        </label>
        <div
          style={{
            marginTop: "10px",
            padding: "13px 14px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-bg)",
          }}
        >
          <textarea
            id="compose-note"
            className={`${styles.field} ${styles.focusable}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE_CHARS}
            readOnly={committed || busy}
            placeholder="The reasoning a reader of your record will judge."
            style={{
              minHeight: "64px",
              font: `400 italic 14.5px/1.6 ${FONT_DISPLAY}`,
              color: "var(--c-ink)",
            }}
          />
        </div>
        <p
          style={{
            margin: "14px 0 0",
            font: `400 11.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          Informational only. A call is a record of your reasoning, not advice
          and not a recommendation to anyone.
        </p>
      </div>

      <div
        style={{
          flex: "none",
          padding: `12px ${PAD} 16px`,
          borderTop: "1px solid var(--c-border)",
          backgroundColor: "var(--c-bg)",
          /*
            Pinned just above the tab bar, at every scroll position and on
            every state.

            The design pins this footer to the bottom of an 844px phone frame.
            In the shell it cannot simply sit last in the flow: `main` reserves
            the tab bar's band with padding-bottom, and Chrome drops a scroll
            container's bottom padding once its content overflows. Measured on
            this screen before the fix, the commit control ended 43px behind
            the tab bar on every state tall enough to scroll.

            Sticky puts it in exactly one place. `bottom: 0` is measured, not
            assumed: a sticky element's offsets resolve against the scrollport's
            CONTENT box, which is already inset by that same padding, so zero
            lands the footer's bottom edge exactly on the tab bar's top edge. On
            a short state nothing scrolls and sticky changes nothing, so the
            control lands in the same 52px band either way.
          */
          position: "sticky",
          bottom: 0,
        }}
      >
        <button
          type="button"
          data-testid="compose-submit"
          className={styles.focusable}
          /*
            ONE control, TWO presses. Which request fires is decided by whether
            a read-back exists, which is the same thing the label says, so the
            control can never do something other than what it is offering.

            `readyToCommit` is checked FIRST. Both flags cannot be true at once
            today (one wants `proposal !== null` and the other `=== null`), and
            ordering them rather than relying on that keeps a future third
            state from silently choosing the write.
          */
          onClick={() => {
            if (readyToCommit) {
              void commit();
              return;
            }
            if (readyToRead) void readItBack();
          }}
          disabled={!unlocked}
          style={{
            width: "100%",
            /* 54, not the design's authored 52. The prototype is unreset and
               its controls are content-box, so `min-height:52px` plus a 1px
               border renders 54 and the parity fingerprint measures 54. This
               repo's global reset makes every box border-box, so 52 here would
               render 52 and be 2px short of the design. Measured value wins. */
            minHeight: "54px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9px",
            font: `600 14.5px/1 ${FONT_SANS}`,
            cursor: unlocked ? "pointer" : "default",
            border: committed
              ? "1px solid var(--c-gold)"
              : unlocked
                ? "1px solid var(--c-ink)"
                : "1px solid var(--c-chrome-border)",
            backgroundColor: committed
              ? "var(--c-oninv-strong)"
              : unlocked
                ? "var(--c-ink)"
                : "var(--c-locked-bg)",
            /*
              DEVIATION, measured. The design pairs a `--c-ink` fill with
              `--c-oninv` type. Those coincide in light and collide in dark,
              where both tokens resolve to the same value: the audit reads the
              unlocked commit control at 1.00:1 in dark, on the most important
              button in the product. `--c-bg` in light is the same pixel as
              `--c-oninv`, so light is untouched and dark becomes the inversion
              the design intends. Values live in src/styles/tokens.css; quoting
              them here would be a hardcoded hex design-lint refuses.
            */
            color: committed
              ? "var(--c-ongold)"
              : unlocked
                ? "var(--c-bg)"
                : "var(--c-locked-ink)",
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" style={{ font: `400 12px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
      &middot;
    </span>
  );
}

function AnalyzingCard() {
  return (
    <div style={CARD} aria-hidden="true">
      <div className={styles.sk} style={{ width: "72px", height: "10px" }} />
      <div className={styles.sk} style={{ marginTop: "12px", width: "60%", height: "13px" }} />
      <div className={styles.sk} style={{ marginTop: "10px", width: "100%", height: "12px" }} />
      <div className={styles.sk} style={{ marginTop: "6px", width: "84%", height: "12px" }} />
    </div>
  );
}

/**
 * One selectable chip. A real button carrying `aria-pressed`, because the
 * design draws a segmented choice and a div with a role is not one.
 *
 * `spoken` is the horizon said as a sentence fragment. call-horizons.ts sets
 * HORIZON_LABEL aside for the chip and HORIZON_PHRASE for anywhere a horizon
 * is being chosen, and this control is both at once: the chip stays short and
 * the accessible name carries the phrase.
 *
 * The visible label LEADS the accessible name rather than being replaced by
 * it. WCAG 2.5.3 Label in Name requires the name to contain the visible text,
 * and "resolves in about a week" does not contain "1 week", so a voice-control
 * user saying "tap 1 week" would have hit nothing.
 */
function Chip({
  on,
  label,
  spoken,
  disabled,
  onSelect,
}: {
  on: boolean;
  label: string;
  spoken?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={spoken ? `${label}, ${spoken}` : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={styles.focusable}
      style={{
        flex: "none",
        /* 46 for the same reason the commit control is 54: the design's
           authored 44 is a content box on an unreset page and renders 46. Both
           are above the 44px tap floor either way. */
        minHeight: "46px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        border: `1px solid ${on ? "var(--c-ink)" : "var(--c-border)"}`,
        font: `${on ? 600 : 500} 12px/1 ${FONT_SANS}`,
        color: on ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: on ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}
