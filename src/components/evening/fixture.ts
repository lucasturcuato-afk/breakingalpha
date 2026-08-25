/**
 * Sample content for the mobile Evening Wrap, taken verbatim from the rendered
 * prototype (`isEvening`, lines 2296 to 2406).
 *
 * This unit renders from a fixture on purpose. `/api/briefing?type=evening` is
 * reached by `src/app/evening-wrap/page.tsx` and that route is a Lucas file the
 * mobile build only consumes, so the screen is built against a typed shape and
 * the shape below IS the contract a loader has to satisfy. Swapping the fixture
 * for a fetch should not touch a single component.
 *
 * Compliance note on sample content. The rule against an aggregate figure
 * reaches sample data too, so nothing here is a rate and nothing aggregates
 * outcomes into a single figure.
 * The scorecard cells are one instrument's move over one session, the stats
 * band carries counts and one index level, and the reviewed-call block states
 * a count of calls looked at rather than how many of them held.
 */

export type Tone = "up" | "down";

/** A cell of the stats band under the masthead. */
export interface EveningStat {
  label: string;
  value: string;
  /** Reads the figure, not the direction: a falling VIX is calm. */
  tone?: "calm" | "stress";
}

/**
 * A cell of the six-up scorecard inside The Close.
 *
 * `direction` picks the glyph and `tone` picks the colour, because they come
 * apart on the yield cell: a ten-year that fell prints a down glyph and reads
 * as the risk-on side of the tape. The desktop page expresses the same thing
 * as `invert: true` on `SCORECARD_SYMBOLS`; splitting the two fields says it
 * without a flag whose meaning has to be remembered.
 */
export interface ScorecardCell {
  label: string;
  value: string;
  move: string;
  direction: Tone;
  tone: Tone;
}

/** A row of the movers list under "today's top stories". */
export interface EveningMover {
  /**
   * OPTIONAL, because a story rail is not a movers list.
   *
   * An article carries the entities it mentions, and those are as often a
   * company name as a symbol. A name set in the mono column reads as a ticker
   * and is not one, and a source name there reads as a ticker and is not one
   * either. So the column carries a real symbol or it carries nothing, and the
   * row keeps its indent so the headlines still line up.
   */
  symbol?: string;
  /**
   * The session move, or a word when the name stopped trading.
   *
   * OPTIONAL, because a real story rail carries tickers and headlines and no
   * quote. When no quote resolved the row prints its ticker alone rather than
   * a dash standing in for a number nobody measured.
   */
  move?: string;
  headline: string;
}

/** The one call the desk revisited after the close. */
export interface EveningReviewedCall {
  id: string;
  /** What the evidence did. Not an outcome state: nothing settled today. */
  note: string;
  claim: string;
  reasoning: string;
}

/**
 * The mobile Evening Wrap's data contract.
 *
 * EVERY FIELD THAT CAN BE ABSENT IS NULLABLE OR EMPTY, and the screen draws
 * nothing at all for one that is. That is not defensive typing: a wrap that
 * carries no tomorrow setup, no open desk call or no persisted index snapshot
 * is an ordinary wrap, and the alternative to an absent block is a block that
 * states something the payload never said.
 */
export interface EveningWrapData {
  readMinutes: number;
  tagline: string;
  /** Dateline on the rule under the stats band. */
  dateline: string;
  /** The reader's own sectors. Empty hides the personalization banner. */
  sectors: string[];
  /** Only the cells whose source answered. Never a cell that carries a dash. */
  stats: EveningStat[];
  close: {
    stampedAt: string;
    /**
     * The one word the session gets, rendered inside the gold stamp.
     *
     * NULL when the tape could not ground one, which is exactly what
     * `reconcileCloseWord` gives back on a flat or unknown tape. The hero then
     * prints "The market closed." with no stamp, the same as the desk layout.
     */
    verdict: string | null;
    /** Empty when no index snapshot resolved. The hero says so in words. */
    scorecard: ScorecardCell[];
    /** Empty when the brief carries no close narrative. */
    lede: string;
    /** The first two paragraphs always render; the rest sit behind the toggle. */
    body: string[];
  };
  /** Null when no open desk call could be read for this session. */
  reviewed: EveningReviewedCall | null;
  /** What happened to everything else that was looked at. */
  reviewedRest: string | null;
  stories: {
    lede: string;
    movers: EveningMover[];
  };
  /** The wrap states its next event. See O2 in DECISIONS.md. */
  nextEvent: string | null;
  /** Session the wrap covers, stated by the stale notice. */
  coversSession: string;
}

export const EVENING_FIXTURE: EveningWrapData = {
  readMinutes: 5,
  tagline: "How the session played out, and what it meant.",
  dateline: "Evening Wrap · Thursday, August 6",
  sectors: ["Technology", "Energy", "Financials"],
  stats: [
    { label: "Close", value: "THIN", tone: "stress" },
    { label: "Movers", value: "8" },
    { label: "Theses", value: "7 active" },
    { label: "VIX", value: "15.80 ▼4.20%", tone: "calm" },
  ],
  close: {
    stampedAt: "THE CLOSE · 4:35 PM ET",
    verdict: "thin",
    scorecard: [
      { label: "S&P 500", value: "6,412.08", move: "0.17%", direction: "down", tone: "down" },
      { label: "NASDAQ", value: "21,043.60", move: "0.08%", direction: "up", tone: "up" },
      { label: "DOW", value: "44,812.40", move: "0.31%", direction: "down", tone: "down" },
      { label: "RUSSELL", value: "2,284.11", move: "0.94%", direction: "down", tone: "down" },
      /* The one cell where the glyph and the colour disagree, and the reason
         the two are separate fields. */
      { label: "10Y YIELD", value: "4.62%", move: "1.0bp", direction: "down", tone: "up" },
      { label: "WTI", value: "68.40", move: "1.12%", direction: "up", tone: "up" },
    ],
    lede:
      "312 advancers against 188 decliners masked a fourth straight session where the equal-weight index finished under the cap-weighted one.",
    body: [
      "The desk read the tape as risk-on into the July CPI print and the breadth said otherwise. The rotation into defensives that started Tuesday did not reverse, and the equal-weight spread has now widened for a fourth consecutive session.",
      "Volume told the same story. The session cleared on roughly eighty percent of the twenty-day average, thin for a Thursday with a CPI print the following morning, and the closing auction was the only meaningful print of the afternoon.",
      "Utilities outran the merchant names again, a fourth session running, and the reason two open calls on the desk now sit closer to their review dates than their reasoning would like. The PJM auction remains the settling event for both.",
      "Rates finished where they started, which understates the day. The ten-year traded a four basis point range and gave it all back into the close, and the front end has moved further than the long end on every session this week.",
    ],
  },
  reviewed: {
    id: "CALL-0413",
    note: "Evidence weakened tonight",
    claim:
      "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
    reasoning: "XLU outran CEG again. The scarcity premise is now doing all the work.",
  },
  reviewedRest:
    "The other six were reviewed and did not move. Nothing settled today. Grading runs after the close at 5:00 PM PT.",
  stories: {
    lede:
      "The desk read the tape as risk-on into the July CPI print. Breadth said otherwise, and the rotation into defensives that started Tuesday did not reverse.",
    movers: [
      {
        symbol: "NVDA",
        move: "+3.43%",
        headline:
          "Blackwell output guidance lifted for the January quarter, and the supply narrative changes with it.",
      },
      {
        symbol: "EA",
        move: "closed",
        headline:
          "The $55B take-private completed, and it is now the comp every sponsor will cite in interactive entertainment.",
      },
    ],
  },
  nextEvent:
    "Tomorrow: July CPI at 8:30, then the brief at 6:45. Nothing of yours settles until Aug 27.",
  coversSession: "Wednesday, August 5",
};
