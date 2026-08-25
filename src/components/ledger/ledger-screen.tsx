"use client";

import { useState } from "react";
import { Chevron } from "./chevron";
import { MobileTickerStrip } from "./mobile-ticker-strip";
import { LedgerClaimCard } from "./ledger-claim-card";
import { LedgerEntryRow } from "./ledger-entry-row";
import { LedgerDateRule } from "./ledger-date-rule";
import { type LedgerData } from "./fixture";
import styles from "./ledger.module.css";

/**
 * The Ledger. The brief and the record as one continuous timeline, reverse
 * chronological and unfiltered, with a repeating date rule marking each day.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through a harness that resolves those
 * branches from a state map; see the PR body.
 */

export type BriefStage = "ready" | "loading" | "error" | "none" | "stale";

const PAD = "var(--v3-pad)";

export function LedgerScreen({
  stage = "ready",
  data,
  wrapPublishedAt = null,
}: {
  stage?: BriefStage;
  /** The gated fixture, or null when no source exists. Never defaulted. */
  data: LedgerData | null;
  /**
   * Publication time of today's evening wrap, already formatted, or null when
   * the wrap does not exist yet. Overrides the fixture. Never a clock.
   */
  wrapPublishedAt?: string | null;
}) {
  const [pulseOpen, setPulseOpen] = useState(false);
  const [bannerShown, setBannerShown] = useState(true);

  /* No source, no screen. `data` is null in every environment where no loader
     supplies it, and the screen renders its loading state rather than inventing
     one. This is the rule from PR #661: with no data, render nothing or render loading,
     never a sentence about the reader or their record.

     It is an early return on purpose. Below this line TypeScript knows `data`
     is non-null, so no later reader needs a guard and no later edit can bring
     the fixture back by omission. The fixture used to arrive as a DEFAULT
     PARAMETER here, which meant deleting one gate silently served an invented
     brief, three fabricated claims and "One of your calls was checked
     overnight" to real readers. That is the defect that blocked PR #646 and PR #653,
     and it was live on this screen. */
  if (data === null) {
    return (
      <div data-parity="ledger" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%", padding: `0 ${PAD}` }}>
        <MobileTickerStrip />
        <BriefSkeleton />
      </div>
    );
  }

  return (
    <div data-parity="ledger" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%", padding: `0 ${PAD}` }}>
      {/* The top element on the screen, above the banner and the masthead, and
          the only thing in the product that keeps moving once a screen has
          settled. Without it the masthead floats. */}
      <MobileTickerStrip />
      {/* No sectors, no banner. "Personalized for:" over an empty chip row is
          a claim about the reader that an empty profile cannot support. */}
      {bannerShown && data.sectors.length > 0 ? (
        <PersonalizationBanner data={data} onDismiss={() => setBannerShown(false)} />
      ) : null}
      <Masthead data={data} />
      {/* The band carries a LIVE lamp. With no figures beside it there is
          nothing live to point at, so the whole band goes. */}
      {data.stats.length > 0 ? <StatsBar data={data} loading={stage === "loading"} /> : null}

      <div style={{ padding: `0 ${PAD}` }}>
        {stage === "loading" ? <BriefSkeleton /> : null}
        {stage === "error" ? <BriefError /> : null}
        {stage === "none" ? <BriefNone /> : null}
        {stage === "stale" ? <StaleNotice data={data} /> : null}

        {stage === "ready" || stage === "stale" ? (
          <>
            {data.continuity ? <Continuity continuity={data.continuity} /> : null}
            <LedgerDateRule
              date={data.today.date}
              wrapPublishedAt={wrapPublishedAt ?? data.wrapPublishedAt}
              onOpenWrap={() => {}}
            />
            {data.pulse ? (
              <>
                <PulseHero pulse={data.pulse} />
                <PulseProse pulse={data.pulse} open={pulseOpen} onToggle={() => setPulseOpen((v) => !v)} />
              </>
            ) : null}
            {data.briefProgress ? <BriefProgress progress={data.briefProgress} /> : null}
            {data.today.claims?.map((c, i) => (
              <LedgerClaimCard
                key={c.id}
                eyebrow={c.eyebrow}
                claim={c.claim}
                reasoning={c.reasoning}
                window={c.window}
                windowRelative={c.windowRelative}
                variant={c.variant}
                ungradeableReason={c.ungradeableReason}
                delayMs={60 + i * 60}
                onOpen={() => {}}
                onTrack={c.variant === "open" ? () => {} : undefined}
              />
            ))}
          </>
        ) : null}

        {/* The record stays put whatever today's brief did. A failed or absent
            brief is not a reason to hide entries the user already owns. */}
        {data.past.map((day) => (
          <div key={day.date}>
            <LedgerDateRule date={day.date} past />
            {day.entries?.map((e, i) => (
              <LedgerEntryRow
                key={e.id}
                state={e.state}
                instrument={e.instrument}
                claim={e.claim}
                result={e.result}
                first={i === 0}
                onOpen={() => {}}
              />
            ))}
          </div>
        ))}

        {data.entriesBefore !== null ? (
          <div
            style={{
              marginTop: "22px",
              textAlign: "center",
              font: "400 italic 12.5px/1 'Playfair Display', serif",
              color: "var(--c-muted)",
            }}
          >
            {data.entriesBefore} entries before this
          </div>
        ) : null}

        <TailAction label="Write your own call" weight={600} borderToken="var(--c-ink)" marginTop="18px" />
        <TailAction
          label="The desk grades itself too"
          weight={500}
          borderToken="var(--c-border)"
          marginTop="10px"
          fillToken="var(--c-surface)"
        />
        <div style={{ height: "calc(24px + env(safe-area-inset-bottom))" }} />
      </div>
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

function PersonalizationBanner({ data, onDismiss }: { data: LedgerData; onDismiss: () => void }) {
  return (
    <div style={{ padding: "10px 0 0", display: "flex", alignItems: "center", gap: "10px" }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          border: "1px solid var(--c-border)",
          borderRadius: "12px",
          backgroundColor: "var(--c-well)",
          padding: "8px 12px",
        }}
      >
        <span style={{ font: "400 11px/1 Inter, sans-serif", color: "var(--c-muted)" }}>
          Personalized for:
        </span>
        {data.sectors.map((s) => (
          <span
            key={s}
            style={{
              font: "600 10px/1.35 Inter, sans-serif",
              padding: "3px 7px",
              borderRadius: "4px",
              border: "1px solid var(--c-border)",
              backgroundColor: "var(--c-well)",
              color: "var(--c-secondary)",
            }}
          >
            {s}
          </span>
        ))}
        <button
          type="button"
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            minHeight: "12px",
            padding: "16px 0",
            margin: "-16px 0",
            display: "inline-flex",
            alignItems: "center",
            font: "500 11px/1 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          Edit →
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={styles.bare}
        style={{
          boxSizing: "content-box",
          width: "32px",
          height: "32px",
          padding: "6px",
          margin: "-6px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-muted)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function Masthead({ data }: { data: LedgerData }) {
  return (
    <div style={{ backgroundColor: "var(--c-inverse)", padding: "11px 20px 12px", marginTop: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: "700 19px/1 'Playfair Display', serif", letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
          Signal<span style={{ display: "inline-block", font: "700 19px/1 'Playfair Display', serif", color: "var(--c-oninv-gold)" }}>era</span>
        </span>
        <span
          style={{
            width: "33px",
            height: "33px",
            borderRadius: "50%",
            border: "1px solid rgba(255,253,249,0.3)",
            backgroundColor: "rgba(255,253,249,0.12)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 11.5px/1 Inter, sans-serif",
            color: "var(--c-oninv)",
          }}
        >
          MR
        </span>
      </div>
      <div style={{ marginTop: "12px", font: "700 19px/1.1 'Playfair Display', serif", letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
        Morning Brief
      </div>
      {data.tagline ? (
        <div
          style={{
            marginTop: "6px",
            maxWidth: "230px",
            font: "400 italic 12.5px/1.3 'Playfair Display', serif",
            color: "rgba(255,253,249,0.78)",
          }}
        >
          {data.tagline}
        </div>
      ) : null}
      {data.readMinutes !== null ? (
        <span
          style={{
            marginTop: "10px",
            display: "inline-block",
            font: "600 10px/1 Inter, sans-serif",
            padding: "4px 9px",
            borderRadius: "14px",
            backgroundColor: "rgba(255,253,249,0.15)",
            color: "rgba(255,253,249,0.9)",
          }}
        >
          {data.readMinutes} min read
        </span>
      ) : null}
    </div>
  );
}

function StatsBar({ data, loading }: { data: LedgerData; loading: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "18px",
        flexWrap: "wrap",
        padding: "10px 0",
        borderBottom: "1px solid var(--c-border)",
        backgroundColor: "var(--c-bg)",
      }}
    >
      {data.stats.map((s) => (
        <span key={s.label} style={{ display: "inline-flex", alignItems: "baseline", gap: "6px" }}>
          {/* One anatomy for all four cells. The design draws three labels in
              Inter 700 and the VIX label in mono at --c-oninv-dim, which is two
              anatomies in one band and measures 2.9:1 on cream. See the PR. */}
          <span style={{ font: "700 10px/1 Inter, sans-serif", color: "var(--c-muted)" }}>{s.label}</span>
          {loading ? (
            <span className={styles.sk} style={{ display: "inline-block", width: "34px", height: "10px" }} />
          ) : (
            <span
              style={{
                font: "700 12px/1 'JetBrains Mono', monospace",
                color:
                  s.tone === "calm"
                    ? "var(--c-greenink)"
                    : s.tone === "stress"
                      ? "var(--c-redink)"
                      : s.tone === "mood"
                        ? "var(--c-amberink)"
                        : "var(--c-ink)",
              }}
            >
              {s.value}
            </span>
          )}
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", marginLeft: "auto" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--c-green)" }} />
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
          LIVE
        </span>
      </span>
    </div>
  );
}

function Continuity({ continuity }: { continuity: NonNullable<LedgerData["continuity"]> }) {
  const c = continuity;
  return (
    <div
      className={styles.enter}
      style={{
        marginTop: "14px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        padding: "13px 14px 12px",
        /* The design fills this card. It was missing here and parity could not
           see it: the container carries no text of its own, so it is not in the
           fingerprint at all and a fill absent from an unfingerprinted element
           diffs clean forever. Caught by eye against the prototype. */
        backgroundColor: "var(--c-well)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-goldink)" }}>
          SINCE YOU LAST LOOKED
        </span>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
          {c.changeCount} CHANGES
        </span>
      </div>
      {c.lines.map((l, i) => (
        <div
          key={l.text}
          style={{
            /* The design gives the first line more room and a margin off the
               header, and tightens every line after it. Keyed on position
               rather than on emphasis: it is the rhythm of the stack, not a
               property of what the line says. */
            padding: i === 0 ? "11px 0" : "9px 0",
            marginTop: i === 0 ? "9px" : 0,
            borderTop: "1px solid var(--c-hair)",
            display: "flex",
            alignItems: "baseline",
            gap: "10px",
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: l.emphasis
                ? "500 13px/1.4 Inter, sans-serif"
                : "400 12.5px/1.45 Inter, sans-serif",
              color: l.emphasis ? "var(--c-ink)" : "var(--c-body)",
            }}
          >
            {l.text}
          </span>
          {l.before ? (
            <span
              style={{
                font: "500 10px/1 'JetBrains Mono', monospace",
                letterSpacing: "0.04em",
                color: "var(--c-muted)",
              }}
            >
              {l.before} → {l.after}
            </span>
          ) : null}
          {/* Gold, and only on the emphasis line. The design gives the lead
              change a chevron and the count line a delta figure instead: one
              says "there is something to read", the other says what moved. A
              chevron on both would flatten that. */}
          {l.emphasis ? <Chevron direction="right" stroke="var(--c-gold)" style={{ marginTop: "3px" }} /> : null}
        </div>
      ))}
      <div
        style={{
          /* The design gives this row a 46px minimum and centres it, rather
             than padding it like the lines above. It is the row that opens the
             open-call list, so it is sized as a control even before it is one. */
          minHeight: "46px",
          borderTop: "1px solid var(--c-hair)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>{c.openNow}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.04em", color: "var(--c-muted)" }}>
            {c.nextIn}
          </span>
          {/* Drawn at rest, which is rotate(0deg), because the open-call list
              this row expands is not built in this unit. The rotation and its
              easing are the design's own and are carried here so the control
              that lands later inherits them rather than inventing them. */}
          <span
            style={{
              display: "inline-flex",
              transition: "transform 180ms cubic-bezier(0.16,1,0.3,1)",
              transform: "rotate(0deg)",
            }}
          >
            <Chevron direction="down" />
          </span>
        </span>
      </div>
    </div>
  );
}

function PulseHero({ pulse }: { pulse: NonNullable<LedgerData["pulse"]> }) {
  const p = pulse;
  return (
    <div
      className={styles.rise}
      style={{
        marginTop: "16px",
        borderRadius: "14px",
        backgroundColor: "var(--c-inverse)",
        /* Padding moves to the inner wrapper, as the design has it. The glow
           has to reach the card's own edge, and padding on this element would
           inset the overflow box the wash is clipped by. */
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* The corner glow. A 220px circle pulled 70px past the top right corner,
          so what lands on the card is the bright inner quarter of it falling
          away to nothing well before the opposite edge. The design writes the
          gold as --c-gold's own value carrying an eight-bit alpha suffix, which
          resolves to the 0.376 below. No token expresses an alpha of a token,
          so the alpha is spelled out here and the hue is not. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "-70px",
          top: "-70px",
          width: "220px",
          height: "220px",
          background: "radial-gradient(circle, rgba(212,168,75,0.376), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      {/* One positioned wrapper for all of it, as the design does it. The glow
          is absolutely positioned, so it paints above every non-positioned
          sibling: without this the stamp, the headline and the drivers all sit
          under the wash rather than on the card. */}
      <div style={{ position: "relative", padding: "18px 16px 16px" }}>
      <div style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "rgba(255,253,249,0.55)" }}>
        {p.stampedAt}
      </div>
      <p style={{ margin: "12px 0 0", font: "800 25px/1.24 'Playfair Display', serif", letterSpacing: "-0.025em", color: "var(--c-oninv)" }}>
        Today the market is{" "}
        <span
          style={{
            display: "inline-block",
            backgroundColor: "var(--c-gold)",
            color: "var(--c-ongold)",
            borderRadius: "9px",
            padding: "1px 11px",
            transform: "rotate(-1deg)",
            boxShadow: "0 4px 0 rgba(0,0,0,0.15)",
          }}
        >
          {p.verdict}
        </span>
        .
      </p>
      {p.drivers.length > 0 ? (
      <div style={{ marginTop: "15px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {p.drivers.map((d) => (
          <span
            key={d.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              font: "500 12px/1 Inter, sans-serif",
              color: "var(--c-oninv)",
              backgroundColor: "rgba(255,253,249,0.08)",
              border: "1px solid rgba(212,168,75,0.25)",
              borderRadius: "14px",
              padding: "7px 12px",
            }}
          >
            {d.label}
            <span
              style={{
                font: "600 10px/1.35 Inter, sans-serif",
                padding: "3px 7px",
                borderRadius: "4px",
                backgroundColor: `var(--pill-${d.tone}-bg)`,
                color: `var(--pill-${d.tone}-text)`,
                border: `1px solid var(--pill-${d.tone}-border)`,
              }}
            >
              {d.toneLabel}
            </span>
          </span>
        ))}
      </div>
      ) : null}
      </div>
    </div>
  );
}

function PulseProse({
  pulse,
  open,
  onToggle,
}: {
  pulse: NonNullable<LedgerData["pulse"]>;
  open: boolean;
  onToggle: () => void;
}) {
  const p = pulse;
  return (
    <>
      <p style={{ margin: "16px 0 0", font: "400 17px/1.55 'Playfair Display', serif", color: "var(--c-ink)", textWrap: "pretty" }}>
        {p.lede}
      </p>
      {(open ? p.body : p.body.slice(0, 1)).map((b) => (
        <p key={b.slice(0, 24)} style={{ margin: "12px 0 0", font: "400 var(--v3-body)/var(--v3-lead) Inter, sans-serif", color: "var(--c-body)" }}>
          {b}
        </p>
      ))}
      {/* Nothing withheld, no control. The label promises more prose and an
          empty body has none. */}
      {p.body.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className={styles.bare}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            font: "600 12.5px/1 Inter, sans-serif",
            color: "var(--c-goldink)",
          }}
        >
          {open ? "Less" : "Read the full pulse"}
        </button>
      ) : null}
    </>
  );
}

function BriefProgress({ progress }: { progress: NonNullable<LedgerData["briefProgress"]> }) {
  const { read, total, status } = progress;
  return (
    <div style={{ marginTop: "6px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <span style={{ font: "400 italic 12.5px/1 'Playfair Display', serif", color: "var(--c-secondary)" }}>
          {status}
        </span>
        <span style={{ font: "400 10.5px/1 'JetBrains Mono', monospace", letterSpacing: "0.045em", color: "var(--c-muted)" }}>
          {read} / {total}
        </span>
      </div>
      <div style={{ marginTop: "9px", display: "flex", gap: "5px" }} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "2px",
              backgroundColor: i < read ? "var(--c-ink)" : "var(--c-border)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TailAction({
  label,
  weight,
  borderToken,
  marginTop,
  fillToken,
}: {
  label: string;
  weight: number;
  borderToken: string;
  marginTop: string;
  /** The second action is filled; the first is not. */
  fillToken?: string;
}) {
  return (
    <button
      type="button"
      className={styles.bare}
      style={{
        marginTop,
        width: "100%",
        /* 52, not the design's 50. The design's rows are content-box, so its
           50px minimum sits inside a 1px border on each side and measures 52
           rendered. Everything here is border-box under the framework reset, so
           the border has to be in the number. Measured, not transcribed. */
        minHeight: "52px",
        display: "flex",
        alignItems: "center",
        /* The chevron sits on the trailing edge, not next to the label. */
        justifyContent: "space-between",
        padding: "0 16px",
        border: `1px solid ${borderToken}`,
        borderRadius: "9px",
        backgroundColor: fillToken,
        font: `${weight} 13px/1.4 Inter, sans-serif`,
        color: "var(--c-ink)",
        textAlign: "left",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>{label}</span>
      <Chevron direction="right" size={15} />
    </button>
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

function BriefSkeleton() {
  return (
    <div style={{ paddingTop: "16px" }} aria-busy="true" aria-label="Loading the morning brief">
      <div className={styles.sk} style={{ height: "14px", width: "58%" }} />
      <div className={styles.sk} style={{ height: "160px", marginTop: "14px", borderRadius: "14px" }} />
      {[0, 1].map((i) => (
        <div key={i} className={styles.sk} style={{ height: "168px", marginTop: "16px", borderRadius: "12px" }} />
      ))}
    </div>
  );
}

/**
 * A failed read is not an empty result, and the copy says so in both
 * directions. The principle is stated verbatim in the repo already: nothing is
 * being hidden. On a product whose claim is that nothing is curated away, a
 * failed read that reads as an empty one is a trust failure.
 */
function BriefError() {
  return (
    <div style={{ paddingTop: "18px" }} role="alert">
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        We could not load the morning brief.
      </p>
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)", maxWidth: "32ch" }}>
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
      <button
        type="button"
        className={styles.bare}
        style={{
          marginTop: "14px",
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: "600 13px/1 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}

function BriefNone() {
  return (
    <div style={{ paddingTop: "18px" }}>
      <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
        No brief published yet.
      </p>
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)", maxWidth: "32ch" }}>
        Nothing failed to load. The desk has not published yet, and it publishes at 6:45.
      </p>
    </div>
  );
}

function StaleNotice({ data }: { data: LedgerData }) {
  return (
    <div
      style={{
        marginTop: "14px",
        border: "1px solid var(--c-amber-edge)",
        backgroundColor: "var(--c-amber-well)",
        borderRadius: "12px",
        padding: "13px 14px",
      }}
    >
      <div style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>
        You are reading yesterday&rsquo;s brief.
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        Today&rsquo;s has not published yet.{data.generatedAt ? ` Generated ${data.generatedAt}.` : ""}
      </div>
    </div>
  );
}
