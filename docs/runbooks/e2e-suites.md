# Running the e2e suites without measuring the wrong thing

Two Playwright suites live under `e2e/`. They have different targets, and
running one against the other's target does not error; it fails 25 to 60
tests with messages that blame the product. Both traps below were hit on
2026-09-05 in one run (39 pass, 85 fail), and the config now refuses the
first and names the second.

## 1. The local gate: `npm run test:e2e`

What it runs: the `setup` project (a real sign-in as the e2e account, saved
to `e2e/.auth/user.json`) and then every spec under `e2e/` except
`auth-smoke`, `prod-smoke-5route` and `pressure/`, against a DEV server on
`http://localhost:3000` that Playwright starts itself with `npm run dev`.

What it needs:

- `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` in `.env.local`, for an account on
  `beta_allowlist`. A non-allowlisted account is signed out by the proxy on
  the first gated route and every signed-in test sees `/waitlist`.
- Port 3000 FREE. The config no longer reuses a server it did not start.
  On 2026-09-05 a dev server from another worktree, started three weeks
  earlier, was sitting on 3000; Playwright reused it, and 60 of the 85
  failures were 404s and stale markup from that checkout: every mobile
  screen (`/claim`, `/compose`, `/watch`) 404'd because that checkout
  predated them. With reuse off, an occupied port fails at startup with
  Playwright's "already used" message, which is the honest failure.
- To run against a server you started yourself from THIS checkout (say, on
  another port because 3000 is taken), opt in explicitly:

```
E2E_LOCAL_URL=http://localhost:3100 E2E_REUSE_SERVER=1 npm run test:e2e
```

What a dev server means for the results: `NODE_ENV=development` makes the
mobile routes public and serves their FIXTURES to a signed-out visitor
(`mobileFixtureScreensEnabled()`). The "sample content" tests in
`watch.spec.ts` rely on that. A production build shows those routes to a
signed-out visitor only with `VERCEL_ENV=preview`, and never serves fixtures.

The suite is mutating and its only configured target is the production
Supabase project. It runs as the e2e account, whose rows RLS scopes to it.
Run it supervised. Agents do not run it unattended.

Tests that depend on pipeline state, not account state, skip with a reason
rather than time out: `commit-note-gate.spec.ts` skips a surface whose brief
carries no calls that day (a weekend, for instance). A skip there is not a
pass and not a product failure; rerun on a day the brief has calls.

Tests that depend on account state make it themselves through
`e2e/fixtures.ts` (the app's own `/api/watchlist` routes, as the signed-in
user) and restore the account afterwards. Do not hand-populate the e2e
account to make a test pass; write the fixture.

## 2. The pressure suite: `npm run test:pressure`

What it runs: only `e2e/pressure/`, with its own config
(`e2e/pressure/pressure.config.ts`), in file order, one worker, no retries.
`00-environment` proves the target and writes `e2e/.auth/pressure.json`;
`10` through `50` walk and measure; `90-verdict` assembles the report from
`pressure-report/`.

What it needs, and it starts NONE of this itself:

1. A production build of this checkout:

```
npm run build
```

2. That build served on port 3370 with `VERCEL_ENV=preview` and nothing else
   set. `next start` gives `NODE_ENV=production`, so no screen serves a
   fixture; `VERCEL_ENV=preview` (unprefixed, read server-side by
   `src/proxy.ts`) opens the mobile routes as public paths, which is what a
   signed-out context needs and what gets an un-allowlisted account past the
   gate. Do NOT set `NEXT_PUBLIC_VERCEL_ENV`: the client bundle was compiled
   without it and setting it server-side only is a hydration mismatch.

```
VERCEL_ENV=preview npx next start -p 3370
```

3. The e2e credentials in `.env.local`, as above. `00-environment` signs in
   for real and saves the state the later specs load.

4. Then, in a second terminal:

```
npm run test:pressure
```

What goes wrong without each, and what you see now instead of a stack:

- No server on 3370: every spec fails in `launch()` with
  `PRESSURE PREREQUISITE MISSING: nothing answers on http://localhost:3370`
  and the start commands above. Before: `net::ERR_CONNECTION_REFUSED` inside
  a `goto` in `00-environment`, then 24 unrelated-looking failures.
- `00-environment` not run first: every later spec fails in `phoneContext()`
  with `PRESSURE PREREQUISITE MISSING: e2e/.auth/pressure.json does not exist`
  and the step that writes it. Before: "Error reading storage state" twelve
  times, and `90-verdict` complaining the walk visited nothing.
- Run through the default config by accident: it cannot happen any more; the
  default projects ignore `e2e/pressure/`.

`PRESSURE_BASE_URL` overrides 3370 if you must use another port.

## 3. Reading a failed run

Playwright writes `test-results/<test>/error-context.md` per failure: the
error, the locator, and a page snapshot. Read the snapshot before the error.
A snapshot showing a `404` heading on a route that exists in this tree, or
"Open Next.js Dev Tools" when you expected a production build, is the
environment, not the test. The triage of 2026-09-05 is in the PR that added this file.
