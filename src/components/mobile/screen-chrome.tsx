"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import styles from "./mobile.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import { isPlainLeftClick, readAppHistory, shouldStepBack } from "./history-back";

/**
 * Chrome shared by the five screens in this batch: the back header and the
 * italic section rule.
 *
 * The prototype draws the back header twice with two anatomies, 16px chevron
 * in `--c-secondary` on Settings and Alerts, 14px in `--c-muted` on Saved and
 * Learned. Equivalent controls in equivalent positions get one anatomy, so
 * both build at the darker, larger pair. Recorded in the PR body.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS IS NOW THE ONLY BACK HEADER IN THE MOBILE SCREENS. Deal Flow, Live Feed
 * and Trends each hand-rolled it: the same 48px row, the same 1px rule, the
 * same 44px link, the same `500 13px/1` sans, the same 16px chevron, measured
 * identical at 44x44 with the link 2px from the top of the row. Three copies of
 * one anatomy is how PR 740 came to fix one rule in three places, and this
 * repo has paid for one-rule-many-implementations five times (PR 713, PR 721, PR 738,
 * `slugToCompanyName`, and PR 736's own three back controls). They import this
 * now, and the history rule below lives here once.
 *
 * `historyAware` IS OPT-IN, AND THAT IS THE LOAD-BEARING CHOICE.
 *
 * Four call sites already existed and every one of them NAMES ITS DESTINATION
 * in its own label: "Back to Deal Flow" on Saved, "Settings" on Alerts and
 * Learned, "Ledger" on Settings. `mobile-saved-screen.tsx:82` in particular is
 * a deliberate LATERAL link, Saved to Deal Flow, and not a back at all: Saved
 * is reached from the tab bar, so its previous entry is usually some other
 * pole. Defaulting to history-awareness would turn all four of those labels
 * into lies the first time a reader arrived from somewhere else. So the default
 * is exactly the behaviour those four already had, and the three Ask controls
 * ask for the new one.
 *
 * The test for the flag, so the next caller does not have to guess: pass it
 * when the control's job is "go back", and leave it off when the control
 * promises a specific destination. `/claim`'s chevron (`claim-screen.tsx:133`)
 * is the second kind and stays a plain link to `/ledger`.
 *
 * AND THE FLAG DECIDES THE VISIBLE WORD. A `historyAware` control is labelled
 * "Back". The three screens said "Ask", which was the pole they used to always
 * deliver, and the first build of this change kept that word while taking the
 * behaviour away. Measured, that was a closed loop and a link-purpose failure
 * at once:
 *
 *   /saved -> "Back to Deal Flow" -> /deal-flow -> "Ask" -> /saved -> repeat
 *
 * A reader who reached Deal Flow from Saved could never reach Ask from the
 * control named Ask. And the element is `<a>Ask</a>` with an `aria-hidden`
 * chevron, so a screen reader announced "Ask, link" and then delivered
 * /dashboard, /saved, or another website. `aria-label="Back"` over a visible
 * "Ask" would only trade a link-purpose failure for a label-in-name failure, so
 * THE VISIBLE WORD IS WHAT CHANGED. The four destination-naming call sites keep
 * their labels exactly as they were, which is the same opt-in rule made
 * visible: a control that promises a destination goes on promising it.
 *
 * WHY IT STAYS A `Link` AND DID NOT BECOME A `<button>`. The `href` is the
 * fallback, not decoration. When nothing of ours is behind the page the handler
 * does nothing and the anchor navigates on its own, so that path needs no
 * `router.push` and is served by the anchor's own semantics. It also keeps
 * cmd-click and middle-click opening the stated destination in a new tab, and
 * keeps `ASK_POLE_HREF` flowing through a prop at the call site, which is what
 * leaves `tests/unit/ask-pole-href.test.ts` able to see a hardcoded pole route
 * where a reader would write one.
 */

export function BackHeader({
  href,
  label,
  historyAware = false,
  right,
  boxSizing,
}: {
  href: string;
  /** THE VISIBLE WORD, and it has to match what the control does. A
   *  `historyAware` control passes "Back"; a destination control passes the
   *  destination. Guarded by `tests/unit/back-control-history.test.ts`. */
  label: string;
  /** Step back only when a page of OURS is behind this one, and fall through to
   *  `href` when none is. See the note above for which of the two a given
   *  control is. */
  historyAware?: boolean;
  /** A trailing element in the same 48px row, which pushes the two apart. */
  right?: ReactNode;
  /** `content-box` keeps the 1px rule OUTSIDE the drawn 48px, which is the
   *  prototype's own box model; the app sets `border-box` globally. Trends
   *  builds at the drawn height and the rest of this chrome does not, so the
   *  difference is carried explicitly rather than silently normalised by this
   *  consolidation. */
  boxSizing?: "content-box" | "border-box";
}) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!historyAware) return;
    if (!isPlainLeftClick(event)) return;
    if (!shouldStepBack(readAppHistory())) {
      /* Nothing of OURS is behind this page: a cold entry, a link opened from
         Slack or a search result, or a reader who has already walked back to
         where they came in. The anchor is left alone and navigates to `href`
         by itself. */
      return;
    }
    event.preventDefault();
    router.back();
  }

  return (
    <div
      style={{
        flex: "none",
        boxSizing,
        minHeight: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: right ? "space-between" : undefined,
        padding: "0 var(--v3-pad)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      <Link
        href={href}
        onClick={onClick}
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
      {right}
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
          font: `600 10px/1 ${FONT_MONO}`,
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
