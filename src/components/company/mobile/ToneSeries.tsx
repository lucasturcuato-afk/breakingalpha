"use client";

/**
 * The tone-over-time strip in the mobile Price and tone section.
 *
 * The form, and the measurements that chose it, are argued in
 * `src/lib/company-mobile/tone-series.ts`. This file draws what that module
 * decides and owns the read, nothing else.
 *
 * WHY THE READ IS ON THE CLIENT. Not a new ruling, an existing one followed.
 * `ToneTrendChart`, the desktop surface over the same route, fetches
 * `/api/company-trend` from the browser after mount, and `QuoteLine` at the
 * head of this same section does the same against `/api/company-kpis`. Both
 * patterns on this section are client reads, so a server read here would be a
 * third pattern rather than a continuation of either. It also leaves
 * `CompanyIntelData` and `src/lib/company-mobile/build.ts` untouched, which is
 * the standing shape ruling for this screen.
 *
 * The route makes no model call and spends no per-reader budget, so it sits on
 * the same side of the deliberate-tap rule the quote line already argued.
 *
 * NO RANGE CONTROL, and that is a decision rather than an omission. Desktop
 * carries 7D / 30D / 90D. A 44px tap row is the single most expensive thing
 * this section could add, the fold budget above it was already spent by the
 * quote line, and the control's whole value is choosing a depth the data mostly
 * does not have: the median company reaches only a handful of distinct days in
 * a thirty-day window, so 7D is empty for most of the corpus and 90D redraws
 * the same thin series over a wider axis. Four fixed weeks, no control, no row.
 */

import { useEffect, useState } from "react";

import { FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import {
  SERIES_FAILED_COPY,
  SERIES_RANGE,
  toneSeriesView,
  type ToneBand,
  type ToneSeriesBody,
} from "@/lib/company-mobile/tone-series";
import styles from "./company-mobile.module.css";

/**
 * Fills for a band, base tokens because a band is a fill and not text.
 *
 * The same three the article rows under this section already use, so a green
 * block means the same thing twice on one screen.
 */
const BAND_FILL: Record<string, string> = {
  positive: "var(--c-green)",
  mixed: "var(--c-amber)",
  negative: "var(--c-red)",
};

/** Half the track. A band grows up from the midline or down from it. */
const HALF_TRACK_PX = 13;

/** Bar heights by absolute step. Index 0 is Mixed, which is a flat mark. */
const STEP_PX = [2, 7, 12];

/** Gap between bands, in percent of the track width. */
const BAND_GAP_PCT = 3;

interface ReadOutcome {
  phase: "pending" | "answered" | "failed";
  body: ToneSeriesBody | null;
}

/** One band, drawn off the midline. A void is a dashed hairline, not a zero. */
function Band({ band, index }: { band: ToneBand; index: number }) {
  const width = (100 - BAND_GAP_PCT * 3) / 4;
  const left = index * (width + BAND_GAP_PCT);

  if (band.kind === "void") {
    /* DIFFERENT IN COLOUR AND IN WEIGHT from a Mixed band, which is also a flat
       mark on the midline. Mixed is a solid 2px block in the amber a balanced
       reading owns; a void is a 2px DASHED rule in a neutral text-grade token
       and owns no tone at all. A reader has to be able to tell "this week read
       as balanced" from "this week did not carry enough to read".

       IT IS DRAWN ON THE MIDLINE, NOT BESIDE IT, and in `--c-muted` rather than
       the border token. The first draft put a 1px hairline in `--c-hair` one
       pixel above the always-drawn midline, which is the same token: measured
       against the painted page it came out at 1.11:1 in light and 1.22:1 in
       dark, under the 3:1 floor for a non-text mark, and the two hairlines
       merged into one slightly thicker line. So the mark the header called
       explicit read as nothing at all. `--c-muted` measures 4.93:1 in light and
       6.18:1 in dark against the same ground, and sitting ON the midline it
       replaces that line across the band instead of doubling it. */
    return (
      <span
        data-tone-band="void"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `${left}%`,
          width: `${width}%`,
          top: `${HALF_TRACK_PX - 1}px`,
          height: 0,
          borderTop: "2px dashed var(--c-muted)",
        }}
      />
    );
  }

  const h = STEP_PX[Math.abs(band.step)] ?? STEP_PX[0];
  // Mixed sits centred on the midline. Everything else grows away from it.
  const top =
    band.step > 0 ? HALF_TRACK_PX - h : band.step < 0 ? HALF_TRACK_PX : HALF_TRACK_PX - h / 2;

  return (
    <span
      data-tone-band={band.polarity}
      aria-hidden="true"
      className={styles.toneBand}
      style={{
        position: "absolute",
        left: `${left}%`,
        width: `${width}%`,
        top: `${top}px`,
        height: `${h}px`,
        backgroundColor: BAND_FILL[band.polarity],
        // Grow away from the midline, which is the edge the band is measured
        // from. A single shared origin would run half the bands backwards.
        transformOrigin: band.step > 0 ? "bottom" : band.step < 0 ? "top" : "center",
      }}
    />
  );
}

export function ToneSeries({ company }: { company: string }) {
  const [outcome, setOutcome] = useState<ReadOutcome>({ phase: "pending", body: null });

  useEffect(() => {
    if (!company.trim()) return;

    const ctrl = new AbortController();

    (async () => {
      try {
        const r = await fetch(
          `/api/company-trend?company=${encodeURIComponent(company)}&range=${SERIES_RANGE}`,
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        if (!r.ok) {
          setOutcome({ phase: "failed", body: null });
          return;
        }
        const body = (await r.json()) as ToneSeriesBody;
        if (ctrl.signal.aborted) return;
        setOutcome({ phase: "answered", body });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        /* A network throw is a read that did not answer. It is NOT an empty
           series, and it must never draw as one. */
        setOutcome({ phase: "failed", body: null });
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [company]);

  const view = toneSeriesView({ phase: outcome.phase, body: outcome.body });

  /* NOTHING AT ALL when there is not enough to draw four weeks of. The headline
     a few pixels above has already stated the coverage it has, and a strip of
     empty boxes under it says the same absence a second time in a weaker voice.

     AND NOTHING AT ALL WHILE THE READ IS IN FLIGHT, at any duration. An earlier
     draft drew one line of stand-in copy once the read passed a gate, and that
     line was a height this block reserved and then threw away: measured on a
     company that resolves to `absent` under a slow read, the scroll body grew
     by the line at the gate, held, and collapsed back when the read answered.
     That is the exact jump the block claims not to cause, landing on the
     thinnest companies, which are the majority of the cohort that resolves to
     absent. There is no gate now and no stand-in, so there is nothing to take
     back: the block occupies zero height until it has something true to draw.
     `failed` still draws its line, which is an append and never a collapse. */
  if (view.kind === "absent" || view.kind === "pending") return null;

  if (view.kind === "failed") {
    return (
      <div
        data-tone-series=""
        data-tone-series-kind="failed"
        style={{
          marginTop: "14px",
          font: `400 11.5px/1.25 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        {SERIES_FAILED_COPY}
      </div>
    );
  }

  return (
    <div data-tone-series="" data-tone-series-kind="drawn" style={{ marginTop: "14px" }}>
      <div
        role="img"
        aria-label={view.announcement}
        style={{ position: "relative", height: `${HALF_TRACK_PX * 2}px` }}
      >
        {/* The neutral midline, drawn and continuous under every band, so a
            band's direction is read off a line that is actually there rather
            than off the reader's guess at where the middle is. */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${HALF_TRACK_PX}px`,
            height: "1px",
            backgroundColor: "var(--c-hair)",
          }}
        />
        {view.bands.map((band, i) => (
          <Band key={i} band={band} index={i} />
        ))}
      </div>
      <div
        data-tone-series-caption=""
        style={{
          marginTop: "6px",
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {view.caption}
      </div>
    </div>
  );
}
