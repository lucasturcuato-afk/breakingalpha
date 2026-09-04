# Mobile Radar is the desk's four sections, not two of them

Date: 2026-08-31
Ruled by: Noah

Radar on a phone draws the same four sections the desk does, in the same order,
under the same four words: Following, Watchlist, Calls, Desk record. Each is its
own route under `/watch` and the four share one section row.

This is a deliberate override of the handoff, which put Calls and Desk record
under the Ledger on mobile. It is the same class of override as the pole
renames, and it is logged here for the same reason.

## Why

The handoff's placement was ruled twice and it did not survive contact with the
product. A reader who knows desktop Radar opened Radar on a phone and found two
of its four sections missing, with no sign on the screen that they existed
anywhere. The surface read as a renamed watchlist, because it was: one scroll,
mastheaded "Radar", led by the watchlist, with what the reader follows as a tier
underneath it.

The rule the handoff was protecting is untouched, and it is the reason this is an
override of a placement rather than of a principle:

> The Ledger stays the home of the record. Two entrances to one record is
> acceptable, two records is not.

There is one record. Both entrances run `fetchDeskRecord` into `buildDeskRecord`
into `deskRecordToScreenData` into `DeskRecordScreen`, and after this change they
run the same `loadDeskRecord` wrapper too, so the query, the limit, the bucketing
and the view are one code path from the table to the pixels. The Ledger keeps its
tail action and its back control; Radar's fourth section is a second door onto
the same room.

`/ledger` is a different record and is not touched. `loadLedger` reads today's
brief plus the reader's own claims and never calls `fetchDeskRecord`.

## What was decided at the fork, and what was rejected

Two structures were genuinely available and only one could be built.

**Built: four routes, one section row.** Each section pays for its own read, the
URL names which section a reader is on, the back gesture steps back a section
instead of leaving Radar, and the phone mirrors the mechanism the desk already
uses (four routes under `/radar`, one shared `RadarTabs`). The Radar pole
already owns `/watch` and `isActive` matches a path prefix, so all four sections
light the pole with no edit to the pole table.

**Rejected: one scrolling screen with more tiers.** It keeps the mobile idiom and
it is what the surface already was. It makes a four-part thing read as a list,
which is the defect being fixed, not a milder version of it. It also stacks a
172-row graded record under a watchlist, and two of the four sections are empty
on the account this was built for, so a reader would scroll past two empty blocks
to reach the two with anything in them.

**Rejected: a client-state segmented control on one route.** One URL for four
sections, so nothing is linkable and the back gesture leaves Radar. Worse, one
route would have to load all four datasets on every visit, including the record's
172 rows, to render whichever section the reader picked.

## What would change the answer

A section whose data stops existing. The four sections are four because four have
real reads behind them today. If Calls or the record lost its source, the section
should go rather than draw an empty frame, and Radar would be three.

A navigation model for the mobile shell that carries sub-sections itself. The
section row is built into each screen because the shell has no such model; if one
arrives, the row belongs to it and these four routes should adopt it rather than
keep a private copy.
