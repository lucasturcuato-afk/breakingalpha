# Design and built, side by side at 390px

Six images, three screens by two themes. Left column is the design, right
column is the running build. Both are captured at a 390px viewport at
2x, full page, then placed in one frame so the two can be read against
each other. Nothing here is hand measured.

| Screen | Light | Dark |
|---|---|---|
| Landing | `landing-light.png` | `landing-dark.png` |
| Onboarding, step 1 | `onboarding-light.png` | `onboarding-dark.png` |
| Sign in | `signin-light.png` | `signin-dark.png` |

## How the design side is produced

The prototype does not render over `file://`. Its markup is a template of
`<sc-if>` branches and `{{ }}` placeholders resolved by a runtime that
loads React from the network and a design-system bundle from a path that
is not in this repo, so opening it directly leaves `#v3phone` empty and
every screen fingerprints as zero elements.

`scripts/parity_harness.py` resolves those branches ahead of time and
writes a plain page carrying the prototype's own `<style>` blocks, which
is what `getComputedStyle` then reports on. **That script is not on
`main`.** It lives on `feat/mobile-ledger` and was run from there:

```
git show feat/mobile-ledger:scripts/parity_harness.py > /tmp/parity_harness.py
python3 /tmp/parity_harness.py --screen landing --theme dark \
    --out .parity-proto-landing-dark.html
```

Three corrections are applied to the generated harness before it is
measured. Each is about making the two sides comparable, and none of
them changes a design value.

1. **Font shorthand quotes.** The prototype's logic class builds inline
   style strings that embed double-quoted font names, so the emitted
   `style="..."` attribute ends at the first inner quote and the whole
   font declaration is dropped. Every affected element then measures 16px
   black, which reads as a build defect and is not one. The inner quotes
   are swapped to single ones.
2. **Box sizing.** The harness carries the prototype's `<style>` blocks
   and nothing else, so it has no reset. Production runs Tailwind
   preflight, which sets `box-sizing: border-box` globally. Without it a
   bordered box measures its border outside its declared size and the two
   sides differ by the border width on every card.
3. **The gutter.** The harness puts `--v3-pad` on `#v3phone` while the
   screen markup carries its own gutter, so the content column measures
   310px where the phone measures 350. Every wrapped paragraph then
   breaks one line early on the design side.

## What the images do not show

- **The typed headline is blank on the design side.** The harness cannot
  evaluate `typeRef`, which is a React ref rather than an expression, so
  the h1's target string never lands. The cursor block renders. The
  string itself is asserted in the build and in `TYPED`.
- **The loop card is at a different beat on each side.** It is a live
  5-node animation on a 6300ms cycle; the two pages were not started on
  the same frame.
- **The sign-in adopt well appears only on the design side.** The
  prototype hardcodes `adoptFlow: true`. The build derives it from
  `postAuthDestination(window.location.search)`, so it appears when an
  `?adopt=` or `?next=` actually arrived and not otherwise.
- **The onboarding step segments are blank on the design side.** The
  seven `obD*` styles come out of a `.reduce()` spread the harness's
  expression evaluator does not cover.

## Reproducing the built side

```
npm run build && npx next start -p 3111     # landing and sign in
PORT=3111 npm run dev                       # plus /preview/onboarding-mobile
```

`/preview/onboarding-mobile` is gated to `NODE_ENV=development` by
`src/proxy.ts` and does not exist in production. It exists because
`/onboarding` redirects to `/auth` without a session and to `/dashboard`
once `onboarding_completed` is true, so the wizard cannot otherwise be
measured without signing in as a live user and writing to that user's
profile.
