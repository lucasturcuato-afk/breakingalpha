"use client";

import type { CSSProperties, ReactNode } from "react";

import { BackHeader, SectionRule, TabBarClearance } from "@/components/mobile";
import { ToggleSwitch } from "@/components/mobile/toggle-switch";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import styles from "@/components/mobile/mobile.module.css";

/**
 * `/watchlist/[identifier]`, on a phone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO PROTOTYPE DRAWS THIS SCREEN, so the shape below is a decision rather than
 * a port. `python3 scripts/parity_harness.py --list` names thirty-one flags and
 * none of them is this route: `company` is Company Intel, `story` is one
 * article, `trends` is the trend cluster. There is no `data-parity` attribute
 * on this root for the same reason, because there is nothing to be at parity
 * with, and announcing a target that does not exist would be a false claim to
 * every audit script that reads the attribute.
 *
 * WHAT THE SCREEN IS FOR, in one sentence, decided after reading what the route
 * actually renders rather than from its name: it is the one place a reader can
 * stand on a single name they already track and act on it, reading what has
 * been written about it, asking for a brief, setting what they want to be told
 * about, and keeping their own note.
 *
 * THE ORDER IS THE DESK'S ORDER AND IS NOT REARRANGED. Brief, alerts, coverage,
 * note. The alert control is the primary action on this screen and the reason
 * this unit exists, but the fix for a control under fixed furniture is
 * clearance, not promotion: moving it would change what the screen says is
 * important, which is a redesign of meaning rather than of layout.
 *
 * THE REGISTER IS THE SHIPPED MOBILE ONE, not a third idiom. `BackHeader` and
 * `SectionRule` are the shared chrome the Company Intel screen and the settings
 * batch already draw; `ToggleSwitch` is the repo's only switch primitive and is
 * what `/settings/alerts` renders; the card is the `WatchlistCard` anatomy from
 * `/watch` at 12px on `--c-card`; the type ladder is Playfair for names, Inter
 * for prose, mono for tickers and figures, at the sizes those screens use.
 *
 * WHAT IS DELIBERATELY NOT PORTED FROM THE DESK, both recorded in the PR body:
 *
 *   the coloured left border   The desk draws the price card with a 4px left
 *                              border tinted by the day's direction. Rule 6 of
 *                              scripts/design-lint.mjs forbids a coloured left
 *                              border outright. The direction is carried by the
 *                              figure's own ink instead, which is where every
 *                              other mobile screen carries it.
 *   the faded teaser gate      Signed out, the desk stacks a clipped card under
 *                              a `linear-gradient` fade. Rule 6 forbids surface
 *                              gradients. The signed-out notice below says the
 *                              same thing in words and offers the same control.
 *
 * AND THE CLUSTER DISCLOSURE IS OPEN RATHER THAN A CONTROL. The desk wraps a
 * story's other sources in `MoreSourcesDisclosure`, whose trigger measures 20px
 * tall against a 44px floor and whose palette is desk Tailwind with literal
 * hex. Neither editing that shared component nor writing a second disclosure
 * beside it is this unit's to do, so the other sources are simply drawn, each
 * with its own 44px control. No action is lost and none is added; the sources
 * arrive in fewer taps.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PAD = "var(--v3-pad)";

/** The mode a new alert is being written in. The stored ids, passed through. */
export type AlertKind = "percent_change" | "price_above" | "price_below";

export const ALERT_KINDS: { id: AlertKind; label: string }[] = [
  { id: "percent_change", label: "% move" },
  { id: "price_above", label: "Above $" },
  { id: "price_below", label: "Below $" },
];

/**
 * One saved alert, ALREADY WORDED. The screen is handed `kindLabel` and
 * `valueLabel` rather than the stored row, so no reader-facing string on this
 * surface is assembled from a database column here and the two surfaces cannot
 * word the same alert two ways.
 */
export interface AlertRow {
  id: string;
  kindLabel: string;
  valueLabel: string;
  enabled: boolean;
}

export interface CoverageSource {
  id: string;
  title: string;
  source?: string;
  url?: string;
  when?: string | null;
}

export interface CoverageStory {
  id: string;
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  when?: string | null;
  tags: string[];
  others: CoverageSource[];
}

/**
 * The reader, as three states and never as a boolean.
 *
 * `"pending"` is the auth call still in flight, and it is NOT signed out. The
 * desk resolves the same three off `user === undefined | null | object`; a
 * boolean prop here would collapse the first two and draw the signed-out notice
 * for a moment on every load for a reader who is signed in.
 */
export type Reader = "pending" | "in" | "out";

export interface WatchlistDetailScreenProps {
  identifier: string;
  displayName: string | null;
  /** "ticker", "company" or "sector". The desk's own word for the row. */
  kind: string;
  reader: Reader;
  onSignIn: (headline: string, message: string) => void;

  /* Tape */
  quote: { price: string; pct: number } | null;
  quoteRefreshing: boolean;
  onRefreshQuote: () => void;

  /* Brief */
  loading: boolean;
  storyCount: number;
  cachedBriefAge: string | null;
  hasCachedBrief: boolean;
  briefAge: string | null;
  onOpenBrief: () => void;
  onRedoBrief: () => void;
  onExport: () => void;

  /* Alerts */
  alertsShown: boolean;
  alertsLoading: boolean;
  alerts: AlertRow[];
  alertsFull: boolean;
  alertKind: AlertKind;
  onAlertKind: (next: AlertKind) => void;
  alertAmount: string;
  onAlertAmount: (next: string) => void;
  alertSubmitting: boolean;
  alertFailed: boolean;
  onAddAlert: () => void;
  onToggleAlert: (id: string, next: boolean) => void;
  onDeleteAlert: (id: string) => void;

  /* Coverage */
  stories: CoverageStory[];
  storiesShown: number;
  sortMode: "newest" | "relevant";
  onSortMode: (next: "newest" | "relevant") => void;
  updatedAgo: string | null;
  onStoryMemo: (id: string) => void;

  /* Note */
  noteOpen: boolean;
  onNoteOpen: (next: boolean) => void;
  noteLoading: boolean;
  noteBlocked: boolean;
  noteText: string;
  onNoteText: (next: string) => void;
  onNoteSave: () => void;
  noteSaved: boolean;
}

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

const CARD: CSSProperties = {
  padding: "13px 14px",
  border: "1px solid var(--c-border)",
  borderRadius: "12px",
  backgroundColor: "var(--c-card)",
};

/** The 44px well the design gives a primary action. Radius 9, the button one. */
function PrimaryButton({
  label,
  onClick,
  disabled,
  busy,
  tone = "solid",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "solid" | "quiet";
}) {
  const solid = tone === "solid";
  const dead = disabled || busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={dead}
      aria-disabled={dead}
      aria-busy={busy || undefined}
      style={{
        appearance: "none",
        border: solid ? 0 : "1px solid var(--c-border)",
        margin: 0,
        padding: "0 16px",
        width: "100%",
        minHeight: "46px",
        borderRadius: "9px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `600 13px/1 ${FONT_SANS}`,
        /* `--c-inverse` and never `--c-ink` for a filled control. The two are
           byte-identical in light and resolve to the SAME value in dark, where
           `--c-ink` filled with `--c-oninv` ink measures 1.00:1 against itself.
           The same finding is written out at `commit-sheet.tsx:285`. */
        backgroundColor: dead
          ? "var(--c-locked-bg)"
          : solid
            ? "var(--c-inverse)"
            : "transparent",
        color: dead ? "var(--c-locked-ink)" : solid ? "var(--c-oninv)" : "var(--c-ink)",
        cursor: dead ? "not-allowed" : "pointer",
      }}
    >
      {busy ? "Working" : label}
    </button>
  );
}

/** A mode chip. Same anatomy as the section chips on Company Intel. */
function ModeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={styles.bare}
      style={{
        flex: "1 1 auto",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 10px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        border: active ? "1px solid var(--c-ink)" : "1px solid var(--c-border)",
        font: active ? `600 12px/1 ${FONT_SANS}` : `500 12px/1 ${FONT_SANS}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

/** A line of prose in the screen's body voice. */
function Line({ children, top = 10 }: { children: ReactNode; top?: number }) {
  return (
    <p
      style={{
        margin: `${top}px 0 0`,
        font: `400 13px/1.6 ${FONT_SANS}`,
        color: "var(--c-secondary)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/** A shimmer bar, for a read that is still in flight. */
function Bar({ h, top }: { h: number; top: number }) {
  return (
    <div
      aria-hidden="true"
      className={styles.sk}
      style={{ marginTop: `${top}px`, height: `${h}px`, borderRadius: "6px" }}
    />
  );
}

/* ------------------------------------------------------------------ */

export function WatchlistDetailScreen(props: WatchlistDetailScreenProps) {
  const {
    identifier,
    displayName,
    kind,
    reader,
    onSignIn,
    quote,
    quoteRefreshing,
    onRefreshQuote,
    loading,
    storyCount,
    cachedBriefAge,
    hasCachedBrief,
    briefAge,
    onOpenBrief,
    onRedoBrief,
    onExport,
    alertsShown,
    alertsLoading,
    alerts,
    alertsFull,
    alertKind,
    onAlertKind,
    alertAmount,
    onAlertAmount,
    alertSubmitting,
    alertFailed,
    onAddAlert,
    onToggleAlert,
    onDeleteAlert,
    stories,
    storiesShown,
    sortMode,
    onSortMode,
    updatedAgo,
    onStoryMemo,
    noteOpen,
    onNoteOpen,
    noteLoading,
    noteBlocked,
    noteText,
    onNoteText,
    onNoteSave,
    noteSaved,
  } = props;

  const isSector = kind === "sector";
  const amountReady = alertAmount.trim() !== "" && parseFloat(alertAmount) > 0;
  const visible = stories.slice(0, storiesShown);
  const gated = reader === "out" && stories.length > storiesShown;

  return (
    <div
      data-watchlist-detail=""
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* A DESTINATION, so it keeps its name and is not history-aware. The desk
          control this replaces pushes `/radar/watchlist` unconditionally, and
          the rule in `screen-chrome.tsx` is that a control promising a place
          goes on promising it. */}
      <BackHeader href="/radar/watchlist" label="Watchlist" />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          /* The design's 24px. The tab bar is reserved by `TabBarClearance`
             below, which is the repo's one owner of that rule; nothing here
             adds a second reservation and nothing here writes 59. */
          padding: `20px ${PAD} 24px`,
        }}
      >
        {/* ── Masthead ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ font: `500 12px/1 ${FONT_MONO}`, color: "var(--c-muted)" }}>
            {identifier}
          </span>
          <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
            {kind}
          </span>
        </div>
        <h1
          style={{
            margin: "11px 0 0",
            font: `700 26px/1.14 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {displayName ?? identifier}
        </h1>

        {/* ── Tape ─────────────────────────────────────────────────── */}
        {!isSector && (
          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
            {quote ? (
              <>
                <span style={{ font: `600 22px/1 ${FONT_MONO}`, color: "var(--c-ink)" }}>
                  ${quote.price}
                </span>
                <span
                  style={{
                    font: `600 14px/1 ${FONT_MONO}`,
                    color: quote.pct >= 0 ? "var(--c-greenink)" : "var(--c-redink)",
                  }}
                >
                  {quote.pct >= 0 ? "+" : ""}
                  {quote.pct}%
                </span>
                <span style={{ font: `400 10.5px/1.3 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                  as of market close
                </span>
              </>
            ) : loading ? (
              <Bar h={22} top={0} />
            ) : (
              <span style={{ font: `400 13px/1.4 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                Price unavailable
              </span>
            )}
            {quote && (
              /* 44px of target from content-box padding plus a compensating
                 negative margin, so the drawn control keeps its size and the
                 tape row keeps its rhythm. */
              <button
                type="button"
                onClick={onRefreshQuote}
                disabled={quoteRefreshing}
                aria-label="Refresh price"
                className={styles.bare}
                style={{
                  boxSizing: "content-box",
                  marginLeft: "auto",
                  minWidth: "22px",
                  minHeight: "22px",
                  padding: "11px",
                  margin: "-11px -11px -11px auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: `600 11px/1 ${FONT_SANS}`,
                  color: "var(--c-goldink)",
                  opacity: quoteRefreshing ? 0.5 : 1,
                  cursor: quoteRefreshing ? "not-allowed" : "pointer",
                }}
              >
                Refresh
              </button>
            )}
          </div>
        )}

        {/* ── Signed out ───────────────────────────────────────────── */}
        {reader === "out" && (
          <div style={{ ...CARD, marginTop: "16px" }}>
            <p style={{ margin: 0, font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-body)", textWrap: "pretty" }}>
              You are looking at a preview. Sign in to track {identifier} and see the whole of it.
            </p>
            <button
              type="button"
              onClick={() =>
                onSignIn(
                  `Track ${identifier}`,
                  `Add ${identifier} to your watchlist and get its coverage and alerts.`,
                )
              }
              className={styles.bare}
              style={{
                boxSizing: "content-box",
                marginTop: "8px",
                minHeight: "16px",
                padding: "14px 0",
                marginBottom: "-14px",
                display: "inline-flex",
                alignItems: "center",
                font: `600 12.5px/1 ${FONT_SANS}`,
                color: "var(--c-goldink)",
              }}
            >
              Sign in
            </button>
          </div>
        )}

        {/* ── Brief ────────────────────────────────────────────────── */}
        <SectionRule label="Brief" marginTop="26px" />
        {loading ? (
          <Bar h={46} top={12} />
        ) : storyCount === 0 ? (
          <>
            <Line>
              No recent coverage for {identifier} in our corpus, and the brief is written from
              coverage, so there is nothing to write one from yet.
            </Line>
            <Line top={6}>Coverage lands after the next pipeline run, 6am and 8pm ET on weekdays.</Line>
          </>
        ) : (
          <>
            {hasCachedBrief ? (
              <>
                <Line top={12}>
                  A brief for {identifier} is on file{cachedBriefAge ? `, written ${cachedBriefAge}` : ""}.
                </Line>
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <PrimaryButton label="Read the brief" onClick={onOpenBrief} />
                  <PrimaryButton label="Write it again" onClick={onRedoBrief} tone="quiet" />
                </div>
              </>
            ) : (
              <>
                <Line top={12}>
                  A research note on {identifier}, written from the {storyCount}{" "}
                  {storyCount === 1 ? "story" : "stories"} below: what the company is, what has
                  moved, what to watch. AI-generated, and not financial advice.
                </Line>
                <div style={{ marginTop: "12px" }}>
                  <PrimaryButton
                    label={briefAge === null ? "Write the brief" : "Write it again"}
                    onClick={onOpenBrief}
                  />
                </div>
                {briefAge !== null && (
                  <p style={{ margin: "8px 0 0", font: `400 11px/1.5 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                    Last written {briefAge}.
                  </p>
                )}
              </>
            )}
            {!isSector && (
              <div style={{ marginTop: "10px" }}>
                <PrimaryButton label="Export as PDF" onClick={onExport} tone="quiet" />
                <p style={{ margin: "8px 0 0", font: `400 11px/1.5 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                  Opens the print dialog. Choose Save as PDF.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Alerts ───────────────────────────────────────────────── */}
        {alertsShown && (
          <>
            <SectionRule label="Alerts" marginTop="30px" />
            {alertsLoading ? (
              <>
                <Bar h={44} top={12} />
                <Bar h={44} top={10} />
              </>
            ) : (
              <>
                {alerts.length === 0 ? (
                  <Line>Nothing set. An alert tells you when {identifier} moves the way you name below.</Line>
                ) : (
                  <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {alerts.map((a) => (
                      <div key={a.id} style={{ ...CARD, display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ flex: 1, minWidth: 0, font: `500 13px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
                          {a.kindLabel} {a.valueLabel}
                        </span>
                        <ToggleSwitch
                          checked={a.enabled}
                          onChange={(next) => onToggleAlert(a.id, next)}
                          label={`${a.kindLabel} ${a.valueLabel} alert`}
                        />
                        <button
                          type="button"
                          onClick={() => onDeleteAlert(a.id)}
                          aria-label={`Remove the ${a.kindLabel} ${a.valueLabel} alert`}
                          className={styles.bare}
                          style={{
                            boxSizing: "content-box",
                            flex: "none",
                            minWidth: "20px",
                            minHeight: "20px",
                            padding: "12px",
                            margin: "-12px -12px -12px 0",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            font: `600 12px/1 ${FONT_SANS}`,
                            color: "var(--c-redink)",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {alertsFull ? (
                  <Line top={12}>Five alerts is the most one name can carry. Remove one to add another.</Line>
                ) : (
                  <div data-alert-compose="" style={{ marginTop: "14px" }}>
                    <div role="group" aria-label="Alert kind" style={{ display: "flex", gap: "8px" }}>
                      {ALERT_KINDS.map((k) => (
                        <ModeChip
                          key={k.id}
                          label={k.label}
                          active={alertKind === k.id}
                          onClick={() => onAlertKind(k.id)}
                        />
                      ))}
                    </div>
                    <label
                      htmlFor="watchlist-alert-amount"
                      style={{
                        display: "block",
                        marginTop: "12px",
                        font: `600 11px/1 ${FONT_SANS}`,
                        color: "var(--c-ink)",
                      }}
                    >
                      {alertKind === "percent_change" ? "Move, in percent" : "Price, in dollars"}
                    </label>
                    {/* 16px, and it has to be 16px: iOS Safari zooms the page on
                        focus for anything smaller, and this is the only
                        text-entry control in this section. */}
                    <input
                      id="watchlist-alert-amount"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={alertAmount}
                      onChange={(e) => onAlertAmount(e.target.value)}
                      placeholder={alertKind === "percent_change" ? "5" : "150.00"}
                      aria-describedby={alertFailed ? "watchlist-alert-failed" : undefined}
                      style={{
                        marginTop: "7px",
                        width: "100%",
                        minHeight: "46px",
                        padding: "0 14px",
                        border: "1px solid var(--c-border)",
                        borderRadius: "9px",
                        backgroundColor: "var(--c-surface)",
                        color: "var(--c-ink)",
                        font: `400 16px/1 ${FONT_MONO}`,
                        outlineOffset: "2px",
                      }}
                    />
                    <div style={{ marginTop: "10px" }}>
                      <PrimaryButton
                        label="Add alert"
                        onClick={onAddAlert}
                        disabled={!amountReady}
                        busy={alertSubmitting}
                      />
                    </div>
                    {/* THE WRITE HAS A VISIBLE FAILURE NOW. It used to add the
                        row, then silently take it away again when the POST did
                        not answer, which reads exactly like a browser that
                        dropped a tap. `role="status"` rather than `alert` so it
                        is announced without stealing focus from the input the
                        reader is about to correct. */}
                    {alertFailed && (
                      <p
                        id="watchlist-alert-failed"
                        role="status"
                        style={{
                          margin: "8px 0 0",
                          font: `500 12px/1.5 ${FONT_SANS}`,
                          color: "var(--c-redink)",
                        }}
                      >
                        That alert was not saved. Nothing changed. Try again.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Coverage ─────────────────────────────────────────────── */}
        <SectionRule label="Coverage" marginTop="30px" />
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ font: `500 11px/1.4 ${FONT_SANS}`, color: "var(--c-muted)" }}>
            {loading
              ? "Reading"
              : `${storyCount} ${storyCount === 1 ? "story" : "stories"}${updatedAgo ? `, newest ${updatedAgo}` : ""}`}
          </span>
          {!loading && storyCount > 0 && (
            <div role="group" aria-label="Order" style={{ display: "flex", gap: "8px" }}>
              <ModeChip label="Newest" active={sortMode === "newest"} onClick={() => onSortMode("newest")} />
              <ModeChip label="Relevant" active={sortMode === "relevant"} onClick={() => onSortMode("relevant")} />
            </div>
          )}
        </div>

        {loading ? (
          <>
            <Bar h={96} top={12} />
            <Bar h={96} top={10} />
            <Bar h={96} top={10} />
          </>
        ) : stories.length === 0 ? (
          <Line top={12}>
            Nothing in the corpus mentions {identifier} in the window this screen reads. That is an
            answer, not a wait: the next pipeline run may change it.
          </Line>
        ) : (
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {visible.map((s) => (
              <article key={s.id} style={CARD}>
                {s.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                    {s.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          padding: "3px 7px",
                          borderRadius: "4px",
                          border: "1px solid var(--c-border)",
                          backgroundColor: "var(--c-surface)",
                          font: `500 10px/1.2 ${FONT_SANS}`,
                          color: "var(--c-secondary)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ font: `600 11px/1.3 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
                    {s.source ?? "Unattributed"}
                  </span>
                  {s.when && (
                    <span style={{ font: `400 11px/1.3 ${FONT_MONO}`, color: "var(--c-muted)" }}>{s.when}</span>
                  )}
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    font: `600 14px/1.35 ${FONT_DISPLAY}`,
                    color: "var(--c-ink)",
                    textWrap: "pretty",
                  }}
                >
                  {s.title}
                </p>
                {s.summary && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      font: `400 12px/1.55 ${FONT_SANS}`,
                      color: "var(--c-secondary)",
                      textWrap: "pretty",
                    }}
                  >
                    {s.summary}
                  </p>
                )}
                <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: "1 1 auto",
                        minHeight: "44px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "9px",
                        border: "1px solid var(--c-border)",
                        font: `600 12px/1 ${FONT_SANS}`,
                        color: "var(--c-ink)",
                        textDecoration: "none",
                      }}
                    >
                      Read at source
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onStoryMemo(s.id)}
                    className={styles.bare}
                    style={{
                      flex: "1 1 auto",
                      minHeight: "44px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "9px",
                      border: "1px solid var(--c-border)",
                      font: `600 12px/1 ${FONT_SANS}`,
                      color: "var(--c-goldink)",
                    }}
                  >
                    Memo
                  </button>
                </div>

                {s.others.length > 0 && (
                  <div style={{ marginTop: "12px", borderTop: "1px solid var(--c-hair)" }}>
                    <p
                      style={{
                        margin: "10px 0 0",
                        font: `600 10px/1 ${FONT_MONO}`,
                        letterSpacing: "0.07em",
                        color: "var(--c-muted)",
                      }}
                    >
                      {s.others.length} other {s.others.length === 1 ? "source" : "sources"}
                    </p>
                    {s.others.map((o) => (
                      <div key={o.id} style={{ marginTop: "8px" }}>
                        <p style={{ margin: 0, font: `400 12px/1.45 ${FONT_SANS}`, color: "var(--c-body)" }}>
                          {o.title}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ font: `400 11px/1.3 ${FONT_SANS}`, color: "var(--c-muted)" }}>
                            {[o.source, o.when].filter(Boolean).join(" · ")}
                          </span>
                          {o.url && (
                            <a
                              href={o.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                boxSizing: "content-box",
                                marginLeft: "auto",
                                minHeight: "16px",
                                padding: "14px 0",
                                marginTop: "-14px",
                                marginBottom: "-14px",
                                display: "inline-flex",
                                alignItems: "center",
                                font: `600 11px/1 ${FONT_SANS}`,
                                color: "var(--c-goldink)",
                                textDecoration: "underline",
                                textUnderlineOffset: "3px",
                              }}
                            >
                              Open
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {gated && (
              <div style={CARD}>
                <p style={{ margin: 0, font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-body)", textWrap: "pretty" }}>
                  There is more coverage for {identifier}. Sign in to see all of it.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onSignIn(
                      "Sign in for the whole file",
                      `Get every story we have on ${identifier} with a free account.`,
                    )
                  }
                  className={styles.bare}
                  style={{
                    boxSizing: "content-box",
                    marginTop: "8px",
                    minHeight: "16px",
                    padding: "14px 0",
                    marginBottom: "-14px",
                    display: "inline-flex",
                    alignItems: "center",
                    font: `600 12.5px/1 ${FONT_SANS}`,
                    color: "var(--c-goldink)",
                  }}
                >
                  Sign in
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Note ─────────────────────────────────────────────────── */}
        {reader === "in" && (
          <>
            <SectionRule label="Your note" marginTop="30px" />
            <button
              type="button"
              onClick={() => onNoteOpen(!noteOpen)}
              aria-expanded={noteOpen}
              className={styles.bare}
              style={{
                marginTop: "8px",
                width: "100%",
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                font: `500 13px/1 ${FONT_SANS}`,
                color: "var(--c-secondary)",
              }}
            >
              <span>{noteOpen ? "Hide the note" : "Write a note on this name"}</span>
              <span aria-hidden="true" style={{ font: `400 13px/1 ${FONT_MONO}`, color: "var(--c-muted)" }}>
                {noteOpen ? "–" : "+"}
              </span>
            </button>
            {noteOpen && (
              <div style={{ marginTop: "4px" }}>
                {noteBlocked ? (
                  <Line top={4}>Your session did not resolve, so the note could not be read.</Line>
                ) : noteLoading ? (
                  <Bar h={96} top={8} />
                ) : (
                  <>
                    <label
                      htmlFor="watchlist-note"
                      style={{
                        position: "absolute",
                        width: "1px",
                        height: "1px",
                        overflow: "hidden",
                        clipPath: "inset(50%)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Your note on {identifier}
                    </label>
                    {/* 16px for the same iOS reason as the alert amount. */}
                    <textarea
                      id="watchlist-note"
                      value={noteText}
                      onChange={(e) => onNoteText(e.target.value)}
                      onBlur={onNoteSave}
                      placeholder="What you make of it."
                      style={{
                        width: "100%",
                        minHeight: "96px",
                        padding: "12px 14px",
                        border: "1px solid var(--c-border)",
                        borderRadius: "9px",
                        backgroundColor: "var(--c-surface)",
                        color: "var(--c-ink)",
                        font: `400 16px/1.5 ${FONT_SANS}`,
                        resize: "vertical",
                        outlineOffset: "2px",
                      }}
                    />
                    <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ flex: 1 }}>
                        <PrimaryButton label="Save the note" onClick={onNoteSave} tone="quiet" />
                      </div>
                      {noteSaved && (
                        <span role="status" style={{ font: `600 12px/1 ${FONT_SANS}`, color: "var(--c-greenink)" }}>
                          Saved
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* THE LAST CHILD OF THE SCREEN ROOT, never of the body above it. The one
          owner of this rule is `src/components/mobile/tab-bar-clearance.tsx`
          and its header carries the measurements; nothing here recomputes it. */}
      <TabBarClearance />
    </div>
  );
}
