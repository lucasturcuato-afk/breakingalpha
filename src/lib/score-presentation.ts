/**
 * score-presentation.ts — Plain-language conversion of live_score components.
 *
 * Converts numeric component values into human-readable sentences for the
 * thesis detail page. Uses actual data from signal_breakdown where available.
 */

export const SCORE_SCALE = 100;

interface ScoreComponents {
  price: number;
  sentiment: number;
  ratio: number;
  confidence: number;
  timeDecay: number;
}

interface PresentationContext {
  /** Raw price_change_pct from signal_breakdown (e.g. 1.5 = +1.5%) */
  priceChangePct?: number | null;
  /** Ticker symbol */
  ticker?: string | null;
  /** Conviction direction: BULLISH, BEARISH, etc. */
  conviction?: string | null;
  /** Age in days */
  ageDays: number;
  /** Horizon in days */
  horizonDays: number;
  /** Latest verdict confidence 0-1 */
  latestConfidence?: number | null;
  /** Latest verdict string */
  latestVerdict?: string | null;
}

export interface ComponentSentence {
  label: string;
  sentence: string;
  value: number;
  sentiment: "positive" | "negative" | "neutral";
}

function stanceLabel(conviction: string | null | undefined): string {
  const s = (conviction || "").trim().toUpperCase();
  if (s === "BEARISH") return "bearish";
  if (s === "BULLISH" || s === "HIGH" || s === "MEDIUM") return "bullish";
  return "neutral";
}

export function priceToSentence(value: number, ctx: PresentationContext): ComponentSentence {
  const stance = stanceLabel(ctx.conviction);
  const pct = ctx.priceChangePct;

  let sentence: string;
  if (pct !== null && pct !== undefined) {
    const pctFormatted = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    const ticker = ctx.ticker || "stock";
    if (value > 5) {
      sentence = `${ticker} returned ${pctFormatted}, aligned with ${stance} call`;
    } else if (value < -5) {
      sentence = `${ticker} returned ${pctFormatted}, against the ${stance} call`;
    } else if (Math.abs(value) <= 5 && pct !== 0) {
      sentence = `${ticker} returned ${pctFormatted}, a muted signal either way`;
    } else {
      sentence = `No meaningful price movement for ${ticker}`;
    }
  } else {
    if (stance === "neutral") {
      sentence = "No directional stance — price component inactive";
    } else {
      sentence = "Price data unavailable for this thesis";
    }
  }

  return {
    label: "Price action",
    sentence,
    value,
    sentiment: value > 3 ? "positive" : value < -3 ? "negative" : "neutral",
  };
}

export function sentimentToSentence(value: number): ComponentSentence {
  let sentence: string;
  if (value > 10) {
    sentence = "News sentiment strongly supports the thesis direction";
  } else if (value > 3) {
    sentence = "Modest positive sentiment alignment in coverage";
  } else if (value < -10) {
    sentence = "News sentiment contradicts the thesis direction";
  } else if (value < -3) {
    sentence = "Slight negative sentiment lean in coverage";
  } else {
    sentence = "News sentiment is neutral or insufficient for signal";
  }

  return {
    label: "Sentiment",
    sentence,
    value,
    sentiment: value > 3 ? "positive" : value < -3 ? "negative" : "neutral",
  };
}

export function ratioToSentence(value: number): ComponentSentence {
  let sentence: string;
  if (value > 5) {
    sentence = "Supporting articles clearly outnumber contradicting ones";
  } else if (value > 0) {
    sentence = "Slightly more supporting than contradicting coverage";
  } else if (value === 0) {
    sentence = "Coverage volume below threshold or no directional stance";
  } else {
    sentence = "Contradicting coverage outweighs supporting articles";
  }

  return {
    label: "Coverage balance",
    sentence,
    value,
    sentiment: value > 2 ? "positive" : value < -2 ? "negative" : "neutral",
  };
}

export function confidenceToSentence(value: number, ctx: PresentationContext): ComponentSentence {
  let sentence: string;
  if (value > 0) {
    const confPct = ctx.latestConfidence ? `${Math.round(ctx.latestConfidence * 100)}%` : "high";
    sentence = `Grading model is ${confPct} confident in confirmation`;
  } else if (value < 0) {
    const confPct = ctx.latestConfidence ? `${Math.round(ctx.latestConfidence * 100)}%` : "high";
    sentence = `Grading model is ${confPct} confident in invalidation`;
  } else {
    sentence = "No terminal verdict yet — confidence component inactive";
  }

  return {
    label: "Model confidence",
    sentence,
    value,
    sentiment: value > 0 ? "positive" : value < 0 ? "negative" : "neutral",
  };
}

export function timeDecayToSentence(value: number, ctx: PresentationContext): ComponentSentence {
  let sentence: string;
  const pct = ctx.horizonDays > 0 ? Math.round((ctx.ageDays / ctx.horizonDays) * 100) : 0;

  if (value === 0) {
    sentence = "Terminal verdict reached — no time penalty";
  } else if (pct >= 90) {
    sentence = `Call is ${ctx.ageDays}d old against ${ctx.horizonDays}d horizon — nearing expiry`;
  } else if (pct >= 50) {
    sentence = `Call is ${ctx.ageDays}d into ${ctx.horizonDays}d horizon — midway through`;
  } else {
    sentence = `Call is fresh (${ctx.ageDays}d of ${ctx.horizonDays}d horizon)`;
  }

  return {
    label: "Time elapsed",
    sentence,
    value,
    sentiment: value < -5 ? "negative" : "neutral",
  };
}

export function componentBreakdown(
  components: ScoreComponents,
  ctx: PresentationContext,
): ComponentSentence[] {
  return [
    priceToSentence(components.price, ctx),
    sentimentToSentence(components.sentiment),
    ratioToSentence(components.ratio),
    confidenceToSentence(components.confidence, ctx),
    timeDecayToSentence(components.timeDecay, ctx),
  ];
}

/** Format a score with explicit scale for display */
export function formatScoreWithScale(score: number): string {
  const sign = score > 0 ? "+" : "";
  return `${sign}${score} of ±${SCORE_SCALE}`;
}
