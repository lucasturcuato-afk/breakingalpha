/**
 * Company Intel, mobile. The design's own drawing, as data.
 *
 * EVERY NUMBER AND EVERY SENTENCE BELOW IS INVENTED. It is transcribed from
 * `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html`, the prototype's
 * `isCompany` screen, so the built screen can be diffed against the design with
 * `scripts/screen-audit.mjs parity`. Parity keys on element text, so the design
 * strings are not interchangeable with other strings: substituting a different
 * company would leave every element unmatched and make the diff meaningless.
 *
 * The name on it is a real issuer. Nothing here describes that issuer. This
 * module is reachable only behind `mobileFixtureScreensEnabled()`, which fails
 * closed on production, because `/company/[id]` serves real filings, real Form 4
 * rows and real validated XBRL for real tickers today.
 *
 * The wiring unit replaces this file with the loaders the page already resolves
 * server-side. `src/app/company/[id]/page.tsx` carries every one of them today:
 * `getCompanyDetail`, `fetchCompanyFilings`, `getInsiderTransactions` and
 * `fetchCompanyFinancials`. No new API surface is needed.
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

export interface CompanyFilingRow {
  form: string;
  date: string;
  /** Null when the summariser has not run for this accession yet. */
  summary: string | null;
  /** Which chip this row sits under. Mirrors lib/filing-categories.ts. */
  category: "annual" | "quarterly" | "events" | "insider" | "other";
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
    /** Total stored rows behind the chips, per category. */
    counts: Record<"all" | "annual" | "quarterly" | "events" | "insider" | "other", number>;
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

export const COMPANY_INTEL_FIXTURE: CompanyIntelData = {
  ticker: "CEG",
  exchange: "NASDAQ",
  sector: "Utilities",
  name: "Constellation Energy",
  price: "284.11",
  change: "+1.24%",
  memoCorpus: "34 ARTICLES",

  kpis: [
    { label: "MARKET CAP", value: "$89.2B" },
    { label: "MENTIONS · 30D", value: "212" },
    { label: "ARTICLE TONE", value: "Constructive", meta: "34 articles, 7d", tone: "up" },
    { label: "SOURCES", value: "11", meta: "primary + tier-1" },
  ],

  entry: {
    claim:
      "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
    reading: "Data centre contracting is repricing faster than the regulated book.",
    date: "AUG 27",
  },

  following: {
    since: "Following since Jun 2",
    note: "Part of the grid capacity theme.",
  },

  primer: {
    lede:
      "A coverage primer you could walk into an interview with. Factual scaffolding only.",
    identity: [
      { label: "Sector", value: "Utilities" },
      { label: "Industry", value: "Independent power producers" },
      { label: "Headquarters", value: "Baltimore, Maryland" },
    ],
    overview:
      "The largest operator of carbon-free generation in the United States, running a 21.2 GW nuclear fleet alongside hydro, wind and solar. Revenue comes from wholesale power, retail supply contracts, and increasingly from long-dated fixed-price agreements with data centre operators.",
    keyFigures: [
      { label: "EV / EBITDA", value: "14.8x", scale: "figure" },
      { label: "P / E", value: "27.4x", scale: "figure" },
      { label: "52-WEEK RANGE", value: "171.40 – 297.62", scale: "mono" },
      { label: "NUCLEAR CAPACITY", value: "21.2 GW", scale: "mono" },
    ],
    developments: [
      "A twenty-year power supply agreement with a hyperscale data centre operator in Illinois was disclosed on Jul 31, the fourth such contract this year.",
      "The PJM capacity auction timetable was confirmed for late August, which is the event the desk's open call turns on.",
    ],
    footnote: "Informational only. Nothing here is a recommendation.",
  },

  tone: {
    level: "Constructive",
    direction: "▲ improving",
    levelTone: "up",
    evidence: "Based on 34 articles from 11 sources over the last 7 days.",
    disclaimer:
      "A plain-language reading of how indexed coverage is written, not a price signal and not a score. No number sits behind this label.",
    rows: [
      {
        reading:
          "Coverage of the Illinois supply agreement framed contracted volume as the durable part of the story.",
        meta: "7 ARTICLES · AUG 1",
        direction: "up",
      },
      {
        reading:
          "Two pieces questioned whether auction pricing can clear high enough to matter to the merchant book.",
        meta: "2 ARTICLES · JUL 28",
        direction: "mixed",
      },
      {
        reading:
          "Q2 coverage led on contracted nuclear volume rather than on the quarter's reported figures.",
        meta: "9 ARTICLES · JUL 24",
        direction: "up",
      },
    ],
  },

  filings: {
    counts: { all: 47, annual: 3, quarterly: 9, events: 22, insider: 11, other: 2 },
    rows: [
      {
        form: "8-K",
        date: "JUL 31",
        summary:
          "Twenty-year power supply agreement signed with a hyperscale data centre operator in Illinois.",
        category: "events",
      },
      {
        form: "10-Q",
        date: "JUL 24",
        summary: "Q2 revenue $6.1B. Contracted nuclear volume up eleven percent year over year.",
        category: "quarterly",
      },
      {
        form: "8-K",
        date: "JUN 18",
        summary: "PJM capacity auction timetable confirmed for late August.",
        category: "events",
      },
      { form: "10-K", date: "FEB 26", summary: null, category: "annual" },
      {
        form: "4",
        date: "JUL 18",
        summary: "Section 16 transaction reported by the chief executive.",
        category: "insider",
      },
      {
        form: "424B5",
        date: "MAY 09",
        summary: null,
        category: "other",
      },
    ],
  },

  financials: {
    annual: {
      periods: ["FY2025", "FY2024"],
      bands: [
        {
          band: "INCOME STATEMENT",
          rows: [
            { label: "Revenue", values: ["$24.9B", "$23.6B"] },
            { label: "Gross profit", values: ["$7.44B", "$6.61B"] },
            { label: "Gross margin", values: ["29.9%", "28.0%"], derived: true },
            { label: "Operating income", values: ["$4.21B", "$3.58B"] },
            { label: "Net income", values: ["$3.30B", "$2.78B"] },
            { label: "EPS diluted", values: ["$10.42", "$8.71"] },
          ],
        },
        {
          band: "BALANCE SHEET",
          rows: [
            { label: "Total assets", values: ["$54.1B", "$51.8B"] },
            { label: "Total equity", values: ["$14.9B", "$13.2B"] },
            { label: "Operating cash flow", values: ["$6.02B", "$5.14B"] },
          ],
        },
      ],
    },
    quarterly: {
      periods: ["Q2 26", "Q1 26"],
      bands: [
        {
          band: "INCOME STATEMENT",
          rows: [
            { label: "Revenue", values: ["$6.10B", "$6.44B"] },
            { label: "Gross profit", values: ["$1.83B", "$1.91B"] },
            { label: "Gross margin", values: ["30.0%", "29.7%"], derived: true },
            { label: "Operating income", values: ["$1.04B", "$1.12B"] },
            { label: "Net income", values: ["$812M", "$877M"] },
            /* Not reported for the newest quarter yet. A dash, never a zero,
               which is the rule the closing note states to the reader. */
            { label: "EPS diluted", values: [null, "$2.71"] },
          ],
        },
        {
          band: "BALANCE SHEET",
          rows: [
            { label: "Total assets", values: ["$54.9B", "$54.4B"] },
            { label: "Total equity", values: ["$15.3B", "$15.0B"] },
            { label: "Operating cash flow", values: ["$1.48B", "$1.62B"] },
          ],
        },
      ],
    },
    note:
      "Validated XBRL facts from SEC filings, reported in USD. A dash means the figure was not reported or did not pass validation, never zero.",
  },

  insider: {
    openMarket: [
      {
        name: "Joseph Dominguez",
        role: "Chief Executive Officer",
        date: "JUL 18",
        code: "S",
        shares: "18,400",
        price: "$271.06",
        heldAfter: "142,880",
      },
    ],
    routine: [
      {
        date: "JUN 02",
        code: "CODE A",
        name: "Daniel Eggers",
        detail: "CFO · 4,120 shares granted",
      },
      {
        date: "JUN 02",
        code: "CODE F",
        name: "Daniel Eggers",
        detail: "CFO · 1,806 shares withheld for taxes",
      },
    ],
    /**
     * NOT IN THE PROTOTYPE, and deliberately built anyway. `InsiderTab` groups
     * Form 4 rows three ways and the design draws two, so a company whose only
     * Section 16 activity is a gift or a conversion would render an Insider
     * section that looks empty while the rows exist. See the PR body.
     */
    other: [
      {
        date: "APR 11",
        code: "CODE G",
        name: "Kathleen Barron",
        detail: "EVP · 900 shares gifted",
      },
    ],
  },
};

/**
 * The same screen with every read absent. Not an empty result: this is what the
 * screen draws when the loaders came back with nothing for a company that
 * resolved. Each section states what is missing in the repo's own sourced copy
 * rather than asserting a fact about the company.
 */
export const COMPANY_INTEL_EMPTY: CompanyIntelData = {
  ...COMPANY_INTEL_FIXTURE,
  /* The quote and the corpus count are READS, not identity, so they go with
     everything else that came back absent. Spreading them through from the
     populated fixture drew a screen that said "0 articles, 7d" and "SOURCES 0"
     directly above a memo control reading "34 ARTICLES", beside a live price.
     Ticker, exchange, sector and name stay: those are the company, and they
     resolved, which is what separates this state from a failed read. */
  price: "--",
  change: "",
  memoCorpus: "0 ARTICLES",
  kpis: [
    { label: "MARKET CAP", value: "--" },
    { label: "MENTIONS · 30D", value: "0" },
    { label: "ARTICLE TONE", value: "--", meta: "0 articles, 7d" },
    { label: "SOURCES", value: "0" },
  ],
  entry: null,
  following: null,
  primer: {
    ...COMPANY_INTEL_FIXTURE.primer,
    overview: "",
    keyFigures: [],
    developments: [],
  },
  tone: {
    ...COMPANY_INTEL_FIXTURE.tone,
    level: null,
    direction: "",
    levelTone: "flat",
    // Both strings are `ToneReadout`'s own insufficient branch, not new copy.
    evidence: "No articles in the last 7 days.",
    rows: [],
  },
  filings: {
    counts: { all: 0, annual: 0, quarterly: 0, events: 0, insider: 0, other: 0 },
    rows: [],
  },
  financials: {
    ...COMPANY_INTEL_FIXTURE.financials,
    annual: { periods: COMPANY_INTEL_FIXTURE.financials.annual.periods, bands: [] },
    quarterly: { periods: COMPANY_INTEL_FIXTURE.financials.quarterly.periods, bands: [] },
  },
  insider: { openMarket: [], routine: [], other: [] },
};
