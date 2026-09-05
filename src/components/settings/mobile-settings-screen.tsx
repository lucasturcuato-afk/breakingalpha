"use client";

import { USER_ROLES } from "@/lib/user-roles";
import {
  BackHeader,
  FormField,
  ListRowButton,
  ListRowControl,
  ListRowLink,
  Screen,
  ScreenBody,
  SectionRule,
  TabBarClearance,
} from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";
import { WatchNotice } from "@/components/watch/watch-notice";

/**
 * Settings, at phone width. Grounded in `settings/profile/page.tsx`, whose
 * copy it carries verbatim, plus the "on this device" list the prototype adds.
 * That list has no counterpart in either settings route; it is the mobile
 * navigation spine and the only way Learned, Saved and Alerts are reached.
 *
 * Presentational. Every value and every handler comes from the route, so the
 * mobile and desktop layouts read and write one piece of state and cannot
 * disagree about what is saved.
 *
 * Risk appetite is absent by ruling 7a. The ruling is UI only: the route still
 * loads `risk_appetite` and still sends the value it loaded, so a screen that
 * never showed the control cannot clear one the user set on desktop.
 */

export interface MobileSettingsScreenProps {
  loading: boolean;
  /**
   * The profile READ did not happen, as distinct from a SAVE that failed.
   *
   * `error` below is the save-side message and it sits beside a live Save
   * control, because a save is worth retrying from the form the reader is
   * looking at. This one is the opposite case: the fields hold nothing that
   * came from the reader's stored profile, so the form is not drawn at all
   * and there is no Save control to press over it.
   */
  loadFailed: boolean;
  error: string | null;
  saving: boolean;
  saved: boolean;
  firstName: string;
  firmOrSchool: string;
  role: string | null;
  sectors: string[];
  sectorOptions: readonly string[];
  watchlistInput: string;
  onFirstName: (v: string) => void;
  onFirmOrSchool: (v: string) => void;
  onRole: (v: string) => void;
  onToggleSector: (v: string) => void;
  onWatchlistInput: (v: string) => void;
  onSave: () => void;
  /** Theme is a device preference, so it is read and written by the route. */
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  /** Counts on the navigation rows. Null while the figure is not known yet. */
  learnedEventCount: number | null;
  savedDealCount: number | null;
}

export function MobileSettingsScreen(props: MobileSettingsScreenProps) {
  const {
    loading,
    loadFailed,
    error,
    saving,
    saved,
    firstName,
    firmOrSchool,
    role,
    sectors,
    sectorOptions,
    watchlistInput,
    theme,
    learnedEventCount,
    savedDealCount,
  } = props;

  return (
    <Screen parity="settings">
      <BackHeader href="/ledger" label="Ledger" />
      <ScreenBody>
        <h1
          style={{
            margin: 0,
            font: `800 24px/1.16 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Your Preferences
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            font: `400 13px/1.55 ${FONT_SANS}`,
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
{/* "Changes save instantly" was the design's, and it is false on this
              screen: the only write path is the explicit Save changes button
              below, wired to PATCH /api/user-profile, and nothing persists
              until it is pressed. The clause came out on the same ground that
              took "Published 6:45" off Alerts. Applying that standard to the
              design's claims about a schedule and not to its claims about this
              screen's own behaviour, four lines above the button that
              falsifies it, would have been the standard applied for
              convenience. */}
          Saved changes personalize your entire Signalera experience.
        </p>

        {loading ? (
          <ProfileSkeleton />
        ) : loadFailed ? (
          /* Same block, same words, same retry as the desk half above it, and
             for the same reason: the form is not mounted, so Save is not on
             the screen to be pressed over blank fields. The rows below this
             point still draw, so the reader keeps every way off the screen. */
          <WatchNotice
            heading="Could not load your preferences."
            body="Nothing on this screen can be saved until they load. Saving now would write an empty form over what is already there."
            action={{ href: "/settings/profile", label: "Try again" }}
          />
        ) : (
          <>
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
                placeholder="Company, institution, or school"
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

            <SectionRule label="tracked sectors" />
            <p style={HELP}>Signals from these sectors are surfaced first in your briefs.</p>
            <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {sectorOptions.map((s) => {
                const on = sectors.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => props.onToggleSector(s)}
                    className={styles.bare}
                    style={{
                      minHeight: "44px",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 13px",
                      borderRadius: "9px",
                      font: `500 12px/1 ${FONT_SANS}`,
                      border: `1px solid ${on ? "var(--c-gold)" : "var(--c-border)"}`,
                      backgroundColor: on ? "var(--c-well)" : "var(--c-card)",
                      color: on ? "var(--c-goldink)" : "var(--c-secondary)",
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <p style={HELP} aria-live="polite">
              {sectors.length} sector{sectors.length === 1 ? "" : "s"} selected
            </p>

            <SectionRule label="watchlist tickers" />
            <div>
              <FormField
                label="Watchlist tickers"
                labelHidden
                value={watchlistInput}
                onChange={props.onWatchlistInput}
                placeholder="AAPL, NVDA, MSFT, META"
                help="Comma-separated ticker symbols. Signals touching these will be surfaced prominently."
                mono
              />
            </div>

            {error ? (
              <p
                role="alert"
                style={{
                  margin: "14px 0 0",
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
                backgroundColor: saving ? "var(--c-locked-bg)" : "var(--c-gold)",
                borderRadius: "9px",
                font: `600 13px/1 ${FONT_SANS}`,
                color: saving ? "var(--c-locked-ink)" : "var(--c-ongold)",
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
              {saving ? "Saving" : saved ? "Saved" : "Save changes"}
            </button>
          </>
        )}

        <SectionRule label="on this device" />
        <div style={{ marginTop: "6px" }}>
          <ListRowControl
            label="Theme"
            sub={theme === "dark" ? "Dark, chosen" : "Light, chosen"}
            trailing={
              <button
                type="button"
                onClick={props.onToggleTheme}
                /* The visible word is "Switch", which announces as
                   "Switch, button" and names neither what is switched nor what
                   it becomes. The row's own text is not associated with the
                   control, which is the exact hazard `toggle-switch.tsx`
                   documents and this row was doing anyway. The visible label is
                   unchanged; only the accessible name grows. */
                aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
                className={styles.bare}
                style={{
                  flex: "none",
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 13px",
                  border: "1px solid var(--c-border)",
                  borderRadius: "6px",
                  font: `500 12px/1 ${FONT_SANS}`,
                  color: "var(--c-secondary)",
                }}
              >
                Switch
              </button>
            }
          />
          {/* THE PORT'S ONLY WAY IN. `/settings/preferences` now has a phone
              layout, and before this row nothing on any mobile surface pointed
              at it: the hub carried five rows and none of them was this one, so
              the screen was reachable only by typing the URL.

              It is NOT called "Your preferences". This hub's own masthead
              already says that, and two rows deep in one product cannot both
              be the preferences. The row is named for what it adds beyond this
              screen, and the sub lists three of the four groups only that
              route has. The collision between the two mastheads is real and is
              flagged in the PR rather than fixed from here. */}
          <ListRowLink
            href="/settings/preferences"
            label="More preferences"
            sub="Strategy, horizon, workflow and dashboard cards"
          />
          <ListRowLink
            href="/settings/learned"
            label="What Signalera has learned"
            sub={
              learnedEventCount == null
                ? "Inferred sector weights"
                : `Inferred sector weights, ${learnedEventCount} events`
            }
          />
          <ListRowLink
            href="/saved"
            label="Saved deals"
            sub={
              savedDealCount == null
                ? "Bookmarked from Deal Flow"
                : `${savedDealCount} saved from Deal Flow`
            }
          />
          {/* The design labels this row "Brief and wrap times" over the sub
              "Brief at 6:45, wrap at 4:35". Both halves promise a clock time
              nothing in the repo can source: no cron produces a 6:45 brief, and
              ten consecutive `briefings` rows land at 10:06 to 10:15 and 22:18
              to 22:20 ET. `evening-wrap-screen.tsx:81` already ruled 4:35 "an
              invented 4:35 close" and refused to print it. The row now names
              the destination by the destination's own H1 rather than promising
              a schedule the product does not keep. Flagged in the PR as a
              deliberate deviation from the design's words. */}
          <ListRowLink href="/settings/alerts" label="Alerts" sub="When the app reaches you" />
          {/* The user's own record, not the desk's. `RadarTabs.tsx`,
              `desk-record.ts` and `your-record.ts` each state independently
              that the two are different objects and are never mixed, so this
              row points at /radar/calls. The entry count is not stated here
              because nothing on this screen loads it, and a typed figure
              sitting beside a derived one is how four defects started. */}
          <ListRowLink
            href="/radar/calls"
            label="Prepared record"
            sub="Your own entries, complete and uncurated"
          />
          {/* THE ONLY DELIBERATE PHONE PATH TO THE LEGAL DOCUMENTS.
              `mobileFullBleed` gates the desk footer to `hidden md:block` on 26
              routes, all four poles included, so the footer's Terms, Privacy
              and Support links are in the DOM at 0x0 and tappable on none of
              them. Measured before this row, the one path that worked ran
              through `/radar/following`, which kept its footer only because it
              is absent from the redirect map, and that exemption is one PR from
              being closed. This row does not depend on it.

              It points at the hub rather than at Terms because the reader who
              wants Privacy should not have to arrive at Terms and find a 17.6px
              footer link.

              This is NOT the informational line further down this screen. That
              line states what the product is; this row is navigation. Neither
              replaces the other and the line is untouched. */}
          <ListRowLink
            href="/legal"
            label="Legal"
            sub="Terms, privacy and support"
            bottomRule
          />
          <ListRowButton label="Sign out" onClick={props.onSignOut} chevron={false} topRule={false} />
        </div>

        <p
          style={{
            margin: "12px 0 0",
            font: `400 11px/1.6 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          Signalera is informational only and is never investment advice.
        </p>
      </ScreenBody>
      {/* THE INFORMATIONAL LINE ABOVE HAS NEVER BEEN VISIBLE AT PHONE WIDTH,
          and this element is the whole fix. Measured on a production build of
          `0e51dd3f` at maximum scroll, both themes: at 390 the line ran 802.80
          to 820.39 against a bar top of 785, so all 17.59px of it sat behind
          the bar; at 320 it wrapped to two lines and 34.80 of its 35.19px sat
          behind. `document.elementFromPoint` at its centre answered with the
          Radar pole at every one of 320, 375, 390 and 430.

          NOT CAUSED BY THE `Legal` ROW. The obvious theory was that the row
          added hours earlier pushed the line under. It did not: identical
          coordinates come back on a build without that row, and the rows and
          the `bottomRule` above are untouched here.

          WHY AN ELEMENT AND NOT A PADDING. `#main-content` carries
          `padding-bottom: 59px` from `app-shell.tsx:178`, and on this route
          that padding contributes exactly zero: measured at 390, the scroller
          reports scrollHeight 1853 against a screen root that is itself
          1853.39 tall, which is Chrome dropping a scroll container's bottom
          padding once its content overflows. `ScreenBody` has
          `overflow-y: auto` but never scrolls (scrollHeight and clientHeight
          agree exactly), so `#main-content` is the only scroller and the
          extent has to come from real content.

          A `padding-bottom` on this screen root would in fact also add extent,
          measured, so the reason this is the shared element is ownership and
          not geometry: `@/components/mobile/tab-bar-clearance` is the single
          owner of the clearance rule, and a local padding here would be the
          fifth hand-rolled shape of the thing that module exists to stop.
          Last child of the root, as its three settings siblings already do. */}
      <TabBarClearance />
    </Screen>
  );
}

const HELP = {
  margin: "10px 0 0",
  font: `400 11.5px/1.5 ${FONT_SANS}`,
  color: "var(--c-muted)",
} as const;

/** Three pulsing bars, the loading state `settings/profile/page.tsx` already has. */
function ProfileSkeleton() {
  return (
    <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "14px" }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.sk} style={{ height: "46px" }} />
      ))}
    </div>
  );
}
