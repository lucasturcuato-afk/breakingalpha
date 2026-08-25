"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
 * FACES. Every font here names the loaded family through the back-compat
 * variables globals.css declares on `body`: `--font-playfair-display` resolves
 * to Fraunces, `--font-inter` to Space Grotesk, `--font-jetbrains-mono` to IBM
 * Plex Mono. The app loads exactly those three. The literal names the design
 * uses, Playfair Display, Inter and JetBrains Mono, are not loaded, so spelling
 * them here rendered 96 of this screen's 152 elements in the browser's default
 * serif, sans and mono. Measured with getComputedStyle over the
 * [data-parity="ledger"] subtree on a production build.
 *
 * CONTROLS. Nothing here is a control without a destination. A row that cannot
 * be opened is handed no handler, and both LedgerClaimCard and LedgerEntryRow
 * fall back to a plain div in that case, so it is not focusable, takes no
 * pointer cursor and is not announced as a button.
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
  const router = useRouter();
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
     and it was live on this screen.

     A KNOWN FAILURE OUTRANKS AN ABSENT PAYLOAD, and the ordering inside this
     guard is the whole of that. `loadLedger` gives back `{data: null, stage:
     "error"}` when the brief read fails, and this early return used to reach
     `BriefSkeleton` without ever consulting `stage`, so `BriefError` was dead
     on the loader path and every signed-in reader hit by a Supabase outage got
     a spinner over a read that had already failed and would not be retried.
     A screen that says "loading" about a terminal failure is publishing a
     state it did not establish. It is not a zero, but it is the same untruth
     in a different currency, and it is the defect this PR exists to remove.

     The failure is scoped to the brief, not to the screen. When `data` is
     non-null the error branch stays in the body below, beside the reader's own
     record, because a failed brief read is no reason to discard entries the
     reader already owns. Here there is nothing to keep: the read that failed
     is the one that produces the entire payload.

     THE SKELETON ARM BELOW IS UNREACHABLE FROM EVERY CURRENT CALL SITE, and
     that is recorded here rather than left for the next reader to rediscover.
     `loadLedger` gives back a null payload on exactly one condition, the failed
     brief read, and that condition also sets `stage: "error"`. `page.tsx`, the
     only call site, substitutes null only when the loader did. So today:

         data === null   implies   stage === "error"

     The `?stage=` preview path does NOT reach it either, which is worth being
     precise about: that path requires `sampleAllowed`, which supplies the
     fixture, so `data` is non-null and a forced `?stage=loading` draws the
     skeleton from the body branch further down, under a masthead and a stats
     band. Measured signed out on a dev build: 127 elements with the masthead
     present, where this guard would draw a ticker and one block and no
     masthead.

     IT STAYS, and it is not the same call as deleting the unreachable `null`
     arm of `briefProgress.decided` two commits ago. That was a value in a DATA
     CONTRACT describing to a reader a state that could not occur, and the union
     never had to carry it. This is the type-mandated guard on a REQUIRED,
     NULLABLE prop, and the nullability is the safety property itself: it is
     what makes a missing gate a build failure instead of invented data in front
     of a reader, which is the whole of #670. The guard cannot be deleted
     without giving that up, so the only real choice is what it draws.

     A caller with no payload and no failure to report HAS NOT ANSWERED, and a
     skeleton is what not having answered looks like. Drawing nothing instead
     would make an unanswered read look like an answered and empty one, which is
     the exact confusion this branch exists to prevent. What would make it
     reachable: a loader that can give back a null payload without a failure, or
     a second call site that passes one. Neither exists yet, and either should
     arrive with a rendered proof of this arm. */
  if (data === null) {
    return (
      <div data-parity="ledger" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%", padding: `0 ${PAD}` }}>
        <MobileTickerStrip />
        {stage === "error" ? <BriefError /> : <BriefSkeleton />}
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
              onOpenWrap={() => router.push("/evening-wrap")}
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
                /* No onOpen. There is no claim detail route to send anyone to,
                   and a card that opens nothing must not be a button. */
                onTrack={c.variant === "open" ? () => router.push("/radar/calls") : undefined}
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
              /* No onOpen, for the same reason as the claim cards: no entry
                 detail route exists yet. The row renders as a plain div. */
              <LedgerEntryRow
                key={e.id}
                state={e.state}
                instrument={e.instrument}
                claim={e.claim}
                result={e.result}
                first={i === 0}
              />
            ))}
          </div>
        ))}

        {data.entriesBefore !== null ? (
          <div
            style={{
              marginTop: "22px",
              textAlign: "center",
              font: "400 italic 12.5px/1 var(--font-playfair-display), serif",
              color: "var(--c-muted)",
            }}
          >
            {data.entriesBefore} entries before this
          </div>
        ) : null}

        <TailAction
          label="Write your own call"
          href="/radar/calls"
          weight={600}
          borderToken="var(--c-ink)"
          marginTop="18px"
        />
        <TailAction
          label="The desk grades itself too"
          href="/radar/desk-record"
          weight={500}
          borderToken="var(--c-border)"
          marginTop="10px"
          fillToken="var(--c-surface)"
        />
        {/* Clears the fixed tab bar, not just the home indicator. Measured on a
            production build at 390x844: at maximum scroll the last tail action
            spanned 768 to 820 while the bar started at 785, so 35px of a 52px
            control sat under it and could never be tapped. The bar is
            --mobile-tabbar-row plus its 1px top edge plus the safe area. */}
        <div
          style={{
            height:
              "calc(24px + 1px + var(--mobile-tabbar-row) + env(safe-area-inset-bottom))",
          }}
        />
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
        <span style={{ font: "400 11px/1 var(--font-inter), sans-serif", color: "var(--c-muted)" }}>
          Personalized for:
        </span>
        {data.sectors.map((s) => (
          <span
            key={s}
            style={{
              font: "600 10px/1.35 var(--font-inter), sans-serif",
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
        <Link
          href="/settings/preferences"
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            minHeight: "12px",
            padding: "16px 0",
            margin: "-16px 0",
            display: "inline-flex",
            alignItems: "center",
            font: "500 11px/1 var(--font-inter), sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          Edit →
        </Link>
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
        <span style={{ font: "700 19px/1 var(--font-playfair-display), serif", letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
          Signal<span style={{ display: "inline-block", font: "700 19px/1 var(--font-playfair-display), serif", color: "var(--c-oninv-gold)" }}>era</span>
        </span>
        {/* Decorative, and now actually marked so. The PR previously claimed this
            was aria-hidden while the attribute was absent from the node, which
            left an unlabelled node in the accessibility tree, and an unlabelled
            EMPTY one whenever no initials are derivable. The shell's own avatar
            is the labelled affordance; this disc repeats it and announces
            nothing. */}
        <span
          aria-hidden="true"
          style={{
            width: "33px",
            height: "33px",
            borderRadius: "50%",
            border: "1px solid rgba(255,253,249,0.3)",
            backgroundColor: "rgba(255,253,249,0.12)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            font: "600 11.5px/1 var(--font-inter), sans-serif",
            color: "var(--c-oninv)",
          }}
        >
          {/* The design's disc carries "MR", the sample reader's initials.
              Printed over a real session those are another person's letters on
              this person's screen, so they come from the reader's own profile
              or the disc stays empty. Decorative either way: the shell's own
              avatar is the labelled one. */}
          {data.initials}
        </span>
      </div>
      <div style={{ marginTop: "12px", font: "700 19px/1.1 var(--font-playfair-display), serif", letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
        Morning Brief
      </div>
      {data.tagline ? (
        <div
          style={{
            marginTop: "6px",
            maxWidth: "230px",
            font: "400 italic 12.5px/1.3 var(--font-playfair-display), serif",
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
            font: "600 10px/1 var(--font-inter), sans-serif",
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
          <span style={{ font: "700 10px/1 var(--font-inter), sans-serif", color: "var(--c-muted)" }}>{s.label}</span>
          {loading ? (
            <span className={styles.sk} style={{ display: "inline-block", width: "34px", height: "10px" }} />
          ) : (
            <span
              style={{
                font: "700 12px/1 var(--font-jetbrains-mono), monospace",
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
        <span style={{ font: "400 10px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
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
        <span style={{ font: "400 10px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.07em", color: "var(--c-goldink)" }}>
          SINCE YOU LAST LOOKED
        </span>
        <span style={{ font: "400 10px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.07em", color: "var(--c-muted)" }}>
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
                ? "500 13px/1.4 var(--font-inter), sans-serif"
                : "400 12.5px/1.45 var(--font-inter), sans-serif",
              color: l.emphasis ? "var(--c-ink)" : "var(--c-body)",
            }}
          >
            {l.text}
          </span>
          {l.before ? (
            <span
              style={{
                font: "500 10px/1 var(--font-jetbrains-mono), monospace",
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
        <span style={{ font: "600 12px/1 var(--font-inter), sans-serif", color: "var(--c-ink)" }}>{c.openNow}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ font: "400 10px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.04em", color: "var(--c-muted)" }}>
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
      <div style={{ font: "400 10px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.07em", color: "rgba(255,253,249,0.55)" }}>
        {p.stampedAt}
      </div>
      <p style={{ margin: "12px 0 0", font: "800 25px/1.24 var(--font-playfair-display), serif", letterSpacing: "-0.025em", color: "var(--c-oninv)" }}>
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
              font: "500 12px/1 var(--font-inter), sans-serif",
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
                font: "600 10px/1.35 var(--font-inter), sans-serif",
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
      <p style={{ margin: "16px 0 0", font: "400 17px/1.55 var(--font-playfair-display), serif", color: "var(--c-ink)", textWrap: "pretty" }}>
        {p.lede}
      </p>
      {(open ? p.body : p.body.slice(0, 1)).map((b) => (
        <p key={b.slice(0, 24)} style={{ margin: "12px 0 0", font: "400 var(--v3-body)/var(--v3-lead) var(--font-inter), sans-serif", color: "var(--c-body)" }}>
          {b}
        </p>
      ))}
      {/* Nothing withheld, no control. The closed state already renders the
          first body paragraph, so a single-paragraph pulse has nothing left to
          reveal and the label would promise prose the reader can already see.
          The bar is more than one, not more than none. */}
      {p.body.length > 1 ? (
        <button
          type="button"
          onClick={onToggle}
          className={styles.bare}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            font: "600 12.5px/1 var(--font-inter), sans-serif",
            color: "var(--c-goldink)",
          }}
        >
          {open ? "Less" : "Read the full pulse"}
        </button>
      ) : null}
    </>
  );
}

/**
 * The desk's calls on this brief and how many are graded.
 *
 * ONLY A NUMBER IS A COUNT. `"failed"` is a read that answered with an error,
 * and that is not a zero. Drawing it as `0 / N` under a full row of unfilled
 * segments states a figure nothing established, in the most quantitative shape
 * on the screen. So the numeral pair and the bar are drawn for a real count and
 * for nothing else, and a failed read says it failed instead.
 *
 * The loader's `DeskLoad.decided` carries a third value, `null` for a read that
 * was never made. It cannot arrive here: that read is skipped only when the
 * brief has no calls, and then there is no progress block at all. See the note
 * on `LedgerData.briefProgress`.
 */
function BriefProgress({ progress }: { progress: NonNullable<LedgerData["briefProgress"]> }) {
  const { decided, total, status } = progress;
  const counted = typeof decided === "number" ? decided : null;
  return (
    <div style={{ marginTop: "6px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <span style={{ font: "400 italic 12.5px/1 var(--font-playfair-display), serif", color: "var(--c-secondary)" }}>
          {status}
        </span>
        {counted !== null ? (
          <span style={{ font: "400 10.5px/1 var(--font-jetbrains-mono), monospace", letterSpacing: "0.045em", color: "var(--c-muted)" }}>
            {counted} / {total}
          </span>
        ) : null}
      </div>
      {counted !== null ? (
        <div style={{ marginTop: "9px", display: "flex", gap: "5px" }} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: "2px",
                backgroundColor: i < counted ? "var(--c-ink)" : "var(--c-border)",
              }}
            />
          ))}
        </div>
      ) : null}
      {decided === "failed" ? (
        <div
          role="status"
          style={{
            marginTop: "8px",
            font: "400 11.5px/1.5 var(--font-inter), sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          We could not read which of these have been decided.
        </div>
      ) : null}
    </div>
  );
}

function TailAction({
  label,
  href,
  weight,
  borderToken,
  marginTop,
  fillToken,
}: {
  label: string;
  /** Where it goes. Required: a tail action with nowhere to go is not one. */
  href: string;
  weight: number;
  borderToken: string;
  marginTop: string;
  /** The second action is filled; the first is not. */
  fillToken?: string;
}) {
  return (
    <Link
      href={href}
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
        font: `${weight} 13px/1.4 var(--font-inter), sans-serif`,
        color: "var(--c-ink)",
        textAlign: "left",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>{label}</span>
      <Chevron direction="right" size={15} />
    </Link>
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
  /* `router.refresh()` re-runs the server component, which re-runs the read.
     That is a real retry here, unlike a client screen whose loader only fires
     on mount. Before this the control was a bare `<button>` with no handler:
     inert, focusable, announced as a button. It escaped the control census
     because that was taken on the ready stage, and it was unreachable in
     production only because of the guard-ordering defect above. Fixing that
     made it a live control on the screen whose own headline fix was removing
     controls that do nothing. */
  const router = useRouter();
  return (
    <div style={{ paddingTop: "18px" }} role="alert">
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        We could not load the morning brief.
      </p>
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 var(--font-inter), sans-serif", color: "var(--c-secondary)", maxWidth: "32ch" }}>
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className={styles.bare}
        style={{
          marginTop: "14px",
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: "600 13px/1 var(--font-inter), sans-serif",
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
      <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
        No brief published yet.
      </p>
      {/* This used to read "Nothing failed to load. The desk has not published
          yet." Both halves overreach. `briefQuery` excludes the sentinel
          headline the pipeline writes when a run fails upstream, so a brief
          that published as a failure row lands here, and on that path
          something did fail and the desk did publish. What the read actually
          establishes is narrower and is all this says now: it answered, and it
          returned no brief. The distinction from the error state, which is
          what the old sentence was reaching for, survives in "answered". */}
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 var(--font-inter), sans-serif", color: "var(--c-secondary)", maxWidth: "32ch" }}>
        The read answered and returned no brief. The desk publishes at 6:45.
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
      {/* The bar is age-based: anything past 20 hours is stale, and a brief
          three days old is not yesterday's. So it names the day the brief
          carries rather than a relative word its own trigger cannot support.
          That day is the one the date rule below already prints, so the
          notice and the rule state the same frame. */}
      <div style={{ font: "600 12px/1 var(--font-inter), sans-serif", color: "var(--c-ink)" }}>
        You are reading the brief from {data.today.date}.
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 var(--font-inter), sans-serif", color: "var(--c-body)" }}>
        Today&rsquo;s has not published yet.{data.generatedAt ? ` Generated ${data.generatedAt}.` : ""}
      </div>
    </div>
  );
}
