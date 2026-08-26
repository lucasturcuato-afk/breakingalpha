"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { ClaimAnatomy, OutcomeLead, OUTCOME_TOKENS } from "@/components/ledger";
import { useCompanyTabState, type CompanyTabId } from "@/hooks/useCompanyTabState";

import styles from "./company-mobile.module.css";
/* `./fixture` is NOT imported here and must never be. This is a client
   component, so a value import from that module is a download of the invented
   company: the gate stops the render and not the download. The shape lives in
   `./types` and erases; the fixture arrives as the `data` prop, built behind
   `mobileFixtureScreensEnabled()` on the server by
   `src/app/company/[id]/page.tsx`. */
import type { CompanyIntelData } from "./types";
import { Chip, EmptyWell, SkeletonBar } from "./parts";
import {
  FilingsSection,
  FinancialsSection,
  InsiderSection,
  PrimerSection,
  TONE_INK,
  ToneSection,
} from "./sections";

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

export type CompanyStage = "ready" | "loading" | "error" | "empty";

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
  stage = "ready",
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
   */
  hasCik = true,
}: {
  stage?: CompanyStage;
  data: CompanyIntelData | null;
  hasCik?: boolean;
}) {
  const router = useRouter();
  const { activeTab, setActiveTab } = useCompanyTabState();

  /* No data means no source answered, so the honest drawing is the loader.
     Nothing below states a fact about the company while `data` is null. */
  const effective: CompanyStage = data === null ? "loading" : stage;
  /* A desktop deep link can pin a tab this screen has no section for
     (articles, comps, and the three ids with no button). Fall back to the
     first section rather than drawing an empty body under no active chip. */
  const active = SECTION_IDS.has(activeTab) ? activeTab : "brief";

  /**
   * Retry.
   *
   * A bare `router.refresh()` is guaranteed inert on this screen: the only
   * thing that produces the error state is `?stage=error`, and a refresh keeps
   * the query string, so the retry redraws the same error for ever. Clearing
   * the lifecycle override first is what makes the control real, and it is a
   * no-op once a loader supplies the state instead of the URL, because there is
   * no `stage` to clear then.
   */
  const retry = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("stage");
    router.replace(url.pathname + url.search);
    router.refresh();
  }, [router]);

  return (
    <div
      data-parity="company"
      data-fixture="true"
      className={styles.screenIn}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
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
            font: "500 13px/1 Inter, sans-serif",
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
          /* The design's 24px, plus the bar the shell does not reserve for.
             The measurement that settles which of those two is true is at the
             top of this file. */
          padding: `22px ${PAD} calc(24px + var(--mobile-tabbar-height) + env(safe-area-inset-bottom))`,
        }}
      >
        {effective === "loading" ? <CompanySkeleton /> : null}
        {effective === "error" ? <CompanyError onRetry={retry} /> : null}

        {data !== null && (effective === "ready" || effective === "empty") ? (
          <>
            <Masthead data={data} />
            <KpiGrid data={data} />
            <YourEntries data={data} />

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
            <div key={active} className={styles.sectionIn} style={{ marginTop: "18px" }}>
              {active === "brief" ? <PrimerSection data={data} /> : null}
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
            font: "500 12px/1 'JetBrains Mono', monospace",
            color: "var(--c-muted)",
          }}
        >
          {data.ticker} · {data.exchange}
        </span>
        <span style={{ font: "600 11px/1 Inter, sans-serif", color: "var(--c-secondary)" }}>
          {data.sector}
        </span>
      </div>

      <h1
        style={{
          margin: "11px 0 0",
          font: "700 26px/1.14 'Playfair Display', serif",
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
        }}
      >
        {data.name}
      </h1>

      <p
        style={{
          margin: "12px 0 0",
          font: "500 17px/1 'JetBrains Mono', monospace",
          color: "var(--c-ink)",
        }}
      >
        {data.price}{" "}
        {/* Tinted off the SIGN, never pinned green. The design draws a company
            that happened to be up; a hardcoded green would paint a down day as
            a gain the moment this reads a real quote. */}
        <span
          style={{
            fontSize: "13px",
            color: data.change.trimStart().startsWith("-")
              ? "var(--c-redink)"
              : "var(--c-greenink)",
          }}
        >
          {data.change}
        </span>
      </p>

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
        <span style={{ font: "600 14px/1 Inter, sans-serif", color: "var(--c-oninv)" }}>
          Generate a company brief
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              font: "400 10px/1 'JetBrains Mono', monospace",
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
          font: "400 11px/1.5 Inter, sans-serif",
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        The memo surface is not built yet, so this does nothing on this screen.
      </p>
    </>
  );
}

function KpiGrid({ data }: { data: CompanyIntelData }) {
  return (
    <div
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
      {data.kpis.map((cell) => (
        <div key={cell.label} style={{ backgroundColor: "var(--c-surface)", padding: "11px 13px" }}>
          <div
            style={{
              font: "400 10px/1 'JetBrains Mono', monospace",
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
                ? "700 15px/1 'Playfair Display', serif"
                : "700 17px/1 'Playfair Display', serif",
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
                font: "400 10px/1 Inter, sans-serif",
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

/**
 * The user's own record on this name.
 *
 * Fresh in the design: github.md maps no repo component to it, and the company
 * page carries no counterpart today. The claim object inside it is not fresh,
 * so it is composed from the shared anatomy through the slots that anatomy
 * already exposes rather than by giving that anatomy a third scale. The design
 * draws the reading in italic Playfair, which the row scale does not carry, so
 * it goes through the `meta` slot instead of the `prose` slot.
 */
function YourEntries({ data }: { data: CompanyIntelData }) {
  if (!data.entry && !data.following) {
    return (
      <>
        <EntriesRule />
        <EmptyWell headline="You have no entries on this name yet." />
      </>
    );
  }

  return (
    <>
      <EntriesRule />

      {data.entry ? (
        <div
          style={{
            marginTop: "12px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-card)",
            overflow: "hidden",
          }}
        >
          {/* State is a 2px TOP edge plus a dot and the state word. Never a
              coloured left rule, and a challenged entry is never buried.

              Edge and lead both read data.entry.state, and the edge takes the
              same OUTCOME_TOKENS dot the lead does, so the two cannot drift. A
              hardcoded red here labelled every entry Challenged. */}
          <div
            style={{
              height: "2px",
              backgroundColor: OUTCOME_TOKENS[data.entry.state].dot,
            }}
          />
          <div style={{ padding: "13px 15px" }}>
            <ClaimAnatomy
              scale="row"
              lead={
                <div style={{ marginBottom: "9px" }}>
                  <OutcomeLead state={data.entry.state} instrument={data.entry.date} />
                </div>
              }
              claim={data.entry.claim}
              meta={
                <p
                  style={{
                    margin: "8px 0 0",
                    font: "400 italic 13px/1.55 'Playfair Display', serif",
                    color: "var(--c-body)",
                    textWrap: "pretty",
                  }}
                >
                  {data.entry.reading}
                </p>
              }
            />
          </div>
        </div>
      ) : null}

      {data.following ? (
        <div
          style={{
            marginTop: data.entry ? "10px" : "12px",
            padding: "13px 15px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                display: "inline-block",
                width: "9px",
                height: "9px",
                border: "1.5px solid var(--c-secondary)",
                borderRadius: "50%",
              }}
            />
            <span style={{ font: "600 11px/1 Inter, sans-serif", color: "var(--c-secondary)" }}>
              {data.following.since}
            </span>
          </div>
          <p
            style={{
              margin: "8px 0 0",
              font: "400 12.5px/1.5 Inter, sans-serif",
              color: "var(--c-body)",
            }}
          >
            {data.following.note}
          </p>
        </div>
      ) : null}
    </>
  );
}

function EntriesRule() {
  return (
    <div style={{ marginTop: "24px", display: "flex", alignItems: "center", gap: "11px" }}>
      <span
        style={{
          font: "400 italic 12.5px/1 'Playfair Display', serif",
          color: "var(--c-secondary)",
        }}
      >
        your entries on this name
      </span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
    </div>
  );
}

/**
 * Loading.
 *
 * The handoff specifies no company lifecycle at all: the prototype's dev strip
 * carries no company jump and README's stage table covers the brief, the wrap,
 * the dashboard and the memo only. So the shape here is derived from the screen
 * it is standing in for, not transcribed. It states nothing about the company,
 * which is the point of preferring a load to an empty state that asserts a
 * fact.
 */
function CompanySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        Reading this company.
      </span>
      <SkeletonBar width="42%" height={12} />
      <SkeletonBar width="72%" height={30} marginTop={11} />
      <SkeletonBar width="34%" height={17} marginTop={12} />
      <SkeletonBar width="100%" height={50} marginTop={16} />
      <SkeletonBar width="100%" height={132} marginTop={18} />
      <SkeletonBar width="100%" height={44} marginTop={22} />
      <SkeletonBar width="88%" height={13} marginTop={18} />
      <SkeletonBar width="96%" height={13} marginTop={10} />
      <SkeletonBar width="64%" height={13} marginTop={10} />
    </div>
  );
}

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
          font: "700 21px/1.1 'Playfair Display', serif",
          letterSpacing: "-0.01em",
          color: "var(--c-ink)",
        }}
      >
        This company did not come back.
      </div>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.55 Inter, sans-serif",
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
          font: "600 13px/1 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}
