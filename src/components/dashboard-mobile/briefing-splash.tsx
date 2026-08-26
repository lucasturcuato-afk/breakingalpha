"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./dashboard.module.css";
import { MONO, SANS, SERIF } from "./fonts";

/**
 * The briefing splash. The first frame of the first session.
 *
 * The lifecycle is `dashboard-fx.tsx`'s, unchanged and deliberately so: a
 * session gate, a leave at 1900ms, an unmount at 2600ms, and no splash at all
 * under reduced motion. What is replaced is the content. The desk draws a
 * gold square with an S in it and three counting stats; the design draws the
 * serif monogram alone over three lines of type.
 *
 * The session key is its own. The desk's `DashboardIntro` is still mounted on
 * this route above `md` and writes `signalera_dash_intro_seen` on mount, so
 * sharing the key would let a screen nobody can see suppress the one they can.
 *
 * Skipped, not merely unanimated, under `prefers-reduced-motion`. That is the
 * one place this screen hides something rather than stilling it, and it is
 * the prototype's own behaviour: a splash IS the motion. Nothing is lost with
 * it, because the date, the briefing and the overnight resolution are all on
 * the screen it would have covered.
 */

const SESSION_KEY = "signalera_mobile_dash_intro_seen";
const LEAVE_MS = 1900;
const UNMOUNT_MS = 2600;

/** The design's own offsets, from the four elements of the splash. */
const DELAY = [0, 120, 220, 320];

export function BriefingSplash({
  date,
  headline,
  detail,
}: {
  /** Already formatted, and stated in the design's mono caps. */
  date: string;
  headline: string;
  detail: string;
}) {
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");
  /**
   * Whether this mount plays, decided once.
   *
   * The decision cannot be re-read inside the effect. Development runs every
   * effect mount, cleanup, mount, and the first pass writes the session key,
   * so the second pass reads its own write, bails out, and leaves the splash
   * on screen with its timers already cancelled. Measured: it never left.
   * A ref survives the double invoke, so the second pass re-arms the timers
   * instead of deciding again.
   */
  const plays = useRef<boolean | null>(null);

  useEffect(() => {
    if (plays.current === null) {
      const reduce =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let seen = false;
      try {
        seen = sessionStorage.getItem(SESSION_KEY) === "1";
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* Private mode. A splash that cannot remember itself plays once per
           mount, which is the same thing on a page that mounts once. */
      }
      plays.current = !reduce && !seen;
    }
    if (!plays.current) return;

    /* All three transitions are scheduled, including the first. Setting the
       phase synchronously in the effect body cascades a second render pass
       before paint for no gain, and the whole point of this element is that
       it animates in rather than appearing. */
    const timers = [
      window.setTimeout(() => setPhase("in"), 0),
      window.setTimeout(() => setPhase("out"), LEAVE_MS),
      window.setTimeout(() => setPhase("idle"), UNMOUNT_MS),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, []);

  if (phase === "idle") return null;

  /* Portalled to the body, not rendered in place.
   *
   * In place, the nearest ancestor is `PageTransition`'s motion.div, which
   * carries an inline `transform` while it plays its 200ms enter. A
   * transformed ancestor is the containing block for a `position: fixed`
   * descendant, and the `<main>` above it scrolls with `overflow-y-auto`, so
   * the splash spent the opening frames sized and clipped to the content box
   * rather than the viewport. The body has neither. */
  return createPortal(
    <div
      /* Every box property is a class and the element carries no inline
         style at all, so nothing can defeat `md:hidden`: not an inline
         display, and not a competing single-class rule in the module. */
      className={`md:hidden fixed inset-0 z-50 flex flex-col items-center justify-center ${styles.splash} ${phase === "out" ? styles.splashOut : ""}`}
      aria-hidden="true"
    >
      <div className={styles.introUp}>
        <div
          style={{
            flex: "none",
            padding: "11px",
            /* 14, not the design's 22. The radius scale is 4/6/9/12/14 and 22
               is off it. */
            borderRadius: "14px",
            backgroundColor: "var(--c-inverse)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className={styles.mark}
            style={{
              flex: "none",
              width: "60px",
              height: "60px",
              borderRadius: "14px",
              backgroundColor: "var(--c-oninv)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {/* The serif monogram. Espresso S, gold full stop, on a cream
                tile: both surfaces are pinned across themes by their tokens,
                so the mark never inverts. */}
            {/* `color` carries the glyph and the fill follows it. A bare
                `fill` would leave the element's colour inherited from the
                page, which reads as cream type on a cream tile to anything
                measuring contrast off the colour property, this repo's own
                runtime audit included. */}
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              style={{ display: "block", color: "var(--c-inverse)" }}
            >
              <text
                x="40.35"
                y="74"
                textAnchor="middle"
                fontFamily={SERIF}
                fontWeight="800"
                fontSize="68"
                fill="currentColor"
              >
                S
              </text>
              <circle cx="73.7" cy="67.5" r="6.5" fill="var(--c-oninv-gold)" />
            </svg>
          </div>
        </div>
      </div>
      <div
        className={styles.introUp}
        style={{
          animationDelay: `${DELAY[1]}ms`,
          marginTop: "22px",
          font: `400 10px/1 ${MONO}`,
          letterSpacing: "0.16em",
          color: "var(--c-goldink)",
        }}
      >
        {date}
      </div>
      <div
        className={styles.introUp}
        style={{
          animationDelay: `${DELAY[2]}ms`,
          marginTop: "14px",
          font: `500 26px/1.15 ${SERIF}`,
          letterSpacing: "-0.025em",
          color: "var(--c-ink)",
          textAlign: "center",
          padding: "0 32px",
          textWrap: "pretty",
        }}
      >
        {headline}
      </div>
      <div
        className={styles.introUp}
        style={{
          animationDelay: `${DELAY[3]}ms`,
          marginTop: "12px",
          font: `400 12.5px/1.6 ${SANS}`,
          color: "var(--c-secondary)",
          textAlign: "center",
          padding: "0 44px",
          textWrap: "pretty",
        }}
      >
        {detail}
      </div>
    </div>,
    document.body,
  );
}
