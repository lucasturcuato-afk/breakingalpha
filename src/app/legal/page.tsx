import type { Metadata } from "next";
import { ListRowAnchor, ListRowLink } from "@/components/mobile";
import { FONT_SANS } from "@/components/mobile/fonts";

export const metadata: Metadata = {
  title: "Legal",
  description: "Terms, privacy and support for Signalera.",
};

/**
 * The legal hub. Three rows: Terms, Privacy, Support.
 *
 * WHY A HUB AND NOT A LINK STRAIGHT TO TERMS. The two documents already
 * cross-link, but only through the layout footer, whose three links measure
 * 17.6px tall. Those are the worst tap targets on the two legal pages, so a
 * reader who arrived at Terms and wanted Privacy had a 17.6px target and
 * nothing else. This page is the 56px answer to that, and it is also the single
 * destination the Settings row can name without choosing one document over the
 * other.
 *
 * WHY IT JOINS THE LEGAL LAYOUT AND NOT THE APP SHELL. Three reasons, in the
 * order they decided it:
 *
 * 1. It has to work signed out. The sign-in small print now points into this
 *    tree, so the first reader of this page is frequently a reader with no
 *    session. `AppShell` mounts the desk around a signed-in reader; this layout
 *    mounts nothing that needs one, which is why `/legal/terms` and
 *    `/legal/privacy` already serve signed out and why this page does too.
 * 2. Its two destinations live here. A hub in one layout whose every row lands
 *    in another is a seam the reader feels on the first tap.
 * 3. Nothing is occluded here. This layout draws no mobile tab bar, so a row at
 *    the bottom of the list is reachable, which is exactly the failure the
 *    footer's own Support link has: it sits under the tab bar on every screen
 *    that mounts one.
 *
 * The cost, stated rather than buried: a reader who arrives from Settings
 * leaves the app shell and loses the tab bar until they come back. That is the
 * same trade `/legal/terms` already makes today, and the layout's "Signalera"
 * header link is the way back.
 *
 * ONE LAYOUT, NOT TWO. The rows are the mobile register, 56px with the same
 * hairlines the Settings hub uses, and they are constrained by the layout's own
 * `max-w-3xl` at desktop width. There is no `md:hidden` pair here because there
 * is nothing a wider screen would say differently: it is three destinations
 * either way, and a second copy of them is a second thing to keep true.
 */
export default function LegalHubPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1
        className="font-[family-name:var(--font-playfair-display)] text-espresso text-4xl font-bold mb-2"
      >
        Legal
      </h1>
      <p
        style={{
          margin: "0 0 24px",
          font: `400 13px/1.6 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          maxWidth: "48ch",
          textWrap: "pretty",
        }}
      >
        The documents you agree to by using Signalera, and where to reach us.
      </p>

      <div>
        <ListRowLink
          href="/legal/terms"
          label="Terms of Service"
          sub="What the Service is, and what it is not"
        />
        <ListRowLink
          href="/legal/privacy"
          label="Privacy Policy"
          sub="What is collected, and what is done with it"
        />
        {/* Support is a mail address, not a route, so it is a plain anchor and
            it carries no chevron. It moved here because in the footer it sits
            under the mobile tab bar on every screen that mounts one, and the
            answer to an occluded control is not to pad a footer this product
            deliberately hides on a phone. */}
        <ListRowAnchor
          href="mailto:admin@signalera.ai"
          label="Support"
          sub="admin@signalera.ai"
          bottomRule
        />
      </div>
    </div>
  );
}
