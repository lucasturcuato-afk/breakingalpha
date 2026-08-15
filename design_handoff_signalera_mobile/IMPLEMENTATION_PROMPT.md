# Implementation prompt

Paste this into Claude Code after uploading the handoff folder into the repo. Two prompts: one to plan, one to build. Do not skip the first.

---

## Prompt 1 — orient and plan, write no code

```
I'm implementing a mobile redesign. The design lives in
design_handoff_signalera_mobile/ in this repo.

Read these three files completely before writing anything:
1. design_handoff_signalera_mobile/README.md — the spec
2. design_handoff_signalera_mobile/github.md — screen-to-source map,
   every deviation and open conflict, with reasoning
3. design_handoff_signalera_mobile/Signalera Mobile v3.dc.html — the design
   itself. Open it in a browser. It has a dev strip below the phone frame
   that jumps to all 31 screens and every loading / error / empty / stale
   state. Click through all of them before you plan.

Then read our own code: src/styles/tokens.css, src/app/globals.css,
src/components/shell/mobile-bottom-nav.tsx, and the page.tsx for every
route named in the README's Screens table.

Now write me a plan, no code yet. It must cover:

- A token diff: every custom property in tokens.reference.css that has no
  counterpart in our tokens.css, and every one where our value differs.
  Do not resolve differences by substituting a near value — the README
  explains why. List them for me to decide.
- Which of our existing components can be reused as-is, which need
  variants, and which are net new.
- A build order. Start with the navigation shell and the Ledger, because
  every other screen is reached through them.
- Every place the design contradicts our current production code. The
  README's "Open decisions" table has nine of these. Flag any others you
  find. Do not resolve them yourself and do not pick a side in code.

Ask me about anything ambiguous rather than choosing. I care more about
matching the design exactly than about finishing fast.
```

---

## Prompt 2 — build, one screen at a time

Only after the plan is agreed. Send this once per screen, in the plan's order.

```
Implement <SCREEN NAME> from the design.

Source of truth, in this order:
1. The rendered design — open Signalera Mobile v3.dc.html, use the dev
   strip to reach this screen, and read the actual DOM. Measured values
   beat my description and beat the README where they disagree.
2. The README's row for this screen, plus its Design tokens, Typography,
   Geometry, Motion and Interactions sections.
3. Our existing patterns in the codebase.

Rules for this screen:

- Use our tokens via var(). Never hardcode a hex that has a token.
- ink tokens are for text, base tokens are for fills. Never swap them.
- On any pinned-espresso surface use #f87171 / #4ade80 / #fbbf24, not the
  ink tokens.
- Radii from 4 / 6 / 9 / 12 / 14 only.
- No rendered type below 10px.
- Every interactive element ≥ 44px tall. Where the visual is smaller,
  use the content-box padding plus negative margin pattern the README
  describes. Do not shrink the target and do not move the element.
- Real <button> and <a> elements. A container that already holds a
  focusable control must not itself be focusable.
- Build every state this screen has: loading, error, empty, stale. The
  dev strip shows them. A screen without its states is not done.
- Motion: cubic-bezier(0.16, 1, 0.3, 1), the README's durations, and
  honour prefers-reduced-motion.

Compliance, non-negotiable:
- Never buy / sell / hold / allocation / returns / performance in any
  user-facing string. Check as substrings, not words — every violation
  found during design was inside a longer word.
- No aggregate accuracy percentage or hit rate anywhere, including
  placeholder data. Counts yes, rates no.
- Outcome states are exactly: supported, challenged, developing,
  awaiting. Never right / wrong / correct / win / loss.
- No em-dashes.
- No coloured left borders. State is a 2px top edge plus a dot and the
  state word.

When you're done, tell me:
- Any value you could not source from a token, and what you used
- Any string you changed from the design, and why
- Anything in the design you think is wrong

Do not move to the next screen until I've looked at this one.
```

---

## Order to build in

The dependency order, not the README's reading order:

1. Navigation shell — four poles, both chrome states, safe-area insets
2. Ledger — the home surface, and the anatomy every other card reuses
3. Commit sheet — Track this call, including the failure state
4. Review — the resolution moment
5. Dashboard — splash, stagger, market band
6. Claim, Entry, Prepared record
7. Evening Wrap, Compose, Desk record
8. Watch, Thesis Tracker, Thesis detail
9. Ask, Search, Company Intel, Memo
10. Deal Flow, Deal detail, Trends, Signal, Live Feed, Story
11. Landing, Onboarding, Sign in
12. Settings, Alerts, Saved, Learned, Share

Steps 1–4 are the product. If those are wrong, nothing after them helps.

## Before step 1

Rule on the nine open decisions in the README. Seven are compliance and two
are design-system conflicts. Every one is a place where the design and
production disagree, and an engineer cannot write the screen without knowing
which wins. Deciding them after the build means rewriting shipped copy.

## What to check after each screen

Fast, and it catches most of what went wrong during design:

- Any element with `cursor: pointer` and no handler is a defect
- Any handler under 44px tall is a defect
- Grep the diff for the six banned words as substrings, including
  identifiers and comments
- Toggle the theme and re-read the screen. Token-role errors only surface
  in one theme.
- Set `prefers-reduced-motion` and confirm nothing is hidden rather than
  merely unanimated

## One thing not to do

Do not ask Claude Code to build several screens in one pass. The design has
31 screens sharing one card anatomy and one motion vocabulary; a batch pass
tends to produce near-misses that diverge from each other, and those are far
more expensive to reconcile than to prevent. One screen, reviewed, then the
next.
