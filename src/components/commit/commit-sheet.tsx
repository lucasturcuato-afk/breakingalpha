"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  adoptWindowDays,
  adoptWindowForCall,
  adoptWindowOptions,
  adoptWindowPhrase,
  adoptWindowRequest,
  adoptWindowValue,
  addCalendarDays,
  type AdoptWindow,
} from "@/lib/call-horizons";
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN, type CommitTarget } from "./commit-target";
import styles from "./commit.module.css";

/**
 * The commit sheet. Step 3, and the back half of the core loop.
 *
 * THE FAILURE PATH IS THE POINT OF THIS SCREEN, so it is the first thing below
 * the props and the first thing that was written. A reader types the one
 * sentence that makes their record evidence rather than a list of taps, presses a
 * control for seven tenths of a second, and the sheet closes. If the write was
 * not acknowledged and the sheet closes anyway, that sentence is gone and
 * nothing on the screen ever said so. README: "A call that silently fails to
 * save is the worst possible bug in this product."
 *
 * So there is exactly one way out of the press: `commit()` below, which closes
 * the sheet ONLY after the route answers with a row id. Every other outcome,
 * a non-ok status, an answer with no id, a thrown fetch, lands on `failed`,
 * which keeps the sheet up, keeps the note in the field, and offers a retry.
 * The note state is never cleared by any path in this file.
 *
 * WHERE THE DESIGN PUTS THE FAILURE, AND WHY THIS DOES NOT. The prototype
 * draws the failure copy inside `isLedger` at `:406-412` and `failCommit`
 * (`:3430`) leaves the sheet OPEN over it, so the message sits behind the
 * sheet's own scrim and cannot be read until the sheet is dismissed. README's
 * Interactions section says the sheet shows it. batch-9 open question 3 records
 * the disagreement and resolves neither. README wins here: a failure the reader
 * has to dismiss the sheet to discover is most of the way back to a silent one.
 *
 * NO TOAST. On a successful write the sheet closes and the record changes. The
 * change is the feedback, and `onCommitted` is what re-reads it.
 *
 * FACES. Every font names the loaded family through the back-compat variables
 * globals.css declares on `body`: `--font-playfair-display` is Fraunces,
 * `--font-inter` is Space Grotesk, `--font-jetbrains-mono` is IBM Plex Mono.
 * Spelling the design's literal family names renders in the browser default,
 * which is the defect measured across 96 of the Ledger's 152 elements.
 */

/* The note gate. Defined in ./commit-target, which is pure and imports
   nothing, because desktop /radar/calls and both briefs now ask the same
   line and must not pull this client component in to read it. Re-exported so
   index.ts and every existing importer keeps working against ONE literal. */
export { COMMIT_NOTE_MIN };

/** Length of the press, in ms. Matches `v3fill` and `commit.module.css`. */
export const COMMIT_PRESS_MS = 700;

/**
 * The sheet's own machine. `saving` has no counterpart in the prototype, which
 * commits on a bare timer with no network in between; a real write needs a
 * state for the interval where it has been asked for and not answered.
 */
type CommitPhase = "editing" | "pressing" | "saving" | "failed";

export interface CommitSheetProps {
  /**
   * REQUIRED. What is being committed to. There is no default and no fallback:
   * the provider renders this component only when it has a target, so an
   * absent one is a component that never mounted rather than a sheet drawing
   * something plausible over nothing.
   */
  target: CommitTarget;
  /** Dismiss without writing. */
  onDismiss: () => void;
  /** The route answered with a row id. Close, and re-read the record. */
  onCommitted: () => void;
}

/** "Nov 4, 2026" from an ISO date, read in UTC so the day cannot slip. */
function checkedOnLabel(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function CommitSheet({ target, onDismiss, onCommitted }: CommitSheetProps) {
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<CommitPhase>("editing");
  const [editingWindow, setEditingWindow] = useState(false);
  const [span, setSpan] = useState<AdoptWindow>(() =>
    adoptWindowForCall(target.sessionIso, target.resolveOn),
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  const hintId = useId();

  const noteReady = note.trim().length >= COMMIT_NOTE_MIN;
  const ready = noteReady && phase !== "saving";

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  /* The write. Everything above exists to reach this and everything below
     exists to draw what it decides. */
  const commit = useCallback(async () => {
    setPhase("saving");
    try {
      const res = await fetch("/api/radar/claims/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: target.callId,
          commit_note: note.trim(),
          ...adoptWindowRequest(span),
        }),
      });
      if (!res.ok) {
        setPhase("failed");
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      const id =
        body !== null && typeof body === "object" && "id" in body
          ? (body as { id?: unknown }).id
          : null;
      /* A 200 with no row id is not an acknowledgement. Treating it as one is
         how a write that did not happen becomes a sheet that closed. */
      if (typeof id !== "string" || !id) {
        setPhase("failed");
        return;
      }
      onCommitted();
    } catch {
      setPhase("failed");
    }
  }, [note, onCommitted, span, target.callId]);

  const startPress = useCallback(() => {
    if (!ready) return;
    setPhase("pressing");
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      void commit();
    }, COMMIT_PRESS_MS);
  }, [clearTimer, commit, ready]);

  const endPress = useCallback(() => {
    clearTimer();
    setPhase((p) => (p === "pressing" ? "editing" : p));
  }, [clearTimer]);

  /* Focus lands in the field the sheet exists to fill. */
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  /* Escape dismisses, the same as "Not this one". A modal that can only be
     left by pointer is a modal a keyboard reader is stuck inside. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  /* FOCUS CONTAINMENT, AND WHY IT IS `inert` RATHER THAN A TAB LOOP.
     `aria-modal="true"` names this a modal to assistive technology and does
     nothing else: it is a label, not a behaviour. Measured from the open
     sheet at 390 light, twenty Tab presses produced sixteen stops OUTSIDE
     it, among them the skip link, the tab bar's four destinations and the
     "Track this call" trigger that opened the sheet, so a keyboard reader
     could re-fire `open()` on an already-open sheet
     (`commit-sheet-provider.tsx:118` flags exactly that as latent). All five
     background body children measured `inert=false`, `aria-hidden=null` and
     `pointer-events: auto`.

     `inert` removes the Tab stop, the pointer target AND the screen reader's
     virtual cursor in one attribute. A Tab loop fixes only the first, which
     is why the loop at `waitlist-modal.tsx:155-174` is not the precedent
     followed here, and `aria-hidden` plus `pointer-events` does not stop Tab
     at all. Native `<dialog>` would fix this and the stacking together via
     the top layer, but its backdrop is the `::backdrop` pseudo-element and
     the scrim above has to stay a real `<button>` carrying its own
     accessible name, so that route is closed.

     THE PORTAL DOES NOT OBSTRUCT THIS: `commit-sheet-provider.tsx` portals
     to `document.body`, so this component's root is itself a body child and
     the background is exactly its siblings. The `contains` test is the
     depth-robust form of that, so a future host that nests the root deeper
     cannot make this effect switch off the sheet it is protecting.

     TWO COSTS, BOTH DELIBERATE. This mutates DOM nodes it does not own, so
     it must restore on unmount, including an unmount mid-animation and a
     strict-mode double invoke; the cleanup below is unconditional and
     restores only what this effect set. A sibling already carrying `inert`
     is left alone and left out of `marked`, so if a second overlay is ever
     open at the same time the two do not fight over the attribute and
     neither clears the other's. In dev this also inerts Next's own overlay
     portals, which is harmless. */
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const marked: HTMLElement[] = [];
    for (const sibling of Array.from(root.ownerDocument.body.children)) {
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling === root || sibling.contains(root)) continue;
      if (sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    return () => {
      for (const sibling of marked) sibling.removeAttribute("inert");
    };
  }, []);

  const spanDays = adoptWindowDays(span);
  const endIso = addCalendarDays(target.sessionIso, spanDays);
  const checkedOn = checkedOnLabel(endIso);
  const trimmed = note.trim().length;

  const pressLabel =
    phase === "saving"
      ? "Entering it on your ledger"
      : phase === "pressing"
        ? "Keep pressing"
        : noteReady
          ? "Press to enter this on your ledger"
          : "Write your reasoning first";

  /* THE READY BUTTON IS INVISIBLE IN DARK AS THE DESIGN DRAWS IT, and this is
     measured off the running build rather than reasoned about.
     `commitStyle` (`:3493`) fills with `--c-ink` and inks with `--c-oninv`.
     In light both resolve to the espresso and the cream, 18.23:1. In dark
     the two tokens resolve to THE SAME VALUE, so the label measures 1.00:1
     against its own fill and cannot be read at all. The literals are in
     `tokens.css` and are not repeated here; the ratio is the finding.

     `--c-inverse` is the fill whose ink `--c-oninv` names, which is the whole
     of why that pair exists. In light it is byte-identical to `--c-ink`, so
     nothing measured on the light plate or in the parity fingerprint moves. In
     dark it takes the ready state from 1.00:1 to 17.34:1.

     Same class as DECISIONS.md ruling 10: a measurement that fails an
     accessibility floor is not a style preference, and the design does not get
     to overrule it by having been drawn first. Token-role errors surface in
     one theme only, which is exactly why the check is per theme. */
  const buttonFill = ready ? "var(--c-inverse)" : "var(--c-locked-bg)";
  const buttonInk = ready ? "var(--c-oninv)" : "var(--c-locked-ink)";

  return (
    <div
      ref={rootRef}
      data-parity="commit"
      style={{
        position: "fixed",
        inset: 0,
        /* 50 IS ABOVE THE APP CHROME, AND IT HAS TO BE. DO NOT LOWER IT.
           At 9 this overlay painted UNDER `MobileTabBar`, which is
           `position: fixed`, z-40, and `backgroundColor: var(--c-bg)`, so
           opaque. Measured at 375/390/430 in both themes: "Not this one"
           occupies y 778..822 and the bar occupies y 785..844, so 37 of the
           control's 44px sat under it and only a 7px band was live.
           `document.elementFromPoint` at the control's own centre returned
           the bar's "Watch" link, and a real tap there navigated to
           /radar/watchlist, which signed out redirects to /auth. The
           designed dismiss control did not merely fail to dismiss: it threw
           the reader off the Ledger and took the unsaved note with it, which
           is the header's "silently fails to save" reached by another route.

           There is no z-index token scale in this repo, so this is a
           literal. 50 clears everything between: the only things that exist
           in 10..49 are `#dash-cursor-glow` (z-30, `pointer-events: none`
           decoration) and the z-40 pair of `MobileTabBar` and the desktop
           sidebar, all of which are chrome a modal must cover. It stays
           BELOW the memo modals (9999), the sidebar drawer (9000/9001), the
           tour (8000), the export dialog (100) and the briefing intro (60),
           so nothing that should outrank a sheet stops doing so. */
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      {/* A real button, not the prototype's `div role="button"`. It is the
          dismiss control, so it is the element a keyboard reader reaches when
          they tab past the sheet, and it carries its own name. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close without entering this call"
        className={styles.scrimIn}
        style={{
          position: "absolute",
          inset: 0,
          appearance: "none",
          border: 0,
          padding: 0,
          margin: 0,
          backgroundColor: "var(--c-scrim)",
          cursor: "pointer",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={styles.sheet}
        style={{
          position: "relative",
          backgroundColor: "var(--c-bg)",
          /* The design draws `14px 20px 34px 34px`. The 34px pair is the
             device bezel showing through the prototype's phone frame, not a
             component radius (README), and there is no bezel on a real phone
             to round against, so the bottom corners sit flush. The 20px
             top-right is outside the sanctioned 4/6/9/12/14 scale and is
             unexplained in every handoff document; it is drawn at 14 to match
             its own top-left. Both are recorded in the PR body. */
          borderRadius: "14px 14px 0 0",
          padding: "10px var(--v3-pad) 22px",
          /* No shadow token exists in the system. This is the design's own
             value, and it is one of two literals on this screen. */
          boxShadow: "0 -10px 34px rgba(26, 18, 8, 0.16)",
          maxHeight: "92dvh",
          overflowY: "auto",
          /* The overlay is global and the trigger will not always be a phone:
             the same sheet is what desktop /radar/calls adopts later. Above
             the widest audited phone width it stops stretching and centres,
             so a wide viewport draws a sheet rather than a full-bleed band.
             At 390 and 430 the sheet is already narrower than this, so
             nothing measured on a phone moves. */
          width: "100%",
          maxWidth: "430px",
          margin: "0 auto",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "38px",
            height: "4px",
            borderRadius: "4px",
            backgroundColor: "var(--c-handle)",
            margin: "0 auto 18px",
          }}
        />

        <h2
          id={headingId}
          style={{
            margin: 0,
            font: "700 21px/1.2 var(--font-playfair-display), serif",
            color: "var(--c-ink)",
          }}
        >
          Why do you think so?
        </h2>
        <p
          style={{
            margin: "10px 0 0",
            font: "400 13px/1.55 var(--font-inter), sans-serif",
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
          One line. This is what a reader of your record will actually judge, and it is what gets
          read back to you when the date arrives.
        </p>

        {/* The claim being committed to. The prototype omits it because its
            sheet only ever opens over one card; a global overlay opened from
            three surfaces has to say which call it is about. */}
        <p
          style={{
            margin: "14px 0 0",
            font: "500 15px/1.4 var(--font-playfair-display), serif",
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {target.claim}
        </p>

        <div
          style={{
            marginTop: "14px",
            padding: "13px 14px",
            border: `1px solid ${noteReady ? "var(--c-gold)" : "var(--c-border)"}`,
            borderRadius: "12px",
            backgroundColor: "var(--c-bg)",
            transition: "border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={COMMIT_NOTE_MAX}
            aria-label="Your reasoning"
            aria-describedby={hintId}
            /* The design writes a worked example into this field, an invented
               claim about two named companies. The attribute below is a string
               literal in a client component, so it ships in .next/static and is
               downloadable whether or not anyone opens the sheet, which is
               exactly the shape PR #676 removed from five screens. The prompt
               teaches the same register and asserts nothing about anybody. */
            placeholder="What has to be true for this, and what would change your mind."
            style={{
              width: "100%",
              minHeight: "86px",
              border: "none",
              /* globals.css gives form controls a 4px default. The design
                 draws the field as part of the box around it, not as a
                 control of its own, so the corner belongs to the box. */
              borderRadius: 0,
              outline: "none",
              resize: "none",
              background: "transparent",
              font: "400 italic 15px/1.6 var(--font-playfair-display), serif",
              color: "var(--c-ink)",
              padding: 0,
            }}
          />
        </div>

        <div
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span
            id={hintId}
            style={{ font: "400 11px/1 var(--font-inter), sans-serif", color: "var(--c-muted)" }}
          >
            {noteReady ? "Timestamped before the outcome is known." : "A sentence is enough."}
          </span>
          <span
            aria-hidden="true"
            style={{
              font: "400 10.5px/1 var(--font-jetbrains-mono), monospace",
              letterSpacing: "0.045em",
              color: "var(--c-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {trimmed > 0 ? `${trimmed} characters` : ""}
          </span>
        </div>

        <div style={{ marginTop: "12px", height: "1px", backgroundColor: "var(--c-hair)" }} />

        <div
          style={{
            marginTop: "10px",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ font: "600 13px/1.3 var(--font-inter), sans-serif", color: "var(--c-ink)" }}>
              {checkedOn ? `Checked on ${checkedOn}` : "Checked at the end of the window"}
            </div>
            <div
              style={{
                marginTop: "3px",
                font: "400 11.5px/1.35 var(--font-inter), sans-serif",
                color: "var(--c-secondary)",
              }}
            >
              {/* The design writes "90 days, against XLF and SPY". The day
                  count is real and comes from the window. The benchmark pair
                  has NO read-time source anywhere in `src/` (batch-9 deviation
                  9), so it is not written: naming benchmarks inside the thing
                  the reader is agreeing to would make them part of the
                  commitment on no evidence. */}
              {spanDays === 1 ? "1 day" : `${spanDays} days`}, {adoptWindowPhrase(span)}
            </div>
          </div>

          {/* The prototype's "change" is a `div` with `cursor:pointer`, no
              handler, no tabindex and no role, which README's accessibility
              rule names as a defect outright. The real behaviour already
              exists in `TrackCallControl`'s untracked footer and is portable:
              a select over `adoptWindowOptions`, defaulting to the call's own
              span rather than to a bucket it is not. */}
          {editingWindow ? (
            <select
              autoFocus
              aria-label="How long this call runs"
              value={adoptWindowValue(span)}
              onChange={(e) => {
                const next = adoptWindowOptions(span).find((o) => o.value === e.target.value);
                if (next) setSpan(next.window);
              }}
              onBlur={() => setEditingWindow(false)}
              style={{
                minHeight: "44px",
                maxWidth: "52%",
                padding: "0 10px",
                border: "1px solid var(--c-border)",
                borderRadius: "9px",
                backgroundColor: "var(--c-bg)",
                font: "500 12.5px/1 var(--font-inter), sans-serif",
                color: "var(--c-ink)",
              }}
            >
              {adoptWindowOptions(span).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setEditingWindow(true)}
              style={{
                appearance: "none",
                background: "none",
                border: 0,
                margin: 0,
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                font: "500 12.5px/1 var(--font-inter), sans-serif",
                color: "var(--c-secondary)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              change
            </button>
          )}
        </div>

        <div style={{ marginTop: "6px", height: "1px", backgroundColor: "var(--c-hair)" }} />

        <p
          style={{
            margin: "11px 0 0",
            font: "400 11.5px/1.55 var(--font-inter), sans-serif",
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          The window is fixed the moment you commit and cannot be moved afterwards. A miss stays on
          the record, and the record is better for it.
        </p>

        {/* THE FAILURE STATE. It renders HERE, in the sheet, directly above the
            control that produced it, with the note still in the field above.
            `role="alert"` so it is announced rather than merely drawn. */}
        {phase === "failed" ? (
          <div
            role="alert"
            className={styles.notice}
            style={{
              marginTop: "14px",
              padding: "13px 14px",
              border: "1px solid var(--pill-bear-border)",
              borderRadius: "9px",
              backgroundColor: "var(--c-card)",
            }}
          >
            <p
              style={{
                margin: 0,
                font: "600 12.5px/1.4 var(--font-inter), sans-serif",
                color: "var(--c-redink)",
              }}
            >
              This call was not entered.
            </p>
            <p
              style={{
                margin: "7px 0 0",
                font: "400 12px/1.55 var(--font-inter), sans-serif",
                color: "var(--c-body)",
                textWrap: "pretty",
              }}
            >
              {/* The design says "The connection dropped", which names a cause
                  this code cannot observe: a 500 is not a dropped connection.
                  What is known is that the ledger did not acknowledge it, and
                  that the route writes the row before it answers, so an
                  unanswered request has no acknowledged row behind it. Trying
                  again is safe either way: adopt is idempotent on
                  adopted_from_call_id, so a second attempt after an ambiguous
                  first one finds the row rather than making a second. */}
              The ledger did not acknowledge it. Nothing was written, and your note is still here.
            </p>
            <button
              type="button"
              onClick={() => setPhase("editing")}
              style={{
                appearance: "none",
                background: "none",
                margin: "11px 0 0",
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 15px",
                border: "1px solid var(--c-ink)",
                borderRadius: "9px",
                font: "600 12.5px/1 var(--font-inter), sans-serif",
                color: "var(--c-ink)",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        ) : null}

        {/* The press. A real button, so it is reachable by keyboard, and the
            gesture is bound to pointer AND key events: a long press that
            exists only on a pointer is a control a keyboard reader cannot
            operate at all. `touchAction: none` stops the browser claiming the
            press as a scroll. */}
        <button
          type="button"
          disabled={!ready}
          aria-disabled={!ready}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              startPress();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") endPress();
          }}
          onBlur={endPress}
          style={{
            appearance: "none",
            border: 0,
            margin: "14px 0 0",
            padding: 0,
            width: "100%",
            position: "relative",
            minHeight: "54px",
            borderRadius: "9px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            userSelect: "none",
            touchAction: "none",
            backgroundColor: buttonFill,
            cursor: ready ? "pointer" : "default",
          }}
        >
          {phase === "pressing" ? (
            <span
              aria-hidden="true"
              className={styles.fill}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                backgroundColor: "var(--c-gold)",
              }}
            />
          ) : null}
          <span
            style={{
              position: "relative",
              font: "600 15px/1 var(--font-inter), sans-serif",
              color: buttonInk,
            }}
          >
            {pressLabel}
          </span>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          style={{
            appearance: "none",
            background: "none",
            border: 0,
            padding: 0,
            margin: "8px 0 0",
            width: "100%",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "500 13.5px/1 var(--font-inter), sans-serif",
            color: "var(--c-secondary)",
            cursor: "pointer",
          }}
        >
          Not this one
        </button>
      </div>
    </div>
  );
}
