import type { Metadata } from "next";
import { dealsFixture } from "@/components/deals-mobile/fixture";
import { DealsFixtureProvider } from "@/components/deals-mobile/fixture-context";

export const metadata: Metadata = {
  title: "Deal Flow — Signalera",
};

/**
 * This layout owns the fixture gate, and it is the right place for it because
 * it is the only server component on the route.
 *
 * The mobile screen draws the design's four invented deals in development and
 * on a preview so parity has the design's own strings to pair against. Those
 * deals name real public companies and describe transactions that did not
 * happen, so they must not reach a reader.
 *
 * The gate used to run in the browser. It did fail closed, so nothing
 * fabricated was ever drawn on the page, but deciding in the browser means
 * SHIPPING BOTH BRANCHES: `page.tsx` is a client component, it imported the
 * fixture module, and a production build put every string into the client
 * bundle. Measured on the previous pass, "Blackstone and TPG weigh a joint
 * take-private of Hologic" was readable in three chunks under
 * `.next/static/chunks/`, on the product's own domain, with no session needed.
 *
 * Deciding here means shipping one branch. `dealsFixture()` answers `null`
 * outside development and preview, the module carries `import "server-only"`
 * so it cannot be pulled back across the boundary by accident, and the client
 * receives a value rather than a condition it could evaluate wrongly. No query
 * parameter turns `null` into a deal.
 *
 * That gate is the only defence these strings have. `isPublicPath` in
 * `src/proxy.ts` blocks only when there is no user, so MOBILE_REDESIGN_DEV_PATHS
 * has never gated production for a signed-in reader: they reach this route.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <DealsFixtureProvider value={dealsFixture()}>{children}</DealsFixtureProvider>;
}
