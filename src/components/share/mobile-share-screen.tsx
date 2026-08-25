"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { EyebrowRule } from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * The public share brief, at phone width. The recipient has no session, so
 * this screen is read-only, unindexed, and says both things out loud.
 *
 * github.md has no screen-map row for Share at all; the only mention is the
 * compliance section that records its two em-dash CTAs. So the source was read
 * directly. `share/brief/[id]/page.tsx` supplies every string here.
 *
 * Four deviations from that source, all recorded in the PR body:
 *
 * 1. The two CTAs drop their em-dashes. Source fidelity does not override the
 *    em-dash rule, the same precedent as the Morning Brief tagline.
 * 2. There is a third em-dash the compliance section does not record: the
 *    source renders an em-dash as the placeholder for a deal with no company
 *    name, on a public unauthenticated page, which is the visual signature of
 *    the flaky-render bug github.md already logged. It is not ported.
 * 3. Gold never touches text at `--c-gold`, and the source renders cream on a
 *    gold fill for both CTAs. Both are `--c-ongold` here.
 * 4. Sector Signals IS ported. The prototype drops the section without saying
 *    why. Silently losing a section of someone else's brief is worse than an
 *    extra scroll, so it renders in the Analyst Briefing anatomy.
 */

export interface ShareDeal {
  company?: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

export interface ShareSection {
  key: string;
  title: string;
  body: string;
}

export function MobileShareScreen({
  kind,
  dateLine,
  headline,
  marketTone,
  summary,
  deals,
  sections,
  sectors,
}: {
  kind: string;
  dateLine: string;
  headline: string | null;
  marketTone: string | null;
  summary: string | null;
  deals: ShareDeal[];
  sections: ShareSection[];
  sectors: ShareSection[];
}) {
  const nothingToShow =
    !headline && !summary && deals.length === 0 && sections.length === 0 && sectors.length === 0;

  return (
    <div
      data-parity="share"
      className={styles.enter}
      style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", backgroundColor: "var(--c-bg)" }}
    >
      <header
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "11px var(--v3-pad)",
          borderBottom: "1px solid var(--c-border)",
          backgroundColor: "var(--c-bg)",
        }}
      >
        {/* The design draws the wordmark as inert text. It is a link here, as
            it is on the desktop layout, so it carries the 44px hit box the
            same way every other undersized control does: content-box padding
            plus a compensating negative margin, which moves nothing. */}
        <Link
          href="/"
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            display: "inline-flex",
            alignItems: "center",
            minHeight: "22px",
            padding: "11px 0",
            margin: "-11px 0",
            textDecoration: "none",
          }}
        >
          {/* The CSS wordmark, per the standing logo deviation: the sanctioned
              lockup's defining element is a rising arrow, which is the most
              prominent possible claim about outcomes, seen here before any
              disclaimer. */}
          <span style={{ display: "inline-flex", font: `700 18px/1 ${FONT_DISPLAY}`, letterSpacing: "-0.02em" }}>
            <span style={{ color: "var(--c-ink)" }}>Signal</span>
            <span style={{ color: "var(--c-goldink)" }}>era.</span>
          </span>
        </Link>
        <Link
          href="/auth"
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            flex: "none",
            minHeight: "40px",
            padding: "2px 14px",
            margin: "-2px 0",
            display: "inline-flex",
            alignItems: "center",
            borderRadius: "9px",
            backgroundColor: "var(--c-gold)",
            font: `600 12px/1 ${FONT_SANS}`,
            color: "var(--c-ongold)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Sign up, free
        </Link>
      </header>

      <Tape />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px var(--v3-pad) 0" }}>
        <span
          style={{
            font: `400 10px/1 ${FONT_MONO}`,
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
            textTransform: "uppercase",
          }}
        >
          {kind}
          {dateLine ? ` · ${dateLine}` : ""}
        </span>

        {headline ? (
          <h1
            style={{
              margin: "10px 0 0",
              font: `700 27px/1.18 ${FONT_DISPLAY}`,
              letterSpacing: "-0.022em",
              color: "var(--c-ink)",
              textWrap: "pretty",
            }}
          >
            {headline}
          </h1>
        ) : null}

        {marketTone ? (
          <p
            style={{
              margin: "12px 0 0",
              font: `700 10px/1 ${FONT_SANS}`,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--c-goldink)",
            }}
          >
            Market tone &middot; {marketTone}
          </p>
        ) : null}

        {summary ? (
          <p
            style={{
              margin: "14px 0 0",
              font: `400 16px/1.62 ${FONT_SANS}`,
              color: "var(--c-ink)",
              whiteSpace: "pre-line",
              textWrap: "pretty",
            }}
          >
            {summary}
          </p>
        ) : null}

        {nothingToShow ? (
          <p
            style={{
              margin: "24px 0 0",
              font: `400 13px/1.6 ${FONT_SANS}`,
              color: "var(--c-muted)",
              textWrap: "pretty",
            }}
          >
            This brief has no published sections. The link is valid; there is simply nothing on it yet.
          </p>
        ) : null}

        {deals.length > 0 ? (
          <>
            <EyebrowRule>Top Deals to Watch</EyebrowRule>
            <div style={{ marginTop: "11px", display: "flex", flexDirection: "column", gap: "9px" }}>
              {deals.map((deal, i) => (
                <div
                  key={`${deal.company ?? "deal"}-${i}`}
                  style={{
                    padding: "13px 14px",
                    border: "1px solid var(--c-border)",
                    borderTop: "2px solid var(--pill-watch-border)",
                    borderRadius: "12px",
                    backgroundColor: "var(--c-card)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <h4 style={{ margin: 0, font: `600 14px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
                      {/* No dash placeholder. A deal with no name says so. */}
                      {deal.company || "Company not named"}
                    </h4>
                    <span
                      style={{
                        flex: "none",
                        font: `600 11px/1 ${FONT_MONO}`,
                        color: "var(--c-goldink)",
                      }}
                    >
                      {deal.value || "Undisclosed"}
                    </span>
                  </div>
                  {deal.deal_type ? (
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: "7px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: "var(--c-well)",
                        font: `700 10px/1 ${FONT_MONO}`,
                        letterSpacing: "0.07em",
                        color: "var(--c-goldink)",
                        textTransform: "uppercase",
                      }}
                    >
                      {deal.deal_type}
                    </span>
                  ) : null}
                  {deal.one_liner ? (
                    <p
                      style={{
                        margin: "7px 0 0",
                        font: `400 11px/1.45 ${FONT_SANS}`,
                        color: "var(--c-secondary)",
                        textWrap: "pretty",
                      }}
                    >
                      {deal.one_liner}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {sections.length > 0 ? (
          <>
            <EyebrowRule>Analyst Briefing</EyebrowRule>
            {sections.map((s) => (
              <Article key={s.key} title={s.title} body={s.body} />
            ))}
          </>
        ) : null}

        {sectors.length > 0 ? (
          <>
            <EyebrowRule>Sector Signals</EyebrowRule>
            {sectors.map((s) => (
              <Article key={s.key} title={s.title} body={s.body} />
            ))}
          </>
        ) : null}

        <div
          style={{
            marginTop: "26px",
            padding: "20px 18px calc(20px + env(safe-area-inset-bottom))",
            marginLeft: "calc(-1 * var(--v3-pad))",
            marginRight: "calc(-1 * var(--v3-pad))",
            borderTop: "1px solid var(--c-border)",
            backgroundColor: "var(--c-surface)",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, font: `400 13px/1.55 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
            {/* "every morning" is the prototype's, and it overstates by two days
                a week. `brief-heartbeat.yml:32` crons the morning window `1-5`,
                and the ten `briefings` rows this batch measured are all
                weekdays, which is why the Alerts row says "Weekday mornings".
                A recruiting line on a public page should not promise a cadence
                the sender does not keep. */}
            Want briefings like this every weekday morning?
          </p>
          <Link
            href="/auth"
            className={styles.bare}
            style={{
              margin: "14px auto 0",
              maxWidth: "240px",
              minHeight: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "12px",
              backgroundColor: "var(--c-gold)",
              font: `600 13px/1 ${FONT_SANS}`,
              color: "var(--c-ongold)",
              textDecoration: "none",
            }}
          >
            Try Signalera, free
          </Link>
          <p
            style={{
              margin: "14px 0 0",
              font: `400 10.5px/1.5 ${FONT_SANS}`,
              color: "var(--c-muted)",
              textWrap: "pretty",
            }}
          >
            Shared read-only view. Not indexed by search engines. Informational only, never advice.
          </p>
        </div>
      </div>
    </div>
  );
}

function Article({ title, body }: { title: string; body: string }) {
  return (
    <article
      style={{
        marginTop: "10px",
        padding: "15px 16px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-card)",
      }}
    >
      <h3 style={{ margin: 0, font: `700 16px/1.3 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>{title}</h3>
      <p
        style={{
          margin: "9px 0 0",
          font: `400 13px/1.62 ${FONT_SANS}`,
          color: "var(--c-body)",
          whiteSpace: "pre-line",
          textWrap: "pretty",
        }}
      >
        {body}
      </p>
    </article>
  );
}

/* ── The tape ── */

interface Quote {
  symbol: string;
  price: string;
  pct: number;
}

const TAPE_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM", "GLD", "TLT"];

/**
 * The tape, drawn for this screen rather than reused.
 *
 * `components/brief/ticker-strip.tsx` is the existing one, and it fills the
 * gap before quotes arrive with an em-dash price and a fabricated 0.00%. Both
 * are barred here: the em-dash by rule, and the zero because a figure that
 * describes state must be read from that state and never typed. So this waits.
 * An empty band is honest about knowing nothing yet; a row of zeroes is not.
 */
function Tape() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/watchlist-quotes?symbols=${TAPE_SYMBOLS.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.quotes) return;
        const next = TAPE_SYMBOLS.map((symbol) => {
          const q = data.quotes[symbol];
          if (!q || typeof q.price !== "number") return null;
          return { symbol, price: q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pct: q.pct ?? 0 };
        }).filter((q): q is Quote => q !== null);
        if (next.length > 0) setQuotes(next);
      } catch {
        // The tape is decoration on this surface. A failure leaves it empty.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        flex: "none",
        height: "30px",
        display: "flex",
        alignItems: "center",
        padding: "0 var(--v3-pad)",
        backgroundColor: "var(--c-inverse)",
        overflow: "hidden",
      }}
    >
      {quotes ? (
        <span className={styles.ticker}>
          {[0, 1].map((copy) => (
            <span key={copy} style={{ display: "inline-flex" }}>
              {quotes.map((q) => (
                <span key={`${copy}-${q.symbol}`} style={TAPE_CELL}>
                  {q.symbol} {q.price}{" "}
                  <span style={{ color: q.pct >= 0 ? "#4ade80" : "#f87171" }}>
                    {q.pct >= 0 ? "▲" : "▼"}
                    {Math.abs(q.pct).toFixed(2)}%
                  </span>
                </span>
              ))}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

const TAPE_CELL: CSSProperties = {
  display: "inline-flex",
  gap: "4px",
  paddingRight: "22px",
  font: `400 10px/1 ${FONT_MONO}`,
  letterSpacing: "0.07em",
  color: "var(--c-oninv-body)",
};
