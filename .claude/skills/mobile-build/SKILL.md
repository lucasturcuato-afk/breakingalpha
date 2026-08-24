---
name: mobile-build
description: Use when building any screen of the Signalera mobile redesign from design_handoff_signalera_mobile, steps 3 to 12 of IMPLEMENTATION_PROMPT.md. Loads the shared constraints every screen unit must follow, the parity and audit recipe, and the compliance rules.
---

# Mobile build

One screen per unit. This skill is the shared contract so thirty units do not
diverge into thirty near-misses.

## Sources of truth, in order

1. The rendered design, via
   `python3 scripts/parity_harness.py --screen <flag>`, read with
   `getComputedStyle`.
2. `briefs/batch-N.md` for your screen. The mapping is in the table below.
3. `README.md` and `github.md` in `design_handoff_signalera_mobile/`, and
   `DECISIONS.md` **at the repo root**, not in the handoff directory.

Measured values beat every document.

`DECISIONS.md` carries Noah's rulings on the nine open decisions plus rulings
10 and up. Read the row for your screen before you write a string. Do not
re-litigate a ruling and do not pick a side the file already picked.

## Always run parity through the harness. Measured reasons

`scripts/screen-audit.mjs` defaults `PROTOTYPE` to the raw
`Signalera Mobile v3.dc.html`, and that default is wrong for every screen.
Generate the harness and set `SIG_PROTOTYPE` every single time.

`parity_harness.py`'s docstring says the bare file "diffs clean against
anything". That describes opening it over `file://` with no network. It is not
what you will see: `screen-audit` drives the page under Playwright, where the
CDN React load succeeds and a dev-strip fallback click can switch screens. So
the failure is not a false green. It is worse in a quieter way, and it comes in
two shapes. Both measured against `/ledger` and `/dashboard` on this branch:

- **Screens that have a dev-strip button** compare correctly but noisily.
  `ledger` reports **18 property mismatches** without the harness and
  **8** with it. Ten of those eighteen are artefacts of the unresolved
  template, and a unit that "explains" them is explaining nothing.
- **Screens that have no dev-strip button** compare against the wrong screen
  entirely. The prototype stays on its default, `landing`, and the diff is
  meaningless. `dash` reports **26 mismatches** this way, none of them real.
  The six with no button are `dash`, `entry`, `watch`, `ask`, `answer` and
  `signal`.

Batch building is only permitted here because divergence is caught
mechanically. A harness-less parity run does not catch it. **If your PR body
shows a parity run without `SIG_PROTOTYPE`, the unit is not done.**

One guard does work in your favour: `--selector` matching nothing exits 2
rather than reporting a clean empty diff. So if you forget `data-parity` on
your root element you will be told, loudly.

## Components you consume, never rebuild

From `src/components/ledger/`: `ClaimAnatomy`, `LedgerClaimCard`,
`LedgerEntryRow`, `LedgerDateRule`, `MobileTickerStrip`, `Chevron`,
`OutcomeLead`, `OUTCOME_STATES`, `OUTCOME_TOKENS`. From
`src/components/shell/`: `mobile-tab-bar.tsx`.

Never rebuild them. A screen needing a shape the anatomy lacks gets a wrapper
beside it, never a branch inside it.

`MobileTickerStrip` is built, exported and already carries its
`prefers-reduced-motion` guard at `ledger.module.css:124-131`. Import it. Do
not build a second ticker.

**Do not edit `mobile-tab-bar.tsx` to make your pole light up.** The foundation
PR already added every step 3 to 12 route to the right pole's `owns` list, so
your screen lights its pole the moment it exists. Two exceptions, both
deliberate:

- The Watch pole's `href` still points at `/radar/watchlist`. The unit that
  builds `/watch` moves it, and is the only unit that may touch this file.
- `/theses`, `/theses/[id]` and `/desk-record` are in **no** pole's list. PR
  #619 left Thesis Tracker and Desk record unassigned because where they sit
  is an open question (batch-3 Q5, batch-2 Q3). Those three screens will light
  no pole. That is the existing decision, not a bug for you to fix. Report it
  in your PR body and leave it.

## Tokens

Tokens via `var()`. No hex that has a token. `#f87171`, `#4ade80` and `#fbbf24`
only on pinned espresso.

All 42 handoff colour tokens are on main, in both themes, with zero drift
against `tokens.reference.css`. All five `--v3-*` density properties
(`--v3-pad`, `--v3-body`, `--v3-lead`, `--v3-claim`, `--v3-clamp`) are on main
too.

**Do not add the other 27 `--v3-*` properties.** Their values are `flex`,
`none` and `block`. They are the prototype's dev-strip list filters, toggled by
`setDeals` / `setFilings` / `setTrends` at prototype lines 3120 to 3151, and
they exist to show and hide demo rows. Production filters lists on React state.
Copying them into `tokens.css` imports prototype scaffolding into the design
system.

If your screen genuinely needs a token that is absent, add it from
`tokens.reference.css` rather than substituting a near value, and say so in the
PR body.

ink tokens are text, base tokens are fills, never swapped. Gold never touches
type at `--c-gold`; `--c-goldink` is the only gold permitted on text.

## Geometry, motion, states

Radii 4/6/9/12/14. No rendered type below 10px. 44px minimum tap targets via
content-box padding plus negative margin; do not shrink the target and do not
move the element. Real `button` and `a` elements; a container holding a
focusable control must not itself be focusable. No inline style setting a
property a responsive class also sets. `dvh` never `vh`. `md:hidden` and
`hidden md:block` in classes only. Motion `cubic-bezier(0.16, 1, 0.3, 1)`,
honour `prefers-reduced-motion`, and nothing may be hidden rather than merely
unanimated.

Build every state: loading, error, empty, stale. The prototype's dev strip
shows them. A screen without its states is not done.

## When there is no data, render nothing or render loading

**Never a sentence about the reader or their record.** This is a hard rule and
it outranks matching the design.

Gating the fixture is necessary and **not sufficient**. Nine of eighteen PRs in
the first wave broke this, and three of the nine had gated their fixture
correctly and still shipped an assertion. Gating stops invented *content*
reaching production. It does nothing about invented *claims* in the fallback
you gate down to.

What that looked like, all real, all caught in review:

- A splash reading **"142 stories read overnight. One of your calls was
  checked."** It rendered full screen for 2.6 seconds on a reader's first load,
  over a date six weeks stale. Nothing had been read and no call had been
  checked.
- A record screen showing **SUPPORTED 64 / CHALLENGED 39** under copy promising
  "Every call the desk has published since June 2 is here", while the desktop
  route showed the true numbers on the same deployment.
- A Watch screen rendering `stage: "ready"` over empty data, so it told a
  reader **"Nothing on your watchlist yet"** when they had one.
- An empty state reading **"nothing has moved since yesterday's close"**, which
  is a claim about the tape made with no market data.
- A gate falling back to an error state reading **"This is a failed read"**
  when nothing had been read; the fixture was withheld by design.

Every one is the same shape: a fallback stating a fact it has no source for.
Some are worse than showing a fixture, because a fixture at least looks like
sample data while a confident empty state reads as truth.

**The two patterns that survived review, follow these.**

`/compose` (#650) forces the empty stage in production, which is two blank
fields and a locked control, plus a visible line reading "Preview of the
screen. Nothing written here is kept yet." It asserts nothing and says what it
is.

`/ask` (#654) built a third state. Its own summary is the rule in one line:

> `none` claims a search ran. `loading` claims one is running. `unwired` says
> there is nothing to run.

If your screen has no loader yet, **`unwired` is the honest state** and you
should build it. If a loader exists and has not answered, `loading` is honest.
`empty` is honest only when something real came back empty.

Two traps worth naming:

- **An "empty" fixture is not automatically safe.** One spread the full fixture
  and overrode only some fields, so it kept an invented market band and copy
  reading "Five calls, none decided yet". Read what your empty object actually
  still carries.
- **`loading` forever is its own lie.** If nothing will ever arrive, a
  permanent skeleton tells the reader something is coming. That is what
  `unwired` is for.

Check this at the call site, not just in the component. One screen gated its
body and left a sibling overlay ungated, because the overlay sat outside the
screen root so parity would not fingerprint it. Export one constant and import
it everywhere; a gate you have to remember at each call site is one you will
miss at one of them.

## Compliance, non-negotiable

Never `buy`, `sell`, `hold`, `allocation`, `returns` or `performance` as
substrings, including identifiers and comments. No aggregate rate or accuracy
figure anywhere including placeholder data; counts yes, rates no. Outcome
states exactly `supported` / `challenged` / `developing` / `awaiting`. No
em-dashes. No coloured left borders; state is a 2px top edge plus a dot and the
state word. Challenged entries are never visually punished or buried.

SIGNAL scores are permitted. `DECISIONS.md` ruling 8 settled that a relevance
score is not an accuracy figure.

## Files and actions that are off limits

Never touch `briefing/route.ts`, `watchlist-utils.ts`, `WatchlistAddInput.tsx`,
or `trends/page.tsx`.

Radar's own routes stay untouched: `src/app/radar/page.tsx`,
`src/app/radar/layout.tsx`, `src/app/radar/following/`, `src/app/radar/calls/`,
`src/app/radar/theses/`, and `src/components/radar/RadarTabs.tsx`. The design
dismantles Radar, so mobile Watch, Thesis Tracker, Thesis detail and Desk
record land at their **own new routes** composing existing components. They are
in scope. Editing a `/radar/*` page to get there is not.

Trends is in scope the same way: land it as a new file composing
`src/app/trends/page.tsx`, never as an edit to it. `briefs/batch-6.md` has a
section titled "How Signal lands without editing `src/app/trends/page.tsx`";
follow it.

Never merge, push to main, apply a migration, run the pipeline, write to the
DB, call Gemini, or create or delete a Vercel project.

## Verification, per screen

Put `data-parity="<flag>"` on your screen's root element so parity can scope to
it.

```
npm run dev &

python3 scripts/parity_harness.py --screen <flag>

SIG_PROTOTYPE=.parity-proto.html node scripts/screen-audit.mjs parity <flag> \
  http://localhost:3000/<route> \
  --selector '[data-parity="<flag>"]' --proto-selector '[data-parity="<flag>"]'

node scripts/screen-audit.mjs audit http://localhost:3000/<route> --width 375,390,430
node scripts/screen-audit.mjs audit http://localhost:3000/<route> --width 1440

node scripts/parity_shot.mjs <flag> http://localhost:3000/<route>

git add -A && git commit -m "..."
npm run design:lint -- --since origin/main
npx tsc --noEmit && npm run lint && npm run build
```

Notes that will otherwise cost you a cycle:

- `--width` works in `audit` mode only. `parity` is hardcoded to 390x844
  (`screen-audit.mjs:309,326`). The 1440 evidence comes from `audit`.
- `design-lint --since` exits 2 on a dirty tree. Commit first.
- Your route is reachable unauthenticated in local dev only, via
  `MOBILE_REDESIGN_DEV_PATHS` in `src/proxy.ts`. Do not edit that file; the
  list already covers steps 3 to 12.
- **Four pages enforce auth a second time, in the page body, below the
  proxy**, each calling `if (!user) redirect("/auth")` itself:
  `/intelligence`, `/settings/preferences`, `/onboarding` and
  **`/company/[id]`**. `src/proxy.ts` cannot open any of them. If your screen
  targets one, the guard is in your own page file and it is yours to gate on
  `process.env.NODE_ENV === 'development'`, matching the proxy's precedent.
  Say so in the PR body.

  An earlier version of this skill listed `/company/[id]` as "confirmed
  reachable, answered 200". **That was wrong.** The guard at
  `src/app/company/[id]/page.tsx:83` is unconditional, and the Company Intel
  unit found it the hard way. The claim came from a single curl that returned
  200 and was never reconciled against the source, which had already been
  read. Trust the source over one request, and re-measure when the two
  disagree.

  The routes the proxy genuinely does open in dev: dashboard, evening-wrap,
  deal-flow, saved, settings/profile and ledger. `/radar/*` correctly stays
  gated at 307.
- No CI runs on a frontend PR. `.github/workflows/verify-py.yml` is the only
  `pull_request` trigger and is path-filtered to `backend/**`. Every gate here
  is local and self-reported, so run them honestly.

Then `/run` to see the screen actually rendered, and `/code-review high --fix`
on your own diff.

## Preview requires a Vercel login. Your plates come from local.

Vercel Authentication is enabled for **preview** deployments on this project.
An anonymous request to a preview URL answers **302 to a Vercel login**, not
your screen. Production is unaffected.

So `scripts/parity_shot.mjs` and any curl or Playwright run pointed at a
preview URL will capture a login page or fail outright. **That is the
protection working. It is not a defect in your screen, and it must not be
reported as one.**

Take every capture and every measurement from your **local dev server**, which
is what the verification recipe above already does. The preview URL goes in the
PR body as a build-succeeded signal and a link a signed-in reviewer can open,
never as the source of a plate.

Before this was enabled, preview URLs were reachable by anyone on the public
internet and pointed at the production database. If a run against a preview
suddenly starts working anonymously again, that is worth reporting.

## PR body, required contents

1. The preview URL, first. It is a build signal and a link for a signed-in
   reviewer, not somewhere your screen can be seen anonymously.
2. `design-lint --since origin/main` at 0 new errors.
3. `screen-audit audit` at 375, 390, 430 and at `--width 1440`, with the mobile
   layout absent at 1440.
4. Scoped parity for your screen, run with `SIG_PROTOTYPE`, every mismatch
   fixed or explained.
5. Design versus built captures at 390px in both themes, committed under
   `docs/<screen>-parity/`.
6. Values not sourced from a token, strings changed and why, and anything in
   the design that looks wrong.
7. The `/code-review high --fix` findings you applied.

## Brief for your screen

| Screen | Brief |
|---|---|
| Commit sheet, Review, Trends | `briefs/batch-9.md` |
| Dashboard, Evening Wrap | `briefs/batch-1.md` |
| Claim, Entry, Prepared record | `briefs/batch-2.md` |
| Watch, Thesis Tracker, Thesis detail | `briefs/batch-3.md` |
| Ask browse, Ask answer, Search | `briefs/batch-4.md` |
| Company Intel, Memo | `briefs/batch-5.md` |
| Deal Flow, Deal detail, Signal, Story, Live Feed | `briefs/batch-6.md` |
| Landing, Onboarding, Sign in | `briefs/batch-7.md` |
| Settings, Alerts, Saved, Learned, Share, Compose, Desk record | `briefs/batch-8.md` |

The batch numbers are file names only. `DECISIONS.md` retired the eight-batch
grouping as a sequence; the authoritative order is
`IMPLEMENTATION_PROMPT.md:101-116`.
