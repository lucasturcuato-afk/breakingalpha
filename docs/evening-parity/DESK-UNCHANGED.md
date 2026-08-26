# The desk layout is unchanged, and this is how that is measured

The evidence for it used to be a pixel diff. That was wrong twice over: the
number (2,966 px, 0.229%) did not reproduce, and the cause it named (the ticker
marquee at a different scroll offset) was not the cause. An independent tester
measured 1,802 px, 0.139%, in two bands that were both live values drifting
between two capture runs twenty minutes apart: the mood bar, and the desk stats
bar's VIX cell. The marquee produced no differing pixels at all.

The tester proposed a better instrument and it is adopted here, credited to
them: **the box tree under `<main>` at 1440**, one row per element, as
`tag|depth|x|y|width|height|display`. It is structural, it does not move when a
quote moves, and it is reproducible.

    node scripts/evening-wrap-probe.mjs desk docs/evening-parity/desk-1440-boxtree-after.txt

`desk-1440-boxtree-before.txt` is `373c6b22`, the branch tip before the
corrections. `desk-1440-boxtree-after.txt` is this branch. Both were captured
in the same session, on two local production builds, signed in as the E2E
account at 1440x900 under `reducedMotion: "reduce"` with animations and
transitions pinned off.

**768 rows on both. `diff` reports zero lines, unnormalised.**

The probe also asserts what a hand-written selector gets wrong: the mobile
subtree is mounted OUTSIDE `AppShell`, so it is not inside `<main>` and cannot
pad the count. That is checked in the probe rather than assumed.
