import type { OutcomeState } from "./claim-anatomy";
import type { ClaimCardVariant } from "./ledger-claim-card";

/**
 * Sample content for the Ledger, taken verbatim from the rendered prototype.
 *
 * THE SCREEN NOW HAS A LOADER: `src/lib/ledger-data.ts` reads the real brief
 * and the reader's own record and gives back this exact shape. What remains below
 * is sample content, and it is reachable only from a non-production build with
 * nobody signed in, which is what the parity harness and the width audits
 * drive. A signed-in reader is never shown any of it.
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
  /**
   * The call's own `resolve_on`, ISO date, or null when it has none.
   *
   * Not rendered. The commit sheet needs the RAW date to preselect the call's
   * own span through `adoptWindowForCall`, and `window` above is already
   * formatted prose ("reviewed Nov 4") that cannot be parsed back. A call with
   * no resolve_on falls to the shared default rather than to a span it is not,
   * which is the defect #535 fixed.
   */
  resolveOn?: string | null;
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

/**
 * The contract a loader has to satisfy. `src/lib/ledger-data.ts` is the loader.
 *
 * EVERY BLOCK A LOADER MAY NOT BE ABLE TO SOURCE IS NULLABLE, and the screen
 * draws nothing at all for a null. That is deliberate and it is the whole
 * safety property: a field with no source cannot become a plausible-looking
 * stand-in, because there is no shape for it to occupy. Widening a null back
 * into a required field is how "One of your calls was checked overnight"
 * reached real readers.
 */
export interface LedgerData {
  /** Publication time of the brief, already formatted. Null when unknown. */
  generatedAt: string | null;
  /**
   * The reader's own initials, for the masthead disc. Null when no name is
   * known, and the disc then draws empty rather than someone else's letters.
   * The design prints "MR", which are the sample reader's, and over a real
   * session those are another person's initials on this person's screen.
   */
  initials: string | null;
  /** Estimated from the prose actually rendered. Null when there is none. */
  readMinutes: number | null;
  /** Masthead subtitle. Null when nothing stored describes the brief. */
  tagline: string | null;
  /** Publication time of today's evening wrap, or null when unpublished. */
  wrapPublishedAt: string | null;
  /** The reader's own sector list. Empty hides the banner entirely. */
  sectors: string[];
  /** tone reads the figure, not the direction: a falling VIX is calm. */
  stats: { label: string; value: string; tone?: "calm" | "stress" | "mood" }[];
  /** Null when nothing records what changed since the reader last looked. */
  continuity: {
    changeCount: number;
    lines: { text: string; before?: string; after?: string; emphasis?: boolean }[];
    openNow: string;
    nextIn: string;
  } | null;
  /** Null when no market pulse was published with the brief. */
  pulse: {
    stampedAt: string;
    verdict: string;
    drivers: { label: string; tone: "watch" | "bull" | "bear" | "mixed" | "neutral"; toneLabel: string }[];
    lede: string;
    body: string[];
  } | null;
  /**
   * The desk's calls on this brief, and how many of them have been graded.
   * Null when the brief carries no calls to count.
   *
   * `decided` is TWO states here, and the loader's own `DeskLoad.decided` is
   * three. The difference is deliberate and it is worth reading once.
   *
   *   a number   the read ANSWERED. Zero is a real zero and may be published
   *              as one, because a read came back and found none graded.
   *   "failed"   the read ANSWERED WITH AN ERROR. The screen prints the total,
   *              says the decided count could not be read, and prints no
   *              numeral pair and no progress bar.
   *
   * The third state a read can be in, NOT MADE, is `null` on `DeskLoad` and
   * cannot reach this type: the outcomes read is skipped only when the brief
   * carries no calls, and with no calls there is no progress block to build.
   * It was in this union and unreachable, described in the PR as one of three
   * things a reader could see when it was one of two. Narrowing it here deletes
   * a branch of the view that could never run and keeps the honest three-state
   * shape where the three states are real.
   *
   * A FAILED READ IS NOT A ZERO. Collapsing "failed" into 0 is what put
   * "0 decided" plus a full-width empty progress bar on this screen over a
   * read that never came back, and it is the same defect that printed
   * `SIGNALS TODAY 0` on the Dashboard and "Nothing on your watchlist yet"
   * on Watch.
   */
  briefProgress: { decided: number | "failed"; total: number; status: string } | null;
  /**
   * The reader's session date, ISO. `today.date` above is a formatted long
   * date for the rule and cannot be parsed back into one.
   *
   * REQUIRED, because every loader has it: the window arithmetic behind the
   * commit sheet is anchored on it, and a client that read a clock instead
   * could disagree with the server about which day it is. That is exactly the
   * defect `displayLoggedDate` contains on the read side.
   */
  sessionIso: string;
  today: LedgerDay;
  past: LedgerDay[];
  /** Entries beyond the ones rendered. Null when there are none. */
  entriesBefore: number | null;
}

export const LEDGER_FIXTURE: LedgerData = {
  generatedAt: "6:45 AM ET",
  initials: "MR",
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
  briefProgress: { decided: 1, total: 5, status: "five calls, one decided" },
  sessionIso: "2026-08-06",
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
        resolveOn: "2026-11-04",
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
