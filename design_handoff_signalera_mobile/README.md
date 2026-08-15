# Handoff: Signalera Mobile

## Overview

The complete mobile app for Signalera, designed ground-up for a 390px viewport rather than derived from the desktop product. It ships first as responsive web at mobile width, installable as a PWA; a native port comes later.

**31 screens**, all reachable, each with its loading, error, empty and stale states.

The core loop is the whole product: the Morning Brief publishes falsifiable calls, each with a direction and a resolution horizon. The user adopts one via **Track this call**, which is the only path to a graded entry. It resolves against real market outcomes at its horizon and accumulates into an auditable, timestamped record of the user's reasoning.

## About the design files

**The files in this bundle are design references created in HTML.** They are prototypes showing intended look and behaviour, not production code to copy.

Your task is to recreate these designs in the existing `lucasturcuato-afk/breakingalpha` codebase — Next.js 16, React 19, Tailwind v4, Supabase — using its established patterns. Do not port the inline styles. Every colour in this prototype is a CSS custom property that maps to a token in `src/styles/tokens.css`; the mapping table is in **Design tokens** below.

The prototype is a single Design Component file with one logic class and `sc-if` blocks for screen switching. That structure exists so the whole app can be inspected in one place. It is not a component architecture and should not be treated as one — decompose along the route boundaries in the **Screens** table.

## Fidelity

**High fidelity.** Final colours, typography, spacing, motion timings and copy. Every measurement in this document was taken from the rendered prototype with `getComputedStyle` / `getBoundingClientRect`, not estimated.

Recreate pixel-accurately using the codebase's existing libraries. Where this document and the prototype disagree, the prototype is authoritative; where the prototype and production disagree, see **Open decisions** — several of those are deliberate and unresolved.

## Navigation model

Four poles in a bottom tab bar, 58px rows:

| Pole | Contains |
|---|---|
| **Today** | Dashboard. What changed since the last visit. |
| **Ledger** | Morning Brief and the record as one timeline. The home surface. |
| **Watch** | Tracked Views, Watchlist, Following. Never graded. |
| **Ask** | Search, Company Intel, Deal Flow, Trends, Live Feed, Intelligence. |

The desktop product's nine surfaces resolve into these four. `Radar` is dismantled: its `Calls` tab becomes the Ledger at top level, `Following` and `Watchlist` merge into Watch, and `Desk record` keeps its own screen. The rationale for each is in `github.md`.

## Screens

Every screen maps to a screen flag in the prototype's logic class and to the repo files it was grounded in. `github.md` at the project root carries the full screen-to-source map and is the authoritative reference for provenance.

| Screen | Flag | Purpose |
|---|---|---|
| Landing | `isLanding` | Signed-out. Typed headline, loop demo, waitlist sheet. |
| Onboarding | `isOnboard` | 7 steps: name, role, strategy, sectors, horizon + workflow, tickers, generated preview thesis. |
| Sign in | `isSignin` | Google OAuth + email/password. Check-email and closed-beta waitlist outcomes. |
| Dashboard | `isDash` | Briefing splash, then the stagger. Market band, waiting-for-you, record, desk record, top stories. |
| Ledger | `isLedger` | The brief and the record as one timeline. Continuity block, Market Pulse hero, claim cards, past entries. |
| Claim | `isClaim` | One call opened. Desk reasoning, what would settle it, benchmark and window. |
| Commit sheet | (within `isLedger`) | **Track this call.** Note required before the button unlocks; press-and-hold to enter. |
| Review | `isReview` | Full-screen espresso. The resolution moment, reading the user's own note back. |
| Entry | `isEntry` | One record entry, months later. Claim, note, window result, meaning. |
| Prepared record | `isRecord` | The artifact. Complete, uncurated, exportable. Five months of entries. |
| Evening Wrap | `isEvening` | The Close hero, scorecard, reviewed calls, movers. |
| Compose | `isCompose` | Write your own call. Server-gated gradeability, alternative offered when not gradeable. |
| Desk record | `isDesk` | The desk's own graded record, distinct from the user's. |
| Thesis Tracker | `isTracker` | Evidence leanings by sector from nightly review. Not graded verdicts. |
| Thesis detail | `isThesis` | One thesis with its nightly review timeline. |
| Watch | `isWatch` | Tracked Views, Watchlist, Following. Three visually distinct tiers. |
| Ask (browse) | `isAskBrowse` | Directory: Deal Flow, Trends, Live Feed, recent lookups. |
| Ask (answer) | `isAskAnswer` | Answer citing the user's own ledger first. |
| Search | `isSearch` | Live. Pages / Research jump list, then entity results. |
| Company Intel | `isCompany` | KPI strip + 5 sections: Primer, Price & tone, Filings, Financials, Insider. |
| Memo | `isMemo` | Generated company brief. Citations open as bottom sheets. |
| Deal Flow | `isDeals` | Whole deal universe. Stages: rumored / announced / under_loi / closed. |
| Deal detail | `isDealDetail` | Process timeline, terms, why the desk is watching. |
| Trends | `isTrends` | Theme list. Interiors not built — see Gaps. |
| Signal | `isSignal` | One trend/signal opened. |
| Live Feed | `isFeed` | Grouped coverage. Interiors are rows only — see Gaps. |
| Story | `isStory` | Reader view. Ends on the open call it bears on. |
| Learned | `isLearned` | Intelligence. What the desk has inferred, and how to change it. |
| Share | `isShare` | Shared brief, recipient view. |
| Saved | `isSaved` | Offline. Brief kept automatically for the current day. |
| Settings | `isSettings` | Preferences: name, firm, role enum, sectors, tickers. Theme. |
| Alerts | `isAlerts` | Deliberately short. States that nothing here can interrupt a browser tab. |

## Design tokens

The prototype defines **58 custom properties** per theme on `:root` and `[data-theme="dark"]`. Map these to `src/styles/tokens.css`. Where a prototype token has no counterpart, add it rather than substituting a near value — several near-misses were corrected during design and would regress.

### Surfaces

| Token | Light | Dark | Role |
|---|---|---|---|
| `--c-bg` | `#fffdf9` | `#14100a` | Page |
| `--c-surface` | `#faf7f2` | `#1b1610` | Beneath page |
| `--c-well` | `#faf5ed` | `#221b12` | Pull-quote / callout |
| `--c-card` | `#ffffff` | `#1e1e1e` | Elevated card |
| `--c-inverse` | `#1a1208` | `#0c0906` | Espresso surface |
| `--c-inverse-well` | `#241a0e` | `#171009` | Well on espresso |
| `--c-chrome` | `#f4efe6` | `#0f0c07` | Browser chrome |

### Ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `--c-ink` | `#1a1208` | `#f5efe3` | Headlines, primary |
| `--c-body` | `#3d2b1f` | `#dcd2c1` | Body copy |
| `--c-secondary` | `#6f6248` | `#b5a88f` | Secondary |
| `--c-muted` | `#786a52` | `#9e9178` | Metadata, mono |
| `--c-number` | `#93866f` | `#7d7364` | Ranked numerals |
| `--c-oninv` | `#fffdf9` | `#f5efe3` | On espresso |
| `--c-oninv-strong` | `#faf5ed` | `#faf5ed` | On espresso, emphatic |
| `--c-oninv-body` | `#c9bda6` | `#c9bda6` | On espresso, body |
| `--c-oninv-dim` | `#a2937a` | `#a2937a` | On espresso, dim |
| `--c-oninv-mono` | `#e8dcc4` | `#e8dcc4` | On espresso, mono |

### Borders

| Token | Light | Dark |
|---|---|---|
| `--c-border` | `#ede8df` | `#2f2920` |
| `--c-hair` | `#f0ebe0` | `#282219` |
| `--c-edge` | `#ded5c6` | `#3b3229` |
| `--c-frame` | `#d6cdbc` | `#3b3229` |
| `--c-handle` | `#e2dbcd` | `#3b3229` |
| `--c-inverse-border` | `#3a2c1a` | `#3a2c1a` |

### Gold

| Token | Light | Dark | Role |
|---|---|---|---|
| `--c-gold` | `#d4a84b` | `#d4a84b` | Heritage Gold. Fills, rules, dots. |
| `--c-goldink` | `#7a5f18` | `#d4a84b` | Gold as text. Never `--c-gold` on cream. |
| `--c-ongold` | `#1a1208` | `#1a1208` | Ink on a gold fill |

**Gold never touches text at `--c-gold`.** On cream it measures 2.17:1. `--c-goldink` exists for that reason and is the only gold permitted on type.

### Semantics

| Token | Light | Dark | Role |
|---|---|---|---|
| `--c-green` | `#16a34a` | `#4ade80` | Dot, fill |
| `--c-greenink` | `#15803d` | `#86efac` | Supported, as text |
| `--c-green-surface` | `#15803d` | `#0f5a2b` | Green as a fill behind text |
| `--c-red` | `#dc2626` | `#f87171` | Dot, fill |
| `--c-redink` | `#b91c1c` | `#fca5a5` | Challenged, as text |
| `--c-amber` | `#f59e0b` | `#fbbf24` | Dot, fill |
| `--c-amberink` | `#a16207` | `#fcd34d` | Developing / awaiting, as text |
| `--c-inv-red` | `#f87171` | `#f87171` | Red on espresso |
| `--c-inv-green` | `#4ade80` | `#4ade80` | Green on espresso |

**The `ink` variants are for text and the base variants are for fills.** Using an ink token as a background, or a base token as text, was the single most common defect corrected during design. `--c-green-surface` exists specifically because `--c-greenink` was being used as a fill and drifted below threshold in dark.

**On pinned-espresso surfaces use the literal on-espresso values**, not the ink tokens: `#f87171` red, `#4ade80` green, `#fbbf24` amber. The ink tokens are light-theme values and measure 2.86–3.76:1 on espresso.

### Pills

Five families, each with `bg` / `text` / `border`: `--pill-bull-*`, `--pill-bear-*`, `--pill-mixed-*`, `--pill-neutral-*`, `--pill-watch-*`. Values in the prototype's `:root` block.

### Locked / disabled

| Token | Light | Dark |
|---|---|---|
| `--c-locked-bg` | `#e2dbcd` | `#2a241c` |
| `--c-locked-ink` | `#5f5440` | `#a89b82` |

Used on the commit button before the note is written, and on gated wizard CTAs. Measures 5.39:1, so a disabled control still reads as deliberately disabled rather than washed out.

## Typography

Playfair Display for headlines (700/800, `-0.02em` on H1), Inter for body (14–15px, 1.6–1.72 leading), JetBrains Mono for data with `letter-spacing:0.07em` on eyebrows.

**Scale floor is 10px.** No rendered type below it anywhere. Slide-style eyebrows are 10px mono with wide tracking; body copy is 13–15px Inter; claim text is 15–17.5px Playfair 500.

Four density-driven properties are set from props on `:root`, so they can be tuned globally:

| Property | Standard | Role |
|---|---|---|
| `--v3-pad` | `20px` | Gutter |
| `--v3-body` | `14px` | Body size |
| `--v3-lead` | `1.6` | Body leading |
| `--v3-claim` | `17.5px` | Claim size |
| `--v3-clamp` | `3` | Reasoning lines before expansion |

## Geometry

**Radii: 4 / 6 / 9 / 12 / 14 only.** Cards 12, wells and heroes 14, pills 4, buttons 9. The 34px value on the prototype's outer frame is the device bezel, not a component.

**Tap targets: 44px minimum, no exceptions.** Where a control's visual size is smaller than 44px, the pattern used throughout is `box-sizing:content-box` with padding to reach 44 and a compensating negative margin, so the hit box grows without moving the element or changing the row rhythm. Applied to: onboarding ticker chips, Alerts switches, Filings chips, Live Feed group headers, the personalization banner's Edit and dismiss, and inline citation anchors.

**Inline citations are the one deliberate exception**: a 17px glyph in flowing prose cannot be 44px without wrecking the line. They carry an expanded invisible hit box measuring ~47px, and every source additionally has a 59px row in the list at the foot of the memo, so no source is reachable only through the small anchor.

## Motion

All easing is `cubic-bezier(0.16, 1, 0.3, 1)`. No bounces, no springs.

| Keyframe | Duration | Use |
|---|---|---|
| `v3in` | 240ms | Screen enter, 7px rise |
| `v3rise` | 620ms | Content reveal, 14px rise, staggered ~60ms |
| `dashRise` | 720ms | Dashboard stagger, 12px rise |
| `dashIntroUp` | 640ms | Splash elements, 120/220/320ms offsets |
| `dashIntroOut` | 700ms | Splash exit, opacity + `scale(1.03)` |
| `dashMarkGlow` | 2.2s infinite | Splash mark |
| `barSweepIn` | 400ms | Proportion bars, `scaleX` from left |
| `skeletonShimmer` | 1.8s infinite | Loading |
| `dashFillIn` | 320ms | Skeleton to content |
| `v3wipe` | 520ms | Gold rule draw |
| `v3up` | 300ms | Bottom sheet rise |
| `v3fill` | 700ms | Press-and-hold progress |
| `v3ticker` | 60s linear | Ticker strip |

**Dashboard stagger delays, from the source call sites:** 0 / 80 / 100 / 140 / 180 / 220 / 260 / 300 / 340 / 420ms.

Two rules that were learned the hard way and must be preserved:

1. **The dashboard content wrapper must not fade as a block.** A page-level opacity fade running concurrently with the per-section rise washes the stagger into one uniform fade. The stagger *is* the entrance.
2. **Any entrance on information-bearing data must rest in the drawn state.** `animation: X both` with a delay makes the hidden frame the resting frame, so a subtree that mounts late hides its data permanently. `barSweepIn` sets `transform:scaleX(1); opacity:1` and animates from there.

**The outcome pill sets `transition:none`.** A state word and its colour must change on the same frame — the four outcome words are non-interchangeable, so easing between two semantic hues renders one state's word in another state's colour.

`@media (prefers-reduced-motion: reduce)` disables every animation, the dotted texture, and the press-baseline wipe; the splash is skipped entirely and the typed headline resolves instantly.

## Interactions

### Track this call

The only path to a graded entry, and the most important interaction in the product.

1. Tap **Track this call** on a claim card or the claim screen.
2. Bottom sheet rises (`v3up`, 300ms). Heading: *"Why do you think so?"*
3. **A note is required.** The button renders in the locked treatment until the note reaches 12 characters. Label progresses: *"Write your reasoning first"* → *"Press to enter this on your ledger"* → *"Keep pressing"*.
4. Press and hold for 700ms. A gold fill sweeps the button (`v3fill`).
5. On release the sheet closes, the open-call count increments, brief progress advances, and the card re-renders with a gold top edge, the user's note, and a monospace ledger line.

No toast. The confirmation is the ledger changing.

The note requirement is the strongest idea in the design and its biggest adoption risk. A record of adopted calls proves the user clicked; a record carrying one line of their own reasoning, timestamped before the outcome was known, proves they thought. Only the second is evidence.

### Commit failure

If the ledger does not acknowledge, the sheet shows: *"This call was not entered."* Nothing was written, the note is preserved in the field, and a retry is offered. A call that silently fails to save is the worst possible bug in this product.

### Press-and-hold gesture constraints

No swipe anywhere in the gesture vocabulary, and nothing bound to the left edge — browser back owns it. The hold is 700ms in a bottom sheet, entirely within thumb reach.

### Search

Live. Empty state shows the command palette's own two groups (Pages / Research) with its real destination labels. Typed state groups results by object type — companies, the user's ledger, deals, then an ask-the-desk affordance. No-result state names what coverage actually runs to.

### Memo citations

Inline `[n]` anchors raise the source as a bottom sheet: which source, publisher, date, and the specific line the memo leaned on. The desktop implementation scrolls a sticky sources rail, which is `hidden lg:block` — so at phone width every anchor currently points at nothing. The sheet is the mobile inversion of that, and it is better than the desktop behaviour rather than a degraded version.

**The user's own ledger entry is a numbered source**, cited in the same apparatus as a filing or a wire story, and the memo closes by saying plainly whether it agrees with them.

## State

The prototype's logic class holds one flat state object. The shape a production implementation needs:

| Group | Keys | Notes |
|---|---|---|
| Routing | `screen` | One of the 31 flags |
| Theme | `theme` | `light` / `dark`, persisted |
| Viewport | `vw` | 375 / 390 / 430, dev only |
| Commit | `sheet`, `note`, `pressing`, `committed`, `commitStage` | `commitStage: null \| 'failed'` |
| Brief lifecycle | `briefStage` | `null \| 'loading' \| 'error' \| 'none' \| 'stale'` |
| Wrap lifecycle | `wrapStage` | `null \| 'loading' \| 'none'` |
| Dashboard | `dashStage`, `intro`, `introSeen` | Splash plays once per session |
| Memo | `memoStage`, `openCite` | `'loading' \| 'ready' \| 'error'` |
| Onboarding | `obStep`, `obRole`, `obStrat`, `obHorizon`, `obWork`, `sectors`, `obPreview` | Gated per step |
| Auth | `authStage`, `authMode`, `pwShown` | |
| Composer | `draft`, `draftNote`, `dir`, `hz` | |
| Filters | `wlLens`, `tkLens`, plus CSS-var-driven list filters | |

**Every `*Stage` key is a lifecycle machine.** A reset must clear all of them; enumerating them by hand meant three separate regressions during design, so clear any key matching `/Stage$/` rather than a hand-written list.

**Any figure that describes state must be read from that state, never typed.** Four separate defects came from a hardcoded count sitting next to a derived one and disagreeing with it.

**One exception, and it matters:** the "since you last looked" figures describe an interval that closed before the user arrived, so they are literals and must be invariant to anything done in-session. Deriving the prior value from current state retroactively rewrites the user's history.

## PWA and viewport

Two states must both hold: browser chrome present, and standalone.

- **Use `dvh`, never `vh`.** The address bar collapses and expands on scroll; nothing may be sized so the layout jumps.
- Content height measures 640px with chrome and 712px standalone at 844px device height. Nothing reflows between them — the same components get more room.
- **Nothing of ours enters the bottom band Safari owns.** The tab bar sits above it, not behind it.
- Respect `env(safe-area-inset-bottom)`.
- **Do not assume push notifications exist.** On mobile web they are unreliable unless installed to the home screen, and most users will not install. The Alerts screen says this to the user rather than promising what it cannot deliver.

### The return trigger, without push

This is a design commitment, not a detail. The product lives or dies on the user returning each morning, and it cannot rely on interrupting them.

1. **The open window is the trigger.** Every committed call carries a fixed review date chosen at commit time. The user leaves owed an answer — a durable obligation that cannot be broken by missing a day, only satisfied.
2. **The first two seconds pay that obligation.** The Ledger opens on what changed since the last visit, counted and itemised, about the user's own claims. Not a greeting.
3. **Each session states its next event.** The brief closes with the wrap time; the wrap closes with tomorrow's macro print and the brief time.
4. **The install prompt is earned.** It fires once, only after a first commit and only on a second visit, and argues from the user's own open window.

**No streaks, badges, completion percentages, daily goals, or consecutive-morning counts.** These are out permanently and must not return under another name. The obligation is to a claim the user made, not to the product.

## Responsive

Authored at 390px, verified at 375 / 390 / 430. The layout is fluid; two rules govern:

- **Gradient stops that must clear a fixed gutter belong in pixels, not percentages.** Percentage stops drift as the frame widens while the text stays at a fixed inset, so the transition reaches further into the type at every larger device width.
- **Bands of equivalent cells must have one anatomy.** `flex-wrap` on a figure row makes the line break content-conditional, so one cell wraps and its siblings do not, and two anatomies sit across a hairline. Stack all cells or none.

## Accessibility

- **Contrast:** every text/background pair measured. Body copy ≥ 4.5:1, large text ≥ 3:1. No state is signalled by colour alone — every one carries its word.
- **Tap targets:** 44px minimum, verified with `getBoundingClientRect` across every screen.
- **Focus:** `2px solid var(--c-gold)` at `2px` offset, `4px` radius, from `globals.css`.
- **Keyboard:** every interactive element carries `tabindex="0"` and `role="button"`. In production use real `<button>` elements. **A container that already holds a focusable control must not itself be focusable** — otherwise a keyboard user tabs into a card whose accessible name is the entire card text before reaching the action inside it. Where both the container and an inner control need actions, make them siblings rather than nesting.
- **Links are links.** "Read at Reuters" and "Read source" are real `<a href target="_blank" rel="noopener noreferrer">`, and each points at the publisher named in its own row.
- **A `cursor:pointer` element with no handler is a defect.** Cheap to sweep for, and it caught several screens.

## Compliance

**Legally binding, not stylistic.** The product is informational only and never investment advice.

1. **These words may never appear in user-facing copy:** buy, sell, hold, allocation, returns, performance. Check as substrings, not words — every violation found during design was inside a longer word (a take-private written with "buy", "shareholders", "outperform"). This extends to code identifiers and comments, since a compliance grep over source will hit them.
2. **No aggregate accuracy percentage or hit rate anywhere**, including placeholder content. Counts are permitted; rates are not. Where a rate would be derived, withhold it and show the counts — the repo's own `reportable_min_n` pattern is the right instinct.
3. **Outcome states use exactly:** supported, challenged, developing, awaiting. Never right, wrong, correct, win, or loss.
4. **No em-dashes anywhere.**
5. Impact analysis is fine. Recommendations and individualized suitability framing are not.
6. **Challenged entries must not be visually punished or buried.** A record containing challenged calls is more credible than a spotless one, because it proves the record was not curated. Challenged entries sit in line where they fell, at the same size and weight, and the record is reverse-chronological and unfiltered by default.

### Forbidden visual treatments

Frosted glass, gradients on surfaces, **coloured left borders**, all-caps decorative treatments.

The coloured left border is the one that bites repeatedly, because the design system specifies a 3–4px gold left rule on lead cards and a state spine on scored objects. **State lives in a 2px top edge plus a dot and the state word**, applied consistently. A gold gradient stop wide enough to read also renders as a left bar — that was caught and removed during design.

## Open decisions

**These block implementation.** Each is a place where this design and production currently disagree, and someone has to rule before an engineer writes the screen. All are recorded in `github.md` with fuller reasoning.

| # | Conflict | Where |
|---|---|---|
| 1 | Renders an accuracy percentage per source and a Wilson 95% lower bound; column header reads "Right / wrong"; data model is `n_correct` / `n_wrong` | `src/app/cross-source/page.tsx` |
| 2 | Animates **"EVIDENCE SUPPORTED 71.4%"** above the fold beside "THESES TRACKED 1,284" | Live marketing site |
| 3 | Landing headline "We track which calls **hold** up" contains a banned substring. Design renders "which calls the evidence supports" | `landing/opening-screen.tsx` + live site |
| 4 | `.heroPara` contains "the calls that did not **hold**". Design renders "the calls the evidence ran against" | `landing/opening-screen.tsx` |
| 5 | Role labels "Buy-Side Analyst" / "Sell-Side Analyst" contain banned words inside ordinary job titles. Design renders "Fund Analyst" / "Equity Research" against the same enum ids | `settings/profile/page.tsx`, `OnboardingWizard.tsx` |
| 6 | RIA description "Managing client portfolios and allocations" contains a banned word | `settings/profile/page.tsx` |
| 7 | **Risk Appetite** (defensive / balanced / aggressive) reads as individualized suitability framing. Not ported | `settings/profile/page.tsx` `RISK_OPTIONS` |
| 8 | Numeric SIGNAL scores (8.4, 9.1) per story. A per-story scalar is the same class of derived figure the brief forbids | Live site |
| 9 | `/cross-source` is styled in slate/sky/emerald Tailwind neutrals, not cream / espresso / Heritage Gold. Visually a different product | `src/app/cross-source/page.tsx` |

### Design-system deviations, flagged not drifted

| Deviation | Reason |
|---|---|
| App icon is a serif monogram, not the sanctioned `logo-icon.png` | That mark's defining element is a rising arrow — the most prominent possible claim about returns, seen before any disclaimer. |
| Icon accent is `#a8873a` (Gold Dark, nominally a CTA hover state) | On the cream tile the three golds measure 3.35:1, 2.70:1, 2.17:1. Only Gold Dark clears 3:1 against the icon field, and a home-screen icon renders at 20px with no adjacent label. |
| Mastheads use a CSS wordmark, not the full lockup | Same arrow issue. |
| Coloured left borders removed throughout | Forbidden by the brief; the design system specifies them. |
| All-caps sentiment pills dropped from product copy | Forbidden decorative capitals. Capitals survive only in the monospace ledger line, which is machine record. |
| Market Pulse narrative moved out of the espresso hero onto cream | The source renders it inside the hero with no length cap. 150+ words of cream-on-espresso in a 390px column is hard to read and makes the hero dominate the scroll regardless of narrative length. The hero keeps the pull-quote at fixed height. |
| Masthead gradient stops in px, not % | See Responsive. |

## Gaps

Three surfaces are deliberately unbuilt. None should be invented.

1. **`/cross-source`** — a tenth route with no mobile counterpart. Cannot be ported until conflicts 1 and 9 are resolved.
2. **Trends and Live Feed interiors** — entry rows with real counts only. No visual reference exists for their interiors.
3. **Company Intel Transcripts and Comps tabs** — the repo renders both via `ComingSoonTab.tsx`, so there is nothing to port.

## What to test rather than build

**The required note on commit.** It is the strongest idea in the design and the biggest adoption risk, and building it did not make that risk smaller. One-handed typing on a moving train is genuinely hard; if adoption drops, the loop starves. The fallback that preserves the principle is a note that can be added later with the entry marked unjustified until it is.

**The press-and-hold gesture.** Unfamiliar, not discoverable without its label, and harder than a tap on a moving train. That is partly the intent — it is the only part of the product that physically feels like putting your name on something — but it should be tested before it ships.

**The finite-brief assumption.** The completion screen assumes a bounded set. If the pipeline sometimes emits eleven calls or two, the ritual loses its shape. Capping the decidable set at six and letting the rest read as coverage is a content decision.

## Files

| File | Contents |
|---|---|
| `Signalera Mobile v3.dc.html` | The design. All 31 screens, both themes, all states. Open directly in a browser. |
| `github.md` | Screen-to-source map, sync history, every deviation and open conflict with reasoning. **Read this alongside the README.** |
| `Signalera Mobile v2.dc.html` | Prior structural direction, kept for reference. |
| `Signalera Mobile.dc.html` | First direction, plus the two killed alternatives and the original written brief. |

The prototype has a dev strip beneath the phone frame with direct jumps to every screen and every lifecycle state — Brief loading, Brief error, No brief, Stale brief, Wrap loading, No wrap, Commit fails, Replay splash — plus 375 / 390 / 430 width switches. Use it to see each state without reproducing the conditions.
