"use client";

/**
 * The quote at the head of the mobile Price and tone section.
 *
 * THE TAB IS NAMED FOR A PRICE AND HAS NONE. This answers that literally, in
 * the tab, and leaves the masthead exactly as it is.
 *
 * WHERE THE LINE IS. A price was ruled off this screen three separate times,
 * and the reason each time was that a quote drawn from a server shape with no
 * quote read behind it can only be stale or invented. That ruling is kept in
 * full: nothing here is on `CompanyIntelData`, the server renders no figure,
 * and `src/lib/company-mobile/build.ts` is untouched. The read happens here, in
 * the browser, after mount.
 *
 * WHY THE READ IS ALLOWED TO BE AUTOMATIC. The rule that a read must sit behind
 * a deliberate tap was written about a model call, and its own amendment names
 * budget consumption as the harm: a model call goes behind a tap, a database or
 * upstream read may sit behind a debounce. `/api/company-kpis` makes no model
 * call and spends no per-reader budget. The other half of that ruling forbids a
 * server render driven by a query parameter, and there is no query parameter
 * here. On top of which this screen already fires a live quote on every phone
 * load from the shell above it, so a client quote read is on this screen's bill
 * today either way.
 */

import { useEffect, useState } from "react";

import { FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import {
  QUOTE_FAILED_COPY,
  QUOTE_PENDING_ANNOUNCE_MS,
  QUOTE_PENDING_COPY,
  quoteLineView,
  type QuoteBody,
  type QuoteDirection,
} from "@/lib/company-mobile/quote-line";

/** Same three inks the tone reading uses. Ink tokens, because this is text. */
const DIRECTION_INK: Record<QuoteDirection, string> = {
  up: "var(--c-greenink)",
  down: "var(--c-redink)",
  flat: "var(--c-secondary)",
};

/**
 * The height the figures row occupies, reserved from the first paint.
 *
 * Held on the block whether or not there is anything in it yet, so the tone
 * reading under it sits at the same offset before and after the read answers
 * and nothing on the screen jumps when it does. This is the alternative to a
 * skeleton, not a smaller version of one.
 */
const FIGURES_ROW_PX = 18;

/** The caption row, reserved on the same reasoning as the figures row. */
const CAPTION_ROW_PX = 13;

interface ReadOutcome {
  phase: "pending" | "answered" | "failed";
  body: QuoteBody | null;
}

export function QuoteLine({ ticker }: { ticker: string }) {
  const [outcome, setOutcome] = useState<ReadOutcome>({ phase: "pending", body: null });
  const [announce, setAnnounce] = useState(false);

  useEffect(() => {
    if (!ticker.trim()) return;

    const ctrl = new AbortController();
    /* The only visible pending copy, and it is on a timer rather than on the
       read itself. See QUOTE_PENDING_ANNOUNCE_MS. */
    const timer = setTimeout(() => setAnnounce(true), QUOTE_PENDING_ANNOUNCE_MS);

    (async () => {
      try {
        const r = await fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`, {
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (!r.ok) {
          setOutcome({ phase: "failed", body: null });
          return;
        }
        const body = (await r.json()) as QuoteBody;
        if (ctrl.signal.aborted) return;
        setOutcome({ phase: "answered", body });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        /* A network throw is a read that did not answer. It is NOT an empty
           quote, and it must never draw as one. */
        setOutcome({ phase: "failed", body: null });
      }
    })();

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [ticker]);

  const view = quoteLineView({
    ticker,
    phase: outcome.phase,
    body: outcome.body,
    elapsedMs: announce ? QUOTE_PENDING_ANNOUNCE_MS : 0,
  });

  /* NO SYMBOL, NO LINE, AND NO EXPLANATION. Desktop prints a "Private" badge
     off the same null, over companies that are demonstrably listed. Silence is
     the only claim this row supports. */
  if (view.kind === "absent") return null;

  /* Whatever stands in the figures row when there are no figures. The failure
     sits HERE rather than under the empty row, because a message tucked into
     the caption slot with a blank strip above it reads as a quote that came
     back empty, which is the exact conflation this line exists to end. */
  const standIn =
    view.kind === "failed"
      ? QUOTE_FAILED_COPY
      : view.kind === "pending" && view.announce
        ? QUOTE_PENDING_COPY
        : "";

  return (
    <div
      data-quote-line=""
      data-quote-kind={view.kind}
      style={{
        paddingBottom: "10px",
        marginBottom: "14px",
        borderBottom: "1px solid var(--c-hair)",
      }}
    >
      <div
        style={{
          minHeight: `${FIGURES_ROW_PX}px`,
          display: "flex",
          alignItems: "baseline",
          gap: "10px",
        }}
      >
        {view.kind === "quoted" ? (
          <>
            <span
              data-quote-last=""
              style={{
                font: `600 16px/1.1 ${FONT_MONO}`,
                letterSpacing: "-0.01em",
                color: "var(--c-ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {view.last}
            </span>
            {view.day ? (
              <span
                data-quote-day=""
                style={{
                  font: `600 12.5px/1.1 ${FONT_SANS}`,
                  color: DIRECTION_INK[view.direction],
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {view.day}
              </span>
            ) : null}
            {view.cap ? (
              <span
                data-quote-cap=""
                style={{
                  font: `500 12.5px/1.1 ${FONT_MONO}`,
                  color: "var(--c-secondary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {view.cap}
              </span>
            ) : null}
          </>
        ) : (
          <span
            data-quote-standin=""
            style={{
              font: `400 12.5px/1.1 ${FONT_SANS}`,
              color: "var(--c-secondary)",
            }}
          >
            {standIn}
          </span>
        )}
      </div>

      {/* RESERVED IN EVERY CASE, empty or not. The whole point of not drawing a
          skeleton is that nothing moves when the read lands, and a caption that
          appears only once there are figures to name would move the tone
          reading down the screen at the moment the figures arrive. */}
      <div
        data-quote-caption=""
        style={{
          marginTop: "4px",
          minHeight: `${CAPTION_ROW_PX}px`,
          font: `400 10.5px/1.25 ${FONT_SANS}`,
          color: "var(--c-muted)",
        }}
      >
        {view.kind === "quoted" ? view.caption : ""}
      </div>
    </div>
  );
}
