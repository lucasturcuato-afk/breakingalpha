"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HORIZON_LABEL,
  HORIZON_PHRASE,
  horizonTypeFromDates,
  type HorizonType,
} from "@/lib/call-horizons";
/* `./fixture` is NOT imported here and must never be. This is a client
   component, so a value import from that module is a download of the invented
   draft, the invented note and both invented proposals: the gate stops the
   render and not the download. Everything below is content-free, and the seed
   arrives as a required prop, built on the server by
   `src/app/compose/page.tsx` behind `COMPOSE_FIXTURE_ENABLED`. */
import { COMPOSE_FIXTURE_ENABLED } from "./fixture-gate";
import {
  COMPOSE_DEFAULT_HORIZON,
  COMPOSE_HORIZONS,
  DRAFT_MIN_CHARS,
  EMPTY_SEED,
  MAX_CLAIM_CHARS,
  MAX_NOTE_CHARS,
  NOTE_MIN_CHARS,
  longDate,
  settlementDate,
  type ComposeProposal,
  type ComposeSeed,
  type ComposeStage,
  type Direction,
} from "./compose-data";
import styles from "./compose.module.css";

/**
 * Compose. "Write your own call": the free-text composer promoted from a
 * section inside /radar/calls to a screen of its own.
 *
 * PRESENTATION UNIT. Nothing here reaches the network. `/api/radar/claims/author`
 * produces its proposal through Gemini and `/api/radar/claims` POST is the
 * authored insert; this screen calls neither, and the two controls that would
 * are inert no-ops carrying a comment saying so. The proposal is a fixture and
 * the stage is a URL parameter, which is how the Ledger unit reached its own
 * lifecycle states before it had a loader.
 *
 * Gradeability is SERVER-gated. The prototype computes it in the browser from a
 * hardcoded instrument list; reproducing that would put a client-side verdict
 * on a screen whose whole argument is that the desk checks the claim. So no
 * branch below reads the draft text to decide whether a claim can be graded.
 */

/**
 * Whether this screen can write a call.
 *
 * It cannot. `/api/radar/claims/author` runs Gemini and `/api/radar/claims`
 * POST has no column for the note the design gates the control on.
 * Draft PR #643 proposes `user_claims.commit_note` and has not been ruled on.
 * One constant so the day a loader lands, the marker line, the disabled state
 * and the aria wiring all come off together.
 */
const WRITE_PATH_WIRED = false;

const PAD = "var(--v3-pad)";
const MONO = "'JetBrains Mono', monospace";
const SANS = "Inter, sans-serif";
const SERIF = "'Playfair Display', serif";

const EYEBROW = {
  marginTop: "20px",
  font: `400 10px/1 ${MONO}`,
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

export function ComposeScreen({
  stage = "empty",
  /**
   * What the composer opens on. REQUIRED and NULLABLE, never optional and
   * never defaulted. The caller resolves the gate and passes `seedFor(stage)`
   * or null; leaving the prop off is a build failure rather than an invented
   * call in front of a reader.
   */
  seed,
}: {
  stage?: ComposeStage;
  seed: ComposeSeed | null;
}) {
  /* Re-checked here, not trusted from the page. `EMPTY_SEED` is two blank
     fields and no proposal, which asserts nothing: it is what a real composer
     opens on and what production draws. */
  const opening = COMPOSE_FIXTURE_ENABLED && seed !== null ? seed : EMPTY_SEED;
  const [draft, setDraft] = useState(opening.draft);
  const [note, setNote] = useState(opening.note);
  const [proposal, setProposal] = useState<ComposeProposal | null>(opening.proposal);
  const [direction, setDirection] = useState<Direction>(
    opening.proposal?.expected_direction ?? "bullish",
  );
  /* Derived from the proposal's own window, never transcribed. A chip that is
     hardcoded agrees with `resolution_window_end` only by coincidence, and
     stops agreeing the moment the window moves. */
  const [horizon, setHorizon] = useState<HorizonType>(
    horizonTypeFromDates(
      opening.proposal?.resolution_window_start,
      opening.proposal?.resolution_window_end,
    ) ?? COMPOSE_DEFAULT_HORIZON,
  );

  const committed = stage === "committed" || stage === "committed-context";
  const busy = stage === "saving";
  const analyzing = stage === "analyzing";
  const draftOk = draft.trim().length >= DRAFT_MIN_CHARS;
  const noteOk = note.trim().length >= NOTE_MIN_CHARS;
  const gradeable = proposal?.gradeable === true;

  const error =
    stage === "analyze-error"
      ? "Could not analyze the claim."
      : stage === "save-error"
        ? "Could not save the call."
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

  const readyToCommit = draftOk && noteOk && proposal !== null && !committed && !busy;
  const readyToRead = draftOk && noteOk && proposal === null && !analyzing;

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
        : readyToCommit
        ? gradeable
          ? "Track it"
          : "Track as context"
        : readyToRead
          ? "Read it back"
          : "Write the claim and your reasoning";

  const unlocked = readyToCommit || readyToRead;

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
            font: `500 13px/1 ${SANS}`,
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
            font: `700 24px/1.15 ${SERIF}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Write your own call
        </h1>
        <p
          style={{
            margin: "9px 0 0",
            font: `400 13px/1.6 ${SANS}`,
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
            readOnly={committed || busy}
            placeholder="In your own words, e.g. NVDA gives back the ramp hype by earnings"
            style={{
              minHeight: "78px",
              font: `500 16px/1.45 ${SERIF}`,
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
            style={{ font: `400 11px/1.4 ${SANS}`, color: "var(--c-muted)" }}
          >
            {hint}
          </span>
          <span
            style={{
              font: `400 10.5px/1 ${MONO}`,
              letterSpacing: "0.045em",
              color: "var(--c-muted)",
            }}
          >
            {count}
          </span>
        </div>

        {analyzing ? <AnalyzingCard /> : null}

        {error ? (
          <p
            role="alert"
            className={styles.enter}
            style={{
              margin: "16px 0 0",
              font: `400 12.5px/1.55 ${SANS}`,
              color: "var(--c-redink)",
              textWrap: "pretty",
            }}
          >
            {error}
          </p>
        ) : null}

        {proposal && !gradeable ? (
          <div className={styles.enter} style={CARD}>
            <div
              style={{
                font: `400 10px/1 ${MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              NOT CHECKABLE AS WRITTEN
            </div>
            <p
              style={{
                margin: "10px 0 0",
                font: `400 13.5px/1.65 ${SANS}`,
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
                    font: `400 12px/1.55 ${SANS}`,
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
                    setHorizon(
                      horizonTypeFromDates(
                        alt.resolution_window_start,
                        alt.resolution_window_end,
                      ) ?? COMPOSE_DEFAULT_HORIZON,
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
                    font: `600 12.5px/1.3 ${SANS}`,
                    color: "var(--c-goldink)",
                    cursor: "pointer",
                    textWrap: "pretty",
                  }}
                >
                  {`Make it gradeable: ${proposal.gradeable_alternative.target_symbol} \u00b7 ${DIRECTION_LABEL[proposal.gradeable_alternative.expected_direction]} \u00b7 by ${longDate(proposal.gradeable_alternative.resolution_window_end)}`}
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
                  font: `400 10px/1 ${MONO}`,
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
                <span style={{ font: `500 13px/1 ${MONO}`, color: "var(--c-ink)" }}>
                  {proposal.target_symbol}
                </span>
                <Dot />
                <span style={{ font: `600 12.5px/1 ${SANS}`, color: "var(--c-ink)" }}>
                  {DIRECTION_LABEL[direction]}
                </span>
                <Dot />
                <span style={{ font: `400 12px/1 ${SANS}`, color: "var(--c-body)" }}>
                  {HORIZON_PHRASE[horizon]}
                </span>
              </div>
              <p
                style={{
                  margin: "11px 0 0",
                  font: `400 12px/1.55 ${SANS}`,
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
              {COMPOSE_HORIZONS.map((h) => (
                <Chip
                  key={h}
                  on={horizon === h}
                  label={HORIZON_LABEL[h]}
                  spoken={HORIZON_PHRASE[h]}
                  disabled={committed || busy}
                  onSelect={() => setHorizon(h)}
                />
              ))}
            </div>
            <p
              style={{
                margin: "10px 0 0",
                font: `400 11.5px/1.55 ${SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              Settles {longDate(settlementDate(horizon))}. Fixed at entry and
              cannot be moved afterwards.
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
          {/*
            TODO(PR #643): wire this to `user_claims.commit_note`.

            The design gates the commit control on this field and there is
            nowhere to put what it collects. `user_claims` carries no note
            column and `/api/radar/claims` POST parses no note key. So the
            field is drawn exactly as the design draws it and is deliberately
            not wired to a write. Draft PR #643 proposes the column, the parser in
            `src/lib/commit-note.ts` and the 503 refusal that keeps a user's
            words from vanishing into a 200. Until it is ruled on, this screen
            commits nothing at all, so nothing typed here is discarded by it.
          */}
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
              font: `400 italic 14.5px/1.6 ${SERIF}`,
              color: "var(--c-ink)",
            }}
          />
        </div>
        <p
          style={{
            margin: "14px 0 0",
            font: `400 11.5px/1.55 ${SANS}`,
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
          className={styles.focusable}
          /*
            Disabled, not merely handler-less.
            `Read it back` would POST to /api/radar/claims/author and `Track it`
            would POST to /api/radar/claims; this unit calls neither, because
            the author route runs Gemini and the insert has no column for the
            note the control is gated on. A control that looks live and answers
            with nothing is the worse of the two failures, so the write path is
            visibly closed and the line below says so in words.
          */
          disabled={!unlocked || !WRITE_PATH_WIRED}
          aria-describedby={WRITE_PATH_WIRED ? undefined : "compose-inert"}
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
            font: `600 14.5px/1 ${SANS}`,
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
        {WRITE_PATH_WIRED ? null : (
          <p
            id="compose-inert"
            style={{
              margin: "9px 0 0",
              textAlign: "center",
              font: `400 11px/1.4 ${SANS}`,
              color: "var(--c-muted)",
              textWrap: "pretty",
            }}
          >
            Preview of the screen. Nothing written here is kept yet.
          </p>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" style={{ font: `400 12px/1 ${SANS}`, color: "var(--c-secondary)" }}>
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
        font: `${on ? 600 : 500} 12px/1 ${SANS}`,
        color: on ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: on ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}
