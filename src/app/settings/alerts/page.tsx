import Link from "next/link";
import { AppShell } from "@/components/shell";
import { MobileAlertsScreen } from "@/components/settings/mobile-alerts-screen";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Alerts. A new route, because the screen had none: `src/app/alerts/` does not
 * exist and nothing in the repo renders these settings. It sits under
 * /settings because the only entry point is the Settings row "Alerts", and its
 * back link goes there.
 *
 * THE SHELL, AND WHY IT WAS MISSING. This route and `/settings/learned` were
 * the only two `/settings/*` pages that mounted no `AppShell` at all. Measured
 * on a production build at 320 and 390 in both themes before this change:
 * `#main-content` did not exist, `nav[aria-label="Primary"]` did not exist,
 * and all four poles were absent from the DOM, so a reader who tapped through
 * to this screen had exactly one control on it, the back link, and no way to
 * reach any pole. It is worse than the navigation trap `/settings/profile`
 * carried, because a trap leaves the poles present and unclickable while this
 * never drew them.
 *
 * `mobileFullBleed` is the mechanism, and it is `profile`'s and
 * `trends-mobile`'s, not a third one: it gates the desk's mood bar, topbar and
 * footer below `md` and leaves the tab bar mounted, so the screen keeps its
 * own masthead and gains its navigation. Gating stays in CLASSES on the two
 * wrappers below; an inline `display` beats a responsive class at every
 * breakpoint.
 *
 * WHAT THIS DOES CHANGE AT `md` AND ABOVE, stated rather than buried: the desk
 * message below now renders inside the desk shell, with the sidebar, topbar
 * and footer around it. It had none of those before. That is unavoidable
 * given `AppShell` mounts the sidebar at `md+` unconditionally, and it is the
 * same shape `/trends-mobile` already ships for the same kind of page. The
 * message itself is unchanged, word for word.
 */

export const metadata = {
  title: "Alerts",
};

export default function AlertsPage() {
  return (
    <AppShell pageTitle="Alerts" mobileFullBleed>
      {/* Gating lives in classes. An inline display beats a class at every
          breakpoint, which is how the tab bar reached desktop once already. */}
      <div className="md:hidden">
        <MobileAlertsScreen />
      </div>

      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Alerts is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the brief and the wrap are already in front of you, so there is nothing
          here to schedule.{" "}
          <Link href="/settings/profile" style={{
              boxSizing: "content-box",
              display: "inline-flex",
              alignItems: "center",
              minHeight: "20px",
              padding: "12px 0",
              margin: "-12px 0",
              color: "var(--c-goldink)",
            }}>
            Back to settings
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
