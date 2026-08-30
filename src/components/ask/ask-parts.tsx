import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
/* Deep import, not the barrel. `@/components/ledger` re-exports `LedgerScreen`,
   which is a 25KB "use client" module, and the Ask screen is a client component
   that imports these parts, so the barrel would drag the whole Ledger into the
   /ask client graph for the sake of one 14px chevron. `chevron.tsx` carries no
   "use client" and imports nothing. */
import { Chevron } from "@/components/ledger/chevron";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * The pieces the Ask screen is built from.
 *
 * These are wrappers beside the shared ledger and watch vocabulary, never edits
 * to it. Every number below is read off the Direction C artboards
 * (`d-artboards/ask-artboards.html`, boards `c-light`, `c-dark`, `cq-light`,
 * `cq-dark`), which is the drawing the owner picked and therefore the spec.
 */

export const PAD = "var(--v3-pad)";

/**
 * Every box on this screen that sets a `min-height` also sets it `content-box`,
 * and this is the reason.
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
 * | destination row, `min-height:30` + `11px 0` + rule | 53 | 52 | 53 |
 * | company row, `min-height:47` + rule | 48 | 47 | 48 |
 * | jump row, `min-height:43` + two rules | 45 | 43 | 45 |
 * | prompt chip, `min-height:44` + 1px border | 46 | 44 | 46 |
 * | filter field, `min-height:48` + 1px border | 50 | 48 | 50 |
 *
 * Nothing was out of compliance at border-box, since 44 clears the 44px floor
 * exactly. But it clears it exactly rather than by the 2px the design drew,
 * and `README.md:180` names content-box as the pattern used throughout for
 * reaching 44. Reproducing the drawing's own box model is the correct fix;
 * padding a number until it matches is not.
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
 * The italic serif section rule, "company intel", "browse" and "prompts". A
 * different object from the uppercase mono eyebrow: lower case, italic, and the
 * rule fills whatever width the label leaves. Mono small caps belong on a
 * published artifact; this is a reading surface.
 */
export function AskSectionRule({ label, style }: { label: string; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "11px", ...style }}>
      <span
        style={{
          font: `400 italic 12.5px/1 ${FONT_DISPLAY}`,
          color: "var(--c-secondary)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} aria-hidden="true" />
    </div>
  );
}

/* ── The assistant jump row ────────────────────────────────────────── */

/**
 * The one deliberate way to put a QUESTION to the product, sitting directly
 * under a field that answers none.
 *
 * It is a row rather than a second filled control beside the field, because the
 * field is the primary act and a pair of equals would say otherwise. It is a
 * separate control rather than a submit on the field because the field has no
 * submit moment: it narrows as you type, and a send control beside it would
 * promise a navigation that does not happen. A question is therefore one
 * deliberate tap and never an accident of pressing Enter.
 *
 * The chevron takes `--c-goldink`, the ink token. `--c-gold` is a FILL and
 * never becomes type.
 */
export function AskJumpRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        ...CONTENT_BOX,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        minHeight: "43px",
        borderTop: "1px solid var(--c-hair)",
        borderBottom: "1px solid var(--c-hair)",
        font: `400 13.5px/1.35 ${FONT_SANS}`,
        color: "var(--c-ink)",
        textDecoration: "none",
      }}
    >
      <span>{label}</span>
      <Chevron direction="right" size={15} stroke="var(--c-goldink)" />
    </Link>
  );
}

/* ── Destination row ───────────────────────────────────────────────── */

export type AskDestinationRowProps = {
  href: string;
  label: string;
  /** A count, never a rate. Null when the count could not be read. */
  figure: string | null;
  /** The window the figure covers. Drawn only when there is a figure. */
  window: string;
  icon: ReactNode;
  first?: boolean;
  last?: boolean;
};

/**
 * Deal Flow, Trends, Live Feed, on one line each.
 *
 * WHAT THIS ROW GAVE UP AND WHY. It used to be a 95px two-line block with a
 * counter and a sentence of standing copy under the label, and all three of
 * those sentences came from a fixture that production never rendered: the live
 * screen drew three labels, no figures, and a notice explaining that the
 * figures had no source. One line with a real figure on it beats two lines
 * where the second was blank for every real reader, and three rows at 95px
 * becoming three rows at 53 is most of what lets six companies and all three
 * destinations share one fold.
 *
 * A FAULTED COUNT DRAWS NEITHER THE FIGURE NOR THE WINDOW. The row stays and
 * still opens its destination, because the destination is fine; only the count
 * failed. A bare "0" there would state a fact about the corpus that no read
 * supports, and a window with nothing beside it would frame an absence as a
 * figure. Both go, and the row reads as a row with no figure on it, which is
 * what it is.
 *
 * A real anchor carrying the row's own layout, so the whole box is the tap
 * target rather than a focusable div wrapping a link inside it.
 */
export function AskDestinationRow({
  href,
  label,
  figure,
  window: windowLabel,
  icon,
  first = false,
  last = false,
}: AskDestinationRowProps) {
  return (
    <Link
      href={href}
      style={{
        ...CONTENT_BOX,
        display: "flex",
        gap: "11px",
        alignItems: "center",
        minHeight: "30px",
        padding: "11px 0",
        textDecoration: "none",
        ...rowRule(last),
        ...(first ? { marginTop: "6px" } : null),
      }}
    >
      {icon}
      <span style={{ minWidth: 0, flex: 1, font: `600 15px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
        {label}
      </span>
      {figure !== null ? (
        <>
          <span
            style={{
              flex: "none",
              font: `400 10.5px/1 ${FONT_MONO}`,
              letterSpacing: "0.045em",
              color: "var(--c-ink)",
            }}
          >
            {figure}
          </span>
          <span style={{ flex: "none", font: `400 10.5px/1 ${FONT_SANS}`, color: "var(--c-muted)" }}>
            {windowLabel}
          </span>
        </>
      ) : null}
    </Link>
  );
}

/* ── Company directory row ─────────────────────────────────────────── */

export type AskLookupRowProps = {
  /**
   * Proved to land, or null.
   *
   * A NULL HREF DRAWS THE ROW WITHOUT A LINK, and that is a state this row did
   * not have before the field started searching the corpus. The standing
   * directory never sends one: `buildAskCompanies` omits a row it cannot prove,
   * because a row in a list of six ways in that opens nothing is a dead row. A
   * SEARCH result does send them, because 9.5% of the corpus does not resolve
   * from its own slug and dropping those would make the empty-result sentence
   * claim the corpus has never heard of a company it carries.
   *
   * The row keeps its ticker, its name and its sector, loses its chevron, and
   * is not a tap target. The count of them is stated in the copy above the
   * list, so an absent chevron is explained rather than inferred.
   */
  href: string | null;
  /**
   * Passed straight to `next/link`. False on searched rows: the rows are links,
   * and one keystroke over forty-nine of them already fired eight RSC
   * prefetches of company pages, which is a fan-out that scales with the result
   * set. The standing six keep the framework default.
   */
  prefetch?: boolean;
  /**
   * Null when the company carries no ticker. The chip keeps its 44px so the
   * names beside it stay on one left edge; nothing is drawn inside it.
   * Anthropic and OpenAI are both in the head of this read, so a missing ticker
   * is a real company rather than a bad row. Measured at read depth 50, ticker
   * coverage is 92%, so the chip is drawn as present and this is the rare case.
   */
  ticker: string | null;
  name: string;
  /** The sector. Null when the row has none; nothing stands in for it. */
  detail: string | null;
  first?: boolean;
  last?: boolean;
};

/**
 * The row the company directory is built from.
 *
 * THE SECTOR IS A TAIL NOW, NOT A SECOND LINE, and that is the only change to
 * this row. It used to sit under the name at 10.5px on its own line, which cost
 * every row nine pixels and drew "Technology" five times down a six row list as
 * a stack. As an inline tail after the name it costs no line at all, and the
 * field is low entropy enough that the one row reading `Aerospace & Defense`
 * becomes the thing that stands out, which is what a low-entropy field should
 * do.
 *
 * The name ellipsizes and the tail goes with it, so a long name never pushes
 * the chevron off the row.
 */
export function AskLookupRow({
  href,
  ticker,
  name,
  detail,
  prefetch,
  first = false,
  last = false,
}: AskLookupRowProps) {
  const box: CSSProperties = {
    ...CONTENT_BOX,
    display: "flex",
    alignItems: "center",
    gap: "13px",
    minHeight: "47px",
    textDecoration: "none",
    ...rowRule(last),
    ...(first ? { marginTop: "12px" } : null),
  };

  const inner = (
    <>
      <span
        style={{
          flex: "none",
          font: `500 11px/1 ${FONT_MONO}`,
          color: "var(--c-muted)",
          width: "44px",
        }}
      >
        {ticker}
      </span>
      <span
        style={{
          minWidth: 0,
          flex: 1,
          font: `500 14px/1.3 ${FONT_SANS}`,
          /* An unlinked row reads at the secondary weight of ink rather than at
             full ink. It is still a real company and still legible; it is just
             not a way in, and a row that looks exactly like its neighbours but
             does nothing when tapped is worse than one that looks quieter. */
          color: href !== null ? "var(--c-ink)" : "var(--c-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
        {/* No sector, no tail. An empty span would reserve the gap the design
            gives a fact and put nothing in it. */}
        {detail ? (
          <span style={{ marginLeft: "9px", font: `400 10.5px/1 ${FONT_SANS}`, color: "var(--c-muted)" }}>
            {detail}
          </span>
        ) : null}
      </span>
      {/* No href, no chevron. A chevron on a row that opens nothing is the
          affordance lying about itself, and the copy above the list already
          says how many rows are in this state. */}
      {href !== null ? <Chevron direction="right" /> : null}
    </>
  );

  if (href === null) {
    return <div style={box}>{inner}</div>;
  }
  return (
    <Link href={href} prefetch={prefetch} style={box}>
      {inner}
    </Link>
  );
}

/* ── Notices ───────────────────────────────────────────────────────── */

/**
 * The one shape a failed read and an empty group both take.
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
        font: `400 11.5px/1.5 ${FONT_SANS}`,
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
 * What a reader who arrived on `/ask?q=` is told, and the control that helps.
 *
 * WHAT IT REPLACED. The retired answer screen said "This surface does not
 * answer yet." and offered one inline link measuring 126 by 14 pixels, a live
 * tap-target violation on the one screen in the product where a reader has
 * already been told that nothing answers them. This is the same admission with
 * a full-width 44px action under it, and the working screen continues below it
 * rather than the page ending there.
 *
 * WHY IT IS NOT `WatchNotice`. `watch/watch-notice.tsx:20` is the block this
 * reproduces, and its anatomy is copied exactly: 1px `--c-border`, 12px radius,
 * `--c-surface`, 15px by 16px padding, 13px/1.6 body. What it has not got is a
 * full-width action; its `action` is an inline underlined 12.5px link sized to
 * its own text, which is the shape being replaced here. Adding a second action
 * form to a component three Watch tiers render, to serve one row on one screen,
 * is exactly the variant axis the build rules forbid, so the anatomy is reused
 * and the component is not edited. If a second surface ever needs the
 * full-width form, that is the moment to lift this into the shared one.
 */
export function AskAnswerNotice({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div
      style={{
        padding: "15px 16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-surface)",
      }}
    >
      <h2 style={{ margin: 0, font: `600 15px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>{heading}</h2>
      <p
        style={{
          margin: "7px 0 0",
          font: `400 13px/1.6 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        {body}
      </p>
      <Link
        href={action.href}
        style={{
          ...CONTENT_BOX,
          marginTop: "12px",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          borderTop: "1px solid var(--c-hair)",
          font: `500 13px/1 ${FONT_SANS}`,
          color: "var(--c-goldink)",
          textDecoration: "none",
        }}
      >
        <span>{action.label}</span>
        <Chevron direction="right" size={15} stroke="var(--c-goldink)" />
      </Link>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────── */

/**
 * The three destination glyphs, reproduced at 18px on a 24-unit viewBox at
 * stroke 1.7 with round caps. The design strokes them with a colour literal
 * whose value is exactly `--c-secondary` in the light theme; built with the
 * token, per the same ruling the ledger chevron carries.
 *
 * No `marginTop` any more. It existed to hang an 18px glyph off the top of a
 * two-line row aligned `flex-start`; the destination row is one line aligned
 * `center`, so the offset would now push it 2px below its own label.
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
      style={{ flex: "none" }}
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
