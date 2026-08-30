# The pole set is named for places, so Ask becomes Browse and Today becomes Dashboard

Date: 2026-08-30
Ruled by: Noah

**The Ask pole is renamed Browse, and Dashboard ships alongside it.** Both are
the same decision, applied twice: a pole is named for the place it holds, not
for an action a reader might perform once they arrive. Ruling 19 amended,
2026-08-30, states the principle; this ruling is what it costs.

## Why

**Ask names an action and holds a place.** Exactly the shape that took Watch to
Radar. What sits behind the pole is a company directory, three desks and a link
to the assistant, and **the assistant is the smallest of the four**. A label
that promises the smallest thing behind it mis-sells the other three. "Browse"
is already the word the screen uses for that section, so the rename adopts the
build's own vocabulary rather than inventing a third word for the same idea.

**Dashboard was already ruled and only half landed.** Ruling 17 ruled Today to
Dashboard on **2026-08-26**. The Watch half shipped and the Today half did not,
and the mismatch that ruling cited as its evidence is still on screen four days
later. Ruling 19's own **History** paragraph is about precisely this failure
mode: a ruling that lived in a prompt, got dropped in a rewrite, and shipped
under the old name. **This is the second time.** It is recorded here rather
than re-ruled in a prompt so the third time has somewhere to be caught.

**This is a deliberate deviation from the handoff.** The prototype says Ask and
says Today. Same class as Watch to Radar in ruling 19, and as the `/ask` redraw
in ruling 23: the handoff is overridden on purpose, with the reason written
down, rather than followed into a screen that reads wrong.

### The standing count, which is the part that changes how the handoff is read

Prototype nav: **Today, Ledger, Watch, Ask.**
After this ruling: **Dashboard, Ledger, Radar, Browse.**

**Three of the four poles are renamed. Only Ledger survives, because Ledger was
already a place.**

That count is the reason this ruling matters beyond two labels. **The prototype
is no longer authoritative on navigation.** No future agent should treat a
navigation mismatch against it as a defect. A parity run that reports the pole
labels differing from `Signalera Mobile v3.dc.html` is reporting this ruling,
not a regression, and the correct response is to cite this file and move on.

### What does not move

- **The route does not move.** `/ask` stays. Ruling 19's own `/watch` paragraph
  already establishes that label and route may differ, and it exists so nobody
  "fixes" the mismatch. Radar reads Radar and lives at `/watch`; Browse reads
  Browse and lives at `/ask`. Moving either buys nothing a phone reader can
  see, and costs the pole's `owns` array, the standing ruling comments in
  `mobile-tab-bar.tsx`, and the tests that pin the href.
- **The parity harness flag stays `--screen ask`.** The prototype is a frozen
  artifact and `parity_harness.py` regexes it for `is*: s.screen === '<name>'`.
  The flag names a screen in that file, not a pole in this product. Renaming it
  would break the harness to make a document match a decision the document does
  not contain.

### Intelligence becomes one row among four, and it carries no figure

Under Browse, Intelligence is **a row in the browse list, not the pole's
purpose.** It draws **no figure**, and the reason is that no honest figure
exists: nothing logs a query, and there is no conversation table to count. It
cannot be drawn null either, because `figure: null` already means a faulted
read in this list. Drawing a genuine absence the same way as a failed read
would make two different states render identically, and the reader could not
tell which they were looking at.

**The fold cost is measured**, because the row order is the thing this changes:
Intelligence lands **3px past the fold at 390**, and **320 improves from 2-of-3
to 3-of-4** visible rows. The pole is better read at the narrow width and
marginally worse at the common one, which is the trade being accepted.

## What would change the answer

- **A pole label that stops describing its contents.** This ruling is an
  application of one rule, not a fixed list of four words. If Browse comes to
  hold something a reader would not call browsing, the rule reopens the label,
  the same way it reopened Ask.
- **A query log or a conversation table.** Either would give Intelligence a
  countable figure, and the no-figure half of this ruling expires the day one
  exists. The `figure: null` collision would still have to be resolved first:
  a real zero and a faulted read need two different renderings before either
  can be drawn.
- **Nothing reopens the routes.** `/ask` and `/watch` stay regardless of the
  labels, unless a route itself starts reading differently to a reader, which
  a URL on a phone does not.
