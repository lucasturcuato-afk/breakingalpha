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
 *
 * THE PREVIEW LEG IS UNVERIFIED, and nothing should be claimed for it. Two
 * things have to be true for it to open a screen on a preview deployment and
 * neither is confirmed:
 *
 *   1. `NEXT_PUBLIC_VERCEL_ENV` appears nowhere else in `src/`. The only
 *      Vercel variables this repo reads are the server-side `VERCEL_ENV`
 *      (`src/app/api/brief/export-pdf/route.ts:260`) and
 *      `VERCEL_AUTOMATION_BYPASS_SECRET`. Vercel only supplies the
 *      NEXT_PUBLIC_ form when "Automatically expose System Environment
 *      Variables" is on for the project, and that setting has not been read.
 *   2. Even with it on, `MOBILE_REDESIGN_DEV_PATHS` in `src/proxy.ts` is
 *      gated on `NODE_ENV !== 'production'` with no preview clause, so a
 *      preview deployment sends a signed-out visitor to `/auth` before this
 *      is ever consulted.
 *
 * Both failure modes fail CLOSED, which is why the leg stays as written. The
 * half that matters is the production half, and that one is verified against a
 * real production build.
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
