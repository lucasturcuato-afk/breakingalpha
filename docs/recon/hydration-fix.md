# Hydration fix recon: Date.now() in render

Branch: `fix/hydration-date-now` off `origin/main` (a408ea4e, includes
#341/#345/#347/#348). No migrations, no DDL, no writes, draft PR only, no
em-dashes. Hard gates tsc/lint/build; e2e advisory and NOT auto-run against the
prod ref.

Goal as briefed: fix the 3 `Date.now()`-in-render sites flagged by
`react-hooks/purity`, remove the 3 eslint-disable comments #347 added, and clear
the 9 hydration-downstream e2e failures.

## PHASE 1: the 3 sites, exactly

### Site 1: DealFlowSidebar.tsx:126-127

```
// eslint-disable-next-line react-hooks/purity ...
const now = Date.now();
```
Inside a `useMemo`. `now` drives two values:
- `thisWeek`: count of deals whose `updated_at`/`ingested_at` is within the last
  7 days (`now - ts < WEEK`).
- `lastWeek`: count in the 7-14 day window. `delta = thisWeek - lastWeek`.

Rendered: `{thisWeek}` as the "deals this week" number (line ~276) and `{delta}`
as the "vs last wk" badge (line ~290). Both are integers. Every other value the
memo returns (sectors, largest deals, by-type, in-sector count) is
time-independent.

### Site 2: thesis-card.tsx:126-127 (StalenessIndicator)

```
// eslint-disable-next-line react-hooks/purity ...
const age = Date.now() - new Date(generatedAt).getTime();
```
If `age >= 14 days` and there is no `outcome`, renders a small amber `Clock`
icon ("Stale" tooltip); otherwise renders `null`. Output is a single boolean:
show the stale clock or not.

### Site 3: thesis-card.tsx:191-192 (age label, inline IIFE)

```
// eslint-disable-next-line react-hooks/purity ...
const diffMs = Date.now() - new Date(thesis.generated_at).getTime();
```
Computes `ageDays`/`ageHours`, then a label: "Today" if `<24h`, "Nd ago" if
`<7d`, else "Nw ago", with a trailing warning glyph when stale. Rendered as a
`font-mono` span under the title. Output is a short relative-time string.

`new Date(arg).getTime()` is pure (depends only on its argument). The impurity at
all 3 sites is solely the `Date.now()` call, which the React Compiler purity rule
correctly flags as a non-deterministic read during render.

## PHASE 1, item 2: are these 3 the actual hydration root cause? NO, not as briefed.

This is the load-bearing finding and it contradicts the brief. Verified from the
code, not assumed.

### A hydration mismatch requires the component to render during SSR with a
value that differs from the client's first (hydration) render. All three sites
live in components that only render AFTER a client-side fetch, so they are not
present in the SSR output at all.

- `thesis-card.tsx` (sites 2, 3) renders via `kanban-board.tsx`, which renders on
  `src/app/thesis-board/page.tsx`. That page is `"use client"` with
  `const [theses, setTheses] = useState<ThesisItem[]>([])`, `loading=true`, and
  fetches `/api/theses` in `useEffect`. At SSR `theses=[]`, so ZERO ThesisCards
  render. The cards (and their `Date.now()` age/staleness logic) appear only
  after the post-hydration client fetch. No SSR presence -> no SSR mismatch.
- `DealFlowSidebar.tsx` (site 1) renders only on `src/app/deal-flow/page.tsx`,
  also `"use client"` with `deals=[]`, `loading=true`, fetch in `useEffect`. Even
  in the empty SSR state, `thisWeek`/`delta` computed over `deals=[]` are `0`
  regardless of `now`, so SSR and client first render both produce `0`. No
  divergence.

### The decisive disproof: evening-wrap and morning-brief.

Two of the 9 "hydration-downstream" failures are `evening-wrap.spec.ts:44` and
`morning-brief.spec.ts:62`. Neither page renders ThesisCard or DealFlowSidebar.
So whatever produces the hydration errors on those pages cannot be any of the 3
briefed sites. The 16 errors are therefore NOT fully accounted for by these 3
sites. The brief's causal claim is not supported.

### The deterministic clue.

`preflight-baseline.md` records the 16 "Hydration failed" errors as
byte-identical across three e2e runs, i.e. fully DETERMINISTIC. A `Date.now()`
arithmetic mismatch is boundary-crossing and therefore INTERMITTENT (it only
diverges in the sub-second window where SSR and hydration straddle a day/hour
boundary). Deterministic mismatches point at values that ALWAYS differ
server-vs-client: timezone/locale formatting (`toLocaleDateString`,
`getHours`), not `Date.now()` deltas. This is further evidence the 3 sites are
not the root cause.

### Other render-path Date/locale sources surveyed (candidates for the REAL
cause, to be pinned at runtime):

- `src/components/dashboard/greeting.tsx`: renders time-of-day greeting, market
  status, and `toLocaleDateString`. ALREADY mount-gated (returns a pulse
  placeholder until `mounted`), so it is NOT currently a live source. The
  baseline doc's suspicion of greeting is stale.
- Module-scope `timeAgo()` helpers calling `Date.now()` in render exist in
  `shell/sidebar.tsx`, `shell/notification-dropdown.tsx` (minute granularity:
  `${mins}m ago`), and the dashboard widgets (`watchlist-feed`,
  `competitor-alerts-widget`, `system-intelligence-widget`), plus page-level
  `timeAgo` in evening-wrap/morning-brief/watchlist/dashboard. These are NOT
  caught by `react-hooks/purity` (the rule does not follow calls into
  module-scope helpers), and they render their items only post-fetch, so most
  are not SSR sources either. Minute-granularity ones would mismatch
  intermittently, not deterministically.
- `src/app/layout.tsx` already sets `suppressHydrationWarning` on `<html>` and
  `<body>` (theme-driven), so the shell root is already handled.

Conclusion for item 2: fixing the 3 sites is correct and required (purity, React
Compiler readiness, removing the temporary disables, and future-proofing if these
components are ever SSR'd with data), but it is UNLIKELY to clear all 9 e2e
failures, and provably cannot clear evening-wrap:44 / morning-brief:62. The true
deterministic source needs a runtime capture (dev server + authed page + the
React hydration component stack), which this environment cannot perform: the
worktree has no real `.env` (only `.env.example`) and the affected pages are
auth-gated against prod Supabase. That capture is deferred to Noah's supervised
run.

## PHASE 1, item 3: fix pattern per site

The binding constraint is the LINT requirement, not just hydration. To remove the
`react-hooks/purity` disable, `Date.now()` must not appear in the render path AT
ALL. A mount-gate that still calls `Date.now()` inside a guarded render branch
would keep failing purity (the rule is lexical). `suppressHydrationWarning` is
also out: it would hide a mismatch but leaves `Date.now()` in render, so the
disable could not be removed. Therefore the only pattern that satisfies the lint
requirement is: move `Date.now()` into `useEffect` and store the derived value in
state. This is exactly the codebase's existing convention (`greeting.tsx`,
`theme-provider.tsx`, `export-menu.tsx`'s `useIsClient`).

- Site 1 (DealFlowSidebar): `const [now, setNow] = useState<number|null>(null)`;
  set in `useEffect`. Feed `now` into the existing `useMemo` (add to deps).
  When `now === null`, `thisWeek`/`delta` are `null`; render a `"—"` placeholder
  for the velocity number and a neutral badge. All time-INDEPENDENT sidebar
  content keeps rendering immediately. Justification: client-after-mount; the
  velocity counts are inherently "as of now" and cannot be server-stable without
  threading a server timestamp through a deep client tree (out of proportion for
  two integers). The only visible effect is a one-paint `"—"` before the count.
- Site 2 (StalenessIndicator): compute the boolean in `useEffect`, store
  `isStale` in state; render `null` until set. Justification: client-after-mount;
  output is a tiny optional icon, no layout shift.
- Site 3 (age label): extract the inline IIFE into an `AgeIndicator` component
  (hooks cannot live in an IIFE), compute label + stale flag in `useEffect`,
  render `null` until set. Justification: client-after-mount; mirrors
  StalenessIndicator; the card itself only appears post-fetch so there is no
  added flash.

Single, uniform pattern across all three: client-after-mount via
`useEffect` + `useState`. A server-passed stable timestamp was rejected (deep
prop-threading through client-fetched trees; would also go stale under ISR).
`suppressHydrationWarning` was rejected (does not satisfy the lint requirement).

## PHASE 1.5: PLAN

1. DealFlowSidebar: add `now` state + effect; gate `thisWeek`/`delta` on `now`;
   remove the 1 disable. Placeholder `"—"` while `now === null`.
2. thesis-card: rewrite StalenessIndicator to compute in effect; extract
   AgeIndicator; replace the IIFE with `<AgeIndicator/>`; remove the 2 disables.
   Add `useEffect` to the React import.
3. Gates: `rm -rf .next && npx tsc --noEmit` (expect 0), `npm run lint` (expect 0
   errors; purity must report 0 with the disables REMOVED, proving genuine
   purity, not suppression; rule still error-level globally), `npm run build`
   (expect success).
4. Hydration verification: the deterministic, environment-appropriate proof is
   that `react-hooks/purity` passes for these files with NO disable. A passing
   purity rule is a static guarantee that the render path contains no
   non-deterministic read, which is equivalent to "these components cannot emit a
   hydration mismatch." The browser-console before/after on the 6 authed pages
   requires real Supabase env + the test-user session and is deferred to Noah's
   supervised e2e run (the brief's designated final confirmation). I will NOT
   fabricate console output and will NOT run the mutating e2e suite against prod.
5. The 3 eslint-disable react-hooks/purity comments will be removed.

## SELF-CRITIQUE #1

- Does each fix remove the divergence or just hide it? Removes it. After the fix
  the render path of all 3 sites has no `Date.now()` (purity passes with no
  disable). First render is deterministic by construction; the time value appears
  post-mount. This is removal, not suppression. `suppressHydrationWarning` (the
  hide-only option) was explicitly rejected.
- Flash / layout shift acceptable? Site 1 shows `"—"` for one paint before the
  velocity number; acceptable but the most visible of the three. Sites 2 and 3
  render `null` then a tiny icon/label; the host card only appears post-fetch
  anyway, so no added flash and no reserved-space layout shift of consequence.
- Hydration sources missed in recon? Yes, and that is the central finding: the 3
  briefed sites are client-fetch-gated and are NOT the SSR mismatch root cause;
  evening-wrap/morning-brief errors provably come from elsewhere; greeting is
  already gated. The real deterministic source (likely locale/timezone
  formatting in an ungated SSR path) is not pinned here because runtime capture
  is not possible in this env. I will NOT claim the 9 failures are cleared. The
  PR will state the e2e impact as expected-but-unverified and request Noah's
  supervised run, and will NOT edit the CLAUDE.md 14-floor number.
- Trap avoided: rubber-stamping the brief's "these 3 cause the 9 failures" would
  have produced a fix that passes lint but likely does not move the e2e count,
  and a PR that overclaims. Reported faithfully instead.

## PHASE 2: implementation results

Changed files (neither protected; both confirmed absent from the propose-only
list):
- `src/components/deal-flow/DealFlowSidebar.tsx`: added `now` state set in a mount
  `useEffect`; fed `now` into the existing `useMemo` (added to deps); `thisWeek`
  and `delta` are `null` until mounted and render a `"—"` placeholder; removed the
  1 purity disable. All time-independent sidebar content is unchanged and still
  renders immediately.
- `src/components/thesis/thesis-card.tsx`: rewrote `StalenessIndicator` to compute
  the stale boolean in a `useEffect` (state `isStale`); extracted the inline age
  IIFE into a new `AgeIndicator` component that computes label + stale flag in a
  `useEffect`; replaced the IIFE in JSX with `<AgeIndicator/>`; added `useEffect`
  to the React import; removed both purity disables.

No other files touched. `eslint.config.mjs` is untouched: `react-hooks/purity`
stays at "error" globally; only `set-state-in-effect` is "warn" (from #347).

## SELF-CRITIQUE #2 + VERIFICATION

### Hard gates (all pass)

- tsc: `rm -rf .next && npx tsc --noEmit` -> 0 errors. Exit 0.
- lint: `npm run lint` -> 0 errors, 51 warnings. Exit 0.
- build: `npm run build` -> Compiled successfully, all routes generated. Exit 0.

### The decisive check: purity passes with the disables REMOVED

`react-hooks/purity` is still "error" globally (verified in eslint.config.mjs,
which this branch does not modify). After removing all 3 disable directives, lint
reports 0 errors and 0 purity violations for both files. A passing purity rule is
a STATIC guarantee that the render path of these components performs no
non-deterministic read (`Date.now()` now lives only inside `useEffect`
callbacks, never in render). That is equivalent to "these three sites cannot emit
a server/client hydration mismatch." This is genuine purity, not suppression: no
`suppressHydrationWarning`, no disable, no severity downgrade. New `Date.now()`
in render anywhere (including new ones in these two files) still fails the gate.

Confirmed mechanically:
- purity disables remaining in the two files: 0.
- `Date.now()` occurrences in the two files: 3, all inside `useEffect` bodies
  (StalenessIndicator, AgeIndicator, DealFlowSidebar `setNow`), none in render.

### Warning delta (honest accounting)

51 warnings vs the baseline 48. The +3 are `react-hooks/set-state-in-effect`
(severity "warn", set by #347) from the three new mount effects. This is the
codebase's own established client-after-mount convention (`greeting.tsx`,
`theme-provider.tsx` are already on this warn list). It is the unavoidable cost
of moving `Date.now()` out of render: the value must be lifted into an effect and
stored in state. Counted and visible, not silenced. 0 errors.

### Hydration verification: what was and was NOT done

- DONE (deterministic, environment-appropriate): the purity-with-no-disable proof
  above. The build output additionally shows `/thesis-board`, `/morning-brief`,
  `/watchlist` and peers are `○ (Static)` (prerendered at build time). That is the
  exact mechanism for a DETERMINISTIC mismatch: an ungated time/locale read in a
  statically prerendered render path bakes a build-time value into the HTML that
  always differs from the client runtime value. The three fixed sites do not
  render at build time (client-fetch-gated) and now contain no render-path
  `Date.now()`, so they are provably out of that failure class.
- NOT DONE (cannot, in this environment): the browser-console before/after on the
  6 authed pages. The worktree has no real `.env` (only `.env.example`) and the
  affected pages are auth-gated against prod Supabase. Standing up the dev server
  to render real authed data is not possible here, and the rules forbid running
  the mutating e2e suite against the prod ref unattended. No console output is
  fabricated. This step is deferred to Noah's supervised run, which the brief
  already designates as the final confirmation.
- The age/staleness values still render correctly: verified by code review. The
  label logic ("Today"/"Nd ago"/"Nw ago" + stale glyph) and the staleness
  threshold (14 days) are unchanged; only their timing moved from render to a
  post-mount effect. `new Date(arg)` parsing is identical.

### e2e impact: EXPECTED, NOT VERIFIED. Honest position.

The brief expects 9 of the 14 failures to clear and the floor to drop to 5. Recon
(Phase 1 item 2) shows that is unlikely: the 3 fixed sites are client-fetch-gated
and not the SSR/prerender mismatch source, and evening-wrap:44 / morning-brief:62
provably cannot be caused by these components (they do not render ThesisCard or
DealFlowSidebar). The realistic expectation is that this PR removes the 3 purity
disables and makes those components hydration-safe, but does NOT by itself clear
the 9 failures. The real deterministic source (probable: an ungated locale/time
read in a statically prerendered path) is a separate follow-up that needs a
runtime hydration-stack capture to pin.

Per the brief: the CLAUDE.md 14-floor number is NOT changed in this PR. Any change
to it must wait for a supervised e2e run that actually measures the new floor.

### Constraints honored

- No migrations, no DDL, no writes, no protected files edited, no merge.
- em-dashes in the recon doc and in comments/commit: 0. The only em-dashes in the
  code diff are the `"—"` empty-value UI glyph (matching the file's existing
  `formatValue` convention and the original delta badge) and the pre-existing
  "Stale ..." tooltip left untouched.
- Visual smoke test (a merge gate per CLAUDE.md) is deferred to the supervised
  run for the same env/auth reason; this is a draft PR and does not merge.
