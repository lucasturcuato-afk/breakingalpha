# Axe-core baseline post-Patch N2

Date: 2026-05-07
Tool: axe-core 4.10.0 via CDN inject in Playwright
Target: integration preview `noah/w2-c-phase-1`
Preview URL: https://breakingalpha-git-noah-w2-c-phase-1-lucasturcuato-afks-projects.vercel.app
Auth: temporary test user (deleted post-run)
Reference for: smoke-test recipe T1 / T11 (PR-A0 token swap re-baseline trigger)

## Total

| Metric | Value |
|---|---|
| Total violation rules (unique rule IDs) | 5 |
| Total violation rule x route occurrences | 18 |
| Total violation node count (sum across routes) | 96 |
| Routes scanned | 5 |

### Divergence from "27" target

The Patch N2 baseline target was 27. This baseline run found 96 total violation
nodes / 18 rule-by-route occurrences / 5 unique rule IDs. None of these
match 27 exactly except for one specific aggregate: the `region` rule
total node count across all 5 routes equals exactly 27 (5+5+5+6+6).

Two reasonable interpretations of the divergence:

1. The "27" target was likely measuring the `region` (landmark coverage)
   rule alone, which is the moderate-severity baseline that Patch N2
   acknowledged as out-of-scope for the contrast sweep. Color-contrast
   alone now totals 60 nodes -- significantly higher than 27, so 27 was
   never the color-contrast target.
2. The "27" may have been a rule-instance count from an earlier scan
   with different route coverage / different page state. We do not have
   the prior raw output to confirm.

Recommendation for smoke-test recipe T1:
- If T1 asserts `<= 27 violations`, update to `<= 96 nodes` or
  `<= 18 rule-route occurrences` (whichever metric is intended).
- T11 (re-baseline after PR-A0 token swap / Direction D palette adoption)
  remains valid -- color-contrast nodes (60) are the primary driver and
  will most likely shift dramatically once the token swap lands.

## Per-route breakdown

| Route | Rule count | Node count | Top rule | Severity |
|---|---|---|---|---|
| /company | 4 | 21 | color-contrast (13) | serious |
| /company/nvidia | 4 | 17 | color-contrast (10) | serious |
| /company/stripe | 4 | 20 | color-contrast (13) | serious |
| /morning-brief | 3 | 18 | color-contrast (11) | serious |
| /evening-wrap | 3 | 20 | color-contrast (13) | serious |

## Per-rule aggregate

| Rule ID | Total nodes across routes | Severity | Routes affected | Help URL |
|---|---|---|---|---|
| color-contrast | 60 | serious | 5 / 5 (all) | https://dequeuniversity.com/rules/axe/4.10/color-contrast |
| region | 27 | moderate | 5 / 5 (all) | https://dequeuniversity.com/rules/axe/4.10/region |
| scrollable-region-focusable | 5 | serious | 5 / 5 (all) | https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable |
| heading-order | 2 | moderate | 2 / 5 (nvidia, stripe) | https://dequeuniversity.com/rules/axe/4.10/heading-order |
| empty-table-header | 2 | minor | 1 / 5 (/company) | https://dequeuniversity.com/rules/axe/4.10/empty-table-header |

## Severity breakdown (node-count weighted)

| Severity | Count |
|---|---|
| critical | 0 |
| serious | 65 |
| moderate | 29 |
| minor | 2 |

## Sampled selectors for the 3 highest-frequency rules

### color-contrast (60 nodes)

- `.text-signal-up` (multiple pages -- signal up/down badge tokens)
- `span[aria-label="Beta release"]` (header beta tag)
- `.text-left.text-[12px].flex-1` (small body text)
- `.uppercase.text-[9px].lg:inline` (ticker/uppercase micro-labels)
- `.px-2\.5` (small padding pill)
- `.select-none` (multiple non-selectable text nodes)
- `.text-text-faint.text-[12px]` (faint text color tokens)
- `.sm\:inline-flex` (responsive inline-flex chips)
- `.gap-1.items-center.flex > .text-signal-up.text-[9px].uppercase` (small signal badges)
- `.border-gold\/30 > .items-start.gap-2.flex > h4` (gold-on-light heading)

These are dominated by the legacy palette (`text-signal-up`, `text-text-faint`,
gold-on-light combos, faint micro-labels). PR-A0 token swap to Direction D
should resolve most of these.

### region (27 nodes)

- `.z-\[9001\]` (mood bar overlay) -- not in a `<main>` / `<aside>` / etc landmark
- `.h-\[var\(--moodbar-height\)\]` (mood bar inner)
- `.items-baseline` (top header strip)
- `.items-baseline.whitespace-nowrap.gap-2` (detail page header items)
- 4-6 nodes consistently per page -- top chrome / mood bar / orphan content blocks

Indicates several layout regions are not wrapped in landmark elements
(`<header>`, `<main>`, `<nav>`, `<aside>`). Likely a global layout fix.

### scrollable-region-focusable (5 nodes -- 1 per page)

- `.z-\[9001\] > .overflow-y-auto.flex-1` (mood bar scroll region)
- `.overflow-y-auto.py-2.flex-1` (sidebar / panel scroll region, multiple pages)

A single scrollable container is non-keyboard-focusable. One global fix
(add `tabindex="0"` to the wrapper, or refactor the scroll container) will
clear all 5 occurrences.

## Notes

- This is the baseline against which smoke-test T1 asserts ceiling-violation count.
  Update T1 to use 96 nodes / 18 rule-route occurrences (whichever metric is intended)
  rather than the legacy "27" claim.
- T11 fires re-baseline if PR-A0 token swap (Direction D palette adoption) lands.
  Expected impact: color-contrast (60 nodes, ~62 percent of total) should drop
  significantly. Region / scrollable-region-focusable / heading-order /
  empty-table-header are unaffected by token swap and will remain.
- No `critical` violations were found.
- All 5 routes share 3 baseline rules (color-contrast, region,
  scrollable-region-focusable) -- those are global / shared-component issues.
- `empty-table-header` is unique to `/company` (the directory table).
- `heading-order` only triggers on the populated detail pages (nvidia, stripe).
