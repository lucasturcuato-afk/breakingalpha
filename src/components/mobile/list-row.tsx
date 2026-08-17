"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./mobile.module.css";

/**
 * The settings list row. The one component shared by the largest subset of
 * this batch: Settings' six rows, Alerts' five, and the two screens Settings
 * reaches through them.
 *
 * Nothing in the repo was close enough to extend. `settings/profile/page.tsx`
 * has a local `FormField` and a local `Divider`, neither of which is a row,
 * and `RadarTabs.tsx` shares the hairline idea but is horizontal navigation.
 * So this is a net-new extraction, and it lives here rather than beside any
 * one screen because four of them consume it.
 *
 * Only two things vary, and both are settled here rather than by a prop that
 * encodes a mistake:
 *
 * 1. The trailing control. Three shapes and no more: a chevron (navigation), a
 *    switch, and a bordered text button. Sign out has none.
 * 2. Row height. The prototype draws Settings at 56px and Alerts at 60px. The
 *    extra 4px carries nothing, so both build at 56, which clears the 44px tap
 *    floor with room. Recorded in the PR body as a deliberate parity gap.
 *
 * Focus follows the handoff's rule that a container holding a focusable
 * control must not itself be focusable. A navigational row IS the control, so
 * it renders as a real `a` or `button` with nothing focusable inside. A row
 * carrying a switch or a text button renders as a plain div, and the control
 * inside it is the only tab stop.
 */

const ROW_HEIGHT = "56px";

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      style={{ flex: "none" }}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--c-muted)"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Body({ label, sub, subId }: { label: string; sub?: ReactNode; subId?: string }) {
  return (
    <span style={{ minWidth: 0, flex: 1, display: "block" }}>
      <span
        style={{
          display: "block",
          font: "500 14px/1.35 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        {label}
      </span>
      {sub != null ? (
        <span
          id={subId}
          style={{
            display: "block",
            marginTop: "3px",
            font: "400 11.5px/1.4 Inter, sans-serif",
            color: "var(--c-muted)",
          }}
        >
          {sub}
        </span>
      ) : null}
    </span>
  );
}

function shell(topRule: boolean, bottomRule: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: "13px",
    width: "100%",
    minHeight: ROW_HEIGHT,
    borderTop: topRule ? "1px solid var(--c-hair)" : undefined,
    borderBottom: bottomRule ? "1px solid var(--c-hair)" : undefined,
  } as const;
}

export type ListRowProps = {
  label: string;
  sub?: ReactNode;
  /** Id given to the sub-label so a trailing control can point at it. */
  subId?: string;
  topRule?: boolean;
  bottomRule?: boolean;
};

/** Navigation. The row is the control, so it renders as a link with a chevron. */
export function ListRowLink({
  href,
  label,
  sub,
  topRule = true,
  bottomRule = false,
}: ListRowProps & { href: string }) {
  return (
    <Link href={href} className={styles.bare} style={{ ...shell(topRule, bottomRule), textDecoration: "none" }}>
      <Body label={label} sub={sub} />
      <Chevron />
    </Link>
  );
}

/** An action with no destination. Still the whole row, still one tab stop. */
export function ListRowButton({
  onClick,
  label,
  sub,
  chevron = true,
  topRule = true,
  bottomRule = false,
}: ListRowProps & { onClick: () => void; chevron?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={styles.bare} style={shell(topRule, bottomRule)}>
      <Body label={label} sub={sub} />
      {chevron ? <Chevron /> : null}
    </button>
  );
}

/**
 * A row whose action lives in a trailing control. The row itself is inert, so
 * a keyboard user reaches the switch directly instead of tabbing into a
 * container whose accessible name is the whole row.
 */
export function ListRowControl({
  label,
  sub,
  subId,
  trailing,
  topRule = true,
  bottomRule = false,
}: ListRowProps & { trailing: ReactNode }) {
  return (
    <div style={shell(topRule, bottomRule)}>
      <Body label={label} sub={sub} subId={subId} />
      {trailing}
    </div>
  );
}
