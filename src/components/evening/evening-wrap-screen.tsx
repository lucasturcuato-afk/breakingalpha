"use client";

import Link from "next/link";
import { useState } from "react";
import { ClaimAnatomy, MobileTickerStrip } from "@/components/ledger";
/* The Ledger's motion module, imported rather than copied.
 *
 * Every rule this screen needs is already defined there at the design's own
 * durations and easing, and its reduced-motion block is the audited one: the
 * ticker's guard lives at ledger.module.css:124-131 and the entrance rules all
 * rest in their drawn state, so nothing is hidden rather than merely
 * unanimated. A second module would be a second set of keyframes drifting from
 * the first, which is the failure the shared skill exists to prevent. The
 * module is not screen specific; only its file name is. */
import motion from "@/components/ledger/ledger.module.css";
import {
  CLOSE_VISIBLE_PARAGRAPHS,
  type EveningMover,
  type EveningWrapData,
  type ScorecardCell,
} from "./fixture";

/**
 * The Evening Wrap, mobile. The Close, its scorecard, the one call the desk
 * revisited after the bell, and the movers.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle
 * through `scripts/parity_harness.py --screen evening`, not transcribed from
 * either handoff document. The prototype's `sc-if` branches need a runtime that
 * does not resolve over `file://`, which is what the harness is for.
 *
 * NO TAB BAR, ON PURPOSE. The prototype gates the nav on
 * `showNav: ['dash','ledger','watch','ask'].includes(s.screen)` at line 3460,
 * and `evening` is not in that list, so this surface renders full screen with
 * no bottom bar and no pole lit. That is DECISIONS.md open item O2, recorded as
 * a design bug and deliberately unresolved. This screen reproduces it rather
 * than inventing a bar for it. The single in-surface exit is the `Ledger` link
 * in the masthead, which is therefore a real anchor and not a no-op.
 */

export type WrapStage = "ready" | "loading" | "none" | "error" | "stale";

const PAD = "var(--v3-pad)";
const MONO = "'JetBrains Mono', monospace";
const PLAYFAIR = "'Playfair Display', serif";

/* Type on pinned espresso. The on-inverse ink family has no member at these
   alphas and no token can express an alpha of a token, so the alpha is spelled
   out and the hue is not. Same treatment the Ledger's pulse hero uses. */
const ON_ESPRESSO = {
  dim: "rgba(255,253,249,0.55)",
  tagline: "rgba(255,253,249,0.78)",
  control: "rgba(255,253,249,0.85)",
  pill: "rgba(255,253,249,0.9)",
  cellLabel: "rgba(255,253,249,0.5)",
} as const;

export function EveningWrapScreen({
  stage = "ready",
  data,
}: {
  stage?: WrapStage;
  /** The gated fixture, or null when no source exists. Never defaulted. */
  data: EveningWrapData | null;
}) {
  const [closeOpen, setCloseOpen] = useState(false);
  const [bannerShown, setBannerShown] = useState(true);

  /* NO GUTTER ON THE ROOT, and that is the load-bearing part.
     The prototype's `#v3phone` (line 247) carries no padding; every gutter on
     this screen is drawn by the block that needs it, and the ticker and the
     masthead deliberately have none. `parity_harness.py:1062` injects a
     `padding:0 var(--v3-pad)` onto the phone that the real file does not have,
     so the design side of a 390 parity run measures a 310px text column
     against this screen's correct 350. Matching the harness here would ship
     the wrap 40px too narrow to satisfy a measuring bug. Run the harness at
     --width 430 instead: 430 minus the injected gutter is 390, and both sides
     then measure 350. */
  /* No source, no screen. See the note on `LedgerScreen`: the fixture used to
     arrive here as a DEFAULT PARAMETER, so this screen rendered invented index
     levels, an invented 4:35 close and a fabricated CALL-0413 the moment the
     mount gate above it was deleted. Early return, so below this line `data`
     is non-null and no later edit can reintroduce it by omission. */
  if (data === null) {
    return (
      <div data-parity="evening" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
        <MobileTickerStrip />
        <WrapSkeleton />
      </div>
    );
  }

  return (
    <div data-parity="evening" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
      {/* Built once, in src/components/ledger, and imported here. The barrel
          says so in a comment: the design carries one ticker, not two. */}
      <MobileTickerStrip />
      {bannerShown ? <PersonalizationBanner data={data} onDismiss={() => setBannerShown(false)} /> : null}

      {stage === "loading" ? <WrapSkeleton /> : null}
      {stage === "none" ? <WrapNone /> : null}
      {stage === "error" ? <WrapError /> : null}

      {stage === "ready" || stage === "stale" ? (
        <div className={motion.enter} style={{ padding: `0 ${PAD} 26px` }}>
          <Masthead data={data} />
          <StatsBar data={data} />
          <DateRule data={data} />
          <p style={{ margin: "9px 0 0", font: "400 12.5px/1.5 Inter, sans-serif", color: "var(--c-secondary)" }}>
            {data.tagline}
          </p>

          {stage === "stale" ? <StaleNotice data={data} /> : null}

          <CloseHero data={data} />

          <p style={{ margin: "18px 0 0", font: `400 17px/1.55 ${PLAYFAIR}`, color: "var(--c-ink)", textWrap: "pretty" }}>
            {data.close.lede}
          </p>
          {/* Keyed by position, not by content. A prefix of the paragraph is
              not unique: two paragraphs that open with the same clause collide
              and React drops one of them. The list is append-only and never
              reordered, so the index is the stable identity here. */}
          {data.close.body.slice(0, CLOSE_VISIBLE_PARAGRAPHS).map((b, i) => (
            <p key={i} style={{ margin: `${i === 0 ? 12 : 11}px 0 0`, font: "400 var(--v3-body)/var(--v3-lead) Inter, sans-serif", color: "var(--c-body)", textWrap: "pretty" }}>
              {b}
            </p>
          ))}
          {closeOpen ? (
            <div className={motion.enter}>
              {data.close.body.slice(CLOSE_VISIBLE_PARAGRAPHS).map((b, i) => (
                <p key={i} style={{ margin: "11px 0 0", font: "400 var(--v3-body)/var(--v3-lead) Inter, sans-serif", color: "var(--c-body)", textWrap: "pretty" }}>
                  {b}
                </p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCloseOpen((v) => !v)}
            aria-expanded={closeOpen}
            className={motion.bare}
            style={{
              marginTop: "12px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              font: "600 12.5px/1 Inter, sans-serif",
              color: "var(--c-goldink)",
            }}
          >
            {closeOpen ? "Less" : "Read the full close"}
          </button>

          <SectionRule label={"this morning's calls"} />
          <ReviewedCall data={data} />
          <div
            style={{
              marginTop: "10px",
              padding: "13px 15px",
              border: "1px solid var(--c-border)",
              borderRadius: "12px",
              backgroundColor: "var(--c-surface)",
            }}
          >
            <p style={{ margin: 0, font: "400 12.5px/1.55 Inter, sans-serif", color: "var(--c-body)" }}>
              {data.reviewedRest}
            </p>
          </div>

          <SectionRule label={"today's top stories"} />
          <p style={{ margin: "11px 0 0", font: "400 var(--v3-body)/var(--v3-lead) Inter, sans-serif", color: "var(--c-body)", textWrap: "pretty" }}>
            {data.stories.lede}
          </p>
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column" }}>
            {data.stories.movers.map((m, i) => (
              <MoverRow key={m.symbol} mover={m} last={i === data.stories.movers.length - 1} />
            ))}
          </div>

          <div style={{ marginTop: "22px", height: "1px", backgroundColor: "var(--c-border)" }} />
          {/* The wrap states its next event and offers no link to it. The
              Ledger's date rule links here and states no time. That asymmetry
              is DECISIONS.md O2, recorded as a design defect and reproduced
              rather than resolved. */}
          <p style={{ margin: "16px 0 0", font: `400 15px/1.6 ${PLAYFAIR}`, color: "var(--c-ink)", textWrap: "pretty" }}>
            {data.nextEvent}
          </p>
          <div style={{ height: "calc(24px + env(safe-area-inset-bottom))" }} />
        </div>
      ) : null}
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

/**
 * The complete-profile variant of the personalization banner, which github.md
 * ports onto this screen and NOT onto the Dashboard.
 *
 * The risk-appetite chip the source component pushes into the same array
 * (`PersonalizationBanner.tsx:92`) is deliberately absent: ruling 7a not
 * ported. The source's 8px badge is not reproduced either; these are 10px,
 * which is the floor.
 *
 * The dismiss control is 32px of drawn box inside 6px of content-box padding,
 * so it measures 44 and a negative margin keeps it where the design put it.
 * The design's own control measures 32 and would fail the tap-target rule.
 */
function PersonalizationBanner({ data, onDismiss }: { data: EveningWrapData; onDismiss: () => void }) {
  return (
    <div
      style={{
        margin: `10px ${PAD} 0`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "8px 12px",
        borderRadius: "12px",
        border: "1px solid var(--c-border)",
        backgroundColor: "var(--c-well)",
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
        <span style={{ font: "400 11px/1 Inter, sans-serif", color: "var(--c-muted)", whiteSpace: "nowrap" }}>
          Personalized for:
        </span>
        {data.sectors.map((s) => (
          <span
            key={s}
            style={{
              display: "inline-block",
              padding: "3px 7px",
              borderRadius: "4px",
              backgroundColor: "var(--c-well)",
              border: "1px solid var(--c-border)",
              font: "600 10px/1.35 Inter, sans-serif",
              color: "var(--c-secondary)",
            }}
          >
            {s}
          </span>
        ))}
        <Link
          href="/settings/preferences"
          className={motion.bare}
          style={{
            boxSizing: "content-box",
            display: "inline-flex",
            alignItems: "center",
            minHeight: "12px",
            padding: "16px 0",
            margin: "-16px 0",
            font: "500 11px/1 Inter, sans-serif",
            color: "var(--c-secondary)",
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
        >
          Edit →
        </Link>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={motion.bare}
        style={{
          boxSizing: "content-box",
          flex: "none",
          width: "32px",
          height: "32px",
          padding: "6px",
          margin: "-6px",
          display: "flex",
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

/**
 * The masthead band. Full bleed, pulled back out of the content padding.
 *
 * Solid espresso with no gradient. github.md RETRACTED the interim px-stop
 * treatment because it drew a 10px gold bar down the band's left edge, which
 * is a coloured left border, and the source's percentage stops put every line
 * of type inside the gold stop at 390px, where cream measures 2.18:1.
 */
function Masthead({ data }: { data: EveningWrapData }) {
  return (
    <div style={{ margin: `0 calc(-1 * ${PAD})`, backgroundColor: "var(--c-inverse)", padding: `11px ${PAD} 12px` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <span style={{ display: "inline-flex", font: `700 19px/1 ${PLAYFAIR}`, letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
          Signal<span style={{ color: "var(--c-oninv-gold)" }}>era</span>
        </span>
        {/* The only in-surface exit this screen has. A real anchor, because on
            a surface with no tab bar a no-op here would be a dead end. */}
        <Link
          href="/ledger"
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            font: "500 12px/1 Inter, sans-serif",
            color: ON_ESPRESSO.control,
            textDecoration: "none",
          }}
        >
          Ledger →
        </Link>
      </div>
      <div style={{ marginTop: "9px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `700 19px/1.1 ${PLAYFAIR}`, letterSpacing: "-0.01em", color: "var(--c-oninv)" }}>
            Evening Wrap
          </div>
          <div style={{ marginTop: "4px", font: `400 italic 12.5px/1.3 ${PLAYFAIR}`, color: ON_ESPRESSO.tagline }}>
            {data.tagline}
          </div>
        </div>
        <span
          style={{
            flex: "none",
            background: "rgba(255,253,249,0.15)",
            color: ON_ESPRESSO.pill,
            padding: "4px 9px",
            borderRadius: "14px",
            font: "600 10px/1 Inter, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          {data.readMinutes} min read
        </span>
      </div>
    </div>
  );
}

/**
 * The stats band. One anatomy across every cell, per DECISIONS.md ruling 10:
 * Inter 700 labels in --c-muted, mono values.
 *
 * The design's per-cell skeleton is not reproduced. The prototype binds it to
 * `statLoading: s.briefStage === 'loading'`, which is the Morning Brief's
 * lifecycle, while the whole band sits inside `wrapReady`. The two can never
 * be true at once, so the branch is unreachable in the design as drawn.
 */
function StatsBar({ data }: { data: EveningWrapData }) {
  return (
    <div
      style={{
        margin: `0 calc(-1 * ${PAD})`,
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
        <span key={s.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ font: "700 10px/1 Inter, sans-serif", color: "var(--c-muted)" }}>{s.label}</span>
          <span
            style={{
              font: `700 12px/1 ${MONO}`,
              color:
                s.tone === "calm"
                  ? "var(--c-greenink)"
                  : s.tone === "stress"
                    ? "var(--c-redink)"
                    : "var(--c-ink)",
            }}
          >
            {s.value}
          </span>
        </span>
      ))}
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)" }}>
        <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--c-muted)" }} />
        CLOSED
      </span>
    </div>
  );
}

function DateRule({ data }: { data: EveningWrapData }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "2px 0 0" }}>
      <span style={{ font: `400 italic 13px/1 ${PLAYFAIR}`, color: "var(--c-secondary)" }}>{data.dateline}</span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      <span style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)" }}>CLOSED</span>
    </div>
  );
}

/**
 * The Close. The hero and its six-up scorecard.
 *
 * The prose does NOT live inside the card. github.md's structural deviation
 * splits it: the hero keeps the stamp and the verdict at a fixed height and
 * the narrative moves below onto cream, first sentence as a Playfair lede,
 * everything past the second paragraph behind the toggle.
 */
function CloseHero({ data }: { data: EveningWrapData }) {
  const c = data.close;
  return (
    <div className={motion.rise} style={{ marginTop: "16px", borderRadius: "14px", backgroundColor: "var(--c-inverse)", overflow: "hidden", position: "relative" }}>
      {/* The corner glow. A 220px circle pulled 70px past the top right, so
          only its bright inner quarter lands on the card. The design writes the
          gold as --c-gold's own value with an eight-bit alpha suffix, which
          resolves to the 0.376 below. No token expresses an alpha of a token. */}
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
      <div style={{ position: "relative", padding: "18px 16px 15px" }}>
        <div style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: ON_ESPRESSO.dim }}>{c.stampedAt}</div>
        <p style={{ margin: "13px 0 0", font: `800 25px/1.24 ${PLAYFAIR}`, letterSpacing: "-0.025em", color: "var(--c-oninv)" }}>
          The market closed{" "}
          <span
            style={{
              backgroundColor: "var(--c-gold)",
              color: "var(--c-ongold)",
              padding: "1px 11px",
              borderRadius: "9px",
              display: "inline-block",
              transform: "rotate(-1deg)",
              boxShadow: "0 4px 0 rgba(0,0,0,0.15)",
            }}
          >
            {c.verdict}
          </span>
          .
        </p>
      </div>
      <div
        style={{
          position: "relative",
          margin: "0 16px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0,
          backgroundColor: "rgba(255,253,249,0.05)",
          border: "1px solid rgba(212,168,75,0.2)",
          borderRadius: "9px",
          overflow: "hidden",
        }}
      >
        {c.scorecard.map((cell, i) => (
          <ScorecardTile
            key={cell.label}
            cell={cell}
            column={i % 3}
            row={Math.floor(i / 3)}
            lastRow={Math.floor((c.scorecard.length - 1) / 3)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One scorecard cell. The rules between cells are drawn on the trailing and
 * bottom edges only, so no cell carries a coloured rule on its leading edge.
 *
 * The bottom rule is read off the grid's own last row rather than hardcoded to
 * the first, so a loader that answers with anything other than six cells still
 * draws a rule between every pair of rows and none under the last one.
 */
function ScorecardTile({
  cell,
  column,
  row,
  lastRow,
}: {
  cell: ScorecardCell;
  column: number;
  row: number;
  lastRow: number;
}) {
  return (
    <div
      style={{
        backgroundColor: "var(--c-inverse)",
        padding: "11px 12px",
        borderRight: column < 2 ? "1px solid rgba(212,168,75,0.15)" : undefined,
        borderBottom: row < lastRow ? "1px solid rgba(212,168,75,0.15)" : undefined,
      }}
    >
      <div style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: ON_ESPRESSO.cellLabel }}>{cell.label}</div>
      <div style={{ marginTop: "6px", font: `600 14px/1 ${MONO}`, color: "var(--c-oninv)" }}>{cell.value}</div>
      <div
        style={{
          marginTop: "4px",
          font: `600 10.5px/1 ${MONO}`,
          color: cell.tone === "up" ? "var(--c-inv-green)" : "var(--c-inv-red)",
        }}
      >
        {cell.direction === "up" ? "▲" : "▼"}
        {cell.move}
      </div>
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div style={{ marginTop: "22px", display: "flex", alignItems: "center", gap: "11px" }}>
      <span style={{ font: `400 italic 12.5px/1 ${PLAYFAIR}`, color: "var(--c-secondary)" }}>{label}</span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
    </div>
  );
}

/**
 * The one call the desk revisited after the bell.
 *
 * The reading is `ClaimAnatomy` at row scale, consumed rather than rebuilt.
 * Two measured deltas against the design, both sub-pixel and both accepted so
 * this screen does not fork the shared anatomy: the design draws the claim at
 * 15.5px against the anatomy's 15px, and the reasoning at a 1.55 leading
 * against its 1.5. A third scale would be a branch inside a component the
 * skill says gets a wrapper beside it instead, which is what this is.
 *
 * The card carries a 2px amber top edge and no state dot or state word. That
 * is the design as drawn, and it is a partial application of the state
 * anatomy the standing brief describes. Reported, not silently corrected: the
 * eyebrow says what the evidence did tonight, and nothing settled today, so
 * none of the four outcome states applies to it yet.
 */
function ReviewedCall({ data }: { data: EveningWrapData }) {
  const r = data.reviewed;
  return (
    <div style={{ marginTop: "12px", border: "1px solid var(--c-border)", borderRadius: "12px", backgroundColor: "var(--c-card)", overflow: "hidden" }}>
      <div aria-hidden="true" style={{ height: "2px", backgroundColor: "var(--c-amber)" }} />
      {/* Disabled, not merely handler-less. TODO(PR #643): this opens Review,
          which is HELD and has no route.

          The earlier version was a real <button type="button"> carrying
          `.bare`, which sets `cursor: pointer`, with `onClick={() => {}}` and
          no `disabled`. Keyboard reached it, assistive technology announced a
          button, the pointer said it was live, and pressing it did nothing.
          That is exactly the defect the handoff README names at line 309: a
          cursor:pointer element with no handler. The affordance is now closed
          in every channel it was open in, and the line under the card says so
          in words rather than leaving it to a dimmed pixel.

          The container owns the rhythm, as the entry row does: the anatomy at
          row scale sets no margins, so the 9px between its three slots is a
          gap on the frame rather than a margin inside the primitive. */}
      <button
        type="button"
        disabled
        aria-describedby="evening-reviewed-inert"
        className={motion.bare}
        style={{ width: "100%", textAlign: "left", padding: "14px 15px", display: "flex", flexDirection: "column", gap: "9px", cursor: "default" }}
      >
        <ClaimAnatomy
          scale="row"
          lead={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <span style={{ font: "600 11px/1 Inter, sans-serif", color: "var(--c-amberink)" }}>{r.note}</span>
              <span style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)" }}>{r.id}</span>
            </div>
          }
          claim={r.claim}
          prose={r.reasoning}
        />
      </button>
      <p
        id="evening-reviewed-inert"
        style={{ margin: 0, padding: "0 15px 12px", font: "400 11px/1.4 Inter, sans-serif", color: "var(--c-muted)", textWrap: "pretty" }}
      >
        The review screen is not built yet, so this card does not open.
      </p>
    </div>
  );
}

function MoverRow({ mover, last }: { mover: EveningMover; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "12px 0",
        borderTop: "1px solid var(--c-hair)",
        borderBottom: last ? "1px solid var(--c-hair)" : undefined,
      }}
    >
      <span style={{ flex: "none", width: "46px", font: `500 10.5px/1.5 ${MONO}`, letterSpacing: "0.045em", color: "var(--c-muted)" }}>
        {mover.symbol}
        <br />
        {mover.move}
      </span>
      <p style={{ margin: 0, minWidth: 0, flex: 1, font: "400 13px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {mover.headline}
      </p>
    </div>
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

function WrapSkeleton() {
  return (
    <div style={{ padding: `16px ${PAD} 26px` }} aria-busy="true" aria-label="Synthesising the close">
      <div className={motion.sk} style={{ width: "70%", height: "30px" }} />
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className={motion.sk} style={{ height: "12px" }} />
        <div className={motion.sk} style={{ height: "12px" }} />
        <div className={motion.sk} style={{ width: "58%", height: "12px" }} />
      </div>
      <div className={motion.sk} style={{ marginTop: "22px", width: "100%", height: "190px", borderRadius: "14px" }} />
      <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className={motion.sk} style={{ height: "78px", borderRadius: "12px" }} />
        <div className={motion.sk} style={{ height: "78px", borderRadius: "12px" }} />
      </div>
      <p style={{ margin: "22px 0 0", font: `400 11px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)", textAlign: "center" }}>
        SYNTHESISING THE CLOSE
      </p>
    </div>
  );
}

/**
 * No wrap published. The copy asserts that nothing failed to load, which is
 * only honest because this branch is now separate from the error branch below.
 * See the PR body: the desktop page cannot currently tell the two apart.
 *
 * It takes no `data`, on purpose. There is no wrap on this branch, so there is
 * no payload to read a publication time or a review count out of, and a prop
 * the component cannot honestly use is an invitation to interpolate one.
 */
function WrapNone() {
  return (
    <div
      className={motion.enter}
      style={{ padding: `0 ${PAD} 26px`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: "60dvh" }}
    >
      <span style={{ width: "52px", height: "52px", borderRadius: "50%", backgroundColor: "var(--c-well)", border: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--c-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
        </svg>
      </span>
      <p style={{ margin: "18px 0 0", font: `700 20px/1.25 ${PLAYFAIR}`, color: "var(--c-ink)" }}>
        No evening wrap available
      </p>
      {/* Two removals, both the mobile-build rule from PR #661.
          "Anything reviewed today is already on your record" is a sentence
          about the reader's own record stated on the branch that established
          only that no wrap exists. And the publication time came from
          `data.publishesAt`, which on the empty branch is whatever object the
          caller happened to pass; with no wrap there is no payload to read a
          time out of, so an interpolated 4:35 would be invented precision. The
          copy now says the one thing this branch actually knows. */}
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)", maxWidth: "32ch", textWrap: "pretty" }}>
        Nothing failed to load. The wrap publishes after the close.
      </p>
      {/* Disabled, not merely handler-less. TODO(PR #643 sibling units): the
          record screen is step 6 and has no route yet.

          Same defect shape as the revisited-call card above and fixed the same
          way. It was a real button carrying `.bare`, so it announced as a
          button, took focus and showed a pointer, with `onClick={() => {}}`
          behind it. It is now closed in every one of those channels, drawn in
          the chrome border rather than the ink one so the closed state is
          visible and not only announced, and the line below says why. */}
      <button
        type="button"
        disabled
        aria-describedby="evening-record-inert"
        className={motion.bare}
        style={{ marginTop: "18px", minHeight: "46px", display: "inline-flex", alignItems: "center", padding: "0 18px", border: "1px solid var(--c-chrome-border)", borderRadius: "9px", font: "600 13px/1 Inter, sans-serif", color: "var(--c-secondary)", cursor: "default" }}
      >
        Open your record
      </button>
      <p
        id="evening-record-inert"
        style={{ margin: "9px 0 0", font: "400 11px/1.4 Inter, sans-serif", color: "var(--c-muted)", maxWidth: "32ch", textWrap: "pretty" }}
      >
        The record screen is not built yet, so this control does not open.
      </p>
    </div>
  );
}

/**
 * A failed read, told apart from an absent wrap. THIS SCREEN'S OWN, and the
 * answer to open question 1 in briefs/batch-1.md.
 *
 * The design has no error branch: README's state table gives `wrapStage` as
 * `null | 'loading' | 'none'` and the desktop page swallows the fetch error at
 * `evening-wrap/page.tsx:436` and falls through to `!briefing`. So a failed
 * read renders the empty state, whose copy asserts "Nothing failed to load."
 * On a product whose claim is that nothing is curated away, that is a trust
 * failure rather than a missing nicety. The state is added here, costing no
 * change to `src/app/api/briefing/route.ts`: whichever branch a loader picks
 * is the loader's call, and the screen can now draw both.
 */
function WrapError() {
  return (
    <div className={motion.enter} style={{ padding: `18px ${PAD} 26px` }} role="alert">
      <p style={{ margin: 0, font: `500 17px/1.4 ${PLAYFAIR}`, color: "var(--c-ink)" }}>
        We could not load the evening wrap.
      </p>
      {/* No sentence about the reader or their record. The earlier copy closed
          on "anything reviewed today is already on your record", which is a
          claim about the reader's own history made on the one branch that has
          established nothing came back. That is the rule from PR #661, and it
          outranks matching the design. What survives is a claim about this
          screen only: the read failed, and it is not the same thing as an
          empty result. */}
      <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)", maxWidth: "32ch", textWrap: "pretty" }}>
        This is a failed read, not an empty result. Nothing is being hidden.
      </p>
      {/* A real retry, not a drawn one.
          Retrying a failed read costs nothing here because the screen keeps no
          unsaved state, so a full document reload is a complete retry rather
          than a stand-in for one. This is the only one of the
          three controls on this screen that can succeed today, which is why it
          is wired and the other two are visibly closed. */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={motion.bare}
        style={{ marginTop: "14px", minHeight: "44px", display: "inline-flex", alignItems: "center", padding: "0 17px", border: "1px solid var(--c-ink)", borderRadius: "9px", font: "600 13px/1 Inter, sans-serif", color: "var(--c-ink)" }}
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Reading a previous session's wrap. THIS SCREEN'S OWN.
 *
 * No stale branch exists for the wrap in the prototype, in README's state
 * table, or in the desktop page. The nearest real thing in the repo is
 * `isCurrentSession` at `evening-wrap/page.tsx:656`, which already gates live
 * quotes on whether the wrap being read covers the current session. Once that
 * is false the scorecard is a persisted tape rather than a live one, and the
 * screen should say so instead of drawing yesterday's numbers as today's.
 * Drawn in the amber well the Ledger's own stale notice uses.
 */
function StaleNotice({ data }: { data: EveningWrapData }) {
  return (
    <div style={{ marginTop: "14px", border: "1px solid var(--c-amber-edge)", backgroundColor: "var(--c-amber-well)", borderRadius: "12px", padding: "13px 14px" }}>
      <div style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>
        You are reading an earlier session.
      </div>
      {/* "Your review dates are unaffected" is gone, same rule as the other
          two states: it is a sentence about the reader's own record, and this
          branch knows only which session the wrap in hand covers. What is left
          describes the tape on this screen and nothing else. */}
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {`This wrap covers ${data.coversSession}. The tape below is the close that was persisted then, not a live quote.`}
      </div>
    </div>
  );
}
