"use client";

import { Fragment, useState } from "react";

import {
  applyFilter,
  countByCategory,
  FILTER_LABELS,
  FILTER_ORDER,
  type FilingFilter,
} from "@/lib/filing-categories";
import {
  INSIDER_COVERAGE_NOTE,
  filingsEmptyCopy,
  financialsEmptyCopy,
  insiderEmptyCopy,
  financialsUnreadableCopy,
  primerKeyFiguresEmptyCopy,
} from "@/components/company/tabs/empty-state-copy";

import type { CompanyIntelData, ToneDirection, ToneRowDirection } from "./types";
import { Chip, EmptyWell, RuledRow, SECTION_FILL, SectionNote, SectionRule } from "./parts";
import { QuoteLine } from "./QuoteLine";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import styles from "./company-mobile.module.css";

/**
 * Ink for a tone reading. ink tokens are text, base tokens are fills, and this
 * is text, so every entry is an ink.
 *
 * flat sits on `--c-secondary` rather than on an amber. Amber is the developing
 * and awaiting outcome hue, and a tone level is not an outcome.
 */
export const TONE_INK: Record<ToneDirection, string> = {
  up: "var(--c-greenink)",
  down: "var(--c-redink)",
  flat: "var(--c-secondary)",
};

/**
 * Fill for the dot beside one article's contribution to the reading.
 *
 * Base tokens, not ink tokens, because this is a fill and not text.
 *
 * THREE ENTRIES, and the third is the point. This was a two-way ternary,
 * `direction === "up" ? green : amber`, over a type that could only be "up" or
 * "mixed". A bearish article therefore drew amber, which reads as balanced
 * coverage rather than as negative coverage, and it did so silently on exactly
 * the rows a reader most needs to be right.
 */
const TONE_ROW_FILL: Record<ToneRowDirection, string> = {
  up: "var(--c-green)",
  mixed: "var(--c-amber)",
  down: "var(--c-red)",
};

/**
 * A lone trailing cell takes the whole row.
 *
 * The two-column cards on this screen are painted the way the design draws
 * them: the CONTAINER carries `--c-border` and a 1px gap, and each CELL paints
 * its own ground over it, so the hairline between cells is the container
 * showing through. An odd number of cells leaves the last slot with no cell in
 * it, and that slot is not empty space, it is a filled block of border colour
 * about 57px tall sitting where a figure would go. In both themes it reads as a
 * value that failed to arrive.
 *
 * Every cell on this screen is a real read and none of them can be dropped to
 * make the count even, so the last one spans instead. The zero-cell case is a
 * different fix and belongs at the call site: a bordered container with nothing
 * in it must not render at all.
 */
export function spanWhenLastOfOdd(index: number, count: number): { gridColumn?: string } {
  return count % 2 === 1 && index === count - 1 ? { gridColumn: "span 2" } : {};
}

/**
 * The five Company Intel sections, mobile.
 *
 * One flat section key, not five routes, matching the prototype's `coSection`.
 * Every measurement is read off the rendered prototype with getComputedStyle
 * through scripts/parity_harness.py.
 *
 * WHAT IS SOURCED AND WHAT IS DRAWN. The layout is the design's. The copy that
 * describes an absence is the repo's: filings, financials and insider empties
 * all come from tabs/empty-state-copy.ts, the pure module the desktop tabs
 * share, so the two surfaces cannot drift and so no sentence on this screen
 * claims something the data cannot support.
 */

const MONO_META = `400 10px/1 ${FONT_MONO}`;
const LABEL_MONO = {
  font: MONO_META,
  letterSpacing: "0.07em",
  color: "var(--c-muted)",
} as const;

/* ------------------------------------------------------------------ */
/* Primer                                                              */
/* ------------------------------------------------------------------ */

export function PrimerSection({
  data,
  /**
   * True when the company resolved to a SEC CIK, and the SAME flag the Filings,
   * Financials and Insider sections already take.
   *
   * IT WAS NOT PASSED, and the key-figures empty state asserted "private,
   * pre-IPO, or not currently quoted" for every company with no XBRL on file.
   * That is true for Mistral AI and FALSE for a public filer that has a CIK and
   * has not filed a periodic report yet, which is a false claim about a real
   * company printed under its own name. The screen has had the flag in hand the
   * whole time.
   */
  hasCik,
}: {
  data: CompanyIntelData;
  hasCik: boolean;
}) {
  const { primer } = data;
  return (
    <>
      {/* Both of these render only when they have something in them. The lede
          describes the primer below it, so with no primer there is nothing for
          it to describe; the identity card would otherwise draw as a bordered
          box with nothing inside. Sector, industry and headquarters are reads
          like any other and an absent read prints nothing. */}
      {primer.lede ? (
        <p
          style={{
            margin: 0,
            font: `400 11.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {primer.lede}
        </p>
      ) : null}

      {primer.identity.length > 0 ? (
      <div
        style={{
          marginTop: primer.lede ? "14px" : 0,
          display: "flex",
          flexDirection: "column",
          gap: "9px",
          padding: "14px 15px",
          border: "1px solid var(--c-border)",
          borderRadius: "12px",
          backgroundColor: "var(--c-surface)",
        }}
      >
        {primer.identity.map((row) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "12px",
            }}
          >
            <span style={{ font: `400 11.5px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
              {row.label}
            </span>
            <span
              style={{
                font: `500 12px/1.3 ${FONT_SANS}`,
                color: "var(--c-ink)",
                textAlign: "right",
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      ) : null}

      {/* PrimerTab hides the overview block entirely when neither a live nor a
          curated description exists, rather than drawing an empty heading over
          nothing. Same rule here. */}
      {primer.overview ? (
        <>
          <SectionRule marginTop={18}>business overview</SectionRule>
          <p
            style={{
              margin: "10px 0 0",
              font: `400 14px/1.65 ${FONT_SANS}`,
              color: "var(--c-body)",
              textWrap: "pretty",
            }}
          >
            {primer.overview}
          </p>
        </>
      ) : null}

      <SectionRule marginTop={20}>key figures</SectionRule>
      {primer.keyFigures.length > 0 ? (
        <div
          /* Named for the same reason `data-kpi-grid` is: the odd-row artifact
             is one border-coloured cell and a plate has to crop to it. */
          data-key-figures=""
          style={{
            marginTop: "10px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1px",
            backgroundColor: "var(--c-border)",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          {primer.keyFigures.map((figure, i) => (
            <div
              key={figure.label}
              style={{
                ...spanWhenLastOfOdd(i, primer.keyFigures.length),
                backgroundColor: "var(--c-bg)",
                padding: "12px 13px",
              }}
            >
              <div style={LABEL_MONO}>{figure.label}</div>
              <div
                style={{
                  marginTop: "6px",
                  font:
                    figure.scale === "figure"
                      ? `700 17px/1 ${FONT_DISPLAY}`
                      : `500 13px/1 ${FONT_MONO}`,
                  color: "var(--c-ink)",
                }}
              >
                {figure.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* THE FINANCIALS COPY, because these ARE the financials: every key
           figure is a validated XBRL fact off `financial_facts_latest`, the
           same table the Financials section reads, and none of them is quote
           data. The sentence here used to be PrimerKeyStats' market-data one,
           "private, pre-IPO, or not currently quoted", which is a claim about a
           listing and was false for any company that has a CIK and has not
           filed a periodic report yet. `primerKeyFiguresEmptyCopy` sits on the
           pure module both desktop tabs already share, so the two surfaces
           cannot drift and neither one asserts a listing status nothing on this
           page reads.

           THREE STATES, NOT TWO, and the third is why this is not
           `financialsEmptyCopy` directly. The four keys the Primer names are
           not every fact a filer states: GRAB's only validated fact is
           `cost_of_revenue`, so it lands here with a periodic report ON FILE
           and the two-state copy drew "Financials appear after the first
           periodic report" over a screen whose Financials section draws that
           filer's FY2022 cost of revenue feet away. `primer.hasFiledPeriod` is
           the flag that separates them. */
        <EmptyWell
          headline={
            /* SAME PRECEDENCE AS THE FINANCIALS SECTION, and for the same
               reason: a failed read leaves `keyFigures` empty and
               `hasFiledPeriod` false, so without this the well would print
               "Financials appear after the first periodic report" over a filer
               whose report is on file and whose read merely timed out. */
            data.financials.readFailed
              ? financialsUnreadableCopy()
              : primerKeyFiguresEmptyCopy(hasCik, primer.hasFiledPeriod)
          }
        />
      )}

      <SectionRule marginTop={20}>recent developments</SectionRule>
      {primer.developments.length > 0 ? (
        primer.developments.map((text, i) => (
          /* Keyed on POSITION. The list is static within a render and two
             developments can repeat a sentence; a duplicate key silently reuses
             the wrong row. Same rule on every list on this screen. */
          <RuledRow
            key={`${i}-${text}`}
            first={i === 0}
            last={i === primer.developments.length - 1}
            /* Named so the harness can count what rendered against what the
               pool selected. The empty state's whole claim is a count, and a
               count nothing can measure is a claim nothing can check. */
            marker="data-development-row"
          >
            <p
              style={{
                margin: 0,
                font: `400 13.5px/1.6 ${FONT_SANS}`,
                color: "var(--c-body)",
                textWrap: "pretty",
              }}
            >
              {text}
            </p>
          </RuledRow>
        ))
      ) : (
        /* THE COPY IS BUILT ON THE SERVER, off the pool's own accounting, and
           this branch only draws it. The sentence it replaces asserted an
           empty window over screens whose window was full; see the header on
           `primerDevelopmentsEmptyCopy`. `fill` stays OFF: this well sits
           mid-section with the footnote under it, and a growing well here
           shoves the footnote down the screen. */
        <EmptyWell
          headline={primer.developmentsEmpty.headline}
          note={primer.developmentsEmpty.note}
        />
      )}

      <SectionNote marginTop={14}>{primer.footnote}</SectionNote>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Price and tone                                                      */
/* ------------------------------------------------------------------ */

export function ToneSection({ data }: { data: CompanyIntelData }) {
  const { tone } = data;

  /* THE INSUFFICIENT READ IS A DIFFERENT HEADLINE, NOT A DIFFERENT SECTION.
     ToneReadout keeps "not enough coverage to state a level" apart from "the
     level is neutral", because they are different facts, and that much is
     carried over. What used to be carried over with it was an early RETURN,
     which exited ahead of the rule below and threw away rows the mapper had
     already produced: `buildTone` fills `rows` on both branches, and a company
     whose seven-day window is too thin to state a LEVEL can still have articles
     in it that carry a stored reading. `/company/grab` is that company, and not
     `/company/quantinuum`, which an earlier draft named: measured on all eight,
     grab reads insufficient WITH one article row and quantinuum reads
     insufficient with zero, so the fix is a no-op for quantinuum. The committed
     `tone-insufficient-with-rows-390-*` plates are grab's data.
     An absent level is a statement about the level. It is not a statement that
     the articles do not exist. */
  /* THE SHORT STATE CENTRES, the full one does not. With no level AND no rows
     the whole section is a headline and a caveat, roughly 90px of content in a
     section box of 300 or more, and a top-anchored 90px reads as a section that
     stopped rather than one that finished. Centred, the gap above equals the
     gap below and the difference between the leading gap and the trailing one
     is exactly the scroll body's bottom padding, which is the signature this
     screen's sibling wells already carry. A section with rows in it fills its
     own box and is left alone. */
  const shortBody = !tone.level && tone.rows.length === 0;

  return (
    <>
      {/* THE TAB IS NAMED FOR A PRICE. Until now it carried none, and the only
          figure on it that moved with the market was the chart's move since the
          start of an unlabelled three-month range, which is not the day. This
          draws the day, names its window, and reads it on the CLIENT: no part
          of it reaches `CompanyIntelData`, so the server shape stays quote-free
          exactly as ruled. See the header on ./QuoteLine. */}
      <QuoteLine ticker={data.ticker} />

      <div style={shortBody ? SECTION_FILL : undefined}>
      {tone.level ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
          <span
            style={{
              font: `700 21px/1.1 ${FONT_DISPLAY}`,
              letterSpacing: "-0.01em",
              color: TONE_INK[tone.levelTone],
            }}
          >
            {tone.level}
          </span>
          {/* `formatDirection` suppresses the phrase outright when there is no
              prior week to compare against, and an empty span still draws a
              flex gap beside the level. */}
          {tone.direction ? (
            <span
              style={{
                font: `600 12.5px/1 ${FONT_DISPLAY}`,
                color: TONE_INK[tone.levelTone],
              }}
            >
              {tone.direction}
            </span>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            font: `700 21px/1.1 ${FONT_DISPLAY}`,
            letterSpacing: "-0.01em",
            color: "var(--c-secondary)",
          }}
        >
          Not enough recent coverage
        </div>
      )}

      {/* "" on the insufficient branch, and deliberately: `formatEvidence` over
          an empty window reads "0 of 0 mentions positive", which is a claim
          about a window that carried nothing, so `buildTone` emits nothing and
          this draws nothing rather than an empty paragraph. */}
      {tone.evidence ? (
        <p
          style={{
            margin: "8px 0 0",
            font: `400 11.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-secondary)",
          }}
        >
          {tone.evidence}
        </p>
      ) : null}

      <p
        style={{
          margin: "12px 0 0",
          font: `400 11.5px/1.55 ${FONT_SANS}`,
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        {tone.disclaimer}
      </p>
      </div>

      {/* Drawn whenever there are rows to draw, on EITHER branch. The one case
          it stays away from is no rows AND no level: the headline above has
          already said there was not enough coverage, and a rule over a well
          repeating it says the same absence twice. */}
      {tone.rows.length > 0 || tone.level ? (
        <>
          <SectionRule marginTop={20}>what moved the reading</SectionRule>
          {tone.rows.length > 0 ? (
            tone.rows.map((row, i) => (
              <RuledRow
                key={`${i}-${row.meta}`}
                first={i === 0}
                last={i === tone.rows.length - 1}
                style={{ display: "flex", gap: "12px" }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: "none",
                    display: "inline-block",
                    marginTop: "5px",
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: TONE_ROW_FILL[row.direction],
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, font: `400 13px/1.55 ${FONT_SANS}`, color: "var(--c-body)" }}>
                    {row.reading}
                  </p>
                  <p style={{ margin: "5px 0 0", ...LABEL_MONO }}>{row.meta}</p>
                </div>
              </RuledRow>
            ))
          ) : (
            /* ToneEvidenceList gives back null on an empty window, so the level
               can stand with no evidence under it. Saying so beats drawing
               nothing. */
            <EmptyWell fill headline="No article in the last 7 days moved this reading." />
          )}
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Filings                                                             */
/* ------------------------------------------------------------------ */

/**
 * Chip state is `FilingFilter | null`, where null is the DEFAULT view and
 * carries material forms only. That is FilingsTab's own model, kept whole so a
 * chip means the same thing on both surfaces.
 *
 * DEVIATION FROM THE DRAWING. The prototype wires its Insider chip to jump to
 * the Insider section instead of filtering, and hardcodes it so it can never
 * render active. A chip sitting in a filter row that does not filter is a trap,
 * and the source's own note tells the reader to "use the Insider chip", meaning
 * the filter. It filters here. Recorded in the PR body.
 */
export function FilingsSection({
  data,
  hasCik,
}: {
  data: CompanyIntelData;
  hasCik: boolean;
}) {
  const [filter, setFilter] = useState<FilingFilter | null>(null);
  const { rows } = data.filings;

  if (!hasCik || rows.length === 0) {
    return <EmptyWell fill headline={filingsEmptyCopy(hasCik)} />;
  }

  /* DERIVED, never stored. A chip label is a promise about what tapping it
     draws, so it comes from the rows that are here rather than from a count
     field beside them. The stored version read "Events 22" over two events.
     Both of these are the desktop tab's own helpers, so a chip counts and
     filters by one classifier on both surfaces. */
  const counts = countByCategory(rows);
  const visible = applyFilter(rows, filter);

  return (
    <>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {FILTER_ORDER.map((key) => (
          <Chip
            key={key}
            shape="pill"
            label={`${FILTER_LABELS[key]} ${counts[key]}`}
            active={filter === key}
            disabled={counts[key] === 0}
            onClick={() => setFilter(filter === key ? null : key)}
          />
        ))}
      </div>

      {filter === null && counts.insider > 0 ? (
        <SectionNote>
          {`Showing material filings. ${counts.insider} insider form${
            counts.insider === 1 ? "" : "s"
          } (3, 4, 5) set aside; see the Insider chip or the Insider section.`}
        </SectionNote>
      ) : null}

      {visible.length === 0 ? (
        <EmptyWell
          fill
          headline={
            filter === null
              ? "No material filings recorded. Every stored filing for this company is an insider form; use the Insider chip or the Insider section."
              : "No filings in this category."
          }
        />
      ) : (
        visible.map((row, i) => (
          /* Position, not the row's own fields. Form plus date plus category is
             not unique: the date is a display string with no year, and two 8-Ks
             on one day is ordinary. */
          <div
            key={`${i}-${row.formType}-${row.date}`}
            style={{
              marginTop: i === 0 ? "12px" : undefined,
              display: "flex",
              gap: "12px",
              alignItems: "flex-start",
              padding: "14px 0",
              borderTop: "1px solid var(--c-hair)",
              borderBottom: i === visible.length - 1 ? "1px solid var(--c-hair)" : undefined,
            }}
          >
            <div style={{ flex: "none", width: "54px" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 6px",
                  border: "1px solid var(--c-border)",
                  borderRadius: "4px",
                  backgroundColor: "var(--c-surface)",
                  font: `600 10.5px/1.4 ${FONT_SANS}`,
                  color: "var(--c-ink)",
                }}
              >
                {row.formType}
              </span>
              <div style={{ marginTop: "5px", ...LABEL_MONO }}>{row.date}</div>
            </div>
            {row.summary ? (
              <p
                style={{
                  margin: 0,
                  minWidth: 0,
                  flex: 1,
                  font: `400 13px/1.55 ${FONT_SANS}`,
                  color: "var(--c-body)",
                }}
              >
                {row.summary}
              </p>
            ) : (
              /* A stored filing whose summariser has not run. Stale at the row
                 level, and the only per-row freshness marker either surface
                 carries. Verbatim from FilingsTab. */
              <p
                style={{
                  margin: 0,
                  minWidth: 0,
                  flex: 1,
                  font: `400 italic 13px/1.55 ${FONT_SANS}`,
                  color: "var(--c-muted)",
                }}
              >
                Summary pending
              </p>
            )}
          </div>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Financials                                                          */
/* ------------------------------------------------------------------ */

/**
 * The metric column, then one column per period.
 *
 * NOT a fixed three. `periods` is a list because the data is: measured on the
 * live rows, GRAB has exactly ONE annual period and no quarterly one, while
 * Goldman Sachs has five annual and eight quarterly. A hardcoded third track
 * drew an empty column under a blank header for the first, which reads as a
 * period whose figures are missing rather than as a period that was never
 * filed. (Not ASML: its quarterly basis carries eight periods, not one.)
 *
 * `minmax(auto, Nfr)` AND NOT A BARE `Nfr`. A bare fr resolves against the
 * container width, so every extra period made every column narrower and the
 * table was clipped by the `overflow: hidden` that used to sit on it. Two
 * period columns fitted; five and eight do not, and 5 and 8 are exactly what
 * `ANNUAL_PERIODS` and `QUARTERLY_PERIODS` give back. Measured at 390px on a
 * 348px container: GRAB annual wants 348, ASML annual 375, Quantinuum
 * quarterly 410 and Goldman Sachs quarterly 714, so 366px of a real filer's
 * statement had no way to be reached. An `auto` minimum sizes each track to its
 * own widest figure instead, and the container scrolls sideways.
 *
 * THE WHOLE TABLE IS ONE GRID CONTAINER, which is the other half of the fix.
 * Track sizes are computed per container, so with a grid per row a
 * content-driven track would size off that row's own cells and the columns
 * would stop lining up. The header row, the band heads and every data row are
 * items in this one grid, and the band heads span it with `1 / -1`.
 */
function gridFor(periodCount: number): string {
  return `minmax(auto, 1.35fr) repeat(${Math.max(periodCount, 1)}, minmax(auto, 1fr))`;
}
const HEAD_FONT = `600 10px/1 ${FONT_SANS}`;

/**
 * The metric column stays put while the figures scroll under it.
 *
 * A financials row is a label and a set of numbers, and a number whose row
 * label has scrolled off the screen is a number a reader cannot name. The cell
 * has to paint an opaque ground of its own or the scrolled values show through
 * it, so every user of this passes the ground the row sits on.
 */
const STICKY_LABEL = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  /* THE EDGE IS NOT DECORATION. Without it the scrolled figures are cut at the
     sticky cell's right edge with nothing marking the cut, so the fragment
     reads as the whole value. Measured at scrollLeft 400 on Goldman Sachs
     quarterly, screenshot opened and read: `$4.10B` showed as `10B`,
     `$1807.98B` as `98B`, `$122.78B` as `78B` and the header `Q3 FY2025` as
     `2025`. On a financials surface `98B` standing in for `$1807.98B` is the
     dangerous kind of wrong, because it is legible, plausible and off by four
     orders of magnitude. The rule plus the shadow make the cut a cut. */
  borderRight: "1px solid var(--c-border)",
  boxShadow: "4px 0 6px -4px rgba(0, 0, 0, 0.28)",
} as const;

/**
 * Digits that sit in a column line up.
 *
 * Logged during this sprint as appearing nowhere on this screen, and the
 * financials table is the case it was written for: proportional digits make a
 * column of figures ragged down its own decimal point.
 */
const TABULAR = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The missing-cell mark, an EN dash. Named rather than inlined so the one place
 * it is decided is greppable.
 *
 * FinancialsTab renders `&mdash;` here, an EM dash, which the handoff's
 * compliance rule forbids outright and which scripts/design-lint.mjs rejects on
 * sight. The prototype draws an en dash and the closing note under the table
 * says "A dash". Reported in the PR body as a defect in the shipped desktop
 * file; not fixed from this branch.
 */
const EN_DASH = "–";

/**
 * EVERY period column the filer reported, not the newest pair.
 *
 * The design draws two, and two was a statement about the width of a phone
 * rather than about the data. `ANNUAL_PERIODS` and `QUARTERLY_PERIODS` give
 * back 5 and 8, the mappers return exactly that, and dropping the rest would
 * hide filed figures with nothing on the screen saying so. The table scrolls
 * sideways instead, with the metric column pinned; see `gridFor`.
 *
 * A missing cell draws a dash and never a zero, and a row with no value across
 * any shown period is dropped rather than dashed, both matching the desktop.
 * The design's own closing note states the first rule to the reader.
 *
 * The dash is an EN dash. FinancialsTab renders an em dash, which the handoff's
 * compliance rule 4 forbids outright and which design-lint rejects; the
 * prototype uses an en dash and its own copy says "A dash". Recorded in the PR
 * body as a defect in the shipped desktop file, not fixed here.
 */
export function FinancialsSection({
  data,
  hasCik,
}: {
  data: CompanyIntelData;
  hasCik: boolean;
}) {
  const [basis, setBasis] = useState<"annual" | "quarterly">("annual");
  const { note } = data.financials;
  const { periods, bands } = data.financials[basis];
  const hasBasisData = bands.some((b) => b.rows.length > 0);

  /* Whether EITHER basis has a table, which is a different question from
     whether the SELECTED one does, and the distinction is load bearing. The
     toggle is the only way out of an empty basis, so dropping it on the
     basis-level empty strands the reader: a filer with annual figures and no
     quarterly ones taps Quarterly, the toggle disappears with the table, and
     nothing on the screen gets them back to Annual short of a reload. So the
     SECTION-level empty keys on both bases, and the BASIS-level empty keeps
     the toggle above it. */
  const otherBands = data.financials[basis === "annual" ? "quarterly" : "annual"].bands;
  const hasAnyData = hasBasisData || otherBands.some((b) => b.rows.length > 0);

  /* THE FAILED READ IS CHECKED FIRST, and that order is the whole fix.
     `fetchCompanyFinancials` answers a query error with the same empty views a
     company with no facts gets, so `!hasAnyData` is true in both cases and the
     sentence under it, "Financials appear after the first periodic report", is
     an assertion about the issuer. Measured on `/company/salesforce`, which has
     five years of validated XBRL on file: that sentence on one pass and the
     full FY2022 to FY2026 table twenty minutes later. `financial_facts_latest`
     times out with Postgres 57014 and the mapper cannot see it; `readFailed`
     is the read telling us, and it outranks every emptiness below. */
  if (data.financials.readFailed) {
    return <EmptyWell fill headline={financialsUnreadableCopy()} />;
  }

  /* No table under either basis means no basis to pick between, so the period
     toggle does not render over an empty well. FinancialsTab draws its empty
     state alone for the same reason. */
  if (!hasCik || !hasAnyData) {
    return <EmptyWell fill headline={financialsEmptyCopy(hasCik)} />;
  }

  return (
    <>
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <Chip label="Annual" active={basis === "annual"} onClick={() => setBasis("annual")} />
        <Chip
          label="Quarterly"
          active={basis === "quarterly"}
          onClick={() => setBasis("quarterly")}
        />
      </div>

      {!hasBasisData ? (
        /* NOT financialsEmptyCopy. "Financials appear after the first periodic
           report" is false here, because the other basis has figures. Name the
           basis that is missing and claim nothing else. */
        <EmptyWell
          fill
          headline={`No ${basis} figures on file. The ${
            basis === "annual" ? "quarterly" : "annual"
          } basis has figures.`}
        />
      ) : (
        <>
          {/* THE TABLE SCROLLS SIDEWAYS, INSIDE ITS OWN CONTAINER, and the page
              body never does. `overflow: hidden` used to sit here, which fitted
              the deleted fixture's two period columns and does not fit the real
              ones. See the note on `gridFor` for the measurements. */}
          <div
            role="group"
            aria-label={`${basis === "annual" ? "Annual" : "Quarterly"} financials, scrolls sideways`}
            tabIndex={0}
            /* The visible scrollbar. A screen reader gets the label above; a
               sighted reader used to get nothing at all when the second column
               landed entirely outside the clip. See `.hscroll`. */
            className={styles.hscroll}
            style={{
              marginTop: "12px",
              border: "1px solid var(--c-border)",
              borderRadius: "12px",
              overflowX: "auto",
              overflowY: "hidden",
              /* A sideways fling stays in the table rather than being handed up
                 to the page or to the browser's own back gesture. */
              overscrollBehaviorX: "contain",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridFor(periods.length),
                /* max-content sizes the tracks to the figures they carry;
                   minWidth keeps a table narrower than the screen filling its
                   own border instead of leaving a gap inside it. */
                width: "max-content",
                minWidth: "100%",
              }}
            >
              <div
                style={{
                  ...STICKY_LABEL,
                  padding: "9px 12px",
                  font: HEAD_FONT,
                  color: "var(--c-secondary)",
                  backgroundColor: "var(--c-surface)",
                  borderBottom: "1px solid var(--c-border)",
                }}
              >
                METRIC
              </div>
              {periods.map((period, i) => (
                /* Keyed on POSITION. A period label is not unique: Goldman
                   Sachs' quarterly view carries both "FY2025" and "Q3 FY2025",
                   and two fiscal year-end columns can repeat a label outright. */
                <div
                  key={`${i}-${period}`}
                  style={{
                    padding: i === periods.length - 1 ? "9px 12px 9px 8px" : "9px 8px",
                    textAlign: "right",
                    font: HEAD_FONT,
                    /* AFTER `font`, always. The `font` shorthand resets
                       `font-variant-numeric` to normal, and React writes inline
                       properties in key order, so spreading this above the
                       shorthand silently undoes it. Measured: the cells read
                       `font-variant-numeric: normal` in the browser until this
                       moved down. */
                    ...TABULAR,
                    color: "var(--c-secondary)",
                    backgroundColor: "var(--c-surface)",
                    borderBottom: "1px solid var(--c-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {period}
                </div>
              ))}

              {bands.map((band, bandIndex) => (
                <Fragment key={band.band}>
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      padding: "9px 12px",
                      backgroundColor: "var(--c-surface)",
                      borderTop: bandIndex > 0 ? "1px solid var(--c-border)" : undefined,
                      font: HEAD_FONT,
                      color: "var(--c-muted)",
                    }}
                  >
                    {/* The band name stays put too, for the reason the metric
                        column does: a band head scrolled off the screen leaves
                        the rows under it unnamed. */}
                    <span style={{ position: "sticky", left: "12px", display: "inline-block" }}>
                      {band.band}
                    </span>
                  </div>
                  {band.rows.map((row) => (
                    <Fragment key={row.label}>
                      <div
                        style={{
                          ...STICKY_LABEL,
                          padding: row.derived ? "10px 12px 10px 22px" : "10px 12px",
                          font: row.derived
                            ? `400 12px/1.3 ${FONT_SANS}`
                            : `400 12.5px/1.3 ${FONT_SANS}`,
                          color: row.derived ? "var(--c-secondary)" : "var(--c-ink)",
                          backgroundColor: "var(--c-bg)",
                          borderTop: "1px solid var(--c-hair)",
                        }}
                      >
                        {row.label}
                      </div>
                      {row.values.map((value, i) => (
                        <div
                          key={`${row.label}-${i}`}
                          style={{
                            padding:
                              i === row.values.length - 1
                                ? "10px 12px 10px 8px"
                                : "10px 8px",
                            textAlign: "right",
                            font: `400 12px/1.3 ${FONT_MONO}`,
                            /* After `font`. See the header cell above. */
                            ...TABULAR,
                            color: row.derived ? "var(--c-secondary)" : "var(--c-body)",
                            borderTop: "1px solid var(--c-hair)",
                            /* A figure never wraps mid-number. The track is
                               sized off this, so nothing is cut either. */
                            whiteSpace: "nowrap",
                          }}
                        >
                          {value ?? EN_DASH}
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>

          <SectionNote>{note}</SectionNote>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Insider                                                             */
/* ------------------------------------------------------------------ */

/**
 * Three groups, not the design's two.
 *
 * InsiderTab groups Form 4 rows open market, routine compensation, and other,
 * where other is gifts, conversions and codes outside the two named categories.
 * The design draws the first two. Dropping the third means a company whose only
 * Section 16 activity is a gift renders a section that reads as no activity
 * while the rows sit in the table. Absence of a row is already not evidence that
 * nothing happened, per the coverage note, so hiding rows that do exist is the
 * one thing this section must not do. Deviation recorded in the PR body.
 *
 * The empty branch keys on row count FIRST and not on the CIK, because
 * getInsiderTransactions falls back to a company_id match and rows can arrive
 * with a null CIK. The header comment on InsiderTab records that the older
 * guard hid real transactions.
 */
export function InsiderSection({
  data,
  hasCik,
}: {
  data: CompanyIntelData;
  hasCik: boolean;
}) {
  const { openMarket, routine, other } = data.insider;
  const total = openMarket.length + routine.length + other.length;

  if (total === 0) {
    const copy = insiderEmptyCopy(hasCik);
    return <EmptyWell fill headline={copy.headline} note={copy.note} />;
  }

  return (
    <>
      {openMarket.length > 0 ? (
        <>
          <GroupHead
            title={`Open market · ${openMarket.length}`}
            note="Purchases and sales transacted on the open market, SEC codes P and S."
            marginTop={0}
          />
          {openMarket.map((row, i) => (
            /* Position, for the reason the filing rows carry it: one insider
               disposing in tranches files several code S rows on one date, so
               name plus date plus code collides. */
            <div
              key={`${i}-${row.name}-${row.date}`}
              style={{
                marginTop: "10px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "13px 14px",
                border: "1px solid var(--c-border)",
                borderRadius: "12px",
                backgroundColor: "var(--c-bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <span style={{ font: `600 13px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
                  {row.name}
                </span>
                <span style={LABEL_MONO}>{row.date}</span>
              </div>
              <div style={{ font: `400 11px/1.4 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
                {row.role}
              </div>
              <div
                style={{
                  marginTop: "4px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "9px 12px",
                }}
              >
                <Fact label="SEC CODE" value={row.code} mono={false} />
                <Fact label="SHARES" value={row.shares} mono />
                <Fact label="PRICE" value={row.price} mono />
                <Fact label="HELD AFTER" value={row.heldAfter} mono />
              </div>
            </div>
          ))}
        </>
      ) : null}

      {routine.length > 0 ? (
        <>
          <GroupHead
            title={`Routine compensation · ${routine.length}`}
            note="Grants, option exercises, and shares withheld for taxes, SEC codes A, M and F. Not open-market activity."
            marginTop={openMarket.length > 0 ? 22 : 0}
          />
          <CompactRows rows={routine} />
        </>
      ) : null}

      {other.length > 0 ? (
        <>
          <GroupHead
            title={`Other · ${other.length}`}
            note="Gifts, conversions, and codes outside the categories above."
            marginTop={openMarket.length > 0 || routine.length > 0 ? 22 : 0}
          />
          <CompactRows rows={other} />
        </>
      ) : null}

      {/* One exported constant, so the populated caveat and the empty caveat
          cannot drift apart. */}
      <SectionNote marginTop={14}>{INSIDER_COVERAGE_NOTE}</SectionNote>
    </>
  );
}

function GroupHead({
  title,
  note,
  marginTop,
}: {
  title: string;
  note: string;
  marginTop: number;
}) {
  return (
    <>
      <div
        style={{
          marginTop: marginTop ? `${marginTop}px` : undefined,
          font: `600 11px/1.3 ${FONT_SANS}`,
          color: "var(--c-ink)",
        }}
      >
        {title}
      </div>
      <p
        style={{
          margin: "5px 0 0",
          font: `400 11px/1.5 ${FONT_SANS}`,
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        {note}
      </p>
    </>
  );
}

function CompactRows({
  rows,
}: {
  rows: { date: string; code: string; name: string; detail: string }[];
}) {
  return (
    <>
      {rows.map((row, i) => (
        <div
          key={`${i}-${row.name}-${row.date}`}
          style={{
            marginTop: i === 0 ? "10px" : undefined,
            display: "flex",
            gap: "12px",
            alignItems: "baseline",
            padding: "12px 0",
            borderTop: "1px solid var(--c-hair)",
            borderBottom: i === rows.length - 1 ? "1px solid var(--c-hair)" : undefined,
          }}
        >
          <span
            style={{
              flex: "none",
              width: "60px",
              font: `400 10px/1.4 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {row.date}
            <br />
            {row.code}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: `500 12.5px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
              {row.name}
            </div>
            <div
              style={{
                marginTop: "3px",
                font: `400 11px/1.4 ${FONT_SANS}`,
                color: "var(--c-secondary)",
              }}
            >
              {row.detail}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  return (
    <div>
      <div style={{ font: MONO_META, color: "var(--c-muted)" }}>{label}</div>
      <div
        style={{
          marginTop: "5px",
          font: mono ? `500 12px/1 ${FONT_MONO}` : `500 12px/1 ${FONT_SANS}`,
          /* SHARES sits over PRICE and HELD AFTER in a two-column grid, and one
             insider's rows stack down the section, so these digits line up in a
             column exactly as the financials cells do. After `font`, because
             the shorthand resets it. */
          ...TABULAR,
          color: "var(--c-ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
