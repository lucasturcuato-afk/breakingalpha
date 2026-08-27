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

- `dashboard-mobile-gate-shut.png` — Slow 4G, the gate shut. The briefing tree
  is mounted underneath at `visibility: hidden`; the screen root's `innerText`
  is 0 chars and the whole body is 83. Nothing empty-looking is legible.
- `dashboard-mobile-mid-ladder.png` — 260ms after the gate opens. The early
  rungs have settled, the brief card and the sections below it are still
  rising. The ladder plays as the skeleton clears.
- `dashboard-mobile-light.png` / `dashboard-mobile-dark.png` — settled, both
  themes, 390x844.
- `dashboard-mobile-reduced-motion.png` — `prefers-reduced-motion: reduce`.
  0 `animationstart` events, 0 `animationend` events, and the same 1513 chars
  of screen text as the animated runs. Unanimated, never absent.
