/**
 * The one-line quote at the head of the mobile Price and tone section.
 *
 * WHY THIS EXISTS AT ALL, given that a price was ruled off this screen three
 * times in code and once in a commit body. Every one of those rulings argues
 * against a quote on the SERVER SHAPE, on the grounds that a figure drawn from
 * a shape with no quote read behind it can only be stale or invented. None of
 * them says a quote may not appear on the screen. So the rule they set is kept
 * exactly: nothing here is ever added to `CompanyIntelData`. The figures are
 * read on the client, by the component in
 * `src/components/company/mobile/QuoteLine.tsx`, from `/api/company-kpis`, and
 * they reach the DOM only after that read answers.
 *
 * Everything below is pure so the four screen conditions can be held against it
 * without a browser. The component owns the fetch and nothing else.
 */

/** The body `/api/company-kpis` gives back. Mirrors the route's own union. */
export type QuoteBody =
  | { kind: "live"; ticker: string; last: number | null; change: number | null; marketCap: number | null }
  | { kind: "private"; ticker: string; reason: string }
  | { kind: "price-only-fallback"; ticker: string; last: number | null; change: number | null };

/** Ink selector for the day figure. Same three keys the tone reading uses. */
export type QuoteDirection = "up" | "down" | "flat";

/**
 * What the head of the section draws.
 *
 * Four cases, and they are four because the screen genuinely has four. A
 * company with no symbol and a company whose read did not answer are not the
 * same fact, and desktop draws both as a dash.
 */
export type QuoteLineView =
  /** No symbol on the row. Draw nothing at all, and say nothing about why. */
  | { kind: "absent" }
  /** The read is in flight. `announce` gates the only visible pending copy. */
  | { kind: "pending"; announce: boolean }
  /** The read did not answer, or answered without a figure that is a price. */
  | { kind: "failed" }
  | {
      kind: "quoted";
      last: string;
      day: string | null;
      direction: QuoteDirection;
      cap: string | null;
      /** Names every figure drawn, in the order drawn, including the window. */
      caption: string;
    };

/**
 * How long a read may run before the screen admits it is reading.
 *
 * NO SKELETON, and this constant is the reason. The read was timed on this
 * route: median 58ms, p90 73ms, worst 213ms warm and 286ms on the first call
 * after a cold start, where a crumb fetch runs ahead of it. A shimmer bar over
 * a 58ms gap is a drawing of a load rather than a load, and this repo has
 * already deleted one skeleton for exactly that. The block still reserves its
 * own height from the first paint so nothing under it moves when the figures
 * land; it simply reserves it empty.
 *
 * The gate is well past the measured worst case on purpose. A phone on a poor
 * connection is not the timing bench, and that reader gets a word rather than a
 * blank strip. A reader on a normal connection never sees it.
 */
export const QUOTE_PENDING_ANNOUNCE_MS = 600;

/** The one line the pending case is allowed to draw, once it has earned it. */
export const QUOTE_PENDING_COPY = "reading the quote";

/** Said when the read did not answer. Never conflated with an empty read. */
export const QUOTE_FAILED_COPY = "quote read failed";

/**
 * A last price, or null when the number is not one.
 *
 * TWO GUARDS, and the second is the interesting one. A sampled tail symbol
 * quotes so far below a cent that a plain two-decimal format prints "$0.00",
 * which is a price nobody is at. The fix is not to call the read broken, since
 * it answered and the answer is true; it is to print the figure at a precision
 * that carries it. Under a cent the format switches to two significant digits,
 * which keeps "$0.0043" out of the dash bucket and off the zero.
 */
export function formatQuoteLast(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  if (v >= 0.01) {
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${v.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 2 })}`;
}

/**
 * The day figure, given the fraction the route hands over.
 *
 * The route's `change` is a fraction on both of its branches. The v10 module
 * gives `regularMarketChangePercent` as a fraction, and the v8 fallback
 * computes `(last - previousClose) / previousClose` itself, so one scale covers
 * both and neither is a rate over a population.
 *
 * The direction is taken from the ROUNDED figure, not the raw one. A move of
 * +0.0004% draws as "0.00%", and painting that green states a rise the drawn
 * number does not show.
 */
export function formatQuoteDay(
  v: number | null | undefined,
): { text: string; direction: QuoteDirection } | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const scaled = v * 100;
  const rounded = Math.round(scaled * 100) / 100;
  const direction: QuoteDirection = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const sign = rounded > 0 ? "+" : "";
  return { text: `${sign}${rounded.toFixed(2)}%`, direction };
}

/** Market cap, abbreviated. Null when there is no figure to abbreviate. */
export function formatQuoteCap(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/**
 * The caption under the figures.
 *
 * IT NAMES THE WINDOW, and that is the whole reason it is here. The desktop
 * tab draws two disagreeing figures at once: this same day move, and the
 * chart's move since the start of a range that defaults to three months and is
 * labelled nowhere. Two numbers that disagree and neither says over what.
 *
 * It also names only the figures actually drawn. On the route's price-only
 * branch there is no market cap, so the caption does not promise one.
 */
export function buildQuoteCaption(parts: { day: boolean; cap: boolean }): string {
  const names = ["last"];
  if (parts.day) names.push("change since prior close");
  if (parts.cap) names.push("market cap");
  return names.join(", ");
}

/** What the client component knows at the moment it renders. */
export interface QuoteLineInput {
  /** `""` when the row carries no symbol. Never a slug, never a guess. */
  ticker: string;
  phase: "pending" | "answered" | "failed";
  body?: QuoteBody | null;
  /** Milliseconds the read has been in flight. Only read while pending. */
  elapsedMs?: number;
}

/**
 * The single decision the head of the section makes.
 *
 * THE MISSING SYMBOL CASE NEVER BORROWS DESKTOP'S LABEL. The desktop strip
 * prints a "Private" badge off a null symbol, and a null symbol on this table
 * does not mean the company is unlisted: 1,028 live rows carry no symbol, among
 * them several of the largest listed companies in the world. The badge is
 * false on every one of them, so it does not cross. An absent symbol draws
 * nothing, which is the only claim the data supports.
 *
 * A `private` body is treated as a read that did not answer, for the same
 * reason and on the same evidence the desktop strip already records beside its
 * own privacy check: the row HAS a symbol here, so an upstream 404 on it is a
 * quote this screen could not get, not a company that is unlisted.
 */
export function quoteLineView(input: QuoteLineInput): QuoteLineView {
  if (!input.ticker.trim()) return { kind: "absent" };

  if (input.phase === "pending") {
    return { kind: "pending", announce: (input.elapsedMs ?? 0) >= QUOTE_PENDING_ANNOUNCE_MS };
  }
  if (input.phase === "failed" || !input.body) return { kind: "failed" };
  if (input.body.kind === "private") return { kind: "failed" };

  const last = formatQuoteLast(input.body.last);
  if (last === null) return { kind: "failed" };

  const day = formatQuoteDay(input.body.change);
  const cap = input.body.kind === "live" ? formatQuoteCap(input.body.marketCap) : null;

  return {
    kind: "quoted",
    last,
    day: day?.text ?? null,
    direction: day?.direction ?? "flat",
    cap,
    caption: buildQuoteCaption({ day: day !== null, cap: cap !== null }),
  };
}
