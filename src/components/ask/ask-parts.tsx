import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
/* Deep import, not the barrel. `@/components/ledger` re-exports `LedgerScreen`,
   which is a 25KB "use client" module, and `ask-composer.tsx` is a client
   component that imports PAD from this file, so the barrel would drag the whole
   Ledger into the /ask client graph for the sake of one 14px chevron.
   `chevron.tsx` carries no "use client" and imports nothing. */
import { Chevron } from "@/components/ledger/chevron";

/**
 * The pieces both Ask screens are built from.
 *
 * These are wrappers beside the shared ledger vocabulary, never edits to it.
 * `Chevron` is imported and used as it stands; the back chevron on the answer
 * screen is drawn here instead because it points left at 16px and stroke 1.8,
 * and adding a direction and a size to a shared component to serve one screen
 * is exactly the divergence the build skill forbids.
 *
 * Every number below is the prototype's own, read off
 * `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html` lines 742 to
 * 763 (browse) and 2549 to 2576 (answer) through the parity harness.
 */

export const PAD = "var(--v3-pad)";

/**
 * Every box on these two screens that sets a `min-height` also sets it
 * `content-box`, and this is the reason.
 *
 * The prototype ships no box-sizing reset, so every box in it is the browser
 * default, content-box. This app sets `border-box` globally through Tailwind's
 * preflight. A `min-height` therefore means two different things on the two
 * sides: in the design the border and the block padding sit outside it, in the
 * build they eat into it. Measured at 390 through `parity_harness.py --screen
 * ask`, every min-height box on the screen came out short:
 *
 * | box | design | border-box | content-box |
 * |---|---|---|---|
 * | directory row, `min-height:64` + `15px 0` + rule | 95 | 93 | 95 |
 * | lookup row, `min-height:56` + rule | 57 | 56 | 57 |
 * | prompt chip, `min-height:44` + 1px border | 46 | 44 | 46 |
 * | composer field, `min-height:48` + 1px border | 50 | 48 | 50 |
 * | answer top bar, `min-height:48` + 1px rule | 49 | 48 | 49 |
 *
 * Nothing was out of compliance at border-box, since 44 clears the 44px floor
 * exactly. But it clears it exactly rather than by the 2px the design drew,
 * and `README.md:180` names content-box as the pattern used throughout for
 * reaching 44. Reproducing the prototype's own box model is the correct fix;
 * padding a number until it matches is not. Same reconciliation the mobile
 * Trends and Deal Flow units made.
 *
 * Only boxes with a `min-height` need this. The 48x48 send control sets an
 * explicit `width`/`height` and no border, so both models give 48.
 */
export const CONTENT_BOX = { boxSizing: "content-box" } as const satisfies CSSProperties;

/** Hairline above every row in a group, and below the last one. */
function rowRule(last: boolean): CSSProperties {
  return {
    borderTop: "1px solid var(--c-hair)",
    ...(last ? { borderBottom: "1px solid var(--c-hair)" } : null),
  };
}

/* ── Section rules ─────────────────────────────────────────────────── */

/**
 * The italic Playfair section rule, "browse" and "company intel". A different
 * object from the uppercase mono eyebrow: lower case, italic, and the rule
 * fills whatever width the label leaves.
 */
export function AskSectionRule({ label, style }: { label: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "11px", ...style }}>
      <span
        style={{
          font: "400 italic 12.5px/1 'Playfair Display', serif",
          color: "var(--c-secondary)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} aria-hidden="true" />
    </div>
  );
}

/* ── Directory row ─────────────────────────────────────────────────── */

export type AskDirectoryRowProps = {
  href: string;
  label: string;
  /** A count, never a rate. Null when the count could not be read. */
  counter: ReactNode;
  /** One line of standing copy. Null when there is nothing to say. */
  summary: ReactNode;
  icon: ReactNode;
  first?: boolean;
  last?: boolean;
};

/**
 * Deal Flow, Trends, Live Feed. A real anchor carrying the row's own layout, so
 * the whole 64px box is the tap target rather than a focusable div wrapping a
 * link inside it.
 */
export function AskDirectoryRow({
  href,
  label,
  counter,
  summary,
  icon,
  first = false,
  last = false,
}: AskDirectoryRowProps) {
  return (
    <Link
      href={href}
      style={{
        ...CONTENT_BOX,
        display: "flex",
        gap: "13px",
        alignItems: "flex-start",
        minHeight: "64px",
        padding: "15px 0",
        textDecoration: "none",
        ...rowRule(last),
        ...(first ? { marginTop: "6px" } : null),
      }}
    >
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
          <span style={{ font: "600 15px/1.3 Inter, sans-serif", color: "var(--c-ink)" }}>{label}</span>
          {counter ? (
            <span
              style={{
                font: "400 10.5px/1 'JetBrains Mono', monospace",
                letterSpacing: "0.045em",
                color: "var(--c-muted)",
              }}
            >
              {counter}
            </span>
          ) : null}
        </div>
        {summary ? (
          <p
            style={{
              margin: "5px 0 0",
              font: "400 12.5px/1.5 Inter, sans-serif",
              color: "var(--c-secondary)",
            }}
          >
            {summary}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/* ── Recent lookup row ─────────────────────────────────────────────── */

export type AskLookupRowProps = {
  href: string;
  ticker: string;
  name: string;
  entries: string;
  first?: boolean;
  last?: boolean;
};

export function AskLookupRow({ href, ticker, name, entries, first = false, last = false }: AskLookupRowProps) {
  return (
    <Link
      href={href}
      style={{
        ...CONTENT_BOX,
        display: "flex",
        alignItems: "center",
        gap: "13px",
        minHeight: "56px",
        textDecoration: "none",
        ...rowRule(last),
        ...(first ? { marginTop: "12px" } : null),
      }}
    >
      <span
        style={{
          flex: "none",
          font: "500 11px/1 'JetBrains Mono', monospace",
          color: "var(--c-muted)",
          width: "44px",
        }}
      >
        {ticker}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: "500 14px/1.3 Inter, sans-serif", color: "var(--c-ink)" }}>{name}</div>
        <div
          style={{
            marginTop: "3px",
            font: "400 10.5px/1 Inter, sans-serif",
            color: "var(--c-muted)",
          }}
        >
          {entries}
        </div>
      </div>
      <Chevron direction="right" />
    </Link>
  );
}

/* ── Notices ───────────────────────────────────────────────────────── */

/**
 * The one shape a failed read, an empty group and a stale count all take.
 *
 * Kept distinct in wording on purpose: the handoff's own principle, quoted in
 * github.md from `cross-source/page.tsx`, is that a failed read must never
 * render as an empty one. So "could not be read" and "there is nothing here"
 * say different things rather than sharing one blank slate.
 */
export function AskNotice({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      style={{
        margin: "12px 0 0",
        padding: "11px 13px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-well)",
        font: "400 11.5px/1.5 Inter, sans-serif",
        color: "var(--c-secondary)",
        textWrap: "pretty",
        ...style,
      }}
    >
      {children}
    </p>
  );
}

/**
 * A skeleton bar. The prototype's shimmer class lives in its own stylesheet and
 * is not in this repo, so this is a static block: it says "not yet" without
 * animating, which is also what prefers-reduced-motion would reduce it to.
 */
export function AskSkeleton({
  width,
  height = 12,
  style,
}: {
  width: string;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height: `${height}px`,
        borderRadius: "4px",
        backgroundColor: "var(--c-hair)",
        ...style,
      }}
    />
  );
}

/* ── Icons ─────────────────────────────────────────────────────────── */

/**
 * The three directory glyphs, reproduced at 18px on a 24-unit viewBox at stroke
 * 1.7 with round caps. The design strokes them with a colour literal whose
 * value is exactly `--c-secondary` in the light theme; built with the token,
 * per the same ruling the ledger chevron carries.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--c-secondary)"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ flex: "none", marginTop: "2px" }}
    >
      {children}
    </svg>
  );
}

export const IconDeals = (
  <Glyph>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5h6v2" />
  </Glyph>
);

export const IconTrends = (
  <Glyph>
    <path d="M4 17l5-6 4 3 6-8" />
  </Glyph>
);

export const IconFeed = (
  <Glyph>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Glyph>
);

/** The answer screen's back chevron. Left, 16px, stroke 1.8, inherits colour. */
export const IconBack = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
    style={{ flex: "none" }}
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
