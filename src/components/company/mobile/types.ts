import type { OutcomeState } from "@/components/ledger";

/**
 * Company Intel, mobile. The SHAPE of the screen's data, and nothing else.
 *
 * Split out of `./fixture` so the client component and its sections can name
 * these types without pulling the invented company into the browser bundle. A
 * `"use client"` module that value-imports from `./fixture` downloads every
 * string in it: the gate stops the render, not the download, so invented
 * financials and invented Form 4 rows reached `.next/static` even on a
 * production build where they can never paint.
 *
 * Types erase at compile time, so this file contributes nothing to any bundle.
 * Keep it that way. Nothing here may hold a value.
 *
 * This IS the contract a real loader has to satisfy. The wiring unit replaces
 * `./fixture` with the loaders the page already resolves server-side:
 * `getCompanyDetail`, `fetchCompanyFilings`, `getInsiderTransactions` and
 * `fetchCompanyFinancials`. No new API surface is needed, and no component
 * below this changes shape.
 */
/**
 * How a tone reading is tinted.
 *
 * Never a hardcoded green. The design draws a company that happened to be read
 * constructively, and pinning the colour to that would paint a deteriorating
 * tone as an improving one the moment this reads a real level. The word always
 * carries the meaning; the colour only agrees with it.
 */
export type ToneDirection = "up" | "down" | "flat";

export interface CompanyKpiCell {
  label: string;
  value: string;
  /** Second line under the value. Absent on a bare count. */
  meta?: string;
  /** Set only on a cell the design tints, and tinted off the reading. */
  tone?: ToneDirection;
}

export interface CompanyPrimerRow {
  label: string;
  value: string;
}

export interface CompanyKeyFigure {
  label: string;
  value: string;
  /** Long values drop to the mono scale in the design. */
  scale: "figure" | "mono";
}

export interface ToneEvidenceRow {
  /** Reading of the coverage, one sentence. */
  reading: string;
  /** Article count and date, machine record. */
  meta: string;
  direction: "up" | "mixed";
}

/**
 * Structurally a `FilingLike`, so `countByCategory` and `applyFilter` from
 * `lib/filing-categories.ts` run on these rows directly.
 *
 * NO `category` FIELD. It used to carry one alongside the form, which is a
 * second classifier that can disagree with the shipped one. The chip counts and
 * the chip filter now both go through `categorizeForm(formType)`, so a row can
 * only ever be counted under the chip that draws it.
 */
export interface CompanyFilingRow {
  formType: string;
  date: string;
  /** Null when the summariser has not run for this accession yet. */
  summary: string | null;
}

export interface FinancialsRow {
  label: string;
  /** Two period columns, newest first. Null renders the design's dash. */
  values: [string | null, string | null];
  /** A derived ratio sits one indent in, at the muted scale. */
  derived?: boolean;
}

export interface FinancialsBand {
  band: string;
  rows: FinancialsRow[];
}

export interface InsiderOpenMarketRow {
  name: string;
  role: string;
  date: string;
  code: string;
  shares: string;
  price: string;
  heldAfter: string;
}

export interface InsiderCompactRow {
  date: string;
  code: string;
  name: string;
  detail: string;
}

export interface CompanyIntelData {
  ticker: string;
  exchange: string;
  sector: string;
  name: string;
  price: string;
  change: string;
  /** Article count on the memo control. A count, never a rate. */
  memoCorpus: string;
  kpis: CompanyKpiCell[];
  entry: {
    claim: string;
    reading: string;
    date: string;
    /**
     * Drives BOTH the card's top edge and the word in its lead. Never assumed.
     *
     * The design happens to draw a challenged entry, and hardcoding that would
     * paint a supported entry red and label it Challenged the moment a loader
     * lands. Same defect class as a hardcoded tone tint or a hardcoded price
     * direction; the record is the reader's own and it has to be accurate.
     */
    state: OutcomeState;
  } | null;
  following: {
    since: string;
    note: string;
  } | null;
  primer: {
    lede: string;
    identity: CompanyPrimerRow[];
    overview: string;
    keyFigures: CompanyKeyFigure[];
    developments: string[];
    footnote: string;
  };
  tone: {
    /**
     * Null when the trailing 7 day window did not carry enough coverage to
     * state a level. `ToneReadout` treats that as its own render path with its
     * own copy rather than as a level of zero, and so does this screen.
     */
    level: string | null;
    direction: string;
    /** Tints the level and the direction. Never assumed. */
    levelTone: ToneDirection;
    evidence: string;
    disclaimer: string;
    rows: ToneEvidenceRow[];
  };
  filings: {
    /**
     * NO COUNTS FIELD, deliberately.
     *
     * The chip labels are derived from `rows` at render time by
     * `filingCounts()` in `sections.tsx`. A stored count is a number the chip
     * asserts and the data cannot support: this carried
     * `{ all: 47, events: 22, insider: 11, quarterly: 9 }` over six rows, so
     * "Events 22" drew two. Deriving makes the chip a description of what
     * tapping it produces instead of a claim about a corpus that is not here.
     */
    rows: CompanyFilingRow[];
  };
  financials: {
    /**
     * Two period columns per basis. The desktop table draws five annual or
     * eight quarterly and neither fits a 350px column, so the design windows to
     * the newest pair. Both bases are carried because the toggle is a real
     * control and a toggle that redraws the same numbers under a different
     * label would be a false statement about the period.
     */
    annual: { periods: [string, string]; bands: FinancialsBand[] };
    quarterly: { periods: [string, string]; bands: FinancialsBand[] };
    note: string;
  };
  insider: {
    openMarket: InsiderOpenMarketRow[];
    routine: InsiderCompactRow[];
    other: InsiderCompactRow[];
  };
}
