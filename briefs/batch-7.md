# Batch 7 build brief: Landing, Onboarding, Sign in

Recon only. No implementation. Every repo path below was opened with Read.

Two of these three screens already have a live route and a live component. Landing
and Sign in are rebuilds against existing source, not net-new surfaces. Onboarding
is a rebuild whose step 7 renders an object the API does not return.

## Screens

### Landing

**Prototype flag:** `isLanding` (README Screens table, "Signed out. Typed headline,
loop demo, waitlist sheet."). Confirmed in `Signalera Mobile v3.dc.html` at line
1085, `<sc-if value="{{ isLanding }}">`, closing at 1274. Flag is set at line 3241,
`isLanding: s.screen === 'landing'`.

**Route:** `/` , served by `src/app/page.tsx`. Exists. No new route needed. The
page is a server component that reads the Supabase user and `redirect("/dashboard")`
when signed in, otherwise renders `<OpeningScreen />`. The mobile landing inherits
that gate for free.

**Mapped sources:**

- `src/app/page.tsx` (35 lines). Signed-in redirect to `/dashboard`, else
  `OpeningScreen`. Not named in github.md but it is the route that owns the screen.
- `src/components/landing/opening-screen.tsx` (1308 lines). Confirms every claim
  github.md makes about the hero and then some. The typed target is a literal at
  line 463: `const target = "We track which calls hold up.";`. `heroSetup` copy
  "Anyone can summarize the market." at 496. `.heroPara` at 502 to 505.
  `.heroDisclaimer` "Informational only. Never advice." at 506. `btnGhost`
  "See how it works" wired to `onSeeHow={scrollTo("demo")}` at 340 and 511, and
  `LoopSection` carries `id="demo"` at 565, so the scroll target resolves.
  `.heroBadge` "free trial · invite-only during early access" at 519. The five
  loop node labels at 107. The three DEMO scenes at 101 to 105. The 800 / 1700 /
  3300 / 4100 / 6300 timings at 554 to 558.
- `src/components/landing/landing.module.css` (846 lines). `.heroH1` at 252 is
  `color: var(--ink); font-weight: 500` with no two-tone rule, exactly as github.md
  states. `.heroSetup` at 253 to 256 is 20px italic weight 400 with 14px bottom
  margin. `.heroHeadline` at 257 to 260 is 58px weight 500 at `-0.02em`.
  `.heroCursor` at 261 to 264 is `width: 0.5em; height: 0.82em`, brass, blinking on
  `steps(2,start)`. All four verbatim as documented.
- `src/components/landing/waitlist-modal.tsx` (523 lines). See the sub-surface
  below.
- `src/components/landing/ticker-preview-card.tsx` (41 lines). Opened and verified.
  It is NOT imported by `opening-screen.tsx` (that file imports only
  `WaitlistModal`, `useTheme` and the CSS module). A repo-wide grep for
  `ticker-preview-card` and `TickerPreviewCard` returns only the definition file
  itself, so it is dead code app-wide, not merely unused by the landing. Do not
  reintroduce it. It also hardcodes `#16a34a` / `#dc2626` outside the token system
  and renders a bare price plus percent, which is the "price as hero" pattern the
  watchlist source explicitly demotes.

### Landing, waitlist sheet (named sub-surface)

**Prototype flag:** nested `<sc-if value="{{ wlOpen }}">` inside `isLanding`, at
line 1224 of the .dc.html, with `wlForm` / `wlSuccess` / `wlIsSignup` branches.
State wiring at 3295 to 3303. This is the sheet, not a separate screen flag.

**Route:** none of its own. It is component state on `/`. github.md is explicit:
"This is a DIFFERENT surface from `/auth`: it is waitlist-framed, where `/auth` is
sign-in framed. Both are now built." Do not merge them.

**Mapped sources:**

- `src/components/landing/waitlist-modal.tsx`. Every string github.md claims is
  verbatim is verbatim: headings "Welcome back." / "Join the waitlist." at 272,
  both sublines at 273 to 275, the fine print "Private beta. Access opens in small
  waves. Informational only, never advice." at 513 to 516, the success title
  "Check your email." at 326, EMAIL / PASSWORD / CONFIRM PASSWORD label casing at
  401, 427 and 464, and the confirm field gated on `{!isSignin && ...}` at 461.
  It carries a real focus trap, Escape handling, body scroll lock and focus
  restore at 141 to 185, which the mobile sheet must not lose.
- `src/components/landing/landing.module.css`. The `@media (max-width: 560px)`
  block at 837 to 846 already turns this modal into a bottom sheet:
  `align-items: flex-end`, `border-radius: 16px 16px 0 0`,
  `transform: translateY(100%)` with `.modalPanelIn { transform: none }`, and
  `padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px))`. The safe-area
  respect README demands is already in the source. Reuse it, do not rewrite it.
- `src/lib/allowlist.ts`, `src/lib/waitlist-register-client.ts`. The sheet's
  sign-in path calls `isAllowlisted` then `postWaitlistRegister(email,
  "landing_signin")`, signs out and sends the user to `/waitlist` (222 to 229).

### Onboarding

**Prototype flag:** `isOnboard` (README: "7 steps: name, role, strategy, sectors,
horizon + workflow, tickers, generated preview thesis."). Confirmed in the .dc.html
at line 914, closing at 913 + 172. Flag set at 3294,
`isOnboard: s.screen === 'onboard', goOnboard: () => this.setState({ screen:
'onboard', obStep: 1 })`.

**Route:** `/onboarding`, served by `src/app/onboarding/page.tsx`. Exists. No new
route needed.

**Mapped sources:**

- `src/app/onboarding/page.tsx` (37 lines). Server component. Redirects to `/auth`
  with no user, and to `/dashboard` when `profile.onboarding_completed`. Its own
  doc comment states "Driven by proxy.ts: new users (onboarding_completed = false)
  are redirected here from any gated route." That redirect drops the query string,
  which is where the adopt id dies. See Open questions.
- `src/components/onboarding/OnboardingWizard.tsx` (2030 lines).
  **Line numbers verified.** `canProceed()` is declared at line 501; its seven step
  conditions occupy lines **502 to 508** exactly as github.md cites, with
  `return false` at 509. `ctaDisabled` is at line **642** exactly as cited. Both
  hold, unmoved. One wording correction: github.md calls it "the `canProceed`
  switch". It is not a `switch`, it is a chain of seven `if` statements. Nothing
  turns on that, but do not go looking for a `switch` block.
  Other confirmations: `TOTAL_STEPS = 7` at 67. `ROLES` at 18 to 26, `STRATEGIES`
  at 28 to 34, `SECTORS` (ten entries) at 36 to 47, `HORIZONS` at 49 to 53,
  `WORKFLOWS` at 55 to 59, `RISK_OPTIONS` at 61 to 65. `StepDots` at 432. The
  persona bar is `SignalPreviewPanel`, rendered at 762 under the condition
  `step >= 2 && step <= 6 && step !== 5`, with a separate `Step5Panel` at 772 and
  `Step7FeedPanel` at 782. github.md says "the persona bar on steps 2-6"; the
  source excludes step 5 from that component and gives it its own panel. The
  prototype's `obPersona: ob >= 2 && ob <= 6` (.dc.html 3312) includes step 5.
  All seven `<SectionTitle kicker= title=>` pairs are verbatim as github.md claims
  (1639, 1708, 1739, 1772, 1833, 1916, 1990). The `body` props are NOT verbatim and
  github.md does not claim they are; the design rewrites all seven.
- `src/app/api/onboarding/preview-thesis/route.ts` (118 lines). Gemini 2.5 Flash,
  `responseMimeType: "application/json"`, auth-gated (401 without a user), with a
  `FALLBACK` object returned on missing key, unparseable JSON, or any thrown error,
  so the endpoint never fails the step. Response shape is
  `{ title, sector, conviction, rationale }` where `conviction` is one of
  `HIGH | MEDIUM | WATCH | BEARISH`. The design's step 7 card renders a different
  object entirely. See NOT PORTED and deviations.

### Sign in

**Prototype flag:** `isSignin` (README: "Google OAuth + email/password.
Check-email and closed-beta waitlist outcomes."). Confirmed in the .dc.html at
line 1804, closing at 1886. Flag set at 3655,
`isSignin: s.screen === 'signin'`.

**Route:** `/auth`, served by `src/app/auth/page.tsx`. Exists. No new route needed.
The closed-beta outcome in production is a separate route, `/waitlist`
(`src/app/waitlist/page.tsx`), reached by `window.location.href = "/waitlist"`. The
design renders that outcome inline on the sign-in screen. See NOT PORTED.

**Mapped sources:**

- `src/app/auth/page.tsx` (404 lines). Sign In / Create Account toggle at 235 to
  266, Google OAuth as the only third-party route at 269 to 293, email plus
  password with an eye reveal at 312 to 347, "Password reset coming soon." at 362,
  "Check your email to confirm your account." at 219, the terms footer at 385 to
  388, and the three feature lines at 132 to 136. All verbatim as github.md claims.
  It reads its destination at click time via `destination()` at 20 to 24 rather
  than `useSearchParams`, with the stated reason being to avoid forcing a Suspense
  boundary.
- `src/lib/auth-copy.test.ts` (67 lines). Read in full. It is a Node
  `node:test` suite that `readFileSync`s `src/app/auth/page.tsx` and asserts
  against the raw file text. Exactly what it enforces, and therefore what
  constrains the mobile Sign in screen:
  1. The page must not contain the strings `thesis board`,
     `Trusted by analysts at top-tier firms`, or
     `Join analysts tracking signals`.
  2. No quoted string of 20 or more characters anywhere in the file may match
     `/thesis|theses/i`. The comment gives the reason: "#548 retired user theses;
     everything is a call."
  3. The whole file must not match
     `/trusted by|industry[- ]leading|world[- ]class|top[- ]tier/i`.
  4. The page MUST contain all three of:
     "Falsifiable market calls, published before the outcome is known",
     "Every call scored against the close with benchmark attribution",
     "The misses stay on the record, next to the hits".
  5. The page MUST contain
     "Calls are timestamped before the close and graded after it".
  6. The page must match `/misses/i`.
  Rules 1 through 3 are grep-over-source, so they bind comments and identifiers,
  not just rendered copy. Rules 4 and 5 are exact-substring requirements: if the
  mobile rewrite reflows those three feature lines or the footer line, the test
  fails. Note the design already breaks rule 4: the .dc.html sign-in renders "The
  misses stay on the record, next to **the rest**" (line 1877), not "next to the
  hits". Flagged, not resolved.
- `src/lib/allowlist.ts` (40 lines). `isAllowlisted(supabase, email)` lowercases
  the email, reads one `beta_allowlist` row under RLS policy `allowlist_read_self`,
  and **fails closed**: any query error, including RLS denial or a network failure,
  returns false, meaning deny. The sign-in path calls it at page.tsx:68 and on a
  false result runs `postWaitlistRegister(email, "auth_signin")`,
  `supabase.auth.signOut()`, then `window.location.href = "/waitlist"`.
- `src/lib/auth-redirect.ts` (64 lines). Pure, no React or Supabase.
  `POST_AUTH_DEFAULT = "/dashboard"`. `CALL_ID` regex at 32.
  `safeNext` rejects absolute, protocol-relative and `/\` paths.
  `callDestination(id)` returns `/radar/calls?adopt=<id>#call-<id>`.
  `postAuthDestination(search)` prefers `adopt` over `next` and falls back to
  `/dashboard`. Its header comment says plainly that the id used to die at the auth
  page.
- `src/lib/waitlist-register-client.ts` (33 lines). `postWaitlistRegister` returns
  no allowlist status by design; the endpoint answers a constant `{ ok: true }` so
  the private beta cannot be enumerated. Callers must not branch on it.
- `src/app/auth/callback/route.ts` (131 lines). The server-side gate. Rate limited
  10 per minute per IP. On allowlist hit it honours
  `safeNext(searchParams.get('next')) ?? POST_AUTH_DEFAULT` at 94. On miss it
  registers, sends the confirmation email, signs out, and redirects to
  `/waitlist` or `/waitlist?existing=1` depending on `alreadyNotified`, at 111 to
  127.
- `src/app/waitlist/page.tsx` (89 lines). The production closed-beta destination.
  Server component reading `?existing=1` and rendering two copy variants:
  "You're on the list." and "You're already on the list."

## Shared component to extract first

**The auth form body.** Name it something like `AuthFormBody`. It is the single
biggest duplication in this batch and it is already duplicated twice in the repo.

Consumers:
1. Landing waitlist sheet, `src/components/landing/waitlist-modal.tsx`
2. Sign in, `src/app/auth/page.tsx`
3. Onboarding does not consume it. It is listed here only to say so explicitly.

What is genuinely identical across the two, verified line by line:
- The Google OAuth button, including the same four-path inline SVG with the same
  fills `#4285F4` / `#34A853` / `#FBBC05` / `#EA4335`
  (waitlist-modal.tsx 371 to 388, auth/page.tsx 274 to 291). Byte-identical.
- Sign In / Create Account tab pair with identical labels.
- Email and password inputs with a `lucide-react` `Eye` / `EyeOff` reveal toggle.
- The Supabase calls: `signInWithPassword`, then `isAllowlisted`, then
  `postWaitlistRegister` plus `signOut` plus `/waitlist` on deny; and
  `signUp` with `emailRedirectTo: ${origin}/auth/callback` then
  `postWaitlistRegister` then the check-email state.
- The check-email success panel, including the "Back to sign in" affordance.

What varies, and must therefore be props, not forks:

| Varies | Waitlist sheet | Sign in |
|---|---|---|
| Framing and heading | "Join the waitlist." / "Welcome back." | no heading, brand lockup only |
| Subline | invite-only / small-waves copy | none |
| Confirm password field | present on Create Account only (461) | absent entirely |
| Error presentation | per-field inline, routed by `routeError` (45 to 49), `aria-invalid` | one shared error block above the form (305 to 309) |
| Client-side validation | `EMAIL_RE` plus match check before any auth call (190 to 201) | none, `required` attributes only |
| Forgot password | absent | present with the "Password reset coming soon." toast (349 to 367) |
| Post-signin destination | hardcoded `/dashboard` (228) | `postAuthDestination(window.location.search)` (20 to 24, 76) |
| Google `redirectTo` | bare `/auth/callback` (262) | `/auth/callback?next=<destination>` (115 to 117) |
| Fine print | "Private beta. Access opens in small waves..." (513) | "By continuing, you agree to..." (385) |
| Feature lines | none | three, and `auth-copy.test.ts` requires them exactly |
| Container | bottom sheet with focus trap, Escape, scroll lock | full page, two-column at `lg` |

The last two rows of behaviour divergence are bugs in waiting, not styling choices.
See Open questions 6.

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| Landing route shell | `src/app/page.tsx` | Reusable as-is | Signed-in redirect already correct; only the child changes |
| Opening screen | `src/components/landing/opening-screen.tsx` | Needs variant | Mobile drops IntroGate and MarketReadSection; hero copy is under compliance ruling |
| Landing style module | `src/components/landing/landing.module.css` | Needs variant | Already carries the sub-560px bottom-sheet block; hero type scale changes 20/58 to 17/38 |
| Hero typed headline | `opening-screen.tsx` 463 to 489 | Needs variant | 42ms per char, 700ms delay, cursor dropped 2400ms after; string itself is conflict 3 |
| Loop demo | `opening-screen.tsx` `LoopSection` 528 to 647 | Needs variant | Five-node rail plus three scenes port; the espresso card and pill colours are respecified by README |
| Timeline | `opening-screen.tsx` `TimelineSection` 650 to 873 | Needs variant | Five beats port; the embedded ledger stats block at 829 to 833 renders "evidence supported 71.6% to 71.4%" |
| Proof tabs | `opening-screen.tsx` `ProofSection` 876 to 986 | Needs variant | Week one / week four both port; two-column grid becomes one column |
| Surfaces list | `opening-screen.tsx` `SurfacesSection` 1186 to 1209 | Reusable as-is | Nine names and blurbs are data at 140 to 150 |
| University block | `opening-screen.tsx` `UniversitySection` 1212 to 1232 | Reusable as-is | Real `mailto:` anchor |
| Inline waitlist form | `opening-screen.tsx` `WaitlistSection` 1239 to 1276 | Needs variant | Already delegates to the shared modal; keep that |
| Footer | `opening-screen.tsx` `SiteFooter` 1279 to 1308 | Reusable as-is | Real `next/link` to `/legal/terms` and `/legal/privacy` |
| Scroll progress bar | `opening-screen.tsx` `ScrollProgress` 362 to 381 | Needs variant | Passive listeners, writes width directly; harmless on mobile but not in the design |
| Reveal wrapper | `opening-screen.tsx` `Reveal` 171 to 205 | Reusable as-is | Content visible by default, observer only replays the rise. Matches README's "must rest in the drawn state" rule |
| Reduced-motion hook | `opening-screen.tsx` `useReducedMotion` 156 to 166 | Reusable as-is | Needed by every screen in this batch |
| Intro gate + signal wall | `opening-screen.tsx` `IntroGate` 384 to 451, `WALL_COLUMNS` 39 to 96 | Net new: none, deliberately dropped | NOT PORTED per github.md |
| Market read + live feed | `opening-screen.tsx` `MarketReadSection` 995 to 1183 | Net new: none, deliberately dropped | NOT PORTED per github.md |
| Ticker preview card | `src/components/landing/ticker-preview-card.tsx` | Do not use | Dead app-wide; zero importers |
| Auth gate overlay | `src/components/landing/auth-gate.tsx` | Do not use | Not mapped by github.md. It applies `filter: blur(3px)` at line 20, which is the frosted glass README forbids |
| Waitlist / auth sheet | `src/components/landing/waitlist-modal.tsx` | Needs variant | Extract the form body first; keep the focus trap |
| Shared auth form body | none | **Net new** | Closest analogues are `waitlist-modal.tsx` 342 to 517 and `auth/page.tsx` 232 to 381 |
| Onboarding route shell | `src/app/onboarding/page.tsx` | Reusable as-is | Server gate is correct |
| Onboarding wizard | `src/components/onboarding/OnboardingWizard.tsx` | Needs variant | Desktop is a two-column split with a right preview panel; mobile is single column with the panel content folded into the step |
| Step dots | `OnboardingWizard.tsx` 432 to 455 | Needs variant | Source is a width-morphing pill row; design is seven equal 2px segments (.dc.html 921) |
| Section title | `OnboardingWizard.tsx` 1589 to 1613 | Needs variant | Kicker plus 32px Playfair title plus body; design uses 27px |
| Dark pill option card | `OnboardingWizard.tsx` `DarkPill` 1671 to 1697 | Needs variant | Design's `obCard` is the same anatomy on cream tokens rather than white-on-espresso |
| Gated CTA | `OnboardingWizard.tsx` 736 to 747 | Needs variant | Source disables via `opacity-40`; README mandates `--c-locked-bg` / `--c-locked-ink` at 5.39:1 instead |
| Preview thesis endpoint | `src/app/api/onboarding/preview-thesis/route.ts` | Needs variant | Response shape does not carry what the design's card renders |
| Sign in page | `src/app/auth/page.tsx` | Needs variant | Left 55 percent panel is already `hidden lg:flex`, so mobile inherits the right card only |
| Allowlist check | `src/lib/allowlist.ts` | Reusable as-is | Pure, fails closed |
| Post-auth destination | `src/lib/auth-redirect.ts` | Reusable as-is | Pure. Already exports everything the adopt banner needs |
| Waitlist register client | `src/lib/waitlist-register-client.ts` | Reusable as-is | Never throws, returns no approval status |
| Waitlist outcome page | `src/app/waitlist/page.tsx` | Needs variant | Two copy variants keyed on `?existing=1`; the design has one |
| Adopt-flow banner | none | **Net new** | Closest analogue is `auth-redirect.ts` `postAuthDestination`, which already computes the condition. Design renders it at .dc.html 1814 to 1819 |

## States

### Landing

- **Loading:** UNSPECIFIED in the handoff. The route is a server component that
  awaits `supabase.auth.getUser()`, so a real first-paint gap exists and nothing in
  the design covers it.
- **Error:** UNSPECIFIED. `src/app/page.tsx` does not handle a failed
  `getUser()`; it destructures `data.user` and falls through to the signed-out
  render. Worth knowing, not in scope to fix here.
- **Empty:** not applicable. Every string on this screen is a literal.
- **Stale:** not applicable.
- **Motion states that do exist:** typed headline in progress versus resolved
  (cursor removed 2400ms after completion), and the reduced-motion path which
  writes the final string instantly (`opening-screen.tsx` 468 to 471). The .dc.html
  mirrors both.

### Landing, waitlist sheet

- **Closed / open:** `wlOpen`. Rises on `v3up`, 300ms.
- **Form, sign-in mode:** heading "Welcome back.", no confirm field.
- **Form, create-account mode:** heading "Join the waitlist.", confirm field
  present.
- **Loading:** submit label swaps to "Signing in..." / "Joining..."
  (waitlist-modal.tsx 276 to 282). The .dc.html has no in-flight state; the
  prototype's `wlSubmit` transitions instantly (3309). UNSPECIFIED in the design,
  present in the source. Use the source.
- **Error:** per-field inline in the challenged colour, `.modalFieldErr`
  (landing.module.css 802), routed by `routeError`. The .dc.html has no error
  branch at all. UNSPECIFIED in the design.
- **Success:** `wlSuccess`, "Check your email." plus "Back to sign in".
- **Empty / stale:** not applicable.

### Onboarding

Seven steps. Per-step gate condition, taken from `canProceed()` at
`OnboardingWizard.tsx` 502 to 508, with the prototype's mirror at .dc.html 3196 to
3201 noted where it differs.

| Step | Title | Gate condition (source, line) | Prototype mirror |
|---|---|---|---|
| 1 | Welcome to Signalera. | `firstName.trim().length > 0` (502) | **Not gated.** `obCan` falls through to `true` for step 1. Implement the source condition, not the prototype's |
| 2 | What do you do? | `role !== null` (503) | `!!obRole`, matches |
| 3 | What's your mandate? | `strategy !== null` (504) | `!!obStrat`, matches |
| 4 | What sectors do you follow? | `sectors.length >= 1` (505) | `length >= 1`, matches |
| 5 | Horizon and workflow. | `horizon !== null && workflow !== null` (506) | `!!obHorizon && !!obWork`, matches |
| 6 | Any tickers you watch? | `true`, optional (507) | `true`, matches |
| 7 | Here's what Signalera looks like for you. | `true` (508), but the CTA is separately blocked by `ctaDisabled = !canProceed() \|\| saving \|\| (step === 7 && previewLoading)` (642) | `s.obPreview !== 'loading'`, matches the effective behaviour |

- **Loading, step 7:** the generating state. Source shows a pulsing dot plus
  "Generating a preview thesis…" (1995 to 2006) with the title unchanged. Design
  shows a five-bar skeleton under a changed title, "Writing yours now." plus
  "Reading this morning's brief against the profile you just set." (.dc.html 1035
  to 1049). Two different treatments of the same state.
- **Loading, saving:** CTA label becomes "Saving..." (634 to 635) and both Back and
  CTA disable. UNSPECIFIED in the design; the prototype's `obNext` jumps straight
  to the ledger.
- **Error, step 7:** source sets `previewError` and renders a "Retry preview"
  button (2018 to 2027). **The design has no error branch**: `obPreviewReady` is
  defined as `s.obPreview !== 'loading'` (.dc.html 3337), so failure and success
  render the same card. UNSPECIFIED and a real gap.
- **Error, save:** source renders `error` in `#f87171` beneath the step content
  (712 to 716). UNSPECIFIED in the design.
- **Empty:** step 6 with no tickers has copy in both, source at 1949 to 1951,
  design shows suggested-ticker chips instead.
- **Stale:** not applicable.

### Sign in

- **Form (default):** `authForm`, `authStage === 'form'`. Google, OR rule, email,
  password with reveal, mode-dependent CTA, terms footer, three feature lines.
- **Adopt-flow variant:** `adoptFlow`, .dc.html 1814 to 1819. A "CONTINUING TO A
  CALL" well above the tabs, "Signing in lands you on the call you followed in
  from, not on the dashboard." In the prototype this is hardcoded `adoptFlow: true`
  (3622). In production the condition is derivable, `postAuthDestination(search)
  !== POST_AUTH_DEFAULT`, but the live page renders nothing of the kind.
- **Loading:** submit label becomes "Please wait...", button `disabled`
  (auth/page.tsx 371 to 378). UNSPECIFIED in the design.
- **Error:** one shared block above the form carrying the raw Supabase message
  (305 to 309). UNSPECIFIED in the design; the .dc.html has no error branch.
- **Check-email outcome:** `authCheckEmail`, `authStage === 'email'`. "Check your
  email" plus "Check your email to confirm your account." plus "Back to sign in".
  Matches the source at 210 to 231 verbatim.
- **Closed-beta waitlist outcome:** `authWaitlist`, `authStage === 'waitlist'`.
  Design: BETA eyebrow, "You are on the list", "Signalera is in closed beta. Your
  account is registered and you will hear from the desk when a seat opens.", plus
  "Back to sign in", rendered inline. Production: a hard navigation to `/waitlist`
  after `signOut()`, with two copy variants ("You're on the list." and "You're
  already on the list.") keyed on `?existing=1`, plus a support mailto and a "Back
  to homepage" link. Structurally different. See NOT PORTED.
- **Forgot-password toast:** `forgotToast`, "Password reset coming soon.", 3s
  timeout in the source (353 to 356), no timing given in the design.
- **Empty / stale:** not applicable.

## Lucas-protected files

None. This batch's sources touch none of
`src/app/api/briefing/route.ts`, `src/lib/watchlist-utils.ts`,
`src/components/watchlist/WatchlistAddInput.tsx`, or `src/app/trends/page.tsx`.

One adjacency worth stating so nobody trips into it: `OnboardingWizard.tsx`
`handleFinish` posts each selected ticker to `/api/watchlist` at 567 to 597. That
is an HTTP call to an API route, not an import of `watchlist-utils.ts` or
`WatchlistAddInput.tsx`. The mobile onboarding lands by calling the same endpoint.
No protected file is edited.

## Designed fresh, no repo counterpart

None. github.md maps all three screens in this batch to real repo source. For
contrast, the screens it does mark fresh are Story ("designed fresh. No article
reader exists in the repo; rendering is publisher-indexed."), Saved / offline
("designed fresh. No repo counterpart found."), Alerts ("designed fresh. No repo
counterpart found. Deliberately states that nothing here can interrupt a browser
tab.") and Ask directory ("designed fresh. No mobile browse surface exists in the
repo..."). None of those is in batch 7.

No path github.md maps to these three screens is missing. Zero MAPPED BUT MISSING.

## NOT PORTED and deviations

### Compliance conflicts, live string versus design replacement

All five are open. None is resolved here. In every case the design and the shipping
product disagree, and someone has to rule.

**Conflict 3, landing h1.** README: "Landing headline 'We track which calls **hold**
up' contains a banned substring. Design renders 'which calls the evidence supports'
| `landing/opening-screen.tsx` + live site".
- Live: `opening-screen.tsx:463`, `const target = "We track which calls hold up.";`
- Design: `Signalera Mobile v3.dc.html:3043`,
  `const target = 'We track which calls the evidence supports.';`
- github.md adds: "This is the most-quoted sentence in the product and the
  marketing site and this design now disagree on it."

**Conflict 4, `.heroPara`.** README: "`.heroPara` contains 'the calls that did not
**hold**'. Design renders 'the calls the evidence ran against' |
`landing/opening-screen.tsx`".
- Live: `opening-screen.tsx:502` to `505`, "...Signalera grades every call against
  the evidence, including the calls that did not hold, and gets sharper the longer
  you use it."
- Design: .dc.html:1098, the same sentence with "including the calls the evidence
  ran against".

**Conflict 5, role labels.** README: "Role labels 'Buy-Side Analyst' /
'Sell-Side Analyst' contain banned words inside ordinary job titles. Design renders
'Fund Analyst' / 'Equity Research' against the same enum ids |
`settings/profile/page.tsx`, `OnboardingWizard.tsx`".
- Live, in my file: `OnboardingWizard.tsx:20`,
  `{ id: "buy_side", label: "Buy-Side Analyst", description: "Fund research &
  portfolio" }` and `:21`,
  `{ id: "sell_side", label: "Sell-Side Analyst", description: "Equity research
  coverage" }`.
- Live, in the settings file the README also names: `settings/profile/page.tsx:24`
  and `:25`, same two labels with longer descriptions.
- Design: .dc.html:947 "Fund Analyst" / "Fund research and portfolio" and :948
  "Equity Research" / "Equity research coverage". Enum ids unchanged.

**Conflict 6, RIA description.** README: "RIA description 'Managing client
portfolios and allocations' contains a banned word | `settings/profile/page.tsx`".
- Live: `settings/profile/page.tsx:27`,
  `{ id: "ria", label: "RIA / Advisor", description: "Managing client portfolios
  and allocations" }`.
- The onboarding file in my batch is already clean on this one:
  `OnboardingWizard.tsx:23` reads
  `{ id: "ria", label: "RIA / Wealth Manager", description: "Managing client
  capital" }`.
- Design: .dc.html:950, "RIA / Wealth Manager" with "Managing client capital",
  matching the onboarding file rather than the settings file.
- So the two live files disagree with each other on the same enum id, before the
  design enters the argument at all. Flagged, not resolved.

**Conflict 7, Risk Appetite unported.** README: "**Risk Appetite** (defensive /
balanced / aggressive) reads as individualized suitability framing. Not ported |
`settings/profile/page.tsx` `RISK_OPTIONS`".
- The README's "Where" column is wrong or at least incomplete, and I am flagging
  rather than fixing it. A grep of `src/app/settings/profile/page.tsx` for
  `RISK_OPTIONS` returns nothing. `RISK_OPTIONS` is defined at
  `OnboardingWizard.tsx:61` to `65` and rendered on step 5 at `:1884` under a
  `Risk` label, with `riskAppetite` state at `:471`, submitted at `:553` and
  tracked at `:601`.
- Live step 5 title: `OnboardingWizard.tsx:1835`, "Horizon, workflow and risk."
- Design step 5 title: .dc.html:996, "Horizon and workflow."
- github.md states the consequence directly: "DEVIATIONS, both consequences of one
  omission: step 5's real title is 'Horizon, workflow and risk.' and is rendered
  'Horizon and workflow.' because `risk_appetite` (RISK_OPTIONS) is NOT PORTED,
  individualized suitability framing the product brief forbids".
- Downstream, unflagged by either document: `risk_appetite` is a request field of
  `POST /api/onboarding/preview-thesis` (`route.ts:15`, `:42`, `:66`) and drives
  the fallback conviction at `:33`,
  `conviction: body.risk_appetite === "aggressive" ? "HIGH" : "MEDIUM"`. Dropping
  the control does not drop the field. Whoever rules on conflict 7 has to say what
  the mobile client sends.

### NOT PORTED from the landing, quoted from github.md

> "NOT PORTED: the IntroGate signal wall (four scrolling columns of ambient cards),
> and the MarketReadSection live feed, both are ambient desktop-scale devices."

Both exist and are live. `IntroGate` is `opening-screen.tsx` 384 to 451, fed by
`WALL_COLUMNS` at 39 to 96: four columns, 58s / 74s / 46s / 86s durations,
alternating direction, 28 cards duplicated for the loop. It also locks body scroll
until entry (232 to 240) and carries the lede "Most of it will not matter to you.
The question is which calls hold up." at 442, which is the same banned substring as
conflict 3 in a second place in the same file. `MarketReadSection` is 995 to 1183,
a 3-second interval feed push plus three stat tiles, one of which renders
`EVIDENCE SUPPORTED {pct}%` at 1158 to 1164. Dropping it is also what keeps README
conflict 2 off the mobile landing.

> "Ticker preview cards from `ticker-preview-card.tsx` are NOT used by
> `opening-screen.tsx`; they were removed from the mobile landing when the real
> sections replaced them."

Verified true, and stronger than stated: zero importers anywhere in `src/`.

### Type-scale deviation, quoted from github.md

> "DEVIATIONS: type scaled to 390px preserving the source's setup/headline ratio
> (17px / 38px vs 20px / 58px); the h1 payoff line is restated to avoid a banned
> substring, see Open compliance conflicts."

Both halves verified. Source: `landing.module.css:254` `font-size: 20px` on
`.heroSetup`, `:258` `font-size: 58px` on `.heroHeadline`. Design: .dc.html:1095
`italic 400 17px/1.4` and :1096 `500 38px/1.06`. Ratio 2.9 versus 2.24, so the
ratio is not in fact preserved; the headline shrinks harder than the setup. Flagged.

The wider scale deviation from github.md's adherence pass also lands on this batch:

> "DESIGN SYSTEM ADHERENCE PASS: raised 41 type declarations that rendered below
> the design system's stated 10px floor (scale is 48/28/20/15/14/12/11/10) to that
> floor, and corrected 116 border-radius sites to the sanctioned 4/6/9/12/14
> scale."

Consequence for this batch: the onboarding option cards are 13.5px / 11.5px in the
design (.dc.html 947) against the source's `text-[13px]` / `text-[11px]`
(`OnboardingWizard.tsx` 1716 to 1721), and the source's `rounded-xl` on `DarkPill`
(1686) has to become one of 4 / 6 / 9 / 12 / 14.

### Retracted masthead gradient fix, quoted from github.md

> "DEVIATION, masthead gradient: the source stops are gold 0-30% then espresso from
> 75%. At 390px every line of masthead type lands inside the gold stop, and cream on
> Heritage Gold is 2.18:1. RETRACTED: an interim fix ran gold 0-10px then espresso
> from 18px, which rendered a 10px solid Heritage Gold bar down the full height of
> the band's left edge, a coloured left border, one of the four treatments the
> standing brief forbids, and wider than the 3-4px spines this project already
> removed on principle (ScoredObject's state spine, SectorSignalCard). It was
> logged here as a contrast fix without disclosing that. The band is now solid
> espresso with no gold background at all; 'Signal' is cream and 'era' is gold,
> which is this app's own established wordmark treatment."

Relevance to batch 7: the wordmark treatment that survived the retraction is the
one this batch renders four times. It is NOT the desktop landing's treatment.
Landing source uses `.brassSpan` on "era." (`opening-screen.tsx` 325, 438, 1285) and
auth uses Tailwind `text-espresso` / `text-gold` split (`auth/page.tsx` 150 to 151,
204 to 205). The design uses a vertical gradient fill on "era.",
`linear-gradient(180deg,#e8c77a 0%,#d4a84b 55%,#a8873a 100%)` with
`background-clip: text` (.dc.html 1088, 1226, 1808). Three treatments of one
wordmark across two documents and one codebase. Note also that README's own
"Design-system deviations" table still lists "Masthead gradient stops in px, not %"
as live, which contradicts github.md's retraction of exactly that. Both quoted,
neither resolved.

### Onboarding structural deviations found in the source, not flagged by either document

- **Step 4 sector count.** Source `SECTORS` has ten entries
  (`OnboardingWizard.tsx` 36 to 47). The design renders six chips: Technology,
  Healthcare & Biotech, Energy & Oil/Gas, Financial Services, Industrials &
  Manufacturing, Geopolitics & Macro (.dc.html 984). Consumer & Retail, Aerospace &
  Defense, Real Estate and Media & Telecom are absent. The design's `obMatch`
  helper hardcodes a six-key name map (.dc.html 3326). No document explains the cut.
- **Step 6 input model.** Source is a single-ticker `Input` plus an "Add" button
  plus removable pills, with validation `/^[A-Z.\-]{1,8}$/` at 489. Design is one
  comma-separated free-text field ("Comma-separated ticker symbols.") plus four
  "SUGGESTED FOR YOUR SECTORS" chips (+ VST, + LLY, + JPM, + ETN) that have no
  source counterpart at all (.dc.html 1026 to 1029). Two different data-entry
  models and one invented feature.
- **Step 7 card shape.** This is the largest gap in the batch. The API returns
  `{ title, sector, conviction, rationale }` (`route.ts` 18 to 23). The design's
  ready card renders sector, a ticker (CEG), a Playfair claim, a rationale
  paragraph, and a monospace footer reading
  `CHECKED 2026-08-27 · 21 DAYS · AGAINST XLU AND SPY` (.dc.html 1055 to 1063).
  Ticker, check date, horizon in days and benchmark are four fields the endpoint
  does not return. `conviction`, which it does return, is not rendered anywhere,
  and its `BEARISH` value has no place in the design's vocabulary.
- **Right-panel content.** Desktop has three distinct right panels, `BrandPanel`
  (step 1), `SignalPreviewPanel` (2, 3, 4, 6), `Step5Panel` (5), `Step7FeedPanel`
  (7), all inside `hidden md:flex` (752 to 796). At mobile width every one of them
  is currently invisible. The design folds only the persona chips and the step 5
  "WHAT THAT WINDOW CATCHES" well into the single column. Everything else in those
  four panels is silently dropped, and neither document says so.
- **Step 5 catalyst copy.** github.md: "Catalyst copy adapted from the horizon
  match table (7d / 30d / 90d / 1yr+)." The rendered strings are at .dc.html:3339,
  keyed short / medium / long, not 7d / 30d / 90d / 1yr+. The mapping between the
  two vocabularies is not written down anywhere I could find.
- **Compliance, unreviewed source strings in my batch's files.** Em dashes appear
  in user-facing onboarding copy at `OnboardingWizard.tsx:1950` (the string reads
  "No tickers yet", an em dash, then "you can skip and add them later from
  preferences.") and in the API fallback at
  `route.ts:28`, `:30` and `:35`. README compliance rule 4 forbids em dashes
  anywhere. Not flagged by github.md.

### Sign-in structural deviations

- **The closed-beta outcome is a route in production and a panel in the design.**
  Production: `signOut()` then `window.location.href = "/waitlist"`
  (`auth/page.tsx` 71 to 72), or a server redirect to `/waitlist?existing=1`
  (`callback/route.ts` 125 to 127). Design: an inline `authWaitlist` panel that
  keeps the user on the sign-in screen with a "Back to sign in" affordance
  (.dc.html 1872 to 1882). The design also has no equivalent of the `?existing=1`
  duplicate-arrival copy, and no equivalent of the "If you believe you should
  already have access, email admin@signalera.ai" line (`waitlist/page.tsx` 65 to
  73). Whichever way this is built, the design as drawn loses the duplicate variant.
- **The feature-line string diverges from the test.** Design line 3 reads "The
  misses stay on the record, next to the rest" (.dc.html 1877). `auth-copy.test.ts`
  line 51 requires the exact substring "The misses stay on the record, next to the
  hits". If that rewrite lands in `src/app/auth/page.tsx`, the test fails.
- **The adopt banner exists only in the design.** .dc.html 1814 to 1819. No
  counterpart in `auth/page.tsx`.

### Bearing on the two cold-start memories

Stated only from what these files show.

- **Non-allowlisted users bounce to `/waitlist`.** Confirmed and by design.
  `isAllowlisted` fails closed (`allowlist.ts` 33 to 37). Three call sites enforce
  it identically: `auth/page.tsx` 68 to 72, `waitlist-modal.tsx` 222 to 226, and
  `callback/route.ts` 89 to 127. There is no path through any of these files that
  admits a non-allowlisted account. The bounce is the intended behaviour of the
  code as written.
- **The adopt id dies at the onboarding gate.** The chain is visible in these
  files. `postAuthDestination` correctly produces `/radar/calls?adopt=...` and
  `/auth` uses it on both the password path (76) and the Google path (115 to 117).
  Then: (a) `emailRedirectTo` on signup is a bare `${origin}/auth/callback` with no
  `next` (`auth/page.tsx` 85), so a confirm-link arrival loses the id; (b) the
  waitlist modal never computes a destination at all, hardcoding `/dashboard` (228)
  and a bare `/auth/callback` (262), so every adopt link that lands on the landing
  sheet instead of `/auth` loses the id; and (c) `src/app/onboarding/page.tsx`
  documents that the proxy redirects new users here from any gated route, and
  `OnboardingWizard.handleFinish` ends with `router.push("/dashboard")` at line 612,
  hardcoded, with no reference to `auth-redirect.ts`. A first-time user following an
  adopt link therefore cannot reach the call, whichever door they come through.
  Not chased further than these files show.

## Open questions

1. **Conflict 3, the landing h1.** Ship "We track which calls hold up." or "We
   track which calls the evidence supports."? This is the most-quoted sentence in
   the product, it is live on the marketing site, and the mobile design and the
   shipping code currently disagree. Needs a ruling before the hero is written.
2. **Conflict 4, `.heroPara`.** Ship "including the calls that did not hold" or
   "including the calls the evidence ran against"? Same file, same paragraph block,
   independent decision from question 1 only if you want the two sentences to
   disagree with each other.
3. **Conflict 5, role labels.** Do "Buy-Side Analyst" and "Sell-Side Analyst"
   become "Fund Analyst" and "Equity Research"? These are ordinary job titles that
   the users hold. If yes, it lands in two files at once,
   `OnboardingWizard.tsx` 20 to 21 and `settings/profile/page.tsx` 24 to 25, and
   the desktop product changes with the mobile one.
4. **Conflict 6, the RIA description.** "Managing client portfolios and
   allocations" is the settings file's string. The onboarding file already says
   "Managing client capital" for the same enum id. Which one is canonical, and does
   the label read "RIA / Advisor" or "RIA / Wealth Manager"? The two live files
   already disagree independently of the design.
5. **Conflict 7, Risk Appetite.** Drop the step 5 Risk control entirely, or keep
   it? If dropped, what does the mobile client send as `risk_appetite` to
   `POST /api/onboarding/preview-thesis`, which takes it as a request field and uses
   it to pick the fallback conviction? "Omit the control, keep the field defaulted
   to balanced" is a defensible answer, but it has to be said out loud.
6. **One auth surface or two?** github.md is emphatic that the waitlist sheet and
   `/auth` are deliberately different surfaces. But the sheet hardcodes
   `/dashboard` and a bare `/auth/callback`, while `/auth` routes through
   `postAuthDestination` and forwards `next` through Google. If they stay two
   surfaces, an adopt link that opens the sheet loses the call. Do we (a) keep two
   surfaces and give the sheet the same destination logic, (b) collapse to one, or
   (c) accept the divergence and route adopt links to `/auth` only?
7. **Step 7's card needs four fields the endpoint does not return.** The design
   renders a ticker, a check date, a horizon in days and a benchmark pair
   (XLU and SPY). `preview-thesis/route.ts` returns
   `{ title, sector, conviction, rationale }`. Do we extend the endpoint, or
   redraw the card against the shape that exists? Related: `conviction` is returned
   and never rendered, and one of its four values is `BEARISH`.
8. **Step 7's error state is undesigned.** The source has `previewError` and a
   "Retry preview" button. The design defines `obPreviewReady` as "not loading", so
   a failed generation renders the success card. What does a failed preview look
   like on mobile, and does the CTA stay enabled through it?
9. **Step 4 lost four sectors.** The source offers ten, the design draws six.
   Consumer & Retail, Aerospace & Defense, Real Estate and Media & Telecom are
   missing, and no document explains the cut. Design shorthand, or an intended
   narrowing of the taxonomy?
10. **Step 6 changed the input model and invented a feature.** The design replaces
    the add-and-chip flow with a comma-separated field and adds four "SUGGESTED FOR
    YOUR SECTORS" chips that have no source counterpart. Is the suggestion list in
    scope, and if so where does it come from?
11. **The sign-in feature line versus its test.** The design renders "next to the
    rest"; `auth-copy.test.ts` requires the exact string "next to the hits". Change
    the copy and update the test, or keep the tested string? The test exists
    specifically to stop this screen drifting, so changing it needs a reason on the
    record.
12. **Does the closed-beta outcome stay a route or become a panel?** Production
    signs the user out and navigates to `/waitlist`, which has a duplicate-arrival
    variant on `?existing=1` and a support mailto. The design keeps the user on the
    sign-in screen and has neither. Rendering it inline also means deciding what
    happens to the session, since the current code signs out before navigating.
13. **Is the adopt banner in scope?** The design shows a "CONTINUING TO A CALL"
    well that production does not render. `postAuthDestination` already computes
    the condition, so it is cheap. But it is new product copy on a compliance-
    sensitive screen, and it promises a landing that, per the memory chain above,
    a first-time user does not currently get.
14. **README and github.md disagree on the masthead gradient.** README's
    design-system deviations table still lists "Masthead gradient stops in px, not
    %" as a live decision. github.md retracts exactly that fix and says the band is
    now solid espresso with no gold background. Which document is authoritative for
    the wordmark, given this batch renders it four times in three different
    treatments?
