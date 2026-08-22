# Batch 9 build brief: Commit sheet, Review, Trends

Recon only. No implementation code. Every repo path below was opened in this pass, and every
prototype line number was read out of the file rather than carried from another brief.
Em-dashes in quoted source strings are rendered as `[EMDASH]` so this document stays compliant
while still showing the defect being quoted.

Prototype: `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html` (3749 lines). Provenance
authority is `design_handoff_signalera_mobile/github.md`. Rulings are `DECISIONS.md`. Where any two
disagree, both are quoted and neither is resolved here.

These are the three screens the eight existing briefs left uncovered. **`isReview` appears in no
existing brief at all.** `isTrends` appears only as batch-6's open question 8 ("Trends is
unassigned"). The commit sheet is discussed in passing in batch-2 (items 4, 5, 6 and open question
5) and batch-6, and never assigned. Both were read in full before this pass and are cross-referenced
rather than restated; where this pass found batch-2 wrong, that is said in place.

Build-order context, because it changes how much of this matters.
`design_handoff_signalera_mobile/IMPLEMENTATION_PROMPT.md:118`: "Steps 1[EMDASH]4 are the product.
If those are wrong, nothing after them helps." Per `DECISIONS.md:13-26` the commit sheet is **step
3** and Review is **step 4**. Trends is step 10. Two of the three screens here are the back half of
the core loop, and one of them is ungrounded.

---

## Screens

### Commit sheet (`sheetOpen`; README says "within `isLedger`")

**Flag confirmed, and the README is wrong about where it lives.** `:2579`
(`<sc-if value="{{ sheetOpen }}">`), block runs **2579 to 2604**. It sits at 8 spaces of
indentation, the same depth as `isLedger` (`:257`), `isClaim` (`:469`) and every other screen
block. It is a **sibling of every screen**, not a child of the Ledger.

`sheetOpen: s.sheet` at `:3485` is not gated on `s.screen` in any way. `go(screen)` at `:3165`
(`this.setState({ screen, sheet: false })`) closes it on navigation, but nothing scopes it while
open. Three call sites open it: `:422` (Ledger `notCommitted` card, 44px bordered button), `:492`
(Claim screen, 52px espresso bar), `:1487` (Deal detail, 50px espresso button), all labelled "Track
this call". `openSheet` at `:3486` stops propagation and sets `sheet:true`; `closeSheet` at `:3487`
clears `sheet` and `pressing`.

**Route: NO NEW ROUTE.** The sheet is an overlay. `src/proxy.ts:25-50` lists the mobile-redesign
dev paths by build step and has **no entry for step 3**: `/ledger` (step 2), `/review` (step 4),
`/dashboard` (step 5), `/claim` `/entry` `/record` (step 6), on down. The foundation already treats
the sheet as landing on an existing surface, which is consistent with the Ledger and inconsistent
with it opening from Claim and Deal detail.

**The integration point exists and is a no-op today.**
`src/components/ledger/ledger-claim-card.tsx:44` declares `onTrack?: () => void`, documented at
`:15`: "The commit sheet is out of scope for this unit, so `onTrack` is optional and the action
renders only when a handler is supplied." `src/components/ledger/ledger-screen.tsx:81` passes
`onTrack={c.variant === "open" ? () => {} : undefined}`. The shipped Ledger renders a "Track this
call" button that does nothing. Replacing that empty arrow is this batch's first job.

**Repo sources github.md maps to it** (line 92: `| Commit sheet |
src/components/calls/TrackCallControl.tsx (TRACK_TRUST_LINE, buildLedgerLine, UNGRADEABLE_REASON) |`):

- `src/components/calls/TrackCallControl.tsx` (387 lines, opened in full). **LIVE**, imported by
  `src/components/brief/BriefCallsSection.tsx:519` and `src/app/radar/calls/page.tsx:750`. Exports
  `TRACK_TRUST_LINE` (`:61`), `UNGRADEABLE_REASON` (`:65`), `TrackedClaimLike` (`:69`),
  `buildLedgerLine` (`:95`), `CallLedgerLine` (`:118`), `CallsTrustLine` (`:146`),
  `hasCommitFooter` (`:165`), `CallCommitFooter` (`:186`), plus module-private `UntrackedFooter`
  (`:304`). Header at `:11` states where the affordance belongs: "The affordance is the card's
  FOOTER, passed to ScoredObject and rendered inside its border. It used to float in the gutter
  above the card next to a monospace horizon token, which made the most consequential control in the
  product read as debug output attached to nothing." The mobile design inverts that into a sheet, so
  `CallCommitFooter` is not reusable as a shell. Its three states at `:18-26` are untracked /
  ungradeable / tracked; the sheet has no ungradeable branch (deviation 6).
- `src/components/calls/TrackCallControl.test.ts` (189 lines, opened in full). **LIVE.** Nine tests.
  Five assert `buildLedgerLine` character for character (`:110`, `:135`, `:143`, `:150`, `:159`),
  one asserts `TRACK_TRUST_LINE` verbatim (`:168`), one greps both for
  `/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i` (`:178`), one asserts the trust line
  does not promise a verdict (`:187`). Changing either string breaks tests.

Also opened, because the sheet writes through them:
`src/app/api/radar/claims/adopt/route.ts` (**LIVE**; POST body at `:33` is
`{ call_id?, horizon?, window_days? }`, no note field; header at `:14-27` describes the forward
window, "default one week, caller may override, capped at MAX_WINDOW_DAYS");
`sql/0012_radar_user_claims.sql` (`user_claims` DDL at `:29-53`, seventeen columns, **no note
column**); `src/lib/call-horizons.ts` (`HORIZON_DAYS.quarter = 90` at `:38`, `MAX_WINDOW_DAYS = 90`
at `:55`, `DEFAULT_ADOPT_HORIZON = "week"` at `:62`).

**Where the required note would be written to: nowhere. This is the blocker.**

README makes the note the gate ("**A note is required.** The button renders in the locked treatment
until the note reaches 12 characters") and the prototype enforces it at `:3170`
(`noteReady = s.note.trim().length >= 12`). README then rests the product on it: "A record of
adopted calls proves the user clicked; a record carrying one line of their own reasoning,
timestamped before the outcome was known, proves they thought. Only the second is evidence."

There is no column, no request field and no read path. `user_claims` has no note column
(`sql/0012:29-53`); `/api/radar/claims/adopt` parses three keys and none is a note (`:33`);
`/api/radar/claims` POST has the same gap, recorded by batch-8 under "Compose: the required note has
no field to write to". The nearest column, `gradeability_note`, is the grader's own explanation
(`sql/0012:14`: "gradeable = false with an honest gradeability_note (context-only)"), so reusing it
would put two authors' text in one column. Batch-8 raised this for Compose, step 7. This sheet is
step 3, so this batch hits it first.

**Measured geometry and type, from the markup at `:2580-2601` and the style builders at `:3492-3498`:**

| Element | Line | Measurement |
|---|---|---|
| Overlay | `:2580` | `position:absolute;inset:0;z-index:9`, column, `justify-content:flex-end` |
| Scrim | `:2581` | `rgba(26,18,8,.34)`, `onClick="{{ closeSheet }}"`, `tabindex="0"`, `role="button"` |
| Sheet | `:2582` | `--c-bg`, `border-radius:14px 20px 34px 34px`, `padding:10px var(--v3-pad) 22px`, `box-shadow:0 -10px 34px rgba(26,18,8,.16)`, `animation:v3up 300ms cubic-bezier(0.16,1,0.3,1) both` |
| Handle | `:2583` | `38x4px`, radius 4, `--c-handle`, `margin:0 auto 18px` |
| Heading | `:2584` | `700 21px/1.2 'Playfair Display'`, `--c-ink` |
| Subhead | `:2585` | `400 13px/1.55 Inter`, `--c-secondary`, `text-wrap:pretty` |
| Note box | `:3492` | `padding:13px 14px`, radius 12, border `--c-gold` when ready else `--c-border`, `transition:border-color 180ms` |
| Textarea | `:2587` | `min-height:86px`, `400 italic 15px/1.6 'Playfair Display'`, no border, no resize |
| Hint / count | `:2589` | hint `400 11px/1 Inter` `--c-muted`; count `400 10.5px/1 'JetBrains Mono'` at `0.045em` |
| Window row | `:2591-2594` | `min-height:44px`; `600 13px/1.3 Inter` over `400 11.5px/1 Inter` `--c-secondary`; "change" `500 12.5px/1 Inter`, underlined, `text-underline-offset:3px` |
| Terms line | `:2596` | `400 11.5px/1.55 Inter`, `--c-muted` |
| Commit button | `:3493` | `min-height:54px`, radius 9, `overflow:hidden`, `user-select:none`, `touch-action:none`; fill `--c-ink` when ready, `--c-locked-bg` when not, `--c-well` when committed |
| Press fill | `:3496-3498` | `absolute;left:0;top:0;bottom:0`, `--c-gold`, `animation:v3fill 700ms linear forwards` |
| Button label | `:2599` / `:3494` | `600 15px/1 Inter`; `--c-oninv` ready, `--c-locked-ink` locked, `--c-ink` committed |
| Dismiss | `:2601` | `min-height:44px`, `500 13.5px/1 Inter`, `--c-secondary` |

Radii: 4, 9, 12, and the sheet's `14px 20px 34px 34px`. The 34px pair is the device bezel showing
through (README: "The 34px value on the prototype's outer frame is the device bezel, not a
component"), but the **20px top-right radius is outside README's sanctioned 4 / 6 / 9 / 12 / 14
scale and is unexplained**. Flagged, not resolved.

Keyframes from the prototype's own style block: `v3up` at `:72` is
`from { transform:translateY(101%) }`; `v3fill` at `:73` is `from { width:0% } to { width:100% }`.
Reduced motion at `:71` kills both (`#v3phone *[style*="animation"] { animation:none !important }`),
which leaves the 700ms hold with no visible progress at all. README's post-screen check is "confirm
nothing is hidden rather than merely unanimated" (`IMPLEMENTATION_PROMPT.md:137-138`); whether the
gesture itself degrades is not stated.

**Copy, verbatim, in render order:** `:2584` "Why do you think so?" · `:2585` "One line. This is what
a reader of your record will actually judge, and it is what gets read back to you when the date
arrives." · `:2587` placeholder "Lending attach is carrying the segment and Square is only
compounding at its mature rate." · `:3491` `noteHint` "A sentence is enough." then "Timestamped
before the outcome is known." · `:3490` `noteCount` = `length + ' characters'`, empty at zero ·
`:2592` "Checked on Nov 4, 2026" over "90 days, against XLF and SPY" · `:2593` "change" · `:2596`
"The window is fixed the moment you commit and cannot be moved afterwards. A miss stays on the
record, and the record is better for it." · `:3495` `pressLabel` `'◆ On your ledger'` / "Keep
pressing" / "Press to enter this on your ledger" / "Write your reasoning first" · `:2601` "Not this
one".

### Review (`isReview`)

**Flag confirmed.** `:498` (`<sc-if value="{{ isReview }}">`), block runs **498 to 520**. Registered
at `:3237` (`isReview: s.screen === 'review'`), handler `goReview: this.go('review')` at `:3507`,
per-screen clock `review: '6:51'` at `:3234` (one of the clocks github.md line 30 records fixing).

Three entry points: `:342`, the Ledger's SINCE YOU LAST LOOKED block, a 44px row reading "One of
your calls was checked overnight."; `:1336`, the Dashboard's "waiting for you" block, a 60px espresso
card reading "RESOLVED OVERNIGHT" over "One of your calls was checked."; `:2641`, the dev strip.

**It is the only screen that flips the browser chrome.** `:3169`:
`const dark = s.screen === 'review';`, feeding `darkChrome / lightChrome` at `:3235`, the status-bar
blocks at `:249` and `:252`, and `homeBarStyle` / `homePillStyle` at `:3464-3465`. No other screen
sets `dark`. github.md line 77 states the intent: "the resolution keeps its distinction by being the
only FULL-BLEED espresso screen; every other use is a card." Confirmed at `:499`
(`flex:1;min-height:0;...;background-color:var(--c-inverse)`).

**No tab bar.** `showNav: ['dash', 'ledger', 'watch', 'ask'].includes(s.screen)` at `:3460` excludes
`review`. Same shape as `DECISIONS.md` O2's finding for Evening Wrap and Search, but here it is
correct rather than a bug: the screen is a set piece with two explicit exits (`:516`, `:517`).

**Route: NEW ROUTE NEEDED, and `/review` is already reserved for it.** `src/proxy.ts:27` carries
`'/review', // step 4` inside `MOBILE_REDESIGN_DEV_PATHS`, described at `:15` as "LOCAL DEV ONLY, on
exactly the precedent `/ledger` set: prod stays gated". **No `src/app/review/` directory exists.**
Reserved and unbuilt. Keying is open: the screen resolves one claim, so the param is a `user_claims`
uuid, under the constraint `TrackCallControl.tsx:29` states: "No claim id is shown. user_claims has
only a uuid (no short human id), and a uuid slice or a hash would be a fabricated identifier, so it
is omitted." The uuid may be the route param; it may not appear in copy.

**Repo source github.md maps to it: one, and it is the wrong object.** Line 93:
`| Review (espresso set piece) | src/lib/desk-record.ts attribution copy |`

- `src/lib/desk-record.ts` (opened; header, `DESK_RECORD_COPY` at `:64-105`, `RESOLUTION_ORDER` at
  `:236-240`). **LIVE**, consumed by `src/components/record/DeskRecordView.tsx` and
  `src/app/radar/desk-record/page.tsx`. The attribution copy is `attributionHeading` (`:92`) "What
  clean and confounded mean" and `attributionExplainer` (`:93-94`): "A call is only credited when
  the grader can tell the move apart from its sector and the market. That is a clean read. If the
  name moved because everything moved, the read is confounded and the call is never counted as
  supported, even when the direction matched. Under the attribution bar the read is inconclusive.
  Confounded and inconclusive calls sit in No clean read." That is the DESK's record.
  `src/lib/your-record.ts:4`: "The desk's record (src/lib/desk-record.ts) and the user's record are
  two different objects and are never mixed." Review is the user's: `:508` reads "YOU WROTE" and
  `:509` renders their own note. See deviation 10.

**Beyond that one mapping, Review is ungrounded. Stated plainly.** Nothing in `src/` renders a
resolution moment, reads a user's note back, or occupies a full-bleed espresso screen. Greps run
this pass for `resolved overnight`, `Resolved overnight`, `RESOLVED OVERNIGHT` and `YOU WROTE`
return **zero hits anywhere under `src/`**. There is no `src/app/review/`, no
`src/components/review/`, and no component anywhere whose job is a single settled claim. And the
deeper reason: **the note the screen exists to read back has no column** (`sql/0012:29-53`). Review
cannot be built until the commit sheet's blocker is resolved, which makes steps 3 and 4 one unit of
work rather than two.

**What would have to be invented. None has a repo counterpart or a second prototype state:**

1. **The trigger.** "resolved overnight" (`:501`) implies a batch that settles claims while the user
   is away and a per-user queue of newly settled ones. `backend/grading/grade_user_claims.py`
   produces outcome rows; nothing surfaces "settled since your last visit" to a client. The Ledger's
   continuity block (`:339-340`, "SINCE YOU LAST LOOKED / 2 CHANGES") has the same missing
   machinery, and README's State section warns about this exact datum: those figures "describe an
   interval that closed before the user arrived, so they are literals and must be invariant to
   anything done in-session."
2. **Queue semantics.** The screen is singular. Nothing says what happens when two claims settle,
   whether it repeats, or whether a second is reachable. Both exits leave the flow.
3. **A seen-once rule.** A resolution moment shown twice is not a moment. There is no `reviewSeen`
   key in the state object and the reset at `:3742` clears none.
4. **Three unrendered outcomes.** Only Challenged is drawn (`:502`). No Supported, Developing or
   Awaiting variant exists, and the espresso treatment of each word is undefined.
5. **The closing paragraph** (`:512`), a written interpretation of one outcome. Nothing in the repo
   generates prose about a user's reasoning. It is either an unspecified LLM output or a template
   keyed on the verdict-and-attribution pair, and the design does not say which.

**Measured geometry and type, from `:499-518`:**

| Element | Line | Measurement |
|---|---|---|
| Screen | `:499` | `flex:1;min-height:0`, column, `--c-inverse`, `animation:v3in 300ms` |
| Scroll region | `:500` | `overflow-y:auto`, `padding:30px var(--v3-pad) 0` |
| Date line | `:501` | `400 italic 13px/1 'Playfair Display'`, `--c-oninv-dim` |
| State dot | `:502` | `11x11px`, radius 50%, `background-color:var(--c-red)` |
| State word | `:502` | `700 36px/1 'Playfair Display'`, `letter-spacing:-0.025em`, `--c-oninv-strong` |
| Gold rule | `:503` | `height:1px`, `--c-gold`, `transform-origin:left`, `animation:v3rule 560ms` |
| Claim | `:504` | `500 19px/1.4 'Playfair Display'`, `--c-oninv-strong`, `text-wrap:pretty` |
| Result line | `:505` | `500 15.5px/1.55 Inter`, `--c-oninv-mono` |
| Attribution prose | `:506` | `400 13.5px/1.65 Inter`, `--c-oninv-body` |
| Note block | `:507` | `margin-top:26px;padding-top:22px;border-top:1px solid var(--c-inverse-border)` |
| Note eyebrow | `:508` | `400 11px/1 'JetBrains Mono'`, `--c-oninv-dim` |
| The user's note | `:509` | `400 italic 17px/1.62 'Playfair Display'`, `--c-oninv-strong` |
| Meaning well | `:511` | `padding:16px 17px`, radius 12, `1px solid var(--c-inverse-border)`, `--c-inverse-well` |
| Well body | `:512` | `400 13.5px/1.7 Inter`, `--c-oninv-mono` |
| Primary CTA | `:516` | `min-height:52px`, radius 9, `--c-gold` fill, `600 14.5px/1 Inter`, `--c-ongold` |
| Secondary CTA | `:517` | `min-height:44px`, `500 13.5px/1 Inter`, `--c-oninv-dim` |

The gold rule at `:503` is a 1px horizontal rule drawn left to right. Not a left border; it does not
touch the standing prohibition.

**Copy, verbatim:** `:501` "resolved overnight &middot; Thursday, August 27" · `:502` "Challenged" ·
`:504` "Constellation Energy trades above the utilities sector index through the next PJM capacity
auction result." · `:505` "CEG +2.10% against XLU +6.44% and SPY +1.71% over 21 days." · `:506` "The
move separates cleanly from both the sector and the market, so the read counts. The auction cleared
inside the forward curve and the regulated book carried the sector." · `:508` "YOU WROTE, 2026-08-06
06:58 PT" · `:509` "Data centre contracting is repricing faster than the regulated book. If the
auction clears high the sector index still carries too much regulated drag to keep pace." · `:512`
"Your reasoning held together. Its condition did not arrive: the auction cleared inside
expectations, so the drag you priced never got tested. That is a different thing from being
mistaken, and the record shows which one it was." · `:516` "On to this morning's brief" · `:517`
"Open the full entry".

### Trends (`isTrends`)

**Flag confirmed.** `:2128` (`<sc-if value="{{ isTrends }}">`), block runs **2128 to 2197**.
Registered at `:3581`, handler `goTrends: this.go('trends')` at `:3583`, clock `trends: '12:24'` at
`:3234`. Entered from the Ask directory row (`:748`), the Search jump list (`:1426`) and the dev
strip (`:2647`); its back control (`:2130`) returns to Ask. All three cards (`:2140`, `:2159`,
`:2177`) fire `goSignal`, so Trends is the parent of the Signal screen batch-6 owns.

**Route: NEW ROUTE NEEDED, and the foundation and the tab bar disagree about its name.**

`src/app/trends/page.tsx` exists (1231 lines) and is **PROTECTED**. `CLAUDE.md`'s propose-only list
names it; github.md line 104 repeats it ("Note `src/app/trends/page.tsx` is a propose-only file
under `CLAUDE.md`"). It must never be edited by this batch.

`src/proxy.ts:42` reserves `'/trends-mobile',// step 10`, dev-only. `/trends` itself is separately
and **unconditionally public in production** at `src/proxy.ts:95` (`path === '/trends' ||`), outside
the dev-only `isMobileRedesignDevPath` branch. Two gates on two paths for one screen. And
`src/components/shell/mobile-tab-bar.tsx:106` gives the Ask pole
`owns: ["/intelligence", "/company", "/deal-flow", "/trends", "/live-feed"]`, matched by `isActive`
at `:110-114` on `pathname === route || pathname.startsWith(route + "/")`. `/trends-mobile`
satisfies neither, so the mobile screen lands with **no pole lit** (deviation 21).

**Repo sources github.md maps to it, verified independently.** Line 104, quoted because the receipt
is the point:

> `| Trends + signal detail | **TWO OF THE THREE SOURCES ARE DEAD CODE.** `src/components/trends/signal-card.tsx`
> (`SignalCard`) has no consumer: its only reference is the barrel re-export at
> `src/components/trends/index.ts:2`. `src/components/trends/anomaly-badge.tsx` (`AnomalyBadge`) is
> dead the same way, its only call site being `signal-card.tsx:66` inside the dead card. REAL
> SOURCE: `src/app/trends/page.tsx`, which renders signal rows inline at `:851`
> (`visibleSignals.map(...)`) and never imports either component. IMPORTANT EXCEPTION: the *type*
> `AnomalyLevel` exported from `anomaly-badge.tsx` IS live, imported at `src/app/trends/page.tsx:15`
> and produced by `strengthToAnomaly()` at `:128`, which derives the level from `strength_score`.
> The components are dead; the type and the level thresholds are not. |`

**Every clause verified.** A repo-wide grep for `signal-card`, `anomaly-badge`, `components/trends`,
`AnomalyBadge`, `SignalCard` and `AnomalyLevel` across all `.ts` and `.tsx` under `src/` returns
exactly: `src/app/trends/page.tsx:15` (`import type { AnomalyLevel }`), `:61`
(`type AnomalyFilter = "all" | AnomalyLevel`), `:128` (`function strengthToAnomaly(...): AnomalyLevel`);
the two barrel lines in `src/components/trends/index.ts`; and `signal-card.tsx:2`, `:7`, `:66` plus
`anomaly-badge.tsx`'s own declarations, all internal to the dead pair. So **`AnomalyBadge` and
`SignalCard` are dead; `AnomalyLevel` is live and type-only.** Deleting `anomaly-badge.tsx` breaks
the build. github.md is accurate on all three counts. (Hits in
`src/components/brief/sector-signal-card.tsx` are a different component, unrelated.)

- `src/components/trends/signal-card.tsx` (103 lines, opened). **DEAD.** `SignalData` at `:4-13`;
  `MiniSparkline` at `:19-45` draws at `w=80, h=24`, `strokeWidth 1.5`, colour keyed off anomaly.
  `sparkData` is optional and nothing populates it.
- `src/components/trends/anomaly-badge.tsx` (39 lines, opened in full). **Component DEAD, type
  LIVE.** `AnomalyLevel` at `:3`. `levelStyles` at `:10-15` is a Tailwind map
  (`bg-red-100 text-red-700 border-red-300` for critical), `capitalize` at `:22`, a 6px dot at
  `:27-35` with `animate-pulse` on critical only.
- `src/components/trends/index.ts` (2 lines). No consumer.
- `src/app/trends/page.tsx` (1231 lines). **LIVE and PROTECTED.** Regions read this pass: `:15`,
  `:61` the type; `:41-59` `TrendSignal`, the entire available field set (`id`, `label`, `headline`,
  `tagline`, `cluster_type`, `article_count`, `source_count`, `strength_score`, `novelty_score`,
  `cross_source_flag`, `underrepresented_flag`, `top_companies`, `top_themes`, `top_sectors`,
  `representative_article_ids`, `lookback_run_count`, `created_at`); `:87-95` `timeAgo` producing
  `Nm ago` / `Nh ago` / `Nd ago`, the exact shape the prototype reproduces at `:2145`, `:2164`,
  `:2182`; `:128-133` `strengthToAnomaly` (`>= 0.8 critical`, `>= 0.6 high`, `>= 0.4 medium`, else
  low); `:146` `getDisplayTitle`'s label joiner, a space-padded U+2014 escape; `:351-376`
  `groupByDate` (Today / Yesterday / Earlier this week / Older); `:378` `MAX_VISIBLE = 5`;
  `:447-458` the fetch (`trend_clusters`, seventeen columns,
  `.gte("article_count", 3).gte("source_count", 2).order("created_at", { ascending: false })
  .limit(500)`), logging `[trends] fetch error` at `:460` and falling through; `:602-608` the
  signed-out gate (`filtered.slice(0, 3)`); `:612` the local `Pill`, declared inside the component
  body; `:694` the `AppShell`; `:699` the preview banner with a literal em-dash; `:716` "Filters
  available after sign in"; `:758-779` the severity chip row and trailing `{filtered.length}
  signals`; `:851-947` the inline card; `:980-1200` the signal-detail modal opened by
  `handleCardClick` at `:684`; `:1202-1221` `MemoModal`; `:1223-1228` `SignInModal`.
- `src/app/trends/layout.tsx` (9 lines, opened in full). **LIVE.** Nothing but
  `metadata = { title: "Trends [EMDASH] Signalera" }` and a pass-through `children`. The em-dash is
  in a `<title>`, which is user-visible chrome. It is also why a sibling mobile route cannot just
  reuse this layout: a route under `src/app/trends/` inherits it, one outside does not.

**Measured geometry and type, from `:2129-2194` and the chip builder at `:3220-3222`:**

| Element | Line | Measurement |
|---|---|---|
| Back bar | `:2130` | `min-height:48px`, `border-bottom:1px solid var(--c-border)`; control `min-height:44px`, `500 13px/1 Inter` |
| Title | `:2131` | `700 24px/1.14 'Playfair Display'`, `letter-spacing:-0.02em` |
| Subhead | `:2131` | `400 12.5px/1.5 Inter`, `--c-secondary` |
| Chip row | `:2132` | `flex-wrap:wrap`, `gap:12px`, `padding:14px var(--v3-pad)` |
| Chip | `:3220-3222` | `min-height:44px`, radius 6, `padding:0 12px`, 12px Inter (600 on, 500 off), `--c-ink` border and `--c-surface` fill when active, transparent on `--c-border` when not |
| Card | `:2140` | radius 12, `1px solid var(--c-border)`, `--c-card`, `overflow:hidden`; siblings `margin-top:11px` |
| State edge | `:2141` `:2160` `:2178` | `height:2px`, `--c-red` / `--c-amber` / `--c-border`, across the **top** |
| Card padding | `:2142` | `14px 15px` |
| Level chip | `:2144` | `padding:3px 8px`, radius 6, `--c-red-edge` on `--c-red-well`, `600 10px/1 Inter` in `--c-redink`, 6px `--c-red` dot |
| Timestamp | `:2145` | `400 10px/1 'JetBrains Mono'`, `letter-spacing:0.07em`, `--c-muted` |
| Tag chips | `:2148-2150` | `padding:3px 7px`, radius 6, `--c-edge` on `--c-well`, `600 10px/1 Inter` at `0.02em` |
| Headline | `:2153` | `700 15px/1.35 'Playfair Display'`, `text-wrap:pretty` |
| Sparkline | `:2154` | `64x24` from an `80x24` viewBox, `stroke-width 1.5`, literal `#dc2626` / `#f59e0b` / `#a8873a` |
| Body | `:2156` | `400 12px/1.5 Inter`, `-webkit-line-clamp:2` |

Radii 6 and 12 only, both sanctioned. Every tap target is 44px or the whole card. The tokens the
card needs already exist in `src/styles/tokens.css`: `--c-red-well`, `--c-red-edge`,
`--c-amber-well`, `--c-amber-edge` at `:97-100` light and `:411-414` dark. Nothing to add.

The three sparkline strokes are **literal hexes, not tokens**: `#dc2626` is light `--c-red`,
`#f59e0b` is light `--c-amber`, `#a8873a` is Gold Dark, which github.md line 159 documents as
nominally a CTA hover state. In dark theme `--c-red` is `#f87171` and `--c-amber` is `#fbbf24`, so
all three lines are pinned to light-theme values on a card that flips with the theme.

**Copy, verbatim:** `:2131` "Trends" / "Clustered signals across the index. 34 active, 3 moved this
week." · `:2133-2137` "All 34", "Critical 2", "High 5", "Medium 11", "My sectors" · `:2144`
"Critical", `:2163` "High", `:2181` "Medium" · `:2148-2150` "Utilities", "Capacity", "Emerging" ·
`:2153` "Grid capacity contracting accelerates across four utilities in eleven days" · `:2156` "Nine
filings and 41 articles in eleven days describe fixed-price supply agreements between merchant
generators and data centre operators." · `:2167-2168` "Healthcare", "Recurring" · `:2171` "GLP-1
supply constraints ease as three plants clear qualification" · `:2174` "Capacity language shifted
from supply-constrained to volume-led across six transcripts this quarter." · `:2185-2186`
"Financials", "Credit" · `:2189` "Private credit spreads compress across three unitranche
repricings" · `:2192` "Three of the largest direct lenders repriced paper inside 500 over base
within the same fortnight."

---

## Shared component to extract first

**The espresso outcome lead.** A state dot plus its word, sized for a full-bleed espresso screen and
coloured with the on-espresso literals rather than the ink tokens. It goes first because Review is
step 4, the word is the first thing on the screen, and the shipped component cannot render it.

What exists: `src/components/ledger/claim-anatomy.tsx` (200 lines, opened in full), which batch-2
called for and which shipped in this worktree. `OUTCOME_STATES` at `:134` is the closed set
`["supported", "challenged", "developing", "awaiting"]`. `OUTCOME_TOKENS` at `:145-150` separates
dot from text deliberately: "Base token for the dot, ink token for the word. The dot is a fill and
the word is text; swapping the two was the single most common defect the design recorded."
`OutcomeLead` at `:167-200` renders a 7px dot and an `11px Inter 600` word, both `transition: none`.

Three measured reasons it cannot be used as-is on Review:

1. **Size.** 7px dot / 11px word versus Review's **11px dot / 36px Playfair 700 at -0.025em**
   (`:502`). Not a size prop away; a different face and weight.
2. **Surface.** `OUTCOME_TOKENS` pairs `--c-red` with `--c-redink`. README requires the literals on
   espresso: "**On pinned-espresso surfaces use the literal on-espresso values**, not the ink
   tokens: `#f87171` red, `#4ade80` green, `#fbbf24` amber. The ink tokens are light-theme values
   and measure 2.86 to 3.76:1 on espresso." The component needs a `surface: "cream" | "espresso"`
   prop, the shape batch-2 argued for before this file was written.
3. **The word is not coloured on Review at all.** `:502` puts the word in `--c-oninv-strong`
   (`#faf5ed`, identical in both themes) and leaves the dot as the only carrier of colour.
   `OutcomeLead` colours the word. Two anatomies for one object (deviation 12).

**Correction to batch-2.** Its variance table (lines 147 to 153) records Review's colour source as
"literal `#f87171` / `#4ade80` / `#fbbf24` on espresso". That is not what the file says. `:502` reads
`background-color:var(--c-red)` on the dot and `color:var(--c-oninv-strong)` on the word. There is
no on-espresso literal anywhere in the `isReview` block. Only that row is corrected here; batch-2's
other rows were not re-checked.

Consequence, computed from the token hexes rather than measured off a render: in **light** theme
`--c-red` resolves to `#dc2626`, which against `--c-inverse` `#1a1208` computes to roughly
**3.8:1**; the literal `#f87171` computes to roughly **6.7:1** on the same ground. In **dark** theme
`--c-red` is already `#f87171`, so the defect is light-theme only. A dot is a non-text graphic and
3.8:1 clears the 3:1 graphical floor, so this is a token-role error rather than an accessibility
failure. It should still be the literal, because README says so and because a value that is correct
in one theme by coincidence is not correct.

Second candidate, smaller: **the level chip**. `:2144`, `:2163`, `:2181` on Trends and `:2204` on
Signal are the same object with different token triples. Batch-6 owns Signal, so the two batches
agree on one implementation or ship two. The repo's `AnomalyBadge` is the wrong starting point: dead,
Tailwind-palette rather than tokenised, `capitalize`d, and carrying `animate-pulse` on critical
(`anomaly-badge.tsx:33`) with no prototype counterpart and no reduced-motion gate.

---

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| Bottom sheet shell | none | **Net new** | No bottom sheet in `src/`. Closest analogue is the `@media (max-width: 560px)` block in `landing.module.css` that turns `waitlist-modal.tsx` into a sheet (`border-radius: 16px 16px 0 0`, `translateY(100%)`), per github.md line 115. Different radius, animation and dismiss. |
| Press-and-hold commit control | none | **Net new** | Nothing in the repo has a hold gesture. `CallCommitFooter`'s button is a plain `onClick` (`TrackCallControl.tsx:373`). The 700ms hold, `v3fill`, `touch-action:none` and the four-stage label are design-owned. |
| Note field | none | **Net new** | And it has no destination. See open question 1. |
| Trust line | `TrackCallControl.tsx` (`TRACK_TRUST_LINE`, `CallsTrustLine`) | Needs variant | Test-locked at `TrackCallControl.test.ts:168`. Prototype renders a different sentence at `:2596`. Deviation 5. |
| Ledger line | `TrackCallControl.tsx` (`buildLedgerLine`, `CallLedgerLine`) | Needs variant | Five exact-match assertions. Prototype renders `ENTERED ... CHECKED ...` at `:401`. Batch-2 item 4 and open question 2 own this. |
| Ungradeable reason | `TrackCallControl.tsx` (`UNGRADEABLE_REASON`) | Reusable as-is | Matches `:441` character for character. But the sheet has no branch to put it in. Deviation 6. |
| Commit gate predicate | `TrackCallControl.tsx` (`hasCommitFooter`) | Reusable as-is | Pure: `tracked -> true`, `!gradeable -> true`, else `available`. The sheet needs this answer before it opens, not after. |
| Locked treatment | `src/styles/tokens.css:104-105`, `:418-419` | Reusable as-is | `--c-locked-bg` / `--c-locked-ink` exist in both themes; README states the pair measures 5.39:1. Nothing to add. |
| Window row | `src/lib/call-horizons.ts` | Reusable as-is | `adoptWindowPhrase`, `resolutionPhrase`, `adoptWindowOptions`, `adoptWindowValue`, `HORIZON_DAYS`, `MAX_WINDOW_DAYS`. Pure. The design's "90 days" is exactly `HORIZON_DAYS.quarter` and the cap. |
| Claim card `onTrack` wiring | `ledger-claim-card.tsx:44` | Reusable as-is | Prop exists and is documented. `ledger-screen.tsx:81` passes `() => {}`. Replace the no-op, change nothing else. |
| Espresso outcome lead | `claim-anatomy.tsx` (`OutcomeLead`) | Needs variant | 7px/11px cream only. See the section above. |
| Full-bleed espresso screen | none | **Net new** | github.md line 77: the only full-bleed espresso screen. Also the only screen that flips the status bar (`:3169`). |
| Note read-back block | none | **Net new** | No repo counterpart, and no column behind it. |
| Attribution result line | `src/lib/desk-record.ts` (`attributionExplainer`, `attributionLabel`) | Needs variant | Words are right (clean / confounded / inconclusive); the object is the desk's record, not the user's. Deviation 10. |
| Verdict word table | `src/lib/verdict-vocabulary.ts` | Reusable as-is | `RESOLUTION_BY_STATE` `:38`, `VERDICT_WORD` `:53`, `verdictWordForState` `:66`. Pure. Vocabulary conflict is a content decision. |
| Trends list screen | `src/app/trends/page.tsx:851-947` | **Read-only. Do not touch.** | Protected. A new file composes the same data; nothing imports back into it. |
| Anomaly level derivation | `src/app/trends/page.tsx:128-133` | Needs one shared home | Pure. Must be reimplemented in one shared lib, not moved and not copied twice, or Trends and Signal disagree about what "Critical" means. Batch-6 reached the same conclusion. |
| `TrendSignal` shape | `src/app/trends/page.tsx:41-59` | Re-declare, do not import | Reading a type off a protected file costs nothing; importing creates an edge back into it. |
| Level chip | `src/components/trends/anomaly-badge.tsx` | **Dead. Rewrite.** | Tailwind palette, `capitalize`, `animate-pulse` on critical. Shares its shape with Signal's chip at `:2204`; coordinate with batch-6. |
| Signal card | `src/components/trends/signal-card.tsx` | **Dead. Do not port.** | `sparkData` optional, nothing populates it, `trend_clusters` has no time series. |
| Filter chip row | `src/components/feed/filter-bar.tsx` | Needs variant | Batch-6 owns the extraction and explicitly excluded the Trends copy: "This one sits in a protected file and must be left alone." Mobile Trends consumes the extracted component; it does not touch `Pill` at `:612`. |
| Sparkline | `signal-card.tsx` (`MiniSparkline`) | **Dead, and unfeedable** | 80x24 stroke 1.5, exactly the prototype's viewBox, so the design was drawn from the dead component. No series exists to draw. Deviation 20. |
| Empty state | `src/components/ui/empty-state.tsx` | Reusable as-is | Already used twice by the protected route. |
| Skeleton | `src/components/ui/skeleton.tsx` | Reusable as-is | The protected route uses a bare `h-20 animate-pulse` block; the shared `skeleton-shimmer` matches README's 1.8s keyframe. |

---

## States

Handoff position first, then what exists. Nothing invented.

README's Overview asserts "**31 screens**, all reachable, each with its loading, error, empty and
stale states." **None of the three screens here has a lifecycle state in the prototype.** The dev
strip (`:2636-2680`) exposes jumps for Stale brief, Wrap loading, No wrap, Brief loading, Brief
error, No brief, Replay splash, Memo failed and Commit fails, and nothing else. Batch-2 and batch-6
recorded the same. It now holds for eleven screens across three batches, which makes it a property
of the handoff rather than a per-batch gap.

### Commit sheet

No lifecycle machine. It has a **commit machine**, across four keys:

- **`note`** (`:3489`). Gate at `:3170`: `noteReady = s.note.trim().length >= 12`.
- **`pressing`** (`:3499-3505`). `startPress` returns immediately unless `ready`
  (`ready = noteReady && !s.committed`, `:3171`), sets `pressing:true`, and arms a 700ms timeout.
  `endPress` clears it and drops `pressing` unless already committed.
- **`committed`** (`:3482`), exposed as `committed` / `notCommitted`. The timeout sets
  `{ pressing:false, committed:true, sheet:false, screen:'ledger' }` in one call, so the sheet closes
  and the Ledger re-renders. README: "No toast. The confirmation is the ledger changing."
- **`commitStage`** (`:3428`): `commitFailed: s.commitStage === 'failed'`. `retryCommit` (`:3432`)
  sets it back to `null` and does nothing else.

Four rendered states: **`notCommitted`** (`:413-425`, the open card carrying the CTA at `:422`);
**`committed`** (`:392-404`, a card with a 2px gold **top** edge at `:394` under
`animation:v3rule 420ms`, a `&#9670; Yours` marker, the note echoed at `:400` via `noteEcho`
(`:3483`), and the mono ledger line at `:401`); **`commitFailed`** (`:406-412`, "This call was not
entered." at `:408`, "The connection dropped before the ledger acknowledged it. Nothing was written,
and your note is still here." at `:409`, a 44px "Try again" at `:410`); and **`sheetOpen`** itself,
orthogonal to all three.

- **loading** UNSPECIFIED. The sheet has no busy state and `startPress` commits on a timer with no
  network in between. The repo has one: `CallCommitFooter`'s `busy` prop disables the select and
  renders `"Tracking…"` (`TrackCallControl.tsx:378`). Nothing in the design corresponds.
- **error** SPECIFIED but rendered in the wrong place. Deviation 2.
- **empty** Not meaningful.
- **stale** UNSPECIFIED. The sheet is reachable from a stale brief; README's stale copy says "review
  dates are unaffected", but whether a stale claim can be committed to is not stated.
- **ungradeable** UNSPECIFIED for the sheet. The repo has the branch
  (`CallCommitFooter:268-277`), the Ledger renders the reason at `:441`, the sheet has nothing.
  Deviation 6.

### Review

- **loading** UNSPECIFIED, and it is the screen most likely to need one: entered from a
  notification-shaped row on two surfaces, it immediately renders a settled verdict.
- **error** UNSPECIFIED. The governing principle exists, adopted verbatim in github.md line 146 from
  `src/app/cross-source/page.tsx`: "This is a failed read, not an empty result. Nothing is being
  hidden." Sharper here than anywhere else, because a resolution that fails to load reads as a
  resolution that did not happen.
- **empty** UNSPECIFIED, and arguably the real one. Both entry rows are drawn only in the populated
  case. What the screen shows when nothing settled overnight, and whether the entry rows disappear
  or say so, is undrawn.
- **stale** UNSPECIFIED.
- **Outcome variants** UNSPECIFIED. One of four drawn. Open question 6.
- **Seen-once** UNSPECIFIED. No `reviewSeen` key; the reset at `:3742` clears none.

### Trends

- **loading** UNSPECIFIED in the design. The protected route has one: five
  `h-20 rounded-xl bg-parchment-mid animate-pulse` blocks in the `loading ?` branch.
- **error** UNSPECIFIED, and **absent from the repo too**. `:460` logs `[trends] fetch error` and
  returns; `allSignals` stays empty; a failed read renders as "No trend clusters yet". Exactly the
  trust failure github.md line 146 names.
- **empty** UNSPECIFIED in the design. The repo has two, both via `EmptyState`: "No trend clusters
  yet" / "Trend signals will appear after the pipeline runs and identifies recurring narratives."
  for a zero fetch, and "No signals match your filters" / "Try broadening your filters." for a
  filtered-out list. The prototype draws neither, and its lenses are CSS-driven (`--v3-trCrit` and
  siblings at `:22`, `setTrends` at `:3143-3150`) so no lens can produce an empty list.
- **stale** UNSPECIFIED. "34 active, 3 moved this week" is provenance, not freshness. No
  `Updated HH:MM` stamp of the kind Live Feed carries at `:2236`.
- **signed-out** SPECIFIED in the repo, ABSENT from the design. Deviation 19.

---

## Lucas-protected files

Of the four propose-only files in `CLAUDE.md`, this batch touches one, read-only.

- `src/app/api/briefing/route.ts`: not touched. No screen here reads briefing data.
- `src/lib/watchlist-utils.ts`: not touched **by the screens as drawn**. Scope note, the same one
  batch-6 raised: `src/app/trends/page.tsx:655-675` performs its own watchlist insert inline rather
  than going through that helper, and the protected route's modal exposes an add-to-watchlist
  control. The mobile Trends screen as drawn has **no** watchlist affordance, so the batch stays
  clear as long as none is added.
- `src/components/watchlist/WatchlistAddInput.tsx`: not touched.
- `src/components/memo/MemoModal.tsx`: not touched. Mounted by the protected route at `:1202-1221`,
  but the mobile Trends list has no memo action; the memo lands on Signal, which is batch-6's.
- `src/app/trends/page.tsx`: **touched, read-only.**

### How Trends lands without editing `src/app/trends/page.tsx`

Batch-6's section "How Signal lands without editing `src/app/trends/page.tsx`" established the
shape: re-declare the type, reimplement the pure derivation in a shared lib, fetch independently,
leave `handleCardClick` alone. That holds. Only what changes for the parent surface:

1. **Data shape.** `TrendSignal` (`:41-59`) and the select list (`:452-453`). Re-declare, do not
   import.
2. **Fetch predicate.** `.gte("article_count", 3).gte("source_count", 2)` (`:454-455`),
   `.order("created_at", desc)`, `.limit(500)`. These thresholds define "a cluster worth showing".
   Reproduce them or the two surfaces show different universes and "34 active" means two things.
3. **Level derivation.** `strengthToAnomaly` (`:128-133`), thresholds 0.8 / 0.6 / 0.4. **The one
   thing this batch and batch-6 both need, and it must land in exactly one place.** Whichever ships
   first creates the shared lib; the other imports it. Do not move it out of the protected file, do
   not allow a third copy.
4. **`timeAgo`** (`:87-95`). Pure, three-branch. Same treatment.
5. **`groupByDate`** (`:351-376`). The prototype's list is **flat**, with no date groups. Recorded so
   nobody ports it by reflex.
6. **Dedupe.** `deduplicateSignals` / `areSignalsDuplicates` run over the desktop list; the prototype
   says nothing about dedupe. If the mobile list does not inherit it, the two surfaces can show a
   different count for the same day, colliding with README's "Any figure that describes state must be
   read from that state, never typed."
7. **The entry point, and it is the inverse of batch-6's problem.** Batch-6 was blocked because
   tapping a Trends card opens a modal and pointing it at a route means editing `handleCardClick`
   (`:684`). This batch is not: the mobile Trends list is a **new file with its own cards** and its
   own `goSignal` equivalent. The protected route keeps its modal on desktop, untouched. The two
   lists coexist at two paths.
8. **Do not touch the local `Pill`** at `:612`. Batch-6 already ruled it out of scope.

**What is harder than Signal.** Signal is a detail screen at a new path with no name collision.
Trends is a **list screen that already has a canonical path**: `/trends` is public in production
(`src/proxy.ts:95`), owned by the Ask pole (`mobile-tab-bar.tsx:106`), and named in the Search jump
list github.md line 117 records. `/trends-mobile` leaves the pole dark and the jump list pointing at
the desktop page; `/trends` means editing the protected file. Neither is free.

The Ledger precedent is the nearest answer and not quite the same: `/ledger` is a new path whose pole
owns both it and the old surfaces (`owns: ["/ledger", "/morning-brief", "/evening-wrap",
"/radar/calls"]`, `mobile-tab-bar.tsx:94`). The equivalent is adding `/trends-mobile` to the Ask
pole's `owns`, which touches `mobile-tab-bar.tsx` and **not** the protected route. That file is not
propose-only. Cheapest resolution, still a foundation change, so it is raised rather than assumed
(open question 8).

Two further observations from reading the protected file, for Lucas rather than this batch: `:146`
joins label segments on a space-padded U+2014 written as an escape and `:699` renders a literal
U+2014 in "Previewing trend signals [EMDASH] sign in to unlock all N signals and filters", both
user-facing and both forbidden by README rule 4 (batch-6 recorded them; unchanged this pass); and
`:33` and `:34` both carry the keyword `"buyout"` inside `ACTIVITY_KEYWORDS`, containing the banned
substring `buy`, which README rule 1 says reaches code: "This extends to code identifiers and
comments, since a compliance grep over source will hit them." Deviation 22.

---

## Designed fresh, no repo counterpart

github.md marks four screens as designed fresh (Story, Saved/offline, Alerts, Ask directory) and
**none is in this batch**. All three here carry a row in the screen map. That is not the same as
being grounded:

- **Commit sheet**: mapped to a real, live file that implements the same decision in a different
  place. Genuinely grounded, with one blocker (the note) no source covers.
- **Trends**: mapped to three files, **two of them dead code**, with the real source and the
  live-type exception both named correctly. Grounded once you follow the correction.
- **Review**: mapped to `src/lib/desk-record.ts` attribution copy, which is the desk's record, not
  the user's, and which supplies four sentences of vocabulary and nothing structural. **In substance
  this screen is ungrounded**, and it is not declared fresh, so it is worse off than a screen that
  was: a fresh screen has no source and says so, while Review has a source that does not do what the
  row implies.

Stated plainly: **there is no repo counterpart for the Review screen.** No route, no component, no
copy, and no column for the one datum the screen exists to show. Everything in the itemised list
under the Review section would have to be invented, and inventing it is a product decision, not an
implementation one.

---

## NOT PORTED and deviations

Restricted to these three screens. **Twenty-two, numbered.**

**1. Where the commit sheet lives. Three documents, two answers.** README Screens table:
`| Commit sheet | (within `isLedger`) |`. github.md line 92 lists it under the Ledger. `src/proxy.ts:25-50`
has no step-3 path, consistent with both. The prototype: `:2579` is a sibling of every screen block
at the same indentation, gated on `sheetOpen: s.sheet` (`:3485`) with no reference to `s.screen`,
opened from `:422`, `:492` and `:1487`. Batch-2's open question 5, still open. If the sheet ships as
a Ledger-local component, Claim and Deal detail ship with dead primary CTAs. Not resolved.

**2. The commit failure renders behind its own scrim.** README Interactions: "**Commit failure.** If
the ledger does not acknowledge, the sheet shows: *'This call was not entered.'* Nothing was
written, the note is preserved in the field, and a retry is offered." The prototype puts that copy at
`:406-412`, **inside `isLedger`**. And `failCommit` (`:3430-3431`) sets
`{ screen:'ledger', sheet:true, committed:false, commitStage:'failed', note:'...' }` in one call, so
the sheet renders at `z-index:9` over a `rgba(26,18,8,.34)` scrim (`:2580-2581`) with the failure
card dimmed underneath it. Two consequences: the user is told the failure by an element they cannot
read until they dismiss the sheet, and the sheet stays open showing the commit button in whatever
state the note left it, with no sign the last press failed. README: "A call that silently fails to
save is the worst possible bug in this product." Not resolved.

**3. The required note has nowhere to be written. Blocker.** README makes it the gate and the
argument. `sql/0012_radar_user_claims.sql:29-53` has no note column;
`src/app/api/radar/claims/adopt/route.ts:33` parses `{ call_id, horizon, window_days }`; batch-8
recorded the same gap on the authoring route. Three surfaces require it, zero persist it. Blocks step
3 and therefore step 4. README's own fallback needs the same column: "a note that can be added later
with the entry marked unjustified until it is."

**4. `buildLedgerLine` is test-locked to a string the design does not draw.** Repo
(`TrackCallControl.tsx:95-107`, asserted at `test.ts:112`):
`LOGGED 2026-07-26  ·  REVIEW 2026-08-02  ·  Fixed at entry. Reviewed on the desk's own bar.`
Prototype, on the committed card the sheet produces (`:401`):
`ENTERED 2026-08-06 06:58 PT  ·  CHECKED 2026-11-04`. Batch-2 item 4 and its open question 2 own
this in full, including the wall-clock time `test.ts:159` forbids. Restated only because the sheet
writes the line, so whichever batch ships it inherits the decision.

**5. `TRACK_TRUST_LINE` is restated, and half of it is dropped.** Repo
(`TrackCallControl.tsx:61-62`): "Your window is fixed the moment you commit, and misses stay on your
record. Same benchmark-attribution bar as the desk's own calls: a move the market explains is not a
hit." Prototype (`:2596`): "The window is fixed the moment you commit and cannot be moved afterwards.
A miss stays on the record, and the record is better for it." The benchmark-attribution clause is
gone entirely, which is the half explaining why a move the market caused is not a hit. The repo
comment at `:49` says the line is "Shown ONCE beneath a section heading, never per card" because
"Repeating it above every card turned the strongest sentence in the product into wallpaper." The
sheet is once per commit rather than once per section, so the frequency argument survives; the
content change does not. `test.ts:168` asserts the repo string verbatim. Batch-2 item 5 logged this
from the Ledger side; logged here from the file that renders it.

**6. The sheet has no ungradeable branch, and can be opened on an ungradeable object.**
`TrackCallControl.tsx:18-26` enumerates untracked / ungradeable / tracked; `:268-277` renders
`UNGRADEABLE_REASON` and no control, with the reasoning at `:21-23`: "Offering a commit the system
cannot resolve is worse than offering nothing." `hasCommitFooter` (`:165-177`) returns true for the
ungradeable case precisely so the reason can be shown. The prototype handles it on the **Ledger**, at
`:441`, character for character: "No honest grader for this claim type yet, so there is nothing to
commit to." The ungradeable card (`:436-442`) carries no CTA, so the Ledger path is safe. But `:492`
(Claim) and `:1487` (Deal detail) call `openSheet` with no gradeability check anywhere in the chain,
and `:2579-2604` has no branch for it. Deal detail is the worse case: batch-6's open question 4
already records that a deal row carries no direction and no horizon, so it is structurally
ungradeable, and its CTA opens the same sheet.

**7. The window "change" control has no handler.** `:2593` is a div with `cursor:pointer`,
`text-decoration:underline`, `min-height:44px`, and **no `onClick`, no `tabindex`, no `role`**.
README Accessibility: "**A `cursor:pointer` element with no handler is a defect.** Cheap to sweep
for, and it caught several screens." `IMPLEMENTATION_PROMPT.md:131` repeats it as the first
post-screen check. Same class batch-6 found on the Signal footer at `:2228`. The repo has the real
behaviour: `UntrackedFooter` (`TrackCallControl.tsx:304-386`) toggles an `editing` boolean that swaps
the phrase for a `<select>` over `adoptWindowOptions(window)`, with `autoFocus`, `onBlur` and a
disabled state. Portable; only the trigger is missing.

**8. The preselected window is the cap, not the default.** The sheet (`:2592`) shows "Checked on Nov
4, 2026" over "90 days, against XLF and SPY"; the Claim screen's benchmark table (`:485-487`) shows
the same trio; the Ledger card (`:421`) reads "reviewed Nov 4" over "in about a quarter".
`call-horizons.ts:38` gives `quarter: 90` and `:55` gives `MAX_WINDOW_DAYS = 90`, so the design
preselects the maximum permitted window. The adopt route defaults to `DEFAULT_ADOPT_HORIZON = "week"`
(`:62`), and `TrackCallControl.tsx:204-208` is explicit that the preselection should be the call's
own span: "a 13-day call has no bucket, and defaulting it to '1 week' is the exact defect #535
fixed." Whether 90 days is the sample call's own span or a design default is not stated anywhere.

**9. The benchmark pair has no read-time source.** "against XLF and SPY" appears in the sheet
(`:2592`) and on the Claim screen (`:485`). `src/lib/call-horizons.ts` owns the window only; nothing
in it selects a benchmark set. Batch-2's open question 8, unresolved. Repeated because the sheet
renders the pair inside the commitment itself, which makes it part of what the user agrees to rather
than a label on a card.

**10. Review is mapped to the desk's record.** github.md line 93:
`| Review (espresso set piece) | src/lib/desk-record.ts attribution copy |`. `desk-record.ts:4` and
`DeskRecordView.tsx:4` both say the object is "Signalera's own call record".
`src/lib/your-record.ts:4`: "The desk's record (src/lib/desk-record.ts) and the user's record are two
different objects and are never mixed." Review reads back the user's note (`:508-509`) and closes on
a paragraph about their reasoning (`:512`). github.md itself names this failure mode at line 52 about
a different screen: "`RadarTabs.tsx` states it is the desk's own graded record, distinct from the
user's record on Calls; the two had been wrongly collapsed into one idea." Second instance; batch-2's
open question 3 is the first.

**11. Review's espresso dot uses a light-theme token.** `:502` sets the dot to `var(--c-red)`.
README: "**On pinned-espresso surfaces use the literal on-espresso values**, not the ink tokens:
`#f87171` red, `#4ade80` green, `#fbbf24` amber." github.md line 170 records the identical defect
being fixed on the landing outcome pill and calls it "Same token-role class corrected three times
earlier this session." It survives on the single most important instance of the outcome word in the
product. Light-theme only; in dark `--c-red` already resolves to `#f87171`. Batch-2's variance table
records Review as using the literals; it does not.

**12. Review splits colour and word across two elements.** `:502` puts the dot in `--c-red` and the
word in `--c-oninv-strong` (cream). The shipped `OutcomeLead` (`claim-anatomy.tsx:167-200`) puts the
dot in `OUTCOME_TOKENS[state].dot` and the **word** in `OUTCOME_TOKENS[state].text`. Two anatomies for
one object, on the two surfaces where it matters most. README's accessibility rule is satisfied
either way ("No state is signalled by colour alone [EMDASH] every one carries its word"), and a cream
36px word on espresso is defensible. It is a deviation from a component that shipped in this same
worktree, and neither document records it. Not resolved.

**13. Whether an adopted claim is graded at all. Four sources, three answers.** Load-bearing for
Review, because Review is the moment an adopted claim resolves.

- `sql/0012_radar_user_claims.sql:18-21`: "Adopted claims (source = 'adopted') are NOT independently
  graded ... Only authored gradeable claims are picked up by the grading cron." Its index at
  `:57-61` carries `WHERE gradeable AND status = 'open' AND source = 'authored'`.
- `src/components/calls/TrackCallControl.test.ts:183-185`: "Adopted claims are not yet in the grading
  due-scan (backend/grading/grade_user_claims.py filters source = 'authored') ... If this assertion
  is ever relaxed, the grader filter must be widened first."
- `src/lib/claim-outcome.ts:10-15`: "an adopted claim now carries its own forward window (the user
  picks the horizon) and is graded independently by backend/grading/grade_user_claims.py over that
  window."
- `backend/grading/grade_user_claims.py:64`: `GRADEABLE_SOURCES = ("authored", "adopted")`, with the
  header at `:15-18` recording the change. `sql/0015_user_claims_due_any_source.sql` exists and its
  name says it rebuilds the index.

The backend and `claim-outcome.ts` agree that adopted claims are graded. `sql/0012`'s header and the
test comment are both stale, and the test's assertion at `:187` is still enforced on a premise that
no longer holds. Nobody has to resolve this to build the sheet, but Review cannot be specified until
someone says which claims can reach it.

**14. Review's verdict word and the column it comes from disagree.** `:502` renders "Challenged".
`sql/0012:69-70` constrains the producing column:
`verdict text NOT NULL CHECK (verdict IN ('correct','wrong','partial','ungradable'))`. Three of the
four are in README rule 3's forbidden list ("Never right, wrong, correct, win, or loss").
`src/lib/verdict-vocabulary.ts` is the translation layer and does the job correctly
(`RESOLUTION_BY_STATE:38-45` maps `right -> supported`, `wrong -> challenged`,
`inconclusive -> noCleanRead`; `VERDICT_WORD:53-58` supplies the words), with the reason at `:7-12`:
"a direction that did not hold is a claim the evidence challenged, not a person who was wrong ...
the difference between 'the evidence challenged this' and 'you were wrong' is the difference between
a record someone keeps and a record they abandon." Nothing user-facing is broken; the banned words
live in a DB CHECK and a `ScoredState` union, which README rule 1 says a compliance grep will hit.
`DECISIONS.md` ruling 1 schedules exactly this rename for `n_correct`/`n_wrong` on `/cross-source`,
with the migration written and unapplied, and does not cover `user_claim_outcomes`. Flagged, not
touched.

**15. Outcome vocabulary. Four words specified, six shipped.** Batch-2 item 2 owns this. One line
because Review renders the word at 36px: README rule 3 permits supported / challenged / developing /
awaiting; the repo renders Supported, Challenged, No clean read, Not graded, Inconclusive, Developing
across `verdict-vocabulary.ts:53`, `desk-record.ts:76` and `track-record-live-score.ts:287`. Review
draws one of the four permitted words, so it is compliant as drawn. Which repo bucket produces it is
batch-2's open question 1 and blocks this screen too.

**16. The Trends level is computed and never rendered.** `strengthToAnomaly`
(`src/app/trends/page.tsx:128-133`) derives a four-level anomaly from `strength_score`. Its **only**
consumer in the whole file is the filter predicate at `:583`:
`result.filter((s) => strengthToAnomaly(s.strength_score) === anomalyFilter)`. The inline card
(`:851-947`) renders a "Watching" badge, an Emerging badge, one sector, a source count and a
timestamp, and **no level**. The dead `AnomalyBadge` used to render it. The prototype makes the level
the card's lead element: a coloured chip (`:2144`, `:2163`, `:2181`) and a matching 2px top edge
(`:2141`, `:2160`, `:2178`). The design surfaces a datum the shipped product computes and does not
show. Whether it was ever meant to be visible is not recorded anywhere.

**17. The Trends filter row differs on both axes.** Prototype `:2133-2137`: five chips, "All 34 /
Critical 2 / High 5 / Medium 11 / My sectors", each carrying an inline count except the last, with
**Low absent**. Repo `:760-764`: five chips over `["all","low","medium","high","critical"]`,
title-cased at `:762`, with **no counts on the chips** and a single derived `{filtered.length}
signals` pushed to the row's trailing edge at `:777-779`. Plus two more chip rows above it, Sector
over `INDUSTRY_VERTICALS` (11 entries) and Activity over `ACTIVITY_TYPES` (11 entries), neither of
which the prototype has. So the design drops a level, drops two entire filter dimensions, moves the
counts onto the chips and reverses the order, none of it recorded as a decision. The prototype's
counts are also literals in markup, which README's State section forbids: "**Any figure that
describes state must be read from that state, never typed.** Four separate defects came from a
hardcoded count sitting next to a derived one and disagreeing with it."

**18. "My sectors" is an exclusive lens in the design and an independent toggle in the repo.**
Prototype `setTrends` (`:3143-3150`): `r.setProperty('--v3-trCrit', which === 'mine' ? 'flex' :
on('crit'))`, with `--v3-trHigh` and `--v3-trMed` forced to `'none'` under `mine`. It is one of five
mutually exclusive `trLens` values and it hardcodes a result: show the Utilities card, hide the other
two. Repo: `mySectorsActive` is a boolean toggled at `:770` with `setMySectorsActive((prev) =>
!prev)`, it composes with the severity filter rather than replacing it, and the chip **only renders
at all** when `profileSectors.length > 0` (`:765`). So in production a user can hold Critical and My
sectors at once, and a user with no profile sectors never sees the control. Neither is possible in
the design. Identical in kind to batch-6's finding about Live Feed's Alerts and Saved chips.

**19. Trends signed-out gating. NOT PORTED and not acknowledged.**
`src/app/trends/page.tsx:602-608` truncates to the first three signals for signed-out readers;
`:696-700` renders a preview banner; `:713-717` replaces the entire filter bar with a padlock and
"Filters available after sign in"; `:1223-1228` mounts a `SignInModal` headlined "Sign in to unlock
signals". The prototype has none of it, on a screen whose route is unconditionally public in
production (`src/proxy.ts:95`). Batch-6 raised the same gap for Live Feed and Trends together as its
open question 6. Still open, and now on the screen that owns the gate rather than a sibling.

**20. The Trends sparkline has no data behind it.** The prototype draws a 64x24 polyline on every
card (`:2154`, `:2172`, `:2190`), each with seven hand-authored points. `trend_clusters` as selected
at `:452-453` carries seventeen columns and not one is a time series. The dead `SignalCard`'s
`sparkData?: number[]` (`signal-card.tsx:9`) is optional and nothing populates it, and its
`MiniSparkline` (`:19-45`) draws at exactly `w=80, h=24, strokeWidth 1.5`, which is the prototype's
viewBox, so the design was drawn from the dead component's geometry. github.md line 50 records it as
built from that file. The three strokes are also literal hexes (`#dc2626`, `#f59e0b`, `#a8873a`)
rather than tokens, so they do not flip with the theme. Second half of the same defect.

**21. `/trends-mobile` is reserved by the proxy and unowned by the tab bar.** `src/proxy.ts:42`
reserves `'/trends-mobile',// step 10`, dev-only per the header at `:15-18`.
`src/components/shell/mobile-tab-bar.tsx:106` gives the Ask pole
`owns: ["/intelligence", "/company", "/deal-flow", "/trends", "/live-feed"]`, matched by `isActive`
(`:110-114`) on `pathname === route || pathname.startsWith(route + "/")`. `/trends-mobile` satisfies
neither, so the pole goes dark on arrival. That is the exact failure the same file's comment at
`:85-90` was written to prevent for `/ledger`: "`owns` carries /ledger explicitly since isActive
reads `owns` alone and never `href`, so a pole whose destination is missing from its own list goes
dark on arrival." Same latent problem for `/signal` (`proxy.ts:43`), which batch-6 owns.

**22. Compliance sweep on the three screens.** Substring scan for `buy`, `sell`, `hold`,
`allocation`, `returns`, `performance` over each prototype block and each repo source, per README
rule 1's "Check as substrings, not words".

*Clean.* Prototype `:2579-2604`, `:498-520` and `:2128-2197`: the only hits are the word
`placeholder` in markup attributes. **Zero banned words in any rendered string on any of the three
screens, and zero em-dashes in all three blocks.** Aggregate rates: zero; every figure is a count
("34 active, 3 moved this week", "All 34 / Critical 2 / High 5 / Medium 11"), and Review's
`+2.10% against +6.44%` is one instrument against one benchmark over one window, which is evidence
for a single claim rather than a rate over a set. `src/app/trends/page.tsx` renders no rate (its
`≥70%` at `:232` is a comment). Coloured left borders: zero. Trends uses a 2px **top** edge (`:2141`,
`:2160`, `:2178`), the sanctioned treatment; Review's gold rule (`:503`) is horizontal; the commit
sheet has no rules at all.

*Not clean, all in repo sources rather than the design.* `src/app/trends/page.tsx:33` and `:34`,
`"buyout"` inside `ACTIVITY_KEYWORDS` (protected). `src/app/trends/page.tsx:146` and `:699`,
user-facing em-dashes (protected). `src/app/trends/layout.tsx:3`,
`title: "Trends [EMDASH] Signalera"` (not protected; the cheapest compliance fix in this batch).
`src/components/calls/TrackCallControl.tsx:294`, a comment containing `hold`.
`src/lib/claim-evidence.ts:21` and `:88`, comments containing `returns`.
`sql/0012_radar_user_claims.sql:69-70`, the `verdict` CHECK (deviation 14). None of the last three is
user-facing; all would be hit by the grep README rule 1 describes, and github.md line 190 records the
same cleanup being done once already: "three code comments containing 'hold', and
`performance.now()` in the see-how scroll, swapped to `Date.now()`."

---

## Open questions

1. **Where does the note go.** The design gates the most important interaction in the product on a
   note. `user_claims` has no column, `/api/radar/claims/adopt` no field, `/api/radar/claims` POST no
   field. That is a schema change plus two route changes plus a read path, and per `CLAUDE.md` an
   agent may not apply the migration. **Blocks step 3, and step 4 depends on step 3.** Decide the
   column, decide whether the note is required at write time or can arrive later, and decide who
   applies the migration.

2. **Who owns the commit sheet.** README and github.md put it inside the Ledger; the prototype makes
   it a global overlay opened from three screens. Batch-2 asked and got no answer. It now blocks two
   batches: Claim (batch-2) and Deal detail (batch-6) both ship with a dead primary CTA if the sheet
   is Ledger-local.

3. **Where the commit failure renders.** README says the sheet; the prototype draws it inside the
   Ledger, underneath the sheet's own scrim, with the sheet still open (`failCommit`, `:3430`). One
   of the two is wrong. The sheet-local version looks right given README's "worst possible bug"
   framing, but that is a guess and is not recorded here as a finding.

4. **Can an ungradeable object open the sheet.** The Ledger blocks it by omitting the CTA; Claim
   (`:492`) and Deal detail (`:1487`) do not check. `hasCommitFooter` already answers the question in
   one pure call. Either gate the three call sites or add an ungradeable branch to the sheet, and say
   which.

5. **Which claims can reach Review.** Four sources disagree about whether an adopted claim is graded
   at all (deviation 13). The backend says yes; `sql/0012`'s header and
   `TrackCallControl.test.ts:183-185` say no and are stale. Until someone confirms, Review cannot say
   what it is showing a resolution of.

6. **Review's other three outcomes.** Only Challenged is drawn. Supported, Developing and Awaiting
   have no espresso treatment, and Awaiting arguably has no Review at all, since an awaiting claim
   has not resolved. Confirm the set, and confirm whether the closing paragraph at `:512` is
   generated, templated per verdict-and-attribution pair, or authored.

7. **Review's queue and its seen-once rule.** The screen is singular and the trigger is "resolved
   overnight". What happens when two claims settle, whether the screen repeats on the next visit, and
   where the "settled since you last looked" set comes from are all undefined. The Ledger's
   continuity block has the same missing machinery, and README's warning applies: deriving the prior
   value from current state "retroactively rewrites the user's history."

8. **What path the mobile Trends screen lands on.** `src/proxy.ts:42` reserves `/trends-mobile`;
   `mobile-tab-bar.tsx:106` owns `/trends`. `/trends-mobile` leaves the Ask pole dark and the Search
   jump list pointing elsewhere; `/trends` means editing a propose-only file. Adding `/trends-mobile`
   to the pole's `owns` array is the cheapest resolution and touches a foundation file rather than a
   protected one. Ratify one.

9. **Where `strengthToAnomaly` lives.** This batch and batch-6 both need it and neither may take it
   out of the protected file. Two independent reimplementations give three copies with no guarantee
   the thresholds stay equal, and the badge on Trends and the badge on Signal can then disagree about
   what "Critical" means. One shared lib, one owner, decided before either screen is written.

10. **Does mobile Trends carry the signed-out gate.** Production truncates to three signals and locks
    the filters; the design has neither, on a route public in production today. Carry it, drop it, or
    redirect signed-out traffic. Same question batch-6 asked for Live Feed; answer both at once.

11. **The Trends sparkline.** Nothing populates it and `trend_clusters` has no time series. Drop it,
    add a series to the cluster payload, or derive one from `representative_article_ids` publication
    dates, which would be a different chart than the one drawn. Also decide whether the three pinned
    hexes become tokens, because as authored the card carries light-theme strokes in dark mode.

12. **The Trends filter dimensions.** The design drops Low, drops the eleven-item Sector row and the
    eleven-item Activity row, and moves the counts onto the chips as literals. Confirm that is
    intentional rather than a 390px simplification, and confirm the counts become derived figures
    rather than typed ones per README's State rule.
