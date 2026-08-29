"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { useCompanyTabState, type CompanyTabId } from "@/hooks/useCompanyTabState";

import styles from "./company-mobile.module.css";
/* There is no fixture module to import any more, and nothing here may grow
   one. This is a client component, so a value import of invented data is a
   DOWNLOAD of it: a gate stops the render and not the download, which is how
   invented financials reached `.next/static` on a production build where they
   could never paint. The shape lives in `./types` and erases; the data arrives
   as the `data` prop, assembled on the server by
   `src/lib/company-mobile/build.ts` from reads
   `src/app/company/[id]/page.tsx` already has in hand. */
import type { CompanyIntelData } from "./types";
import { Chip } from "./parts";
import {
  FilingsSection,
  FinancialsSection,
  InsiderSection,
  PrimerSection,
  TONE_INK,
  ToneSection,
  spanWhenLastOfOdd,
} from "./sections";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Company Intel, mobile. The prototype's `isCompany` screen.
 *
 * ONE SCREEN, FIVE SECTIONS, NOT FIVE ROUTES. The prototype carries a single
 * flat `coSection` key and swaps the section body with a 200ms fade. Section
 * state here rides the desktop `?tab=` convention through useCompanyTabState rather
 * than inventing a second one, so a section chip and a desktop tab are the same
 * state: they stay in step while both are mounted, and a deep link means the
 * same thing on either surface.
 *
 * GUTTER, and the trap it sits in. The prototype puts `padding:0 var(--v3-pad)`
 * on the header bar and `padding:22px var(--v3-pad) 24px` on the scroll body,
 * and NOTHING on the screen root. At 390px that is one 20px gutter a side and a
 * 350px content column. scripts/parity_harness.py injects a second gutter of
 * its own onto `#v3phone`, which narrows the design side to 310px, so a build
 * that measures 350 against a harness measuring 310 is right and the harness is
 * wrong. The root below therefore carries no horizontal padding at all.
 *
 * THE SHELL RESERVES NOTHING FOR ITS OWN TAB BAR, and this was checked rather
 * than assumed. app-shell.tsx does put
 * `pb-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom))] md:pb-0`
 * on the scrolling <main>, and that padding does nothing here: the overflow
 * comes from inside `PageTransition`, whose `motion.div` is `h-full`, so the
 * screen spills past <main>'s padding box rather than being laid out after its
 * block-end padding.
 *
 * Measured on the running page at 390x844, scrolled to the end, as
 * `tabBar.getBoundingClientRect().top` minus the bottom of the LOWEST element
 * carrying text. Both readings taken in one page load, toggling only this
 * element's `padding-bottom`:
 *
 *              Primer  Tone  Filings  Financials  Insider
 *   with        +24    +38    +39       +24        +24
 *   24px only   -35    -21    -20       -35        -35
 *
 * Negative is a row sitting UNDER the bar. So the bar is reserved for here, on
 * this screen's own scroll body, and the shell defect is left for whoever fixes
 * it once for all six screens. The shipped `/ledger` measures -18 on the same
 * method, so it carries the defect rather than disproving it.
 */

/* THERE IS NO `stage` PROP AND NO `CompanyStage` TYPE ANY MORE.
 *
 * It was `stage?: CompanyStage` with a `= "ready"` default, and the only thing
 * that ever set it was the `?stage=` query parameter this PR removed: a link
 * anyone could send that drew an empty or error screen over a company with
 * filings, insider rows and financials on file. With that gone, the prop was a
 * lever no caller pulled whose default silently asserted "ready", which is the
 * same defect class as the `hasCik` default this branch already removed.
 *
 * WHERE A FAILED READ GOES NOW. To the block that failed, not to the screen.
 * `financials.readFailed` is carried off `fetchCompanyFinancials`, and the
 * Financials section and the primer's key-figures well both draw it ahead of
 * any emptiness. That is the better shape: a Postgres 57014 on
 * `financial_facts_latest` leaves the other four reads answered, and a
 * screen-level error would hide four good blocks to report one bad one.
 *
 * `data === null` still draws `CompanyError`, because a null payload IS a
 * failed read: this route is a server component that resolves all four reads
 * before it renders, so there is no pending state for a skeleton to describe
 * and a permanent skeleton would tell the reader something is coming when
 * nothing is.
 */

const PAD = "var(--v3-pad)";

/** The five sections, keyed on the ids the desktop tab vocabulary already uses. */
const SECTIONS: { id: CompanyTabId; label: string }[] = [
  { id: "brief", label: "Primer" },
  { id: "trend", label: "Price & tone" },
  { id: "filings", label: "Filings" },
  { id: "financials", label: "Financials" },
  { id: "insider", label: "Insider" },
];

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

export function CompanyIntelScreen({
  /**
   * REQUIRED and NULLABLE, never optional and never defaulted. The caller
   * resolves the gate and passes the fixture or null; leaving the prop off is
   * a build failure rather than an invented company in front of a reader, and
   * below the null guard the type is non-null, so no later edit can bring the
   * fixture back by omission.
   *
   * The null branch below is UNEXERCISED on `/company/[id]` today. That page
   * renders its desk tree rather than this screen when the gate is shut, so
   * `data` is never actually null there. The branch is what makes the type
   * honest and what a second call site would land on; it is not tested
   * behaviour and should not be read as such.
   */
  data,
  /**
   * True when the company resolved to a SEC CIK. Drives which sourced empty
   * copy the Filings, Financials and Insider sections use, exactly as it does
   * on the desktop tabs.
   *
   * REQUIRED, WITH NO DEFAULT. It used to default to `true`, so a call site
   * that forgot the prop asserted an SEC identity for a company that may not
   * have one, and the sections then said "no filings on file" where "not an
   * SEC filer" was the truth. Absence must not silently become true.
   */
  hasCik,
}: {
  data: CompanyIntelData | null;
  hasCik: boolean;
}) {
  const router = useRouter();
  const { activeTab, setActiveTab } = useCompanyTabState();

  /* A desktop deep link can pin a tab this screen has no section for
     (articles, comps, and the three ids with no button). Fall back to the
     first section rather than drawing an empty body under no active chip. */
  const active = SECTION_IDS.has(activeTab) ? activeTab : "brief";

  /**
   * Retry.
   *
   * A bare `router.refresh()`, and it is not inert any more. The previous
   * version cleared a `?stage=` parameter first, because that parameter was
   * the only thing that could produce the error state and a refresh would have
   * kept it and redrawn the same error for ever. The parameter is gone, so a
   * refresh re-runs the server reads, which is the only thing that can change
   * this branch's answer.
   */
  const retry = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    /* No `data-fixture` attribute on this root. The screen reads the company's
       own rows now, so announcing itself as a fixture to every audit script
       would be false, and it is not conditional either: there is no branch left
       that draws invented data. */
    <div
      data-parity="company"
      className={styles.screenIn}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        /* The wrapper in `page.tsx` is a column flex container with its own
           `min-height: 100%`, and this grows into it. Without the grow, a
           percentage `min-height` against a wrapper whose HEIGHT is auto
           resolves to zero, so this box stopped at its content: measured at
           390x844 on `/company/mistral-ai`, the wrapper was 785px and this was
           617px. The wrapper paints the same ground, so nothing showed through,
           but every section below was laid out inside a box 168px shorter than
           the space it had, which is the space a short section needs to centre
           in. */
        flexGrow: 1,
      }}
    >
      <div
        style={{
          flex: "none",
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          padding: `0 ${PAD}`,
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {/* The design labels this "Ask" because the prototype reaches Company
            Intel from the Ask browse screen. `/ask` does not exist on this
            branch, and a control naming a destination that is not there is a
            false statement about where it goes, so it steps back through
            history and says so. Recorded in the PR body. */}
        <button
          type="button"
          onClick={() => router.back()}
          className={styles.bare}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: `500 13px/1 ${FONT_SANS}`,
            color: "var(--c-secondary)",
          }}
        >
          {/* Drawn here rather than through the shared Chevron. That component
              has no left direction and no 16px size, and adding either would be
              the shared-component edit two other screens are already blocked
              on. A wrapper beside it, never a branch inside it. */}
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
          Back
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          /* A COLUMN, so the active section can take the height nothing above
             it used. Masthead, KPI card and the chip row are all content-sized;
             the section below them is the one thing on this screen that has a
             short state and a long one, so it is the one that grows. */
          display: "flex",
          flexDirection: "column",
          /* The design's 24px, plus the bar the shell does not reserve for.
             The measurement that settles which of those two is true is at the
             top of this file. */
          padding: `22px ${PAD} calc(24px + var(--mobile-tabbar-height) + env(safe-area-inset-bottom))`,
        }}
      >
        {/* A NULL PAYLOAD IS A FAILED READ, NOT A PENDING ONE, and that is
            why this is the error and no longer a skeleton. The route is a
            server component: all four reads are resolved before this renders,
            so nothing is in flight by the time a reader sees it, and a skeleton
            here would promise an arrival that cannot happen. A financials read
            that failed does NOT come here, because the other four answered; it
            is drawn by the Financials section off `financials.readFailed`. */}
        {data === null ? <CompanyError onRetry={retry} /> : null}

        {data !== null ? (
          <>
            <Masthead data={data} />
            <KpiGrid data={data} />
            {/* NO "your entries on this name" BLOCK. `theses`, `user_claims`
                and `watchlist` all carry real rows, but this route resolves none
                of them, so there is nothing to draw. A new read, not a rewire.
                See the header on `./types`. */}

            <div
              style={{
                marginTop: "22px",
                display: "flex",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              {/* The same square chip the filing filters use. Drawn through
                  parts.tsx rather than restated inline, so the two rows cannot
                  drift out of step. */}
              {SECTIONS.map((section) => (
                <Chip
                  key={section.id}
                  label={section.label}
                  active={active === section.id}
                  onClick={() => setActiveTab(section.id)}
                />
              ))}
            </div>

            {/* Keyed on the section so the 200ms fade replays on every swap,
                which is what the prototype's `sc-if` gives for free. */}
            {/* `1 0 auto` and never `1`. Grow into whatever the blocks above
                left over, so a short section can centre in it, and NEVER shrink:
                a shrinkable basis-zero item compresses a long section below its
                own content. */}
            <div
              key={active}
              data-section-body=""
              className={styles.sectionIn}
              style={{
                marginTop: "18px",
                flex: "1 0 auto",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* `hasCik` reaches the primer too now. Its key-figures empty
                  state used to assert "private, pre-IPO, or not currently
                  quoted" for every company with no XBRL, which is false for a
                  company that has a CIK and has not filed a periodic report
                  yet. */}
              {active === "brief" ? <PrimerSection data={data} hasCik={hasCik} /> : null}
              {active === "trend" ? <ToneSection data={data} /> : null}
              {active === "filings" ? (
                <FilingsSection data={data} hasCik={hasCik} />
              ) : null}
              {active === "financials" ? (
                <FinancialsSection data={data} hasCik={hasCik} />
              ) : null}
              {active === "insider" ? (
                <InsiderSection data={data} hasCik={hasCik} />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Masthead({ data }: { data: CompanyIntelData }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span
          style={{
            font: `500 12px/1 ${FONT_MONO}`,
            color: "var(--c-muted)",
          }}
        >
          {data.ticker}
        </span>
        <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          {data.sector}
        </span>
      </div>

      <h1
        style={{
          margin: "11px 0 0",
          font: `700 26px/1.14 ${FONT_DISPLAY}`,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
        }}
      >
        {data.name}
      </h1>

      {/* NO PRICE LINE. The design draws a last price and a day change, and
          neither is on any read this page resolves. Both come from a CLIENT
          fetch to `/api/company-kpis`, which reaches Yahoo and carries its own
          loading, error and staleness states. A quote drawn from a server shape
          with no quote behind it can only be stale or invented, so the line is
          absent rather than approximated. */}
      <MemoControl corpus={data.memoCorpus} />
    </>
  );
}

/**
 * The control that opens the company brief.
 *
 * NO-OP, DELIBERATELY. Screen unit 16, the Memo surface, is blocked on a ruling
 * and is not being built: the design's defining interaction is an inline `[n]`
 * citation opening a source sheet, and there is no data behind it. The live
 * memo surface is src/components/memo/MemoModal.tsx, which has no inline
 * anchors at all, and POST /api/memo gives back a markdown string with no
 * structured source list. Both of those files are propose-only under CLAUDE.md
 * and neither is touched here.
 *
 * INERT, AND IT SAYS SO. An earlier draft was a live-looking button with an
 * empty handler, which README's own accessibility rule calls a defect: a
 * control that looks tappable and does nothing is worse than one that states
 * its condition. It is `disabled` with `aria-disabled`, it carries the reason
 * in a line under itself rather than in a tooltip nobody on a phone can open,
 * and it keeps the design's drawn treatment above that line.
 *
 * TODO(unit 16, Memo): wire this once overlay-versus-route and the source
 * contract are ruled on, and drop the `disabled` plus the line below it. The
 * existing bridge pattern is
 * src/components/company/CompanyMemoModalListener.tsx, which consumes MemoModal
 * through a `memo:generate` window event without modifying it.
 */
function MemoControl({ corpus }: { corpus: string }) {
  return (
    <>
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-describedby="memo-pending-note"
        className={styles.bare}
        style={{
          width: "100%",
          marginTop: "16px",
          minHeight: "50px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 16px`,
          backgroundColor: "var(--c-inverse)",
          borderRadius: "9px",
          cursor: "not-allowed",
        }}
      >
        <span style={{ font: `600 14px/1 ${FONT_SANS}`, color: "var(--c-oninv)" }}>
          Generate a company brief
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              font: `400 10px/1 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-oninv-dim)",
            }}
          >
            {corpus}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--c-gold)"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            style={{ flex: "none" }}
          >
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </span>
      </button>
      <p
        id="memo-pending-note"
        style={{
          margin: "8px 0 0",
          font: `400 11px/1.5 ${FONT_SANS}`,
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        The memo surface is not built yet, so this does nothing on this screen.
      </p>
    </>
  );
}

/**
 * The KPI card.
 *
 * IT IS A VARIABLE-LENGTH LIST, and the grid has to survive both ends of that.
 * `buildKpis` emits one cell per read that answered: the seven-day mention
 * count always, the article tone only when the window carried enough scored
 * coverage to state a level, and the source count only when a publisher name
 * was on a row. So one, two or three cells arrive, and a cell is never invented
 * to round the count.
 *
 * ODD COUNTS. The container paints `--c-border` and each cell paints
 * `--c-surface` over it, so the hairline is the container showing through the
 * 1px gap. With an odd count the last slot has no cell in it and draws as a
 * filled block of border colour about 57px tall, in both themes, exactly where
 * a figure would be. Measured on `/company/mistral-ai` at one cell and on
 * `/company/broadcom` and `/company/salesforce` at three. The lone trailing
 * cell spans the row instead, through the same helper the primer's key-figures
 * grid uses.
 *
 * ZERO CELLS. The whole card is omitted. A bordered, rounded, border-filled box
 * with nothing inside it is not an empty state, it is a container that failed
 * to be filled. Unreachable on today's mapper, because the mention count is
 * always emitted, and it is guarded rather than assumed: the emptiness of a
 * read is not this component's to predict.
 */
function KpiGrid({ data }: { data: CompanyIntelData }) {
  if (data.kpis.length === 0) return null;

  return (
    <div
      /* Named so a plate can crop to exactly this card. The empty half of an
         odd row is the defect it is evidence of, and it is 57px of the same
         colour as the hairline beside it, so a whole-screen plate cannot show
         it. */
      data-kpi-grid=""
      style={{
        marginTop: "18px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1px",
        backgroundColor: "var(--c-border)",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {data.kpis.map((cell, i) => (
        <div
          key={cell.label}
          style={{
            ...spanWhenLastOfOdd(i, data.kpis.length),
            backgroundColor: "var(--c-surface)",
            padding: "11px 13px",
          }}
        >
          <div
            style={{
              font: `400 10px/1 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {cell.label}
          </div>
          <div
            style={{
              marginTop: "6px",
              font: cell.tone
                ? `700 15px/1 ${FONT_DISPLAY}`
                : `700 17px/1 ${FONT_DISPLAY}`,
              /* Tinted off the reading, never pinned green. One table, shared
                 with the Price and tone section, so the KPI cell and the
                 section body can never disagree about what a reading looks
                 like. */
              color: cell.tone ? TONE_INK[cell.tone] : "var(--c-ink)",
            }}
          >
            {cell.value}
          </div>
          {cell.meta ? (
            <div
              style={{
                marginTop: "4px",
                font: `400 10px/1 ${FONT_SANS}`,
                color: "var(--c-muted)",
              }}
            >
              {cell.meta}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* THERE IS NO SKELETON ON THIS SCREEN, and its deletion is the point rather
   than a tidy-up. `/company/[id]` is a server component that awaits
   getCompanyDetail, fetchCompanyFilings, getInsiderTransactions and
   fetchCompanyFinancials before it renders, so by the time a byte reaches a
   reader nothing is in flight and there is no state a skeleton could describe.
   The only signal that ever raised it was `?stage=loading`, a query parameter
   this PR removed. A skeleton with no signal behind it is a promise that
   something is arriving, made on a screen where nothing is. */

/**
 * Error.
 *
 * A failed read and an empty result are different facts and this screen says
 * which one it is, on the governing principle github.md takes from
 * src/app/cross-source/page.tsx: "This is a failed read, not an empty result.
 * Nothing is being hidden."
 */
function CompanyError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert">
      <div
        style={{
          font: `700 21px/1.1 ${FONT_DISPLAY}`,
          letterSpacing: "-0.01em",
          color: "var(--c-ink)",
        }}
      >
        This company did not come back.
      </div>
      <p
        style={{
          margin: "10px 0 0",
          font: `400 13px/1.55 ${FONT_SANS}`,
          color: "var(--c-body)",
          textWrap: "pretty",
        }}
      >
        This is a failed read, not an empty result. Nothing is being hidden, and nothing below is
        a partial answer.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={styles.bare}
        style={{
          marginTop: "18px",
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: `600 13px/1 ${FONT_SANS}`,
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}
