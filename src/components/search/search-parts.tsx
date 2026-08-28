import Link from "next/link";
import type { ReactNode } from "react";
/* Deep imports, not the barrel. `@/components/ledger` re-exports LedgerScreen,
   which is a large "use client" module, and this file is pulled into the
   /search client graph for one chevron and one outcome lead. `chevron.tsx` and
   `claim-anatomy.tsx` carry no "use client" and import nothing. */
import { Chevron } from "@/components/ledger/chevron";
import { ClaimAnatomy, OutcomeLead } from "@/components/ledger/claim-anatomy";
import type { OutcomeState } from "@/components/ledger/claim-anatomy";
import styles from "./search.module.css";
import { FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * The pieces the Search screen is built from.
 *
 * Wrappers beside the shared ledger vocabulary, never edits to it. Two shared
 * components are consumed exactly as they stand: `Chevron`, and `OutcomeLead`
 * plus `ClaimAnatomy` for the one result that is a scored object rather than a
 * list row. Neither gained a prop, a scale or a branch to serve this screen.
 *
 * Every number below is the prototype's own, read off
 * `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html` lines 1399 to
 * 1453 through the parity harness.
 */

export const PAD = "var(--v3-pad)";

/* ── Eyebrow ───────────────────────────────────────────────────────── */

/**
 * PAGES / RESEARCH / COMPANIES / YOUR LEDGER / DEALS / ASK THE DESK.
 *
 * The label is typed in capitals rather than transformed, so the string a
 * screen reader announces is the string in the source. `ui/eyebrow.tsx` was
 * read and is not reused: its `sans` variant is 10px at 0.14em and its `mono`
 * variant is 9.5px, which is under the handoff's 10px type floor.
 */
export function SearchEyebrow({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        font: `400 10px/1 ${FONT_MONO}`,
        letterSpacing: "0.07em",
        color: "var(--c-muted)",
        ...style,
      }}
    >
      {label}
    </div>
  );
}

/* ── The field ─────────────────────────────────────────────────────── */

/**
 * The search field and the Cancel control.
 *
 * Three things differ from the prototype and each is deliberate:
 *
 *   a real label   the prototype ships a bare input with a placeholder. A
 *                  placeholder is not a label: it disappears on the first
 *                  keystroke and screen readers are not required to announce
 *                  it. The label is visually hidden, not absent.
 *   a real button  Cancel is a div with role="button" and tabindex in the
 *                  prototype. Here it is a <button>, so it answers Enter and
 *                  Space without a handler for each.
 *   a focus ring   the prototype sets `outline:none` on the input, which
 *                  removes the keyboard ring from the only control on the
 *                  screen. See `search.module.css`.
 *
 * The bordered box wraps the input and is NOT itself focusable: a container
 * that already contains a focusable control must never take focus of its own.
 */
export function SearchField({
  value,
  onChange,
  onCancel,
  inputId = "search-field",
}: {
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  inputId?: string;
}) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: `8px ${PAD} 12px`,
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search pages, companies, your ledger
      </label>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          /* 48, not the design's 46. The prototype is content-box, so its 46px
             minimum sits inside a 1px border on each side and measures 48
             rendered. Everything here is border-box under the framework reset,
             so the border has to be in the number. Measured on both sides with
             getBoundingClientRect, not transcribed. */
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: "0 14px",
          border: "1px solid var(--c-gold)",
          borderRadius: "12px",
          backgroundColor: "var(--c-bg)",
        }}
      >
        <svg
          style={{ flex: "none" }}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--c-muted)"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          id={inputId}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search pages, companies, your ledger"
          autoComplete="off"
          className={styles.field}
          style={{
            flex: 1,
            minWidth: 0,
            /* Fills the 46px the box leaves inside its own border, so the tap
               target is the field the reader can see rather than the 14px line
               box the text occupies. The design's own input measures 16px
               tall, which is the one property parity reports as a mismatch. */
            alignSelf: "stretch",
            font: `400 14px/1 ${FONT_SANS}`,
            color: "var(--c-ink)",
          }}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className={styles.bare}
        style={{
          flex: "none",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          padding: "0 4px",
          font: `500 13px/1 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

/* ── Jump row ──────────────────────────────────────────────────────── */

/**
 * A row in the PAGES or RESEARCH list. A real anchor carrying the row's own
 * layout, so the whole 48px box is the target rather than a focusable div
 * wrapping a link.
 *
 * The palette's own item button was read and is not reused: `px-4 py-2` at
 * 13px measures well under the 44px floor, and it draws a filled selected
 * state this screen has no equivalent of.
 *
 * `prefetch={false}`, and this is the one line on the screen with a measured
 * number behind it rather than a design one.
 *
 * Ten jump rows are on screen at once and every one of them is a `<Link>`, so
 * the default viewport prefetch warms TEN routes the moment /search paints.
 * Measured at 390x844 on a 4G profile (9 Mbps down, 170ms RTT, 4x CPU),
 * median of three cold loads:
 *
 *   default prefetch   TTI 2162ms   696 KB over the wire   76 requests
 *   prefetch={false}   TTI  844ms   286 KB over the wire   19 requests
 *
 * 403 KB and 58 of those requests are the prefetch. They land after the load
 * event, so they do not delay first paint, but the last of them is parsed in
 * a 100ms long task about 1.3s in, and that task is what keeps the screen
 * from going quiet. 361 KB of the 403 is route JS for the ten destinations, not
 * RSC payload, which is why a `loading.tsx` boundary on each destination
 * would recover about 42 KB and none of the long task.
 *
 * What this gives up is measured too. Clicking a jump row and timing until
 * the destination is painted, same profile, cold cache, median of three:
 *
 *   default prefetch   /dashboard  389ms    /live-feed  122ms
 *   prefetch={false}   /dashboard 1074ms    /live-feed  801ms
 *
 * So the trade is about 1318ms off the load against about 682ms added to the
 * one navigation that follows. A visit that loads /search and jumps once is
 * roughly 636ms faster and 190 KB lighter, because nine of the ten warmed
 * routes were never opened.
 *
 * Four other shapes were built and measured before this one. Deferring the
 * prefetch to `requestIdleCallback` after load moved nothing (TTI 2206ms):
 * the main thread is already idle there, so the default was never waiting on
 * it. Warming only the first three rows gave back 258ms while still spending
 * 273 KB, and quietly made the other seven slower. Next's own
 * `HoverPrefetchLink` shape, `prefetch={active ? null : false}` armed on
 * pointer intent, needs roughly 800ms of dwell before the click to be worth
 * anything on a 170ms RTT: at 120ms of dwell, which is what a tap actually
 * gives, its navigation measured 1110ms, no better than this line. This
 * screen is `md:hidden`, so a tap is the only input it will ever see.
 * Arming every row on the first pointer event was worst of all, at 1170ms,
 * because ten prefetches then compete with the navigation they were meant to
 * help.
 *
 * Deliberately scoped to the jump rows. The entity rows below only exist once
 * a query has been typed, so they are not on this screen's load path.
 */
export function SearchJumpRow({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minHeight: "48px",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          font: `400 13.5px/1.35 ${FONT_SANS}`,
          color: "var(--c-body)",
        }}
      >
        {label}
      </span>
      <Chevron direction="right" />
    </Link>
  );
}

/* ── Entity rows ───────────────────────────────────────────────────── */

/**
 * One anatomy for both entity list rows. The axes the design varies are the
 * row height, the presence of a fixed-width mono ticker, and nothing else:
 * a company is 60px with a 46px ticker, a deal is 56px with none.
 *
 * Both heights carry +1 here, for the same reason the field does. The design's
 * rows are content-box and each opens with a 1px hairline, so a 60px minimum
 * measures 61 rendered; border-box has to put the rule in the number. Measured
 * on both sides.
 */
function EntityRow({
  href,
  ticker,
  title,
  detail,
  minHeight,
}: {
  href: string;
  ticker?: string;
  title: string;
  detail: string;
  minHeight: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "13px",
        minHeight,
        borderTop: "1px solid var(--c-hair)",
        textDecoration: "none",
      }}
    >
      {ticker ? (
        <span
          style={{
            flex: "none",
            width: "46px",
            font: `500 11px/1 ${FONT_MONO}`,
            letterSpacing: "0.045em",
            color: "var(--c-muted)",
          }}
        >
          {ticker}
        </span>
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: `500 14px/1.35 ${FONT_SANS}`, color: "var(--c-ink)" }}>{title}</div>
        <div
          style={{
            marginTop: "3px",
            font: `400 11.5px/1.4 ${FONT_SANS}`,
            color: "var(--c-muted)",
          }}
        >
          {detail}
        </div>
      </div>
      <Chevron direction="right" />
    </Link>
  );
}

export function SearchCompanyRow({
  href,
  ticker,
  name,
  detail,
}: {
  href: string;
  ticker: string;
  name: string;
  detail: string;
}) {
  return <EntityRow href={href} ticker={ticker} title={name} detail={detail} minHeight="61px" />;
}

/**
 * The design draws this row with `cursor:pointer` and no handler at all, which
 * is a chevron pointing nowhere. Deal detail is not built, so rather than aim
 * at a route that does not exist, or leave a pointer with nothing behind it,
 * the row opens Deal Flow. Recorded in the PR body as a deviation.
 */
export function SearchDealRow({ name, detail }: { name: string; detail: string }) {
  return <EntityRow href="/deal-flow" title={name} detail={detail} minHeight="57px" />;
}

/* ── The ledger result ─────────────────────────────────────────────── */

/**
 * Not a list row. A stacked state header over Playfair claim text, which is
 * the scored-object anatomy the Ledger already owns, so it composes
 * `OutcomeLead` and `ClaimAnatomy` rather than a variant of the row above.
 *
 * `ClaimAnatomy` at scale="row" renders the claim at 500 15px/1.42 Playfair
 * with no margin, which is the prototype's value to the decimal. The 6px gap
 * between the header and the claim belongs to this container, not to the
 * anatomy, so the anatomy is untouched.
 */
export function SearchLedgerResult({
  href,
  state,
  date,
  claim,
}: {
  href: string;
  state: OutcomeState;
  date: string;
  claim: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "14px 0",
        borderTop: "1px solid var(--c-hair)",
        textDecoration: "none",
      }}
    >
      <ClaimAnatomy scale="row" lead={<OutcomeLead state={state} instrument={date} />} claim={claim} />
    </Link>
  );
}

/* ── Ask the desk ──────────────────────────────────────────────────── */

/**
 * The one bordered card on the screen. The query is echoed in the label at
 * weight 600 and is NOT carried in the href: `/intelligence` does not read a
 * query parameter, and inventing one that the chat ignores would be a link
 * that lies about what it does. Recorded in the PR body.
 */
export function SearchAskTheDesk({ query }: { query: string }) {
  return (
    <Link
      href="/intelligence"
      style={{
        marginTop: "8px",
        /* 54, not the design's 52. Content-box plus a 1px border on each side.
           Same correction as the field and the entity rows, measured. */
        minHeight: "54px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "0 16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-surface)",
        textDecoration: "none",
      }}
    >
      <span style={{ font: `400 13.5px/1.4 ${FONT_SANS}`, color: "var(--c-body)" }}>
        Ask about <strong style={{ fontWeight: 600 }}>{query}</strong>
      </span>
      <svg
        style={{ flex: "none" }}
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--c-gold)"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

/* ── Group wrapper ─────────────────────────────────────────────────── */

/**
 * An eyebrow and the rows under it. The design spaces every group after the
 * first by 20px off the one above.
 *
 * `rowsMarginTop` is the one axis, and it is not cosmetic. The jump lists drop
 * their rows 2px below the eyebrow because those rows carry no rule of their
 * own; the entity groups set it to zero because every entity row opens with a
 * `border-top` hairline that would otherwise float off its heading.
 */
export function SearchGroup({
  eyebrow,
  first = false,
  rowsMarginTop = "2px",
  children,
}: {
  eyebrow: string;
  first?: boolean;
  rowsMarginTop?: string;
  children: ReactNode;
}) {
  return (
    <div style={first ? undefined : { marginTop: "20px" }}>
      <SearchEyebrow label={eyebrow} />
      <div style={{ marginTop: rowsMarginTop }}>{children}</div>
    </div>
  );
}
