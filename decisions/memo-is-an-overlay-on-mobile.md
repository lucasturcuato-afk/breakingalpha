# The memo opens as an overlay on mobile, not as a route

Date: 2026-09-02
Ruled by: Noah

The mobile Company Intel memo control opens `MemoModal` in place, the same
overlay the desktop tree opens. It does not navigate. The same action must not
move a reader to a different screen on a phone than it does on a laptop.

## Why

### The gate on this ruling is answered

The question that blocked it was whether a memo needs a URL. It does not, and
that is measurable rather than arguable:

| what a route would give a memo | does it exist today |
|---|---|
| a way to ask for one memo by id | no. `/api/memo` is POST only |
| a route that renders a stored memo | no. there is no output-by-id page |
| a share affordance on the memo surface | no |
| a link in any email | no |
| a `searchParam` any surface reads | no |
| copy that copies a link | no. copy copies the memo text |
| one memo ever marked as shared | no |

Memos are persisted with stable ids, so an id exists. Nothing consumes it. An
overlay therefore loses a reader nothing a route would have given them.

### The reasoning first written down was wrong, and the corrected version lands the same way round only harder

Two facts change the shape of the argument.

**The desktop mount count is 21, not 23.** Two of the 23 were not mount sites:
one was a JSDoc comment naming the component, and one was a prefix match on the
lazy wrapper's own child. Re-counted while writing this: 21 JSX mounts of
`MemoModal` across 17 host files, excluding `src/components/memo/` itself.

**`MemoModal` already opens as an overlay on a phone at 12 of those 21 today.**
That is the fact that settles it. Continuity is not something this ruling
establishes; it is the status quo on every mobile surface that already reaches a
memo, and Company Intel is the single screen out of step with it.

So the trade is not "teach 21 sites a destination". It is "undo 12 that already
work". A route would introduce the inconsistency the ruling exists to prevent.

### What this ruling does NOT decide

A memo has no URL today. Gaining one is a separate change and an independent
one: it needs a public read route keyed on the memo id and an anonymous read
policy on the row, neither of which exists. That work is orthogonal to
overlay-versus-route. An overlay surface can be handed a URL later without being
rebuilt, and a route would not have produced a shareable link on its own either,
because the missing piece in both cases is the read path and the policy.

Also not decided here, and deliberately out of the change that records this:

- **A purpose-built mobile sheet.** The overlay this ruling picks is the
  existing `MemoModal`, unmodified. A phone-native sheet is its own unit.
- **Back-gesture dismissal.** Follows from a sheet, not from this.
- **The inline citation to source interaction.** Genuinely unbuilt: `/api/memo`
  gives back one markdown string with no structured source list, so there is
  nothing for a citation to open. The blocker note that says so is accurate and
  stays accurate.
- **The overlay's accessibility contract.** `MemoModal` has no `role="dialog"`,
  no `aria-modal`, no inert siblings, no focus entry, and the page behind it
  scrolls. That is a real defect and it is proposed as a diff rather than made,
  because the file is propose-only.

## What would change the answer

Any one of the rows in the table above turning into a yes. Concretely: the first
route that renders a stored memo by id, or the first surface that offers a memo
link rather than memo text. At that point a memo has a destination, and a
destination is the one thing an overlay cannot be.
