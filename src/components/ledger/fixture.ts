import type { OutcomeState } from "./claim-anatomy";
import type { ClaimCardVariant } from "./ledger-claim-card";

/**
 * Sample content for the Ledger, taken verbatim from the rendered prototype.
 *
 * This screen has no data source yet. The brief API is owned elsewhere and is
 * off limits to this unit, so the screen is built against a typed fixture and
 * the shape below IS the contract a real loader has to satisfy. Swapping the
 * fixture for a fetch should not touch a single component.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data too. Nothing here is a rate. The per-entry numbers are
 * one instrument's move against one benchmark over one window, which is the
 * evidence for a single claim, and the progress figure is a count.
 */

export interface LedgerClaim {
  id: string;
  eyebrow: string;
  claim: string;
  reasoning?: string;
  window?: string;
  windowRelative?: string;
  variant: ClaimCardVariant;
  ungradeableReason?: string;
}

export interface LedgerEntry {
  id: string;
  state: OutcomeState;
  instrument: string;
  claim: string;
  result: string;
}

export interface LedgerDay {
  date: string;
  claims?: LedgerClaim[];
  entries?: LedgerEntry[];
}

export interface LedgerData {
  generatedAt: string;
  readMinutes: number;
  tagline: string;
  /** Publication time of today's evening wrap, or null when unpublished. */
  wrapPublishedAt: string | null;
  sectors: string[];
  /** tone reads the figure, not the direction: a falling VIX is calm. */
  stats: { label: string; value: string; tone?: "calm" | "stress" | "mood" }[];
  continuity: {
    changeCount: number;
    lines: { text: string; before?: string; after?: string; emphasis?: boolean }[];
    openNow: string;
    nextIn: string;
  };
  pulse: {
    stampedAt: string;
    verdict: string;
    drivers: { label: string; tone: "watch" | "bull" | "bear" | "mixed" | "neutral"; toneLabel: string }[];
    lede: string;
    body: string[];
  };
  briefProgress: { read: number; total: number; status: string };
  today: LedgerDay;
  past: LedgerDay[];
  entriesBefore: number;
}

export const LEDGER_FIXTURE: LedgerData = {
  generatedAt: "6:45 AM ET",
  readMinutes: 4,
  tagline: "A considered reading of overnight markets, in four chapters.",
  wrapPublishedAt: null,
  sectors: ["Technology", "Energy", "Financials"],
  stats: [
    { label: "Mood", value: "PATIENT", tone: "mood" },
    { label: "Stories", value: "142" },
    { label: "Theses", value: "7 active" },
    { label: "VIX", value: "15.80 ▼4.20%", tone: "calm" },
  ],
  continuity: {
    changeCount: 2,
    lines: [
      { text: "One of your calls was checked overnight.", emphasis: true },
      { text: "Open calls, so that count fell", before: "7", after: "6" },
    ],
    openNow: "6 open now",
    nextIn: "next in 21 days",
  },
  pulse: {
    stampedAt: "MARKET PULSE · 6:45 AM ET",
    verdict: "patient",
    drivers: [
      { label: "PJM auction · late Aug", tone: "watch", toneLabel: "Watch" },
      { label: "Hologic · $18.3B", tone: "bull", toneLabel: "Bullish" },
    ],
    lede:
      "Breadth thinned for a fourth session while the index held, which is the tape saying it does not believe its own level.",
    body: [
      "Equal-weight closed under the cap-weighted index again, and the spread has now widened on four consecutive sessions. Nine of the eleven sectors finished green, which is the sort of print that reads constructive until you notice the index gained almost nothing.",
      "Rates did the quiet work. The ten-year gave back a basis point into the close after two soft payroll prints, and the front end has moved further than the long end in every session this week. The desk reads the term premium as carrying more of the level than the market is pricing.",
    ],
  },
  briefProgress: { read: 1, total: 5, status: "five calls, one decided" },
  today: {
    date: "Thursday, August 6",
    claims: [
      {
        id: "c1",
        eyebrow: "Financial services",
        claim: "Cash App gross profit growth outpaces Square's for a second consecutive quarter.",
        reasoning:
          "Q2 put Cash App inflows per active at a new high while merchant GPV growth stayed in the low teens. Lending attach is doing most of the work and the desk reads the gap as widening before it closes.",
        window: "reviewed Nov 4",
        windowRelative: "in about a quarter",
        variant: "open",
      },
      {
        id: "c2",
        eyebrow: "Rates",
        claim: "The 10-year Treasury yield closes under 4.50% before the September FOMC decision.",
        reasoning:
          "Two soft payroll prints and a cooling shelter component have moved the front end without the long end following. The desk reads the term premium as carrying more of the level than the market is pricing.",
        window: "already yours",
        windowRelative: "checked Sep 4",
        variant: "onLedger",
      },
      {
        id: "c3",
        eyebrow: "Credit",
        claim: "Private credit spreads compress further as bank retrenchment slows.",
        variant: "ungradeable",
        ungradeableReason:
          "No honest grader for this claim type yet, so there is nothing to commit to.",
      },
    ],
  },
  past: [
    {
      date: "Wednesday, August 5",
      entries: [
        {
          id: "e1",
          state: "challenged",
          instrument: "NVO",
          claim: "Novo Nordisk narrows the US script gap against Lilly by the July IQVIA prints.",
          result: "NVO −8.13% against XLV −0.44%. Clean read.",
        },
        {
          id: "e2",
          state: "supported",
          instrument: "MSFT",
          claim: "Azure growth reaccelerates above 30% when the June quarter prints.",
          result: "MSFT +6.41% against XLK +1.02%. Clean read.",
        },
        {
          id: "e3",
          state: "developing",
          instrument: "SOFI",
          claim: "SoFi's deposit costs peak in the June quarter.",
          result:
            "SOFI +4.02% against XLF +3.71%. The move could not be separated from the sector, so nothing was tested. The window is extended.",
        },
      ],
    },
  ],
  entriesBefore: 41,
};
