"use client";

/**
 * PrimerKeyStats (Coverage Primer)
 *
 * Compact valuation digest from the same on-view quote feed the KPI strip uses
 * (/api/company-kpis -> Yahoo v10). Factual market data only: P/E (trailing and
 * forward), market cap, 52-week range, dividend yield, EPS TTM, beta, and the
 * 1-year analyst consensus target, the last labeled as a third-party figure from
 * the data provider (Yahoo Finance), never a Signalera number.
 *
 * Driven entirely by the quote prop the parent fetches; renders a neutral empty
 * state when no live quote is available (private/pre-IPO, or a price-only
 * fallback). No buy/sell/hold/exposure/allocation language.
 */

import type { QuoteSummaryLive } from "@/lib/yahoo/quoteSummary";

interface PrimerKeyStatsProps {
  /** Live quote, or null when unavailable (private, price-only, error, loading). */
  quote: QuoteSummaryLive | null;
  /** True while the quote fetch is in flight (shows a muted loading line). */
  loading: boolean;
}

function fmtPE(v: number | null): string | null {
  return v != null && Number.isFinite(v) && v > 0 ? `${v.toFixed(1)}x` : null;
}
function fmtUsd(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMktCap(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}
function fmtPct(v: number | null): string | null {
  return v != null && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : null;
}
function fmtBeta(v: number | null): string | null {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : null;
}
function fmtRange(lo: number | null, hi: number | null): string | null {
  const l = fmtUsd(lo);
  const h = fmtUsd(hi);
  return l && h ? `${l} - ${h}` : null;
}

/**
 * Yahoo's next-earnings timestamp, drawn as a day.
 *
 * FIXED TO UTC, and not as a stylistic choice. The value is a unix second read
 * from `calendarEvents.earnings.earningsDate`, and rendering it in whatever zone
 * the reader's browser reports lets the same stored instant draw as two
 * different days for two readers. A timestamp near a zone boundary is exactly
 * where that bites, so the zone is pinned and the drawn day is the same
 * everywhere.
 */
function fmtEarningsDate(v: number | null): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  const d = new Date(v * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Reported EPS against consensus, as the percent Yahoo already computed.
 *
 * THE SCALE IS A FRACTION, measured rather than assumed:
 * `earningsHistory.history[].surprisePercent.raw` comes back as 0.0674 beside a
 * `fmt` of "6.74%", so it multiplies by 100 like `dividendYield` above and
 * unlike Finnhub's field of the same name, which is already whole percent in
 * `theses.signal_breakdown`. Two providers, two scales, one name.
 *
 * The sign is taken from the ROUNDED figure, matching
 * `company-mobile/quote-line.ts`. A surprise of +0.0004% draws as "0.00%", and
 * a plus sign on that states a beat the drawn number does not show.
 */
function fmtEarningsSurprise(
  v: QuoteSummaryLive["lastEarnings"],
): string | null {
  const pct = v?.surprisePct;
  if (pct == null || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct * 100 * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

const SHELL = "bg-cream-hi border border-border-base rounded-lg p-4 space-y-3";
const EYEBROW = "font-sans text-[9.5px] font-bold text-text-faint";

export function PrimerKeyStats({ quote, loading }: PrimerKeyStatsProps) {
  // Build the present stats only; absent fields are dropped, not shown blank.
  const stats: { label: string; value: string; note?: string }[] = [];
  if (quote) {
    const push = (label: string, value: string | null, note?: string) => {
      if (value) stats.push({ label, value, note });
    };
    push("Market cap", fmtMktCap(quote.marketCap));
    push("P/E (trailing)", fmtPE(quote.peTrailing));
    // Forward P/E is a Yahoo consensus-estimate figure (attributed like the 1y
    // target), and is dropped when trailing EPS (TTM) is negative or missing: a
    // forward P/E on non-positive earnings is not meaningful, which is why
    // mainstream sites dash it (and why trailing P/E is already absent there).
    const epsTtm = quote.epsTrailing;
    const fwdEpsMeaningful = epsTtm != null && Number.isFinite(epsTtm) && epsTtm > 0;
    push(
      "P/E (forward)",
      fwdEpsMeaningful ? fmtPE(quote.peForward) : null,
      "Analyst consensus (Yahoo Finance)",
    );
    push("EPS (TTM)", fmtUsd(quote.epsTrailing));
    push("52-week range", fmtRange(quote.fiftyTwoWeekLow, quote.fiftyTwoWeekHigh));
    push("Dividend yield", fmtPct(quote.dividendYield));
    push("Beta", fmtBeta(quote.beta));
    push("1y target", fmtUsd(quote.targetMeanPrice), "Analyst consensus (Yahoo Finance)");
    // Both cells name their provenance in the note, and the earnings date names
    // it twice. `calendarEvents.earnings.earningsDate` is Yahoo's ESTIMATE until
    // the filer confirms, and quoteSummary.ts:116 takes element [0] of it
    // unconditionally, so on a company Yahoo is still giving a window this is the
    // EARLIEST day of that window and not a date anybody has announced. The label
    // says est. and the note says estimated for that reason; neither states a
    // confirmed date, because this shape cannot tell a confirmed one from a guess.
    push("Next earnings (est.)", fmtEarningsDate(quote.nextEarningsDate), "Estimated date (Yahoo Finance)");
    push("Last EPS vs consensus", fmtEarningsSurprise(quote.lastEarnings), "Reported vs consensus (Yahoo Finance)");
  }

  return (
    <section data-testid="primer-key-stats" className={SHELL}>
      <h3 className={EYEBROW}>Key stats</h3>
      {stats.length > 0 ? (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="font-sans text-[9px] font-bold text-text-faint">
                {s.label}
              </dt>
              <dd className="font-data text-[13px] text-espresso font-semibold">
                {s.value}
              </dd>
              {s.note ? (
                <span className="font-sans text-[9px] text-text-faint italic">{s.note}</span>
              ) : null}
            </div>
          ))}
        </dl>
      ) : (
        <p
          data-testid="primer-key-stats-empty"
          className="font-sans text-[12px] text-text-faint italic leading-relaxed"
        >
          {loading
            ? "Loading market data..."
            : /* WHY THIS DOES NOT SAY WHY. `quote` is null for four different
                 reasons, and the prop comment above says so: private,
                 price-only, an error, or still loading. This component cannot
                 tell them apart from its own inputs, so naming three of them as
                 fact was a guess presented as a finding, and it read as
                 "private" whenever the real cause was a failed fetch. Alvotech
                 is quoted on NASDAQ and got this sentence. State the thing that
                 is true and stop there. */
              "Market data is not available for this company."}
        </p>
      )}
    </section>
  );
}
