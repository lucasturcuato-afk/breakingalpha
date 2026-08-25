"use client";

import { BackHeader, ListRowControl, Screen, ScreenBody, ToggleSwitch } from "@/components/mobile";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Alerts. The one screen in this batch with no repo source at all: github.md
 * records it as designed fresh, and no `src/app/alerts/` route exists. Its
 * whole argument is that a browser tab cannot be interrupted, so nothing here
 * promises a push notification.
 *
 * WHY THE FIVE SWITCHES ARE LOCKED, and this is the correction to the version
 * that first shipped on this branch.
 *
 * They used to be live switches writing a `signalera_alert_prefs` key to
 * localStorage, and the file argued that persisting to the device was honest
 * because it "changes what is waiting when the app is opened here". That was
 * not true. Nothing in the repo ever read the key. A recon of every
 * persistence path found:
 *
 *   - `user_profiles` carries exactly one notification column,
 *     `brief_email_subscribed` (`sql/brief_email_unsubscribe.sql:27`), and it
 *     is a SINGLE flag covering the brief and the wrap together. It cannot
 *     express `brief` separately from `wrap`, and there is nothing at all for
 *     review days, window closing or followed names.
 *   - `/api/user-profile` PATCH whitelists 14 fields and that column is not
 *     among them, so the one column that exists is not even writable from a
 *     signed-in session.
 *   - Both senders, `backend/brief_email_send.py:390` and
 *     `src/app/api/brief/send-email/route.ts:405`, test that single flag and
 *     nothing else, and they serve the brief and the wrap from the same
 *     recipient set.
 *
 * So there is no reader to wire five switches to, and inventing one means a
 * migration, which this unit may not apply. Collapsing brief and wrap into the
 * one flag that does exist would be worse than the localStorage version: the
 * screen would show two controls that are secretly one.
 *
 * The treatment is PR #661's, established on the evening wrap
 * (`evening-wrap-screen.tsx:684-690`): a control with nothing behind it is
 * closed rather than merely handler-less, drawn so the closed state is visible
 * and not only announced, with a line saying why.
 *
 * WHAT THE EXPLANATION MAY CLAIM, and this is a correction to the first
 * version of it. That line used to end "The schedule each row describes is
 * what Signalera sends today, switch or no switch." Three of the five rows
 * cannot support that. `watchlist_sync.py:611` is the only producer of a
 * user-facing notification in `backend/`, and it fires on a price threshold
 * being crossed, not when the desk writes on a followed name. Nothing in
 * `src/` or `backend/` matches `review_date`, `due_for_review` or
 * `review_due`, and no workflow mentions a review. Nothing produces a
 * window-closing notice. Only the brief and the wrap have a producer, and they
 * are the two rows already sourced to `brief-heartbeat.yml`. Removing four
 * unsourceable claims and then writing a fifth is the same defect wearing the
 * fix's clothes, so the sentence now says only the thing this file can prove:
 * that no store is wired up.
 *
 * WHY THE LOCKED CONTROL NO LONGER ANNOUNCES A STATE. It was a
 * `<button role="switch" aria-checked="false" disabled>`, which reads as
 * "switch, off, dimmed". "Off" is a claim about a setting, and with no store
 * there is no setting to be off: the value is absent, not false. The evening
 * wrap's precedent closed a BUTTON, which carries no state; a switch does.
 * So the locked control is now decorative and `aria-hidden`, the row is plain
 * text, and the line above the group carries the fact. Flagged in the PR: if
 * Noah wants the switches operable, they need a migration behind them.
 */

const ROWS: { key: string; group: "publication" | "ledger"; label: string; sub: string }[] = [
  /* PUBLICATION TIMES REMOVED, and this is the second correction.
   *
   * The design says "Published 6:45, weekdays" and "Published 4:35, after the
   * close". Neither is true and neither is sourceable. No cron in
   * `.github/workflows/` produces a 6:45 brief; the closest in-repo statement
   * of a real window is `brief-heartbeat.yml:32-33`, which fires "~3h after
   * the morning brief window" at 17:00 UTC and "~3h after the evening brief
   * window" at 05:00 UTC, putting the two windows near 10:00 and 22:00 ET. Ten
   * consecutive `briefings` rows agree with the workflow and not with the
   * design: mornings land 10:06 to 10:15 ET, evenings 22:18 to 22:20 ET.
   *
   * This programme has already ruled on the same figure. The evening wrap
   * screen calls 4:35 "an invented 4:35 close" and "invented precision" and
   * refuses to print it (`evening-wrap-screen.tsx:81` and `:676`). Printing it
   * here as fact would contradict a sibling screen in the same batch.
   *
   * What is left is the cadence, which both the workflow crons (`1-5` and
   * `2-6`) and all ten rows support. The clock time is not stated because
   * nothing in the repo can source it. */
  { key: "brief", group: "publication", label: "Morning brief", sub: "Weekday mornings" },
  { key: "wrap", group: "publication", label: "Evening wrap", sub: "After the close" },
  { key: "review", group: "ledger", label: "Review days", sub: "The morning a call is checked" },
  { key: "window", group: "ledger", label: "Window closing", sub: "Two days before, so nothing surprises you" },
  { key: "names", group: "ledger", label: "Followed names", sub: "Only when the desk writes on one" },
];

export function MobileAlertsScreen() {
  return <AlertsView />;
}

export function AlertsView() {
  const publication = ROWS.filter((r) => r.group === "publication");
  const ledger = ROWS.filter((r) => r.group === "ledger");

  return (
    <Screen parity="alerts">
      <BackHeader href="/settings/profile" label="Settings" />

      <div style={{ flex: "none", padding: "14px var(--v3-pad) 0" }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.16 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          When the app reaches you
        </h1>
        {/* The design's sentence ends "…and what the home screen badge counts".
            There is no badge: the Badging API call that would set one appears
            nowhere in the codebase, so there is nothing counting. The clause is
            dropped and the rest of the design's sentence, which is true, is
            kept. (Stated this way on purpose. The previous wording quoted the
            grep that proved it, which then made the comment its own only
            match.) */}
        <p
          style={{
            margin: "8px 0 0",
            font: `400 12.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          On the browser, none of this can interrupt you. It changes what is waiting when you open the
          app.
        </p>
      </div>

      <ScreenBody padTop="18px">
        <p
          style={{
            margin: "0 0 16px",
            font: `400 12px/1.55 ${FONT_SANS}`,
            color: "var(--c-amberink)",
            textWrap: "pretty",
          }}
        >
          The five switches below are locked. Nothing behind them stores a setting yet, so they are
          shown closed rather than as controls that would take a change and drop it.
        </p>

        <Group eyebrow="PUBLICATION" marginTop="0px">
          {publication.map((row, i) => (
            <Row key={row.key} row={row} bottomRule={i === publication.length - 1} />
          ))}
        </Group>

        <Group eyebrow="YOUR LEDGER" marginTop="24px">
          {ledger.map((row, i) => (
            <Row key={row.key} row={row} bottomRule={i === ledger.length - 1} />
          ))}
        </Group>

        <div
          style={{
            marginTop: "20px",
            padding: "15px 16px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-well)",
          }}
        >
          <div
            style={{
              font: `400 10px/1 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            WHY THIS PAGE IS SHORT
          </div>
          <p
            style={{
              margin: "9px 0 0",
              font: `400 13px/1.65 ${FONT_SANS}`,
              color: "var(--c-body)",
              textWrap: "pretty",
            }}
          >
            Nothing here can push to a browser tab, and most people never install to the home screen.
            So the product does not depend on interrupting you. What brings you back is the window you
            fixed yourself, and the app opens on it.
          </p>
        </div>
      </ScreenBody>
    </Screen>
  );
}

function Group({
  eyebrow,
  marginTop,
  children,
}: {
  eyebrow: string;
  marginTop: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop }}>
      <h2
        style={{
          margin: 0,
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {eyebrow}
      </h2>
      <div style={{ marginTop: "2px" }}>{children}</div>
    </section>
  );
}

function Row({
  row,
  bottomRule,
}: {
  row: (typeof ROWS)[number];
  bottomRule: boolean;
}) {
  /* No `subId`. It existed to bind the row's qualifier to the switch through
     `aria-describedby`, and the locked control is `aria-hidden` with nothing to
     describe. An id nothing references is the kind of leftover that later reads
     as a wired relationship. */
  return (
    <ListRowControl
      label={row.label}
      sub={row.sub}
      bottomRule={bottomRule}
      trailing={<ToggleSwitch checked={false} onChange={NOOP} label={row.label} locked />}
    />
  );
}

/* Never called: `locked` drops the handler and sets `disabled`. Declared once
 * at module scope so the prop stays required on the primitive rather than
 * becoming optional for one caller. */
function NOOP() {}
