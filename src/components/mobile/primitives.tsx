"use client";

import type { CSSProperties, ReactNode } from "react";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "./fonts";
import styles from "./mobile.module.css";

/* ══════════════════════════════════════════════════════════════════════
   Shared pieces for the three mobile screens.
   ══════════════════════════════════════════════════════════════════════
   Small on purpose. Anything used by exactly one screen stays in that
   screen; only shapes that appear on two or more live here, so a change
   to one screen cannot silently redraw another.
   ══════════════════════════════════════════════════════════════════════ */

export const EASE = "cubic-bezier(0.16,1,0.3,1)";

/* The families live in ./fonts so a server component can read them too.
 * Re-exported here because every existing mobile screen imports them from
 * this module. */
export { FONT_DISPLAY, FONT_SANS, FONT_MONO } from "./fonts";

/** Stagger helper for the reveal class. `--d` is the animation delay. */
export function delay(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

/**
 * "Signal" in ink, "era." carrying the vertical gold gradient.
 *
 * The trailing full stop is part of the mark on every surface except
 * sign in, where the prototype drops it. Rendered as one inline-flex so
 * the two halves share a baseline whatever the size.
 */
export function Wordmark({
  size,
  weight = 700,
  stop = true,
  tracking = "-0.02em",
}: {
  size: number;
  weight?: number;
  stop?: boolean;
  /* The footer mark sets its own. The design runs -0.02em on the three
     masthead sizes and -0.01em on the 16px footer one. */
  tracking?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        fontFamily: FONT_DISPLAY,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1,
        letterSpacing: tracking,
      }}
    >
      <span style={{ color: "var(--c-ink)" }}>Signal</span>
      <span className={styles.wordmarkGold}>{stop ? "era." : "era"}</span>
    </span>
  );
}

/** Mono eyebrow. 10px floor, wide tracking, gold as TEXT via --c-goldink. */
export function Eyebrow({
  children,
  size = 10,
  tracking = "0.16em",
  color = "var(--c-goldink)",
  weight = 400,
  style,
}: {
  children: ReactNode;
  size?: number;
  tracking?: string;
  color?: string;
  weight?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1,
        letterSpacing: tracking,
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A section head: gold mono kicker, then a hairline running to the edge. */
export function SectionRule({ label }: { label: string }) {
  return (
    <div
      className={styles.rise}
      style={{ marginTop: 34, display: "flex", alignItems: "baseline", gap: 14 }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "0.16em",
          color: "var(--c-goldink)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, backgroundColor: "var(--c-border)" }} />
    </div>
  );
}

/**
 * The step / section title block the onboarding and the sign-in outcome
 * panels share: a small kicker, a Playfair title, an optional body line.
 */
export function TitleBlock({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body?: string;
}) {
  return (
    <div className={styles.in}>
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: "var(--c-goldink)",
        }}
      >
        {kicker}
      </div>
      <h1
        style={{
          margin: "12px 0 0",
          fontFamily: FONT_DISPLAY,
          fontSize: 27,
          fontWeight: 500,
          lineHeight: 1.16,
          letterSpacing: "-0.025em",
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        {title}
      </h1>
      {body && (
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: FONT_SANS,
            fontSize: 13.5,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
          {body}
        </p>
      )}
    </div>
  );
}

/**
 * The Google mark. The four fills are Google's own, fixed by its brand
 * guidelines, so they are neither ours to theme nor ours to approximate.
 * They read from --brand-google-* rather than sitting inline as literals.
 * Geometry is byte-identical to the two copies already in this repo.
 */
export function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="var(--brand-google-blue)"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="var(--brand-google-green)"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="var(--brand-google-yellow)"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="var(--brand-google-red)"
      />
    </svg>
  );
}

/** A tick inside a soft round well. The check-email and success panels. */
export function CheckSeal() {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        backgroundColor: "var(--c-well)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 16px",
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--c-gold)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </div>
  );
}
