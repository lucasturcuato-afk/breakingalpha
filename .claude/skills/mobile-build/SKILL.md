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
- **`npm run lint`'s warning count is not what `grep -c warning` says, and a
  scratch directory can move it.** Two separate traps, both of which have cost
  this batch a round each.

  Count with the report's own shape, `grep -cE "^\s+[0-9]+:[0-9]+\s+warning"`,
  not `grep -c warning`. The summary block contains the word twice more, so the
  naive grep reads 83 where the real figure is 81. Three people reconciling
  81 / 82 / 83 were all reading artefacts of their own greps.

  And flat config's default ignores are only `node_modules` and `.git`.
  **Dot-directories are NOT ignored**, which is why `eslint.config.mjs` has to
  name `.claude/**` and `.session-artifacts/**` by hand. Any other untracked
  scratch dir left in the worktree root is linted as first-class source, its
  findings land in the total, and the run still **exits 0**. Count from a clean
  root, or the gate silently changes its number without ever failing. Same
  shape as the `--since` bare-run bug PR #647 fixed: a gate that is quietly
  wrong is worse than one that breaks.
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
- **Kill servers by port, never by process name.** Use
  `lsof -ti tcp:<PORT> | xargs kill`. **Never `pkill -f next-server`, `pkill -f
  "next dev"`, or any global pattern.** Several units run their own servers on
  their own ports at the same time. A global pkill killed another unit's server
  mid-probe during the performance work, and the run it corrupted would have
  read as a 674 ms improvement if that unit had not noticed and thrown it out.
  Kill what you started, on the port you started it on.

Then `/run` to see the screen actually rendered, and **review your own diff
explicitly**: read `git diff origin/main...HEAD` yourself, top to bottom, and
say in the PR body what you found and fixed.

**Do NOT use `/code-review`.** It resolves its target through
`$CLAUDE_PROJECT_DIR`, which is the primary clone for every subagent regardless
of which worktree the agent is working in. It never consults your cwd. So a
dispatch that fences you to a worktree cannot bind it: one run reviewed the
primary clone and left uncommitted edits in a working tree nobody had asked it
to touch. See DECISIONS.md ruling 13.

Reading your own diff is also better at this. The unit that did it after the
misfire found two real defects a fenced tool had not: a length cap written twice
so the field could accept more than the column stores, and an overlay not keyed
on its subject, so a second open inherited the previous note.

## If you are measuring performance

**Halve the model before sizing anything off it.** The attribution pass fitted

    TTI = 800 ms + 2.7 ms per gzipped KB of pre-load JS

across six routes. It ranks routes correctly and it correctly identifies bytes
as the lever. **It also overpredicts.** The first fix to test it removed 73 KB
and measured **95 to 105 ms against a predicted 197**. Use it to decide what to
look at, never to claim what a fix returned.

Three more things that pass already paid for:

- **A refutation test can pass and still be worthless.** The AppShell
  hypothesis was to be falsified by blocking its chunk, and the block moved TTI
  165 ms, which read as confirmation. It was not. Blocking the entry chunk
  stops the whole app hydrating, removing work no fix could remove. **Check
  that your control removes only the thing you are testing.** Honest controls
  put that cause at about 45 ms, not 165.
- **TTI can move without the page getting faster.** Under a last-long-task
  definition, deleting one late 100 ms task is worth over a second of metric.
  One fix moved TTI 1380 ms on a page that was tappable at 860 ms **in both
  builds**. Check your long-task list before and after. A shortened critical
  path is real, a deleted late task is mostly cosmetic, and you should say
  which one you have.
- **More splitting can be slower.** Lazy-loading three further shell components
  pushed one route from 1101 ms to 2249 ms. Bytes are the lever, and past some
  point another chunk costs more than it saves. Measure the direction rather
  than assuming it.

`/ledger` and `/compose` make **zero Supabase requests** and are the clean
instruments. `/trends` swings about **2 seconds** on Postgres buffer warmth
alone, so report it separately or exclude it and say which.

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
7. What your own read of the diff found, and what you fixed. Not a tool's output: your own.

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

## When a screen is done

**A screen is done when it renders a real user's real data, or states plainly
that it cannot. Rendering a fixture is not done.**

This is the bar, and nothing else is. A screen that draws the design perfectly
from invented data is a prototype that happens to live at a route. Say so in
the PR title and body, in those words, so the state of the screen survives
being read six PRs later by someone counting what shipped.

Three states are acceptable in production:

1. **Wired.** The screen reads a loader and paints what it returns.
2. **Honest empty.** There is a source, it returned nothing, and the screen
   says so without asserting anything about the reader.
3. **Unwired.** There is no source. The screen says that, or renders loading,
   and asserts nothing at all.

Anything else is a defect, including an empty state that makes a claim.
`BriefNone` said "Your six open calls are unaffected", which reads as
reassurance and is a fact about the reader that the screen cannot know. The
copy has no source behind it. Delete the sentence rather than soften it.

### The two fixture rules, now enforced by design-lint

**A fixture is never a default.** Not `data = LEDGER_FIXTURE`, not
`data ?? DASH_FIXTURE`. The caller resolves the gate and passes the result:

```tsx
<LedgerScreen data={mobileFixtureScreensEnabled() ? LEDGER_FIXTURE : null} />
```

Make the prop REQUIRED and NULLABLE, and early-return the loading state when
it is null. Below that guard the type is non-null, so no later edit can bring
the fixture back by leaving a prop off. A missing gate becomes a build failure
instead of invented data in front of a reader.

This is not hypothetical. `/ledger` shipped with `data = LEDGER_FIXTURE` and no
gate anywhere in its path, and served every signed-in reader on a phone three
fabricated claims and the sentence "One of your calls was checked overnight."
Rule `fixture-default` catches it now.

**A fixture is never imported by a client component.** The gate is a runtime
constant, so it stops the render and not the download: fixture prose reaches
`.next/static` whether or not it can ever paint. Resolve on the server and pass
the value down, the way `/trends-mobile` does. Rule `fixture-in-client-bundle`
catches it, and the number to check afterwards is bytes in `.next/static`, not
whether the screen looks right.

`deals-mobile`, `feed/mobile` and `trends-mobile` all measure zero. Copy one of
those three rather than inventing a fourth method.

## The rollup, before any screen merges

After the units finish and BEFORE the first merge, one agent reads **only the
disclosures** across every open PR in the batch: the caveats, the "not wired"
notes, the known-issue sections. It reads no code. It answers one question:

> If every one of these merges, what is then true of production?

It writes that as a single paragraph and posts it on the tracking PR.

This step exists because of a specific failure. Twelve screen PRs merged, and
ten of the twelve disclosed in their own bodies that the screen had no data
source: #649 said it seven times, #651 and #658 eight times each. Not one unit
claimed a working screen and not one hid anything. But twelve scoped caveats
each read as a small caveat, and nobody added them up, so what actually shipped
was a mobile surface where most screens cannot show a reader their own data. The
reviewer who read all thirteen PRs did not add them up either.

Aggregation is a separate job from review, and it has to be someone's job or it
is nobody's. The rollup is cheap: it is a read of thirteen PR bodies. It is the
only step in this process that looks at the batch rather than at a screen.

## Verifying plates: enumerate and open, never match a filename

**Before a branch merges, list every image blob reachable from it and open each
one. Do not decide what a plate contains from what it is called.**

```
git rev-list --objects origin/main..HEAD \
  | awk 'NF==2' | grep -iE '\.(png|jpe?g|gif|webp|svg)$' \
  | sort -u -k1,1
```

Then open them. All of them. The list is short enough to read.

### Why this is a rule and not a suggestion

**Six plates were missed tonight by name-based sweeps and found by enumeration.**
Three separate greps ran over these branches and every one of them passed.

- `ledger-390-signed-in-wired-full.png` carried **"signed-in" in its own
  filename** and was still missed, because the pattern anticipated `-wired` and
  `-claims` and not the `-full` suffix.
- `desk-wired-390-light.png`, `-dark` and `-tail` read exactly like the plates a
  wiring PR should carry. They were captures of the real graded desk record,
  with tickers, dates, thesis text and price attributions.
- Two more sets survived a plate deletion **inside PR bodies**, as prose and as
  `?raw=true` links, after the images themselves had been removed. **Check the
  body as well as the commits.**

In the other direction, a loose pattern manufactures findings that are not real:
`1440-desktop-` matched two DOM-signature `.txt` files that contain only node
names and box geometry, and reported them as a leak.

**A plate is what it is regardless of what it is called.** The filename is
written by whoever captured it, at the moment they were thinking about something
else.

### What each kind looks like when you open it

- **Fixture parity plate**: design beside built, both sides showing invented
  data. On this programme the fixture record is 64 / 39 / 18 / 22 and the
  invented calls are CEG, MSFT and SOFI. Safe.
- **Lifecycle state**: driven by `?stage=`, drawing a skeleton, an error, an
  empty or an unwired notice. Safe.
- **Empty E2E account**: "Your feed is empty", zero counts. Safe.
- **Signed-in production capture**: real index levels, a real dateline, real
  desk narrative, or any individual call with a ticker and a date. **Never
  commit one while the repository is public.**

The distinction that matters most is the last one: an OPEN call with a future
review date is a live position thesis. A graded historical call is the record
the product already publishes about itself. Both are auth-gated; only the first
is time-sensitive.

### What to do instead

Structural evidence carries the same claims without reproducing content: node
counts, character counts, request counts, byte counts, computed styles,
geometry, parity numbers and timings. A box-tree diff proved "the desk did not
move" better than a pixel diff did, and it is immune to live values.
