"use client";

import { useEffect, useState } from "react";
import styles from "./ledger.module.css";

/**
 * The ticker strip. The top element on the Ledger, and the only thing in the
 * product that moves continuously once a screen has settled.
 *
 * This is not the mechanism from scratch. `src/components/brief/ticker-strip.tsx`
 * already runs the same device on the desk: the same 60s linear marquee off the
 * same 60s poll of the same route. What differs is the scale it is drawn at, so
 * this is the mobile drawing of an existing thing rather than a second one.
 *
 * Measured off the rendered prototype:
 *
 *   bar      30px tall, --c-inverse, overflow hidden
 *   fades    34px wide at each edge, the bar's own colour to its zero-alpha self
 *   track    width:max-content, v3ticker 60s linear infinite, 0 to -50%
 *   cell     6px gap, 0 14px padding
 *   symbol   400 10px/1 mono, 0.07em, --c-oninv-dim
 *   price    500 10.5px/1 mono, 0.045em, --c-oninv-strong, tabular
 *   delta    600 10px/1 mono, 0.07em, red or green, tabular
 *
 * The list is rendered twice because the keyframe translates the track by half
 * its own width. One copy and the strip would jump back at the midpoint.
 *
 * The design paints the up delta with a pale green literal while painting the
 * down one with `var(--c-inv-red)`. Both directions use their token here. The
 * design's own `--c-inv-green` exists, in both themes, and is not that literal.
 */

/** The design's set, in the design's order. */
const SYMBOLS = ["SPY", "NVDA", "CEG", "AMAT", "TNX", "VIX", "BRK.B", "XLU"];

const POLL_MS = 60_000;

export interface TickerCell {
  symbol: string;
  price: string;
  pct: number;
}

const MONO = "var(--font-jetbrains-mono), monospace";

export function MobileTickerStrip({ quotes: external }: { quotes?: TickerCell[] }) {
  const [fetched, setFetched] = useState<TickerCell[] | null>(null);

  useEffect(() => {
    if (external) return;
    let live = true;

    async function read() {
      try {
        /* Bounded, and the bound is not decoration. The quotes route reaches
           two upstreams and can take twenty seconds cold, and an unbounded
           fetch on the top element of the screen is a request the page waits on
           to go idle: it kept a headless load busy past thirty seconds and
           timed the runtime audit out. A strip of prices must never be able to
           delay anything. Five seconds matches the bound the quotes route
           already puts on its own upstream calls. */
        const res = await fetch(`/api/watchlist-quotes?symbols=${SYMBOLS.join(",")}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!live || !data?.quotes) return;
        /* Only symbols the route actually answered for. A cell with no price is
           not information, and inventing a zero delta to keep the cell count at
           the design's eight would put a number on the screen that no source
           produced. Which of the eight resolve is a property of the route, so
           the strip follows it rather than asserting over it. */
        setFetched(
          SYMBOLS.flatMap((symbol) => {
            const q = data.quotes[symbol];
            if (!q || q.price == null) return [];
            const change = Number.isFinite(q.pct) ? q.pct : 0;
            return [{ symbol, price: String(q.price), pct: change }];
          }),
        );
      } catch {
        /* Leave whatever is already drawn. A failed poll is not a reason to
           blank a strip that is currently reading correctly. */
      }
    }

    read();
    const t = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [external]);

  const cells = external ?? fetched ?? [];
  /* Two copies, because the keyframe moves the track by half its width. */
  const track = [...cells, ...cells];

  return (
    <div
      style={{
        height: "30px",
        backgroundColor: "var(--c-inverse)",
        overflow: "hidden",
        position: "relative",
      }}
      aria-hidden="true"
    >
      <Fade side="left" />
      <Fade side="right" />
      <div
        className={styles.ticker}
        style={{ display: "flex", alignItems: "center", height: "100%", width: "max-content" }}
      >
        {track.map((c, i) => (
          <span
            key={`${c.symbol}-${i}`}
            style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px", padding: "0 14px" }}
          >
            <span style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-oninv-dim)" }}>
              {c.symbol}
            </span>
            <span
              style={{
                font: `500 10.5px/1 ${MONO}`,
                letterSpacing: "0.045em",
                color: "var(--c-oninv-strong)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.price}
            </span>
            <span
              style={{
                font: `600 10px/1 ${MONO}`,
                letterSpacing: "0.07em",
                color: c.pct >= 0 ? "var(--c-inv-green)" : "var(--c-inv-red)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.pct >= 0 ? "▲" : "▼"} {Math.abs(c.pct).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The edge fade. The design writes the bar's own colour out to a zero-alpha
 * version of itself rather than to `transparent`, which in Safari interpolates
 * through black and leaves a grey bruise at the edge of a dark bar.
 */
function Fade({ side }: { side: "left" | "right" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: side === "left" ? 0 : undefined,
        right: side === "right" ? 0 : undefined,
        top: 0,
        bottom: 0,
        width: "34px",
        zIndex: 2,
        background: `linear-gradient(to ${side === "left" ? "right" : "left"}, var(--c-inverse), var(--c-inverse-clear))`,
        pointerEvents: "none",
      }}
    />
  );
}
