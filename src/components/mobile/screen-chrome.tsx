"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./mobile.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Chrome shared by the five screens in this batch: the back header and the
 * italic section rule.
 *
 * The prototype draws the back header twice with two anatomies, 16px chevron
 * in `--c-secondary` on Settings and Alerts, 14px in `--c-muted` on Saved and
 * Learned. Equivalent controls in equivalent positions get one anatomy, so
 * both build at the darker, larger pair. Recorded in the PR body.
 */

export function BackHeader({ href, label }: { href: string; label: string }) {
  return (
    <div
      style={{
        flex: "none",
        minHeight: "48px",
        display: "flex",
        alignItems: "center",
        padding: "0 var(--v3-pad)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      <Link
        href={href}
        className={styles.bare}
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
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {label}
      </Link>
    </div>
  );
}

/** The italic Playfair section label with its trailing hairline. */
export function SectionRule({ label, marginTop = "24px" }: { label: string; marginTop?: string }) {
  return (
    <div style={{ marginTop, display: "flex", alignItems: "center", gap: "11px" }}>
      <span style={{ font: `400 italic 12.5px/1 ${FONT_DISPLAY}`, color: "var(--c-secondary)" }}>
        {label}
      </span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
    </div>
  );
}

/**
 * A mono eyebrow with a trailing rule, the anatomy the share brief uses above
 * Top Deals and Analyst Briefing.
 */
export function EyebrowRule({ children, marginTop = "24px" }: { children: ReactNode; marginTop?: string }) {
  return (
    <div style={{ marginTop, display: "flex", alignItems: "center", gap: "11px" }}>
      <h2
        style={{
          margin: 0,
          font: `700 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
          textTransform: "uppercase",
        }}
      >
        {children}
      </h2>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--pill-watch-border)" }} />
    </div>
  );
}

/** The screen scroll body. Fills the viewport without ever measuring in vh. */
export function ScreenBody({
  children,
  padTop = "20px",
  gutter = true,
}: {
  children: ReactNode;
  padTop?: string;
  gutter?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: `${padTop} ${gutter ? "var(--v3-pad)" : "0"} calc(24px + env(safe-area-inset-bottom))`,
      }}
    >
      {children}
    </div>
  );
}

/** The outer frame every screen in this batch shares. */
export function Screen({ parity, children }: { parity: string; children: ReactNode }) {
  return (
    <div
      data-parity={parity}
      className={styles.enter}
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
      }}
    >
      {children}
    </div>
  );
}
