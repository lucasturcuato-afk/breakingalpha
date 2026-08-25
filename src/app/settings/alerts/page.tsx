import Link from "next/link";
import { MobileAlertsScreen } from "@/components/settings/mobile-alerts-screen";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Alerts. A new route, because the screen had none: `src/app/alerts/` does not
 * exist and nothing in the repo renders these settings. It sits under
 * /settings because the only entry point is the Settings row "Brief and wrap
 * times", and its back link goes there.
 */

export const metadata = {
  title: "Alerts",
};

export default function AlertsPage() {
  return (
    <>
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
    </>
  );
}
