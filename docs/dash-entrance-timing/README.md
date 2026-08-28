# Mobile /dashboard entrance timing

Evidence for `perf/dashboard-mobile-mount`. The entrance was never missing; it
was mistimed, and the phone was paying for a desktop tree it cannot see.

## Harness

Production build (`next build` then `next start -p 3257`), Playwright Chromium,
390x844 dSF 3 `isMobile` `hasTouch` iOS UA, signed in with the E2E account.
CDP `Network.emulateNetworkConditions {latency:150, downloadThroughput:209715.2,
uploadThroughput:86400}` plus `Emulation.setCPUThrottlingRate {rate:4}`.
n=6 cold, n=6 warm, medians. Before and after measured back to back in one
session against the same harness, each on its own production build.

`time-to-content` is the first sample where FCP has fired AND `body.innerText`
is longer than 200 chars. Both conditions are needed: `>200 chars` alone fires
at 269ms, before anything paints, because shell chrome is in the DOM long
before CSS prunes it. `innerText` is layout aware, so the tree the gate keeps
at `visibility: hidden` does not count toward it. A below-md-only signal (the
mobile screen's own `h1`) is recorded beside it and lands at the same instant.

`dashRise` first-rung time counts only `animationstart` events whose computed
`animation-play-state` is `running`. Chrome fires `animationstart` for a
delay-0 animation even while it is paused, so the raw event is not proof the
ladder ran. `animationend` is: an animation that never resumed never ends, and
all 10 rungs and all 4 bars end.

| metric | before | after | delta |
| --- | --- | --- | --- |
| TTFB | 245ms | 221ms | -24ms |
| FCP | 1188ms | 1160ms | -28ms |
| TTI | 5565ms | 3253ms | -2312ms |
| time-to-content | 5570ms | 4341ms | -1229ms |
| below-md-only signal | 5570ms | 4341ms | -1229ms |
| dashRise first rung | 5584ms | 4429ms | -1155ms |
| JS transferred | 435.1 KB | 435.3 KB | +0.2 KB |
| total transferred | 701.5 KB | 639.8 KB | -61.7 KB |
| requests | 106 | 85 | -21 |
| long-task total | 387ms | 333ms | -54ms |

Warm, same runs:

| metric | before | after | delta |
| --- | --- | --- | --- |
| time-to-content | 1880ms | 1536ms | -344ms |
| dashRise first rung | 1899ms | 1617ms | -282ms |
| total transferred | 132.3 KB | 77.3 KB | -55.0 KB |
| requests | 98 | 75 | -23 |
| long-task total | 26ms | 0ms | -26ms |

## The shots

- `dashboard-mobile-gate-shut.png`. Slow 4G, the gate shut. The briefing tree
  is mounted underneath at `visibility: hidden`; the screen root's `innerText`
  is 0 chars and the whole body is 83. Nothing empty-looking is legible. The
  avatar pill is an empty circle with no letter in it and every content block is
  blank, so this frame is structurally incapable of carrying account data.
- `market-band-light.png` / `market-band-dark.png`. The settled market band,
  both themes, cropped out of the 390x844 renders. What these carry is the
  theme tokens: ink and ground invert, and the up and down tones go from deep
  green and crimson to mint and rose. The four cells are
  `DEFAULT_MARKET_CARDS` (SPY, VIX, TNX, SIGNALS) unchanged, so the band says
  nothing about the account that took the capture.

## Plates removed, 2026-08-28

Four full-page plates came out under DECISIONS.md ruling 18: while this
repository is public, no committed capture of a signed-in view may carry an
account name, a record block or personalization chips.

Removed:

- `dashboard-mobile-light.png`
- `dashboard-mobile-dark.png`
- `dashboard-mobile-mid-ladder.png`
- `dashboard-mobile-reduced-motion.png`

All four rendered, between them: a greeting naming the reader, the account
avatar initial, the personal grading tally in full under its own heading, the
desk-wide signal counts and the brief teaser headline.

**The categories are named here and the values deliberately are not.** Pulling
an image and then transcribing what it showed does not reduce the exposure. It
converts a screenshot into indexed, searchable text, which outlives the PNG and
is easier to find than the PNG ever was. What a future reader needs in order to
judge this incident is the class of data that was published and the surfaces it
was on, and the categorical form carries all of that. The values themselves add
nothing to the judgement and would re-run the disclosure. Every measurement
below is of the fix rather than of the account, so those stay.

**The blobs stay reachable in history, by decision rather than by omission.**
The repository has three people in it, the account is the owner's own, and no
claim text and no review date appears in any of the four. History is not
rewritten and nothing is force-pushed.

### What replaced them

The two settled plates are replaced by `market-band-light.png` and
`market-band-dark.png`. Those are honest sub-regions of the very same renders.
Nothing is blurred, masked, redacted or painted over: the crop is a plain
rectangle cut in the blank gutters above and below the band, at device rows
600 and 1289, against greeting ink that ends at row 523 and brief-card ink
that starts at row 1317. The gutters are blank at the same rows in both
themes, so one box serves both.

The other two have no visual replacement. Reasons follow, because a plate that
vanishes with no reason given is the same defect as a plate that overstates.

`mid-ladder` was tested for a crop and failed the test. Its stagger, measured
as vertical displacement from the settled frame by row-profile correlation, in
device px at dSF 3:

| rung | displacement |
| --- | --- |
| header and logo | 0 |
| date rule | 2 |
| greeting block | 5 |
| MARKET head | 8 |
| market band | 13 |
| brief card | 27 |

The record section's heading rule is at zero opacity in that frame while the
paragraph under it has already settled. The only two rungs inside the safe
crop region are the MARKET head and the band, 5 device px apart, which is 1.7
CSS px. That is not legible in a still, and a still cannot show displacement
at all without the settled frame next to it. Such a crop would be
indistinguishable from `market-band-light.png` while being captioned as
mid-flight evidence, which is worse than no image. The table above is the
evidence instead.

`reduced-motion` is pixel-identical to the settled light render: zero row
shift in every band, and a mean absolute luminance difference at or under 0.20
out of 255. A still of it therefore carries nothing the light crop does not,
and "unanimated" is an absence that no still can show in the first place. The
proof is the event count already stated above: 0 `animationstart`, 0
`animationend`, and the same 1513 chars of screen text as the animated runs.
