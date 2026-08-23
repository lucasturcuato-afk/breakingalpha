"use client";

import { useState } from "react";

import { FILTER_LABELS, FILTER_ORDER, type FilingFilter } from "@/lib/filing-categories";
import {
  INSIDER_COVERAGE_NOTE,
  filingsEmptyCopy,
  financialsEmptyCopy,
  insiderEmptyCopy,
} from "@/components/company/tabs/empty-state-copy";

import type { CompanyIntelData, ToneDirection } from "./fixture";
import { Chip, EmptyWell, RuledRow, SectionNote, SectionRule } from "./parts";

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

const MONO_META = "400 10px/1 'JetBrains Mono', monospace";
const LABEL_MONO = {
  font: MONO_META,
  letterSpacing: "0.07em",
  color: "var(--c-muted)",
} as const;

/* ------------------------------------------------------------------ */
/* Primer                                                              */
/* ------------------------------------------------------------------ */

export function PrimerSection({ data }: { data: CompanyIntelData }) {
  const { primer } = data;
  return (
    <>
      <p
        style={{
          margin: 0,
          font: "400 11.5px/1.5 Inter, sans-serif",
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        {primer.lede}
      </p>

      <div
        style={{
          marginTop: "14px",
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
            <span style={{ font: "400 11.5px/1 Inter, sans-serif", color: "var(--c-secondary)" }}>
              {row.label}
            </span>
            <span
              style={{
                font: "500 12px/1.3 Inter, sans-serif",
                color: "var(--c-ink)",
                textAlign: "right",
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* PrimerTab hides the overview block entirely when neither a live nor a
          curated description exists, rather than drawing an empty heading over
          nothing. Same rule here. */}
      {primer.overview ? (
        <>
          <SectionRule marginTop={18}>business overview</SectionRule>
          <p
            style={{
              margin: "10px 0 0",
              font: "400 14px/1.65 Inter, sans-serif",
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
          {primer.keyFigures.map((figure) => (
            <div key={figure.label} style={{ backgroundColor: "var(--c-bg)", padding: "12px 13px" }}>
              <div style={LABEL_MONO}>{figure.label}</div>
              <div
                style={{
                  marginTop: "6px",
                  font:
                    figure.scale === "figure"
                      ? "700 17px/1 'Playfair Display', serif"
                      : "500 13px/1 'JetBrains Mono', monospace",
                  color: "var(--c-ink)",
                }}
              >
                {figure.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* PrimerKeyStats' own empty sentence. Market data absent is a
           statement about the quote, never about the company. */
        <EmptyWell headline="Market data not available. This company is private, pre-IPO, or not currently quoted." />
      )}

      <SectionRule marginTop={20}>recent developments</SectionRule>
      {primer.developments.length > 0 ? (
        primer.developments.map((text, i) => (
          /* Keyed on POSITION. The list is static within a render and two
             developments can repeat a sentence; a duplicate key silently reuses
             the wrong row. Same rule on every list on this screen. */
          <RuledRow key={`${i}-${text}`} first={i === 0} last={i === primer.developments.length - 1}>
            <p
              style={{
                margin: 0,
                font: "400 13.5px/1.6 Inter, sans-serif",
                color: "var(--c-body)",
                textWrap: "pretty",
              }}
            >
              {text}
            </p>
          </RuledRow>
        ))
      ) : (
        <EmptyWell headline="No indexed coverage in the window this primer reads from." />
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

  /* ToneReadout keeps the insufficient read on its own render path with its own
     copy, because "not enough coverage to state a level" and "the level is
     neutral" are different facts. Carried over rather than collapsed. */
  if (!tone.level) {
    return (
      <>
        <div
          style={{
            font: "700 21px/1.1 'Playfair Display', serif",
            letterSpacing: "-0.01em",
            color: "var(--c-secondary)",
          }}
        >
          Not enough recent coverage
        </div>
        <p
          style={{
            margin: "8px 0 0",
            font: "400 11.5px/1.5 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          {tone.evidence}
        </p>
        <SectionNote>{tone.disclaimer}</SectionNote>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <span
          style={{
            font: "700 21px/1.1 'Playfair Display', serif",
            letterSpacing: "-0.01em",
            color: TONE_INK[tone.levelTone],
          }}
        >
          {tone.level}
        </span>
        <span
          style={{
            font: "600 12.5px/1 'Playfair Display', serif",
            color: TONE_INK[tone.levelTone],
          }}
        >
          {tone.direction}
        </span>
      </div>

      <p
        style={{
          margin: "8px 0 0",
          font: "400 11.5px/1.5 Inter, sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        {tone.evidence}
      </p>

      <p
        style={{
          margin: "12px 0 0",
          font: "400 11.5px/1.55 Inter, sans-serif",
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        {tone.disclaimer}
      </p>

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
                backgroundColor: row.direction === "up" ? "var(--c-green)" : "var(--c-amber)",
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, font: "400 13px/1.55 Inter, sans-serif", color: "var(--c-body)" }}>
                {row.reading}
              </p>
              <p style={{ margin: "5px 0 0", ...LABEL_MONO }}>{row.meta}</p>
            </div>
          </RuledRow>
        ))
      ) : (
        /* ToneEvidenceList gives back null on an empty window, so the level can
           stand with no evidence under it. Saying so beats drawing nothing. */
        <EmptyWell headline="No article in the last 7 days moved this reading." />
      )}
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
  const { counts, rows } = data.filings;

  if (!hasCik || rows.length === 0) {
    return <EmptyWell headline={filingsEmptyCopy(hasCik)} />;
  }

  const visible =
    filter === null
      ? rows.filter((r) => r.category !== "insider")
      : filter === "all"
        ? rows
        : rows.filter((r) => r.category === filter);

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
            key={`${i}-${row.form}-${row.date}`}
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
                  font: "600 10.5px/1.4 Inter, sans-serif",
                  color: "var(--c-ink)",
                }}
              >
                {row.form}
              </span>
              <div style={{ marginTop: "5px", ...LABEL_MONO }}>{row.date}</div>
            </div>
            {row.summary ? (
              <p
                style={{
                  margin: 0,
                  minWidth: 0,
                  flex: 1,
                  font: "400 13px/1.55 Inter, sans-serif",
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
                  font: "400 italic 13px/1.55 Inter, sans-serif",
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

const GRID = "1.35fr 1fr 1fr";
const HEAD_FONT = "600 10px/1 Inter, sans-serif";

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
 * Two period columns, which is the design's own read and a data decision rather
 * than a restyle: FinancialsTab draws five annual or eight quarterly columns and
 * neither fits a 350px content column. The two shown are the newest pair.
 *
 * A missing cell draws a dash and never a zero, and a row with no value across
 * either shown period is dropped rather than dashed, both matching the desktop.
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

  /* No table under either basis means no basis to pick between, so the period
     toggle does not render over an empty well. FinancialsTab draws its empty
     state alone for the same reason. */
  if (!hasCik || !hasAnyData) {
    return <EmptyWell headline={financialsEmptyCopy(hasCik)} />;
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
          headline={`No ${basis} figures on file. The ${
            basis === "annual" ? "quarterly" : "annual"
          } basis has figures.`}
        />
      ) : (
        <>
          <div
            style={{
              marginTop: "12px",
              border: "1px solid var(--c-border)",
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                backgroundColor: "var(--c-surface)",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <div style={{ padding: "9px 12px", font: HEAD_FONT, color: "var(--c-secondary)" }}>
                METRIC
              </div>
              <div
                style={{
                  padding: "9px 8px",
                  textAlign: "right",
                  font: HEAD_FONT,
                  color: "var(--c-secondary)",
                }}
              >
                {periods[0]}
              </div>
              <div
                style={{
                  padding: "9px 12px 9px 8px",
                  textAlign: "right",
                  font: HEAD_FONT,
                  color: "var(--c-secondary)",
                }}
              >
                {periods[1]}
              </div>
            </div>

            {bands.map((band, bandIndex) => (
              <div key={band.band}>
                <div
                  style={{
                    padding: "9px 12px",
                    backgroundColor: "var(--c-surface)",
                    borderTop: bandIndex > 0 ? "1px solid var(--c-border)" : undefined,
                    font: HEAD_FONT,
                    color: "var(--c-muted)",
                  }}
                >
                  {band.band}
                </div>
                {band.rows.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: GRID,
                      borderTop: "1px solid var(--c-hair)",
                    }}
                  >
                    <div
                      style={{
                        padding: row.derived ? "10px 12px 10px 22px" : "10px 12px",
                        font: row.derived
                          ? "400 12px/1.3 Inter, sans-serif"
                          : "400 12.5px/1.3 Inter, sans-serif",
                        color: row.derived ? "var(--c-secondary)" : "var(--c-ink)",
                      }}
                    >
                      {row.label}
                    </div>
                    {row.values.map((value, i) => (
                      <div
                        key={`${row.label}-${i}`}
                        style={{
                          padding: i === 0 ? "10px 8px" : "10px 12px 10px 8px",
                          textAlign: "right",
                          font: "400 12px/1.3 'JetBrains Mono', monospace",
                          color: row.derived ? "var(--c-secondary)" : "var(--c-body)",
                        }}
                      >
                        {value ?? EN_DASH}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
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
    return <EmptyWell headline={copy.headline} note={copy.note} />;
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
                <span style={{ font: "600 13px/1.3 Inter, sans-serif", color: "var(--c-ink)" }}>
                  {row.name}
                </span>
                <span style={LABEL_MONO}>{row.date}</span>
              </div>
              <div style={{ font: "400 11px/1.4 Inter, sans-serif", color: "var(--c-secondary)" }}>
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
          font: "600 11px/1.3 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        {title}
      </div>
      <p
        style={{
          margin: "5px 0 0",
          font: "400 11px/1.5 Inter, sans-serif",
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
              font: "400 10px/1.4 'JetBrains Mono', monospace",
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {row.date}
            <br />
            {row.code}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: "500 12.5px/1.3 Inter, sans-serif", color: "var(--c-ink)" }}>
              {row.name}
            </div>
            <div
              style={{
                marginTop: "3px",
                font: "400 11px/1.4 Inter, sans-serif",
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
          font: mono ? "500 12px/1 'JetBrains Mono', monospace" : "500 12px/1 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
