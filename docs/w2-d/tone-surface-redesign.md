# WD110 -- Tone surface redesign

**Status:** Closed (re-scoped; Element 3 shipped via PR #317, 2026-06-03 -- see status addendum)  
**Filed:** 2026-05-18  
**Priority:** P1  
**Complexity:** M (UI redesign + new components + data dependency on WD49)  
**Depends on:** WD49 (sentiment_reason field on articles, populated via 2026-05-18 backfill)  
**Coordination:** src/app/trends/page.tsx currently Lucas-protected per CLAUDE.md as of session start; expected coordination cost minimal based on Lucas's in-flight work being on learning substrate (outputs table, Step 4 evaluator) rather than trends route. Confirm with Lucas before implementation sprint.

## Status addendum (2026-06-03)

Do not build against the "Problem" section below as a description of the current
surface -- it describes the pre-redesign state and went stale within two weeks of
filing. Recorded here so the next session does not re-litigate the same recon.

**Already shipped on main before this spec was picked up** (ToneReadout +
ToneTrendChart + src/lib/tone.ts + /api/company-trend, landed after 2026-05-18):

- Problem 1 ("+0.00 / 0%" delta framing): fixed. ToneReadout renders a
  plain-language level + week-over-week direction + evidence count and never
  shows the bare -1..+1 scalar. This superseded Element 1 in a stronger form
  than spec'd (the spec's "Net bullish (+0.4)" would have re-exposed the scalar).
- Problem 2 / WD53 (hardcoded-green sparkline): resolved. The sparkline is gone;
  ToneTrendChart sign-colors the line and markers.
- Problem 3 (legend-less bar row): gone. SentimentHeat removed from the tab.
- Problem 4 (three competing readings): addressed by the readout-over-line layout.
- Element 4 window toggle: a 7D / 30D / 90D range strip exists on ToneTrendChart
  (component-local state, not URL-persisted; spec wanted 7/14/30 + URL state).

**Shipped via PR #317 (this spec, re-scoped to Element 3 only):**

- getCompanyDetail surfaces WD49 sentiment_reason (verified 100% populated,
  36,536/36,536 rows at ship time) as CompanyDetailArticle.sentimentReason.
- ToneEvidenceList: "Behind this tone" rows directly under the ToneReadout on
  the Price & Tone tab; same trailing 7-day window as the tone level,
  relevance-desc, capped at 5 with overflow count.
- ToneArticleDetail: click-through detail (side panel desktop, bottom sheet
  mobile) with sentiment_reason in a gold callout, summary, sentiment pill,
  outbound source link, Escape/backdrop close.

**Dropped in the re-scope (file a new WD if wanted later):**

- Element 2 event-dot timeline. The shipped trajectory line stays the default
  view; events-as-default is a product decision, not a bug fix.
- Element 4 events/trajectory view toggle and ?view/?window URL state.

## Problem

The current "Sentiment · 8d" surface on the Company Intel Trend tab fails as both UX and signal. Failure modes observed in production smoke 2026-05-18:

1. "LATEST +0.00 ▲ 0%" delta stat misframes sentiment as a metric. Sentiment is bounded -1 to +1, mean-reverting, and not a "score that grows." The delta-with-arrow pattern (borrowed from stock-price displays) creates wrong intuitions. "0% change" is the modal state, not noteworthy.

2. Sparkline sentiment line is hardcoded green regardless of underlying polarity. Filed as WD53. Bullish and bearish stretches render identical color.

3. Bottom bar row encodes three colors (orange / light-green / dark-green) with no legend or semantic key. Users cannot tell what each bar represents.

4. The chart answers no clear user question. It attempts to be simultaneously: a current-state metric (LATEST), a trajectory (sparkline), and a per-day mix (bar row). Three competing readings, none answered well.

5. No connection to underlying articles. Users cannot drill from sentiment surface into the events that drove it. The new sentiment_reason field from WD49 has no UI presence yet.

## User moments

The Company Intel Trend tab serves two primary user moments:

**Surveillance (professional users).** Daily check-in on names already owned or tracked. Core question: "What happened since yesterday and what should I look at first?" Decision moment: prioritize attention across a watchlist of 10-30 names.

**Exploration (students and new-to-name users).** Landing on a company page from an external referrer (TIS conversation, class assignment, news article). Core question: "What is the recent story on this company?" Decision moment: form a quick read on whether the name is worth deeper research.

These moments are not incompatible. Surveillance users do exploration when they hit a name they do not know. Exploration users become surveillance users when a name enters their watch list. The redesign must serve both without a mode-switching dropdown that users will not touch.

## Design: four elements on one surface

### Element 1: Delta stat (always visible at the top)

Plain-text summary stating net tone for the visible window in English. Replaces the misleading "+0.00 ▲ 0%" framing.

Examples:
- "Net bullish (+0.4) over 14 days"
- "Mixed tone -- 8 bullish events, 7 bearish, 4 neutral"
- "Net bearish (-0.6), driven by guidance cut and analyst downgrade"

Implementation rules:
- Computed from same daily-aggregate logic as today's sentiment7d, extended to the visible window.
- Sign-coded color: green for positive, red for negative, neutral gray for absolute value below 0.15.
- When sentiment_reason data is rich enough (top-3 bearish events have explicit reasons), append the highest-magnitude event in 5-8 words.
- Always legible on mobile. Primary read for watchlist-scanners.

### Element 2: Event timeline (default visualization)

Replaces the sparkline + bar row stack. Horizontal timeline showing high-signal articles as discrete dots.

Layout:

```
Tone · 14d
[delta stat]
[================ time axis: 14 days ================]
●     ●         ●           ●●     ●          ●
M     T   W     T   F   S   S      M T W   T F S
Each dot = one high-signal article
Color: bullish=green, bearish=red, neutral=gray
```

Filtering rules:
- Show only articles with relevance_score >= 7.
- If a day has more than 3 high-signal events, cluster into a single larger dot with badge count ("3+").
- Hover/tap a dot: tooltip shows title (truncated) + sentiment + first ~50 chars of sentiment_reason.
- Click/tap a dot: opens article detail (Element 3).

Why this over a smooth trajectory line:
- Surveillance users want to see specific events, not averages.
- Exploration users learn the company by scanning the events themselves.
- Volume is encoded by density (more dots = more activity that week).
- The dots are the data, not an abstraction over it.

### Element 3: Article detail (click-through)

Responsive surface: side panel on desktop (>=768px viewport), modal on mobile.

Shows:
- Article title and source
- Published date + relative time
- Existing summary (RSS feed text, post-strip_html)
- sentiment_reason rendered prominently (the "why" for the sentiment label)
- Sentiment label as colored pill (bullish / bearish / neutral)
- Outbound link: "Read full article on [source]"
- Close button / Escape key dismisses

Implementation rule: reuse existing article-row data model from getCompanyDetail.ts. No new query needed.

### Element 4: View + window toggles (top-right)

Two small toggles at the top-right of the surface:

**View toggle:** events ↔ trajectory.
- Events (default): Element 2 above.
- Trajectory: smooth line view, daily aggregate tone score on -1 to +1 axis, reference line at 0, background bands (light-green above 0, light-red below 0).
- State persisted in URL as `?view=events|trajectory`.

**Window toggle:** 7d / 14d / 30d.
- Default: 14d.
- State persisted in URL as `?window=7d|14d|30d`.
- Updates both Element 1 (delta stat) and Element 2 (timeline) or trajectory.

Both toggles work on mobile.

## Out of scope for WD110

These are separate concerns:
- Watchlist-level summary (cross-company "which names changed tone"). File as future WD.
- Sentiment-driven alerts. File as future WD.
- Multi-company comparison view. File as future WD.
- Historical analysis beyond 30 days. File as future WD.
- Backfilling sentiment_reason on pre-WD49 articles. Handled by WD49 backfill (in progress 2026-05-18).

## Component touch list

- `src/components/company/tabs/TrendTab.tsx` -- replace current Sentiment · 8d block with new surface.
- `src/components/company/CompanyTrendCard.tsx` -- right-rail summary card; either reuse Element 1 as rail summary or keep separate but apply WD53 fix.
- New: `src/components/company/tone/ToneTimeline.tsx` -- event-dot visualization.
- New: `src/components/company/tone/ToneDeltaStat.tsx` -- plain-text delta (Element 1). Reusable.
- New: `src/components/company/tone/ToneDetail.tsx` -- responsive article detail (side panel on desktop, modal on mobile).
- New: `src/components/company/tone/ToneTrajectory.tsx` -- trajectory line view.
- New: `src/components/company/tone/ToneToggles.tsx` -- view + window toggles.
- `src/lib/data-access/getCompanyDetail.ts` -- extend to surface relevance_score and sentiment_reason for timeline filter and detail rendering.
- `src/hooks/useCompanyTabState.ts` or new sibling hook -- add `?view` + `?window` URL state.

## Coordination touchpoints

- `src/app/trends/page.tsx` Lucas-protected per CLAUDE.md. Coordination cost expected minimal (Lucas's in-flight work is on learning substrate, not trends route) but confirm with Lucas before implementation.
- `getCompanyDetail.ts` not currently Lucas-protected but heavily used in Lucas's learning-substrate output grading. Worth a heads-up before extending its return shape.

## Data dependencies

- WD49 sentiment_reason field on articles. Spec assumes populated. Backfill in progress 2026-05-18.
- relevance_score field on articles. Already exists; used for timeline filter at >= 7.
- Daily aggregate computation currently in getCompanyDetail.ts:55, 106-120. Reusable for Element 1 and Element 4 with minor extension for arbitrary window length.

## Open questions for implementation sprint

1. Mobile interaction for dot tap. Hover does not exist on mobile, so tap goes directly to detail surface, no tooltip preview. Test on real devices.
2. Cluster behavior when day has more than 3 events. Tooltip on the cluster? Or vertical-stack of dots? UX research before committing.
3. Empty state. What does the timeline show when a company has 0 articles in the window? Probably the delta stat says "No events in last 14 days" and the timeline area is suppressed.
4. Loading state. Placeholder while data fetches. Match existing loading patterns elsewhere on Company Intel.
5. Keyboard navigation on the timeline. Current tab system has Alt+1..9 shortcuts. Should the timeline have arrow-key navigation between dots?

## Estimated implementation effort

- New components (Elements 1-4 plus toggles): 8-10 hours focused build
- Data-access extensions: 1-2 hours
- URL state (view + window): 1-2 hours
- Mobile responsiveness pass (side panel vs modal logic): 2-3 hours
- Lucas coordination: 1 hour
- QA + design review: 2 hours

Total: ~15-20 hours focused work, achievable in 2-3 day sprint.

## Validation criteria

The redesign succeeds if:
- A surveillance user lands on the Trend tab and identifies the most important recent event within 5 seconds.
- An exploration user reads the company's recent narrative by scanning ~14 dots + reading 2-3 sentiment_reason texts in 30-60 seconds.
- Both users drill from any visible event into the article that triggered it within one click/tap.
- The current "+0.00 ▲ 0%" misleading framing is gone.
- WD53 (hardcoded-green sparkline) is resolved as a side effect.

## Cross-references

- WD49 -- sentiment_reason field (precondition).
- WD53 -- hardcoded-green sparkline (resolved by this redesign).
- WD82 -- "Sentiment" → "Tone" relabel (shipped via WD93).
- WD93 -- Trend tab rename (shipped 2026-05-18).
- WD88 -- re-evaluate Lucas protection post-#197 (related; this spec assumes trends/page.tsx remains protected until WD88 is closed).
