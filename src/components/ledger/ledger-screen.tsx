"use client";

import { useState } from "react";
import { LedgerClaimCard } from "./ledger-claim-card";
import { LedgerEntryRow } from "./ledger-entry-row";
import { LedgerDateRule } from "./ledger-date-rule";
import { LEDGER_FIXTURE, type LedgerData } from "./fixture";
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
  data = LEDGER_FIXTURE,
  wrapPublishedAt = null,
}: {
  stage?: BriefStage;
  data?: LedgerData;
  /**
   * Publication time of today's evening wrap, already formatted, or null when
   * the wrap does not exist yet. Overrides the fixture. Never a clock.
   */
  wrapPublishedAt?: string | null;
}) {
  const [pulseOpen, setPulseOpen] = useState(false);
  const [bannerShown, setBannerShown] = useState(true);

  return (
    <div style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
      {bannerShown ? <PersonalizationBanner data={data} onDismiss={() => setBannerShown(false)} /> : null}
      <Masthead data={data} />
      <StatsBar data={data} loading={stage === "loading"} />

      <div style={{ padding: `0 ${PAD}` }}>
        {stage === "loading" ? <BriefSkeleton /> : null}
        {stage === "error" ? <BriefError /> : null}
        {stage === "none" ? <BriefNone /> : null}
        {stage === "stale" ? <StaleNotice data={data} /> : null}

        {stage === "ready" || stage === "stale" ? (
          <>
            <Continuity data={data} />
            <LedgerDateRule
              date={data.today.date}
              wrapPublishedAt={wrapPublishedAt ?? data.wrapPublishedAt}
              onOpenWrap={() => {}}
            />
            <PulseHero data={data} />
            <PulseProse data={data} open={pulseOpen} onToggle={() => setPulseOpen((v) => !v)} />
            <BriefProgress data={data} />
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

        <TailAction label="Write your own call" weight={600} borderToken="var(--c-ink)" marginTop="18px" />
        <TailAction label="The desk grades itself too" weight={500} borderToken="var(--c-border)" marginTop="10px" />
        <div style={{ height: "calc(24px + env(safe-area-inset-bottom))" }} />
      </div>
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

function PersonalizationBanner({ data, onDismiss }: { data: LedgerData; onDismiss: () => void }) {
  return (
    <div style={{ padding: `10px ${PAD} 0`, display: "flex", alignItems: "center", gap: "10px" }}>
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
    <div style={{ backgroundColor: "var(--c-inverse)", padding: `11px ${PAD} 12px`, marginTop: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: "700 19px/1 'Playfair Display', serif", letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
          Signal<span style={{ color: "var(--c-gold)" }}>era</span>
        </span>
        <span
          style={{
            width: "33px",
            height: "33px",
            borderRadius: "50%",
            border: "1px solid rgba(255,253,249,0.3)",
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
      <div style={{ marginTop: "12px", font: "700 19px/1.1 'Playfair Display', serif", color: "var(--c-oninv)" }}>
        Morning Brief
      </div>
      <div
        style={{
          marginTop: "6px",
          font: "400 italic 12.5px/1.3 'Playfair Display', serif",
          color: "var(--c-oninv-body)",
        }}
      >
        {data.tagline}
      </div>
      <span
        style={{
          marginTop: "10px",
          display: "inline-block",
          font: "600 10px/1 Inter, sans-serif",
          padding: "4px 9px",
          borderRadius: "14px",
          backgroundColor: "var(--c-inverse-well)",
          color: "var(--c-oninv-mono)",
        }}
      >
        {data.readMinutes} min read
      </span>
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
        padding: `10px ${PAD}`,
        borderBottom: "1px solid var(--c-border)",
        backgroundColor: "var(--c-bg)",
      }}
    >
      {data.stats.map((s) => (
        <span key={s.label} style={{ display: "inline-flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ font: "700 10px/1 Inter, sans-serif", color: "var(--c-muted)" }}>{s.label}</span>
          {loading ? (
            <span className={styles.sk} style={{ display: "inline-block", width: "34px", height: "10px" }} />
          ) : (
            <span
              style={{
                font: "600 10.5px/1 'JetBrains Mono', monospace",
                color: s.tone === "down" ? "var(--c-redink)" : "var(--c-ink)",
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

function Continuity({ data }: { data: LedgerData }) {
  const c = data.continuity;
  return (
    <div
      className={styles.enter}
      style={{
        marginTop: "14px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        padding: "13px 14px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-goldink)" }}>
          SINCE YOU LAST LOOKED
        </span>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
          {c.changeCount} CHANGES
        </span>
      </div>
      {c.lines.map((l) => (
        <div key={l.text} style={{ padding: "11px 0", borderTop: "1px solid var(--c-hair)", marginTop: "9px" }}>
          <span style={{ font: "500 13px/1.4 Inter, sans-serif", color: "var(--c-ink)" }}>{l.text}</span>
          {l.before ? (
            <span style={{ marginLeft: "6px", font: "400 12.5px/1.45 Inter, sans-serif", color: "var(--c-body)" }}>
              {l.before} → {l.after}
            </span>
          ) : null}
        </div>
      ))}
      <div style={{ paddingTop: "11px", borderTop: "1px solid var(--c-hair)", display: "flex", alignItems: "baseline", gap: "9px" }}>
        <span style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>{c.openNow}</span>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
          {c.nextIn}
        </span>
      </div>
    </div>
  );
}

function PulseHero({ data }: { data: LedgerData }) {
  const p = data.pulse;
  return (
    <div
      className={styles.rise}
      style={{
        marginTop: "14px",
        borderRadius: "14px",
        backgroundColor: "var(--c-inverse)",
        padding: "16px",
      }}
    >
      <div style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-oninv-dim)" }}>
        {p.stampedAt}
      </div>
      <p style={{ margin: "12px 0 0", font: "800 25px/1.24 'Playfair Display', serif", color: "var(--c-oninv)" }}>
        Today the market is{" "}
        <span
          style={{
            display: "inline-block",
            backgroundColor: "var(--c-gold)",
            color: "var(--c-ongold)",
            borderRadius: "9px",
            padding: "1px 11px",
          }}
        >
          {p.verdict}
        </span>
        .
      </p>
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
    </div>
  );
}

function PulseProse({ data, open, onToggle }: { data: LedgerData; open: boolean; onToggle: () => void }) {
  const p = data.pulse;
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
    </>
  );
}

function BriefProgress({ data }: { data: LedgerData }) {
  const { read, total, status } = data.briefProgress;
  return (
    <div style={{ marginTop: "6px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <span style={{ font: "400 italic 12.5px/1 'Playfair Display', serif", color: "var(--c-secondary)" }}>
          {status}
        </span>
        <span style={{ font: "400 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
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
}: {
  label: string;
  weight: number;
  borderToken: string;
  marginTop: string;
}) {
  return (
    <button
      type="button"
      className={styles.bare}
      style={{
        marginTop,
        width: "100%",
        minHeight: "52px",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        border: `1px solid ${borderToken}`,
        borderRadius: "9px",
        font: `${weight} 13px/1.4 Inter, sans-serif`,
        color: "var(--c-ink)",
      }}
    >
      {label}
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
        This is a failed read, not an empty result. Nothing is being hidden, and your open calls are unaffected.
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
        Nothing failed to load. The desk has not published yet, and it publishes at 6:45. Your six open calls are unaffected.
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
        Today&rsquo;s has not published yet. Generated {data.generatedAt}. Your review dates are unaffected.
      </div>
    </div>
  );
}
