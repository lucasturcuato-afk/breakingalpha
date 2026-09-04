"use client";

import type { ReactNode } from "react";
import { USER_ROLES } from "@/lib/user-roles";
import {
  BackHeader,
  FormField,
  ListRowLink,
  Screen,
  ScreenBody,
  SectionRule,
  TabBarClearance,
} from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * `/settings/preferences`, at phone width.
 *
 * ── WHAT THIS IS GROUNDED IN ──────────────────────────────────────────────
 *
 * THE PROTOTYPE HAS NO PREFERENCES SCREEN. `parity_harness.py --list` names
 * thirty-one screens and none of them is this route; the one called `settings`
 * renders, element for element, the hub that already ships as
 * `mobile-settings-screen.tsx` (97 elements, read over http, not file://).
 * So there is nothing to port pixel-for-pixel here and no parity gap to
 * record. The register instead comes from the shipped hub, which is why every
 * measurement below is that file's: 24px Fraunces masthead, 13px deck,
 * `SectionRule` between groups, 44px chips at 9px radius, 12px role cards in a
 * two-up grid, `FormField` for text entry, `ListRow*` for navigation. Nothing
 * here is a second settings idiom.
 *
 * PRESENTATIONAL, AND THAT IS LOAD BEARING. Every value and every handler
 * comes from `PreferencesForm`, which renders this and the desk layout over
 * ONE piece of state. The alternative, a second component with its own
 * `useState` behind `md:hidden`, mounts both halves at once: they would drift
 * apart on a resize and then race each other to PATCH the same profile. The
 * hub settled this the same way and for the same reason.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * THE LEARNED WEIGHTS ARE A LINK, NOT A SECTION. The desk half draws them
 * inline. `/settings/learned` already exists as a full mobile screen, already
 * carries the honest reading of whether anything is stored at all, and the hub
 * already reaches it by that exact label and sub. Redrawing it here would be a
 * second rendering of one truth, and the two would disagree the first time
 * either moved.
 *
 * NO SKELETON, BECAUSE THERE IS NO READ TO WAIT ON. The route is a server
 * component: `first_name`, `role`, `sectors`, the tickers and the cards all
 * arrive as props of the first paint. A pulsing bar here could never render,
 * and a state that cannot happen is not a state, it is decoration that hides a
 * missing one. The states this screen really has are all built: idle, three
 * separate empties (no role, no sectors, no tickers), saving, saved, and a
 * save that failed. See `PreferencesForm` for where each is driven from.
 */

export type Option = { id: string; label: string };

export interface MobilePreferencesScreenProps {
  saving: boolean;
  saved: boolean;
  error: string | null;

  firstName: string;
  firmOrSchool: string;
  role: string | null;
  strategy: string | null;
  sectors: string[];
  horizon: string | null;
  workflow: string | null;
  watchlist: string[];
  tickerInput: string;
  marketCards: string[];

  strategyOptions: readonly Option[];
  sectorOptions: readonly string[];
  horizonOptions: readonly Option[];
  workflowOptions: readonly Option[];
  marketCardOptions: readonly string[];
  /** How many cards the dashboard draws. Beyond it the rest go inert. */
  marketCardLimit: number;

  onFirstName: (v: string) => void;
  onFirmOrSchool: (v: string) => void;
  onRole: (v: string) => void;
  onStrategy: (v: string) => void;
  onToggleSector: (v: string) => void;
  onHorizon: (v: string) => void;
  onWorkflow: (v: string) => void;
  onTickerInput: (v: string) => void;
  onAddTickers: () => void;
  onRemoveTicker: (v: string) => void;
  onToggleMarketCard: (v: string) => void;
  onSave: () => void;
}

export function MobilePreferencesScreen(props: MobilePreferencesScreenProps) {
  const {
    saving,
    saved,
    error,
    firstName,
    firmOrSchool,
    role,
    strategy,
    sectors,
    horizon,
    workflow,
    watchlist,
    tickerInput,
    marketCards,
    strategyOptions,
    sectorOptions,
    horizonOptions,
    workflowOptions,
    marketCardOptions,
    marketCardLimit,
  } = props;

  const atLimit = marketCards.length >= marketCardLimit;

  return (
    <Screen parity="preferences">
      {/* The hub is the parent surface and this route is one tap inside it, so
          the control names the destination it goes to rather than saying
          "Back". Same reading, and the same label, as `/settings/alerts` and
          `/settings/learned`. */}
      <BackHeader href="/settings/profile" label="Settings" />

      <ScreenBody>
        <h1
          style={{
            margin: 0,
            font: `800 24px/1.16 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Your preferences
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            font: `400 13px/1.55 ${FONT_SANS}`,
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
          {/* The desk half's own sentence, carried. Its second sentence,
              "Changes take effect immediately", was already struck on the desk
              because the only write path is the button at the foot of this
              screen. */}
          Manage every dimension of how Signalera personalizes your
          intelligence feed.
        </p>

        <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <FormField
            label="First name"
            value={firstName}
            onChange={props.onFirstName}
            placeholder="Your first name"
          />
          <FormField
            label="Firm or school"
            value={firmOrSchool}
            onChange={props.onFirmOrSchool}
            placeholder="e.g. Goldman Sachs, MIT"
          />
        </div>

        <SectionRule label="your role" />
        <p style={HELP}>This shapes how briefs and memos are framed for you.</p>
        <div
          style={{
            marginTop: "12px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
          }}
        >
          {USER_ROLES.map((r) => {
            const on = role === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => props.onRole(r.id)}
                className={styles.bare}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "13px 14px",
                  borderRadius: "12px",
                  border: `1px solid ${on ? "var(--c-gold)" : "var(--c-border)"}`,
                  backgroundColor: on ? "var(--c-well)" : "var(--c-card)",
                }}
              >
                <span style={{ font: `600 12.5px/1.3 ${FONT_SANS}`, color: "var(--c-ink)" }}>
                  {r.label}
                </span>
                <span
                  style={{
                    marginTop: "5px",
                    font: `400 10.5px/1.4 ${FONT_SANS}`,
                    color: "var(--c-muted)",
                  }}
                >
                  {r.shortDescription}
                </span>
              </button>
            );
          })}
        </div>
        {/* An unset role is a real state and it is the one a new account is
            in. Saying so is not the same as drawing nothing. */}
        {role === null ? <p style={HELP}>No role chosen yet.</p> : null}

        <SectionRule label="strategy" />
        <Chips>
          {strategyOptions.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              on={strategy === s.id}
              onClick={() => props.onStrategy(s.id)}
            />
          ))}
        </Chips>
        {strategy === null ? <p style={HELP}>No strategy chosen yet.</p> : null}

        <SectionRule label="tracked sectors" />
        <p style={HELP}>Signals from these sectors are surfaced first in your briefs.</p>
        <Chips marginTop="12px">
          {sectorOptions.map((s) => (
            <Chip
              key={s}
              label={s}
              on={sectors.includes(s)}
              onClick={() => props.onToggleSector(s)}
            />
          ))}
        </Chips>
        <p style={HELP} aria-live="polite">
          {sectors.length === 0
            ? "No sectors tracked yet."
            : `${sectors.length} sector${sectors.length === 1 ? "" : "s"} selected`}
        </p>

        <SectionRule label="investment horizon" />
        <Chips>
          {horizonOptions.map((h) => (
            <Chip
              key={h.id}
              label={h.label}
              on={horizon === h.id}
              onClick={() => props.onHorizon(h.id)}
            />
          ))}
        </Chips>

        <SectionRule label="workflow style" />
        <Chips>
          {workflowOptions.map((w) => (
            <Chip
              key={w.id}
              label={w.label}
              on={workflow === w.id}
              onClick={() => props.onWorkflow(w.id)}
            />
          ))}
        </Chips>

        <SectionRule label="watchlist tickers" />
        {/* A WRAPPER BESIDE THE PRIMITIVE, NEVER A BRANCH INSIDE IT.
            `FormField` draws a label over one input and knows nothing about a
            trailing action, which is correct: this route's model is an ARRAY
            with add and remove, not the hub's comma-separated string, and
            teaching the primitive about a second shape would put that
            difference inside it. A real `form` around the field is what makes
            the iOS keyboard's return key add a ticker, with no key handler and
            no change to `FormField` at all. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onAddTickers();
          }}
        >
          <div style={{ marginTop: "12px" }}>
            <FormField
              label="Add tickers"
              value={tickerInput}
              onChange={props.onTickerInput}
              placeholder="e.g. AAPL, MSFT"
              help="Comma or space separated. Signals touching these are surfaced prominently."
              mono
            />
          </div>
          <button
            type="submit"
            disabled={tickerInput.trim() === ""}
            className={styles.bare}
            style={{
              marginTop: "10px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              borderRadius: "9px",
              border: "1px solid var(--c-border)",
              font: `600 12px/1 ${FONT_SANS}`,
              color: tickerInput.trim() === "" ? "var(--c-locked-ink)" : "var(--c-ink)",
              backgroundColor: tickerInput.trim() === "" ? "var(--c-locked-bg)" : "var(--c-card)",
              cursor: tickerInput.trim() === "" ? "default" : "pointer",
            }}
          >
            Add to watchlist
          </button>
        </form>

        <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {watchlist.map((t) => (
            /* The chip IS the remove control, so there is one tab stop per
               ticker and its accessible name says what tapping does. A 20px
               glyph nested inside a chip would be the second control in a row
               whose own text is not its name, which is the hazard
               `toggle-switch.tsx` documents. */
            <button
              key={t}
              type="button"
              aria-label={`Remove ${t} from your watchlist`}
              onClick={() => props.onRemoveTicker(t)}
              className={styles.bare}
              style={{
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "0 13px",
                borderRadius: "6px",
                border: "1px solid var(--c-border)",
                backgroundColor: "var(--c-surface)",
                font: `500 12px/1 ${FONT_MONO}`,
                letterSpacing: "0.02em",
                color: "var(--c-ink)",
              }}
            >
              {t}
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--c-muted)"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ))}
        </div>
        {watchlist.length === 0 ? <p style={HELP}>No tickers on your watchlist yet.</p> : null}

        <SectionRule label="dashboard market cards" />
        <Chips marginTop="12px">
          {marketCardOptions.map((sym) => {
            const on = marketCards.includes(sym);
            const inert = atLimit && !on;
            return (
              <Chip
                key={sym}
                label={sym}
                on={on}
                inert={inert}
                mono
                onClick={() => props.onToggleMarketCard(sym)}
              />
            );
          })}
        </Chips>
        <p style={HELP} aria-live="polite">
          {marketCards.length} of {marketCardLimit} chosen
          {atLimit ? `. Clear one to choose another.` : ""}
        </p>

        {error ? (
          <p
            role="alert"
            style={{
              margin: "16px 0 0",
              font: `400 12px/1.55 ${FONT_SANS}`,
              color: "var(--c-redink)",
              textWrap: "pretty",
            }}
          >
            {error} Nothing was saved. Try again.
          </p>
        ) : null}

        <button
          type="button"
          onClick={props.onSave}
          disabled={saving}
          className={styles.bare}
          style={{
            marginTop: "18px",
            width: "100%",
            minHeight: "48px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            borderRadius: "9px",
            font: `600 13px/1 ${FONT_SANS}`,
            backgroundColor: saving ? "var(--c-locked-bg)" : "var(--c-gold)",
            color: saving ? "var(--c-locked-ink)" : "var(--c-ongold)",
            cursor: saving ? "default" : "pointer",
          }}
        >
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {saved ? <path d="M5 12l5 5L19 7" /> : <path d="M19 21H5V3h11l3 3zM8 3v6h7" />}
          </svg>
          {saving ? "Saving" : saved ? "Saved" : "Save preferences"}
        </button>

        <p
          style={{
            margin: "12px 0 0",
            font: `400 11px/1.6 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {/* The desk half's closing note, carried word for word. It is the one
              honest statement on either half about when a change is felt. */}
          Changes to your preferences will be reflected across your dashboard
          and briefs within a few minutes. Some content (like Morning Briefs)
          updates with the next pipeline run.
        </p>

        <SectionRule label="elsewhere" />
        <div style={{ marginTop: "6px" }}>
          {/* Label and sub match the hub's row for the same destination
              exactly. One name for one screen, on both surfaces that reach
              it. */}
          <ListRowLink
            href="/settings/learned"
            label="What Signalera has learned"
            sub="Inferred sector weights"
            bottomRule
          />
        </div>
      </ScreenBody>

      {/* The tab bar's height, reserved once, by the module that owns the rule.
          Measured on this route before it was here: `#main-content` is the
          scroller (the screen's own body grows rather than scrolling, so
          `scrollHeight === clientHeight` on it), the shell's bottom padding is
          dropped by Chrome the moment the content overflows, and the last
          control lands under a bar whose top edge is at 785 on an 844 viewport.
          Not a local constant, not 59 written out: see
          `@/components/mobile/tab-bar-clearance` for what four copies of this
          one rule cost. */}
      <TabBarClearance />
    </Screen>
  );
}

const HELP = {
  margin: "10px 0 0",
  font: `400 11.5px/1.5 ${FONT_SANS}`,
  color: "var(--c-muted)",
} as const;

/** The chip row. 12px gaps, exactly as the hub draws its sector chips. */
function Chips({ children, marginTop = "12px" }: { children: ReactNode; marginTop?: string }) {
  return (
    <div style={{ marginTop, display: "flex", flexWrap: "wrap", gap: "12px" }}>{children}</div>
  );
}

/**
 * The hub's sector chip, one anatomy for all four of this screen's chip
 * groups: 44px tall, 9px radius, gold border and well when chosen.
 *
 * `inert` is the market-card limit and it is a real `disabled` button, not a
 * dimmed live one. A chip is a `button` and a button carries no state, so
 * `disabled` asserts nothing untrue about a setting; that is the same line
 * `ResetLearnedPrefsButton` draws, and the opposite of the five Alerts
 * switches, which render as decorative spans because `aria-checked="false"`
 * would claim a stored value that does not exist.
 *
 * `min-height` sits on a box with a border and no block padding, so under the
 * app's global `border-box` the drawn box and the hit box are both exactly
 * 44px. No `content-box` compensation is needed here, and adding one would
 * silently make the row 46px.
 */
function Chip({
  label,
  on,
  inert = false,
  mono = false,
  onClick,
}: {
  label: string;
  on: boolean;
  inert?: boolean;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={inert}
      onClick={onClick}
      className={styles.bare}
      style={{
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 13px",
        borderRadius: "9px",
        font: mono ? `500 12px/1 ${FONT_MONO}` : `500 12px/1 ${FONT_SANS}`,
        letterSpacing: mono ? "0.02em" : undefined,
        border: `1px solid ${on ? "var(--c-gold)" : "var(--c-border)"}`,
        backgroundColor: on ? "var(--c-well)" : inert ? "var(--c-locked-bg)" : "var(--c-card)",
        color: on ? "var(--c-goldink)" : inert ? "var(--c-locked-ink)" : "var(--c-secondary)",
        cursor: inert ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
