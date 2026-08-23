/**
 * Production gate for the mobile redesign's fixture screens.
 *
 * A fixture screen draws invented data. `/company/[id]` already serves real,
 * server-resolved company detail, filings, insider rows and financials for a
 * real ticker, so an ungated fixture on that route would show invented
 * financials and invented insider activity attributed to a real company. This
 * is the switch that stops that, and it is the sharpest version of the risk in
 * the mobile programme.
 *
 * FAILS CLOSED. Exactly two ways through: a build that is not production, or an
 * explicit Vercel preview deployment. Anything else, including an unset,
 * misspelled or unexpected environment value, lands on the production branch
 * and gives back false.
 *
 * Both reads are `process.env.<LITERAL>`, which Next inlines at build time, so
 * a production bundle carries the constant and the fixture branch is
 * unreachable rather than merely unvisited.
 */
export function mobileFixtureScreensEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Local development only, on the precedent `src/proxy.ts` already set for the
 * mobile redesign dev paths.
 *
 * `/company/[id]` enforces auth a second time in the page body, below the
 * proxy, so `MOBILE_REDESIGN_DEV_PATHS` cannot open it: a signed-out client
 * still lands on `/auth` and every parity, audit and smoke run measures the
 * sign-in page instead of the screen. A build agent cannot obtain a session, so
 * without this the whole verification chain is unrunnable.
 *
 * Deliberately NARROWER than mobileFixtureScreensEnabled: a preview deployment
 * keeps its auth redirect. This only ever opens on a development server.
 */
export function mobileFixtureAuthBypass(): boolean {
  return process.env.NODE_ENV === "development";
}
