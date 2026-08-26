"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { EspressoOutcomeLead } from "./espresso-outcome-lead";
import { COMMIT_NOTES_BEGAN_LABEL } from "./notes-began";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import type { ReviewData } from "./fixture";
import styles from "./review.module.css";

/**
 * Review. The moment one of the reader's own calls resolves.
 *
 * The only FULL-BLEED espresso screen in the product. Every other use of the
 * espresso surface is a card; github.md line 77 states the intent, and the
 * prototype confirms it at line 499. It is also the only screen the prototype
 * flips the browser chrome for (`const dark = s.screen === 'review'`, line
 * 3169), which production has no equivalent of and does not fake.
 *
 * FACES. Every font names a family the app actually loads, through
 * `@/components/mobile/fonts`. The design spells Playfair Display, Inter and
 * JetBrains Mono; `src/app/layout.tsx` loads Fraunces, Space Grotesk and IBM
 * Plex Mono and nothing else, so naming the design's families here would ship
 * the screen in the browser's default serif and sans. That was measured on the
 * Ledger at 96 of 152 elements.
 *
 * THE TIMESTAMP IS THE WHOLE SUBTLETY, and it is ruled.
 *
 * The note eyebrow renders `user_claims.commit_note_at`, the moment the NOTE
 * was written. It NEVER renders `user_claims.created_at`, the moment the row
 * was made. Ruled by Noah on 2026-08-25 and recorded in
 * `sql/proposals/0033_user_claim_commit_note.sql`: the two diverge the moment
 * a note is edited and nothing in the schema prevents that, so a screen whose
 * entire subject is what you said and when you said it reads the field that
 * means that.
 *
 * This component cannot break that rule by accident. It never receives
 * `created_at` in any form. `ReviewData` carries no such field, the loader
 * resolves the one question that needs it into a boolean, and a grep for
 * `created_at` across `src/components/review/` returns nothing.
 *
 * THE NULL CASE IS PERMANENT AND IT IS MOST OF THE DATA. Every claim adopted
 * before 2026-08-25 has a null note and a null note timestamp, and there is no
 * backfill: nothing recorded when those notes would have been written, because
 * there were no notes. So the null case is not an edge, it is the shape of the
 * existing record, forever. It is drawn as HISTORY rather than as a missing
 * value, and it does not fall back to `created_at`, which would put a
 * real-looking timestamp above a note that does not exist.
 *
 * CONTROLS. Nothing here is a control without a destination. The secondary
 * exit is rendered only when a caller supplies one, so it is absent rather
 * than inert while its route does not exist.
 */

export type ReviewStage = "ready" | "loading" | "error" | "empty";

const PAD = "var(--v3-pad)";

/* Copy that belongs to a STATE rather than to data. Every line here is either
   a statement about the read itself or a statement about the schema, and none
   of them is a fact about the reader that this screen would have no source
   for. They are collected so the register can be read in one place. */
const COPY = {
  /** The note read answered with an error. github.md line 146, verbatim. */
  noteFailed: "This is a failed read, not an empty result. Nothing is being hidden.",
  /** The claim predates the column. History, not a missing value. */
  noteHistoric: `Commit notes began on ${COMMIT_NOTES_BEGAN_LABEL}. This call was taken before that, so there was never one to read back.`,
  /** The claim postdates the column and still carries no note. */
  noteNone: "Nothing was written with this call.",
  /**
   * The resolution read answered with zero resolved calls. Only ever rendered
   * on a query that SUCCEEDED and came back empty, never on a failure and
   * never with nobody signed in.
   */
  emptyLine: "No call on your record has resolved yet.",
  /**
   * What resolving means, in the desk's own attribution vocabulary. Sourced
   * from `src/lib/desk-record.ts`, which is the one repo object github.md maps
   * to this screen. It describes the grader, not the reader.
   */
  emptyExplainer:
    "A call resolves when its window closes and the grader can separate its move from its sector and the market.",
  /** The resolution read answered with an error. */
  errorLine: "This is a failed read, not an empty result. Nothing is being hidden.",
} as const;

export function ReviewScreen({
  stage,
  data,
  entryHref,
}: {
  stage: ReviewStage;
  /** The resolution, or null when there is none to draw. Never defaulted. */
  data: ReviewData | null;
  /**
   * Destination of the secondary exit, "Open the full entry", or null when
   * there is nowhere for it to go. REQUIRED so a caller has to answer the
   * question rather than inherit a default.
   *
   * It is null on this branch. The prototype's `goEntry` targets the Entry
   * screen, build step 6, which is reserved at `/entry` in
   * `MOBILE_REDESIGN_DEV_PATHS` and does not exist yet. A control that points
   * at a 404 is worse than one that is absent, and the README is explicit
   * that a `cursor:pointer` element with no handler is a defect. One line in
   * `page.tsx` turns it on when that route lands.
   */
  entryHref: string | null;
}) {
  /* No resolution, no set piece. `data` is null in every state that has
     nothing to draw, and the screen draws that state instead of inventing a
     verdict. The ordering matters and it is the lesson from the Ledger: a
     KNOWN FAILURE OUTRANKS AN ABSENT PAYLOAD. Reaching the skeleton without
     consulting `stage` would put a spinner over a read that had already
     failed and would not be retried, which is a screen publishing a state it
     did not establish.

     It is an early return on purpose. Below this line TypeScript knows `data`
     is non-null, so no later edit can bring a fixture back by leaving a prop
     off: a missing gate becomes a build failure rather than an invented
     resolution in front of a reader. */
  if (data === null) {
    return (
      <ReviewFrame entryHref={entryHref}>
        {stage === "error" ? (
          <ReviewFailed />
        ) : stage === "empty" ? (
          <ReviewEmpty />
        ) : (
          <ReviewSkeleton />
        )}
      </ReviewFrame>
    );
  }

  return (
    <ReviewFrame entryHref={entryHref}>
      {/* The design writes "resolved overnight" unconditionally. A grade from
          three weeks ago did not land overnight, and the lead phrase is
          therefore data. */}
      <div style={{ font: `400 italic 13px/1 ${FONT_DISPLAY}`, color: "var(--c-oninv-dim)" }}>
        {data.resolvedAt.overnight ? "resolved overnight" : "resolved"} &middot;{" "}
        {data.resolvedAt.day}
      </div>

      <EspressoOutcomeLead state={data.state} />

      <div
        className={styles.rule}
        aria-hidden="true"
        style={{ marginTop: "22px", height: "1px", backgroundColor: "var(--c-gold)" }}
      />

      <p
        style={{
          margin: "20px 0 0",
          font: `500 19px/1.4 ${FONT_DISPLAY}`,
          color: "var(--c-oninv-strong)",
          textWrap: "pretty",
        }}
      >
        {data.claim}
      </p>

      {/* The grader's benchmark line, verbatim. Never a sentence written here,
          and absent rather than approximated when the outcome row carries
          none. */}
      {data.result ? (
        <p
          style={{
            margin: "20px 0 0",
            font: `500 15.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-oninv-mono)",
          }}
        >
          {data.result}
        </p>
      ) : null}

      {data.reading ? (
        <p
          style={{
            /* Sits 9px under the benchmark line when there is one, and takes
               that line's own top margin when there is not, so a resolution
               with no benchmark numbers does not open a gap where they were. */
            margin: `${data.result ? "9px" : "20px"} 0 0`,
            font: `400 13.5px/1.65 ${FONT_SANS}`,
            color: "var(--c-oninv-body)",
            textWrap: "pretty",
          }}
        >
          {data.reading}
        </p>
      ) : null}

      <NoteBlock note={data.note} predatesNotes={data.predatesNotes} />

      {/* Prototype line 512. Null from every real read: nothing in the repo
          generates prose about a reader's own reasoning, so the well is absent
          rather than filled with a sentence this screen made up. */}
      {data.meaning ? (
        <div
          style={{
            marginTop: "24px",
            padding: "16px 17px",
            border: "1px solid var(--c-inverse-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-inverse-well)",
          }}
        >
          <p
            style={{
              margin: 0,
              font: `400 13.5px/1.7 ${FONT_SANS}`,
              color: "var(--c-oninv-mono)",
              textWrap: "pretty",
            }}
          >
            {data.meaning}
          </p>
        </div>
      ) : null}
    </ReviewFrame>
  );
}

/* ── the note, which is the screen's subject ───────────────────────────── */

/** The mono eyebrow above the note slot, whatever the slot turns out to hold. */
function NoteEyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{ font: `400 11px/1 ${FONT_MONO}`, color: "var(--c-oninv-dim)" }}>{children}</div>
  );
}

/**
 * The note, in the three states the read can be in, plus the one split that
 * makes an absence read as history.
 *
 * The absence bodies are deliberately NOT drawn in the note's own voice. The
 * note is 17px italic Fraunces in `--c-oninv-strong`; an absence is 13.5px
 * Space Grotesk in `--c-oninv-body`, the same register the grader's reading
 * uses. A sentence explaining that there is no note must not look like a note.
 */
function NoteBlock({
  note,
  predatesNotes,
}: {
  note: ReviewData["note"];
  predatesNotes: boolean;
}) {
  const wrap = (children: ReactNode) => (
    <div
      style={{
        marginTop: "26px",
        paddingTop: "22px",
        borderTop: "1px solid var(--c-inverse-border)",
      }}
    >
      {children}
    </div>
  );

  const absence = (body: string) =>
    wrap(
      <>
        <NoteEyebrow>NO NOTE ON THIS CALL</NoteEyebrow>
        <p
          style={{
            margin: "13px 0 0",
            font: `400 13.5px/1.65 ${FONT_SANS}`,
            color: "var(--c-oninv-body)",
            textWrap: "pretty",
          }}
        >
          {body}
        </p>
      </>,
    );

  /* The read answered with an error. Scoped to this block: a note that could
     not be read is no reason to discard a resolution that was. */
  if (note === "failed") {
    return wrap(
      <>
        <NoteEyebrow>YOUR NOTE</NoteEyebrow>
        <p
          style={{
            margin: "13px 0 0",
            font: `400 13.5px/1.65 ${FONT_SANS}`,
            color: "var(--c-oninv-body)",
            textWrap: "pretty",
          }}
        >
          {COPY.noteFailed}
        </p>
      </>,
    );
  }

  /* The read answered and there is no note. Two different things, drawn
     differently, because a claim from before the feature existed is not a
     claim whose note failed to load. */
  if (note === null) {
    return absence(predatesNotes ? COPY.noteHistoric : COPY.noteNone);
  }

  return wrap(
    <>
      {/* THE RULED FIELD. `writtenAt` is commit_note_at and only ever that.
          Null renders a bare eyebrow: no time is better than a borrowed one,
          and created_at is the one this must never reach for. */}
      <NoteEyebrow>{note.writtenAt ? `YOU WROTE, ${note.writtenAt}` : "YOU WROTE"}</NoteEyebrow>
      <p
        style={{
          margin: "13px 0 0",
          font: `400 italic 17px/1.62 ${FONT_DISPLAY}`,
          color: "var(--c-oninv-strong)",
          textWrap: "pretty",
        }}
      >
        {note.text}
      </p>
    </>,
  );
}

/* ── states with nothing to draw ───────────────────────────────────────── */

function StateBlock({ eyebrow, lines }: { eyebrow: string; lines: string[] }) {
  return (
    <>
      <NoteEyebrow>{eyebrow}</NoteEyebrow>
      {lines.map((line, i) => (
        <p
          key={line}
          style={{
            margin: `${i === 0 ? "16px" : "10px"} 0 0`,
            font: `400 ${i === 0 ? "15.5px/1.55" : "13.5px/1.65"} ${FONT_SANS}`,
            color: i === 0 ? "var(--c-oninv-mono)" : "var(--c-oninv-body)",
            textWrap: "pretty",
          }}
        >
          {line}
        </p>
      ))}
    </>
  );
}

/** The read succeeded and came back with no resolved call. */
function ReviewEmpty() {
  return <StateBlock eyebrow="NOTHING TO REVIEW" lines={[COPY.emptyLine, COPY.emptyExplainer]} />;
}

/** The read failed. Never dressed as an empty record. */
function ReviewFailed() {
  return <StateBlock eyebrow="COULD NOT READ" lines={[COPY.errorLine]} />;
}

/**
 * The read has not answered. Says nothing at all, which is the only honest
 * thing a screen can say before its query comes back.
 */
function ReviewSkeleton() {
  return (
    <div aria-hidden="true">
      <div className={styles.sk} style={{ height: "13px", width: "62%" }} />
      <div className={styles.sk} style={{ marginTop: "18px", height: "36px", width: "54%" }} />
      <div style={{ marginTop: "22px", height: "1px", backgroundColor: "var(--c-inverse-border)" }} />
      <div className={styles.sk} style={{ marginTop: "20px", height: "26px" }} />
      <div className={styles.sk} style={{ marginTop: "8px", height: "26px", width: "78%" }} />
      <div className={styles.sk} style={{ marginTop: "26px", height: "24px" }} />
      <div className={styles.sk} style={{ marginTop: "8px", height: "24px", width: "66%" }} />
    </div>
  );
}

/* ── the frame ─────────────────────────────────────────────────────────── */

/**
 * The espresso set piece and its two exits.
 *
 * `data-parity="review"` lives here and nowhere else, so a parity run scopes
 * to exactly one subtree whatever state the screen is in.
 *
 * The frame is a column with a scrolling body and a footer that does not
 * scroll, matching prototype lines 499, 500 and 515. `minHeight: 100%` rather
 * than a viewport unit: the shell's `main` already reserves the tab bar's
 * height below md, and a dvh here would measure past it.
 */
function ReviewFrame({
  children,
  entryHref,
}: {
  children: ReactNode;
  entryHref: string | null;
}) {
  return (
    <div
      data-parity="review"
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-inverse)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `30px ${PAD} 0` }}>
        {children}
      </div>

      <div
        style={{
          flex: "none",
          padding: `16px ${PAD} 18px`,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <Link
          href="/ledger"
          className={styles.bare}
          style={{
            minHeight: "52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--c-gold)",
            borderRadius: "9px",
            font: `600 14.5px/1 ${FONT_SANS}`,
            color: "var(--c-ongold)",
          }}
        >
          On to this morning&apos;s brief
        </Link>

        {entryHref ? (
          <Link
            href={entryHref}
            className={styles.bare}
            style={{
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `500 13.5px/1 ${FONT_SANS}`,
              color: "var(--c-oninv-dim)",
            }}
          >
            Open the full entry
          </Link>
        ) : null}
      </div>
    </div>
  );
}
