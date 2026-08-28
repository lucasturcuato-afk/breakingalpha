# Ten plates were removed from this directory, deliberately

Every PNG committed here has been deleted at the branch tip:

```
before-t1200-390-dark.png     before-t1200-390-light.png
after-t1200-390-dark.png      after-t1200-390-light.png
after-settled-390-dark.png    after-settled-390-light.png
fault-list-read-failed-1440.png
fault-one-read-failed-1440.png
fault-all-reads-failed-1440.png
genuine-zero-1440.png
```

They were captures of `/radar/watchlist` **signed in against production**, and
this repository is public.

## What they carried, by category

The categories are named. The values deliberately are not. The last section of
this file says why, and that reasoning is the point rather than a footnote.

- **All ten** drew the account's own identity chrome. At 1440 that is the
  sidebar footer card, which pairs a live plus-addressed mailbox with a role
  label. At both widths it is the header avatar glyph, which is the account
  initial.
- **The mailbox is the most serious item in the set.** It is a plus-addressed
  variant of a real address, so it routes and it is deliverable. It was
  published on a public repository.
- **Six of the ten** additionally drew the account's own tracked set: the
  membership of the personal watchlist across its ticker rows, its sector
  subscription, the tracked-item tally, and the ticker denominator beside it.

## A correction to the record

The builder's position was that the rendered payload was intercepted and
synthetic. Half of that is accurate and half is not.

The article rows ARE fixture. The chip rail is not. The tracked set in the
committed plates does not match the synthetic generator left behind in the
working harness: the plates contain entries that generator never emits, omit
entries it always emits, and order them differently. The rail was drawn from
the account's own list.

The discrepancy is recorded because the interception defence was offered in
good faith from a script that had been superseded.

## Two plates the first audit did not name

The audit manifest was built from a diff taken at one moment. A later commit on
this branch, `aee238c3`, added two more 1440 plates, and the manifest did not
move with the branch. Both were opened. Both are the same class as the eight
already named, so all ten come out rather than eight.

## Why history was not rewritten

Ruled by the owner: delete in a new commit, no history rewrite, no force push.
The blobs stay reachable by commit SHA. That is an accepted cost recorded as a
decision, not an oversight. The reasoning given was that the content is the
owner's own account on a three-person repository, and that no claim text and no
review dates appear in any of the ten.

That is a narrower exposure than the plates removed from `wire/evening-wrap-data`
and `wire/ledger-data`, which carried open calls with future review dates and
were stripped from history. See `docs/ledger-parity/PLATES-REMOVED.md`.

## What replaced them

Eight replacements were captured fresh against a **synthetic tracked set**:
stand-in identifiers that are not instruments, and a sector the account does
not subscribe to. `GET /api/watchlist` was intercepted on every run, so nothing
in these renders comes from the account. Every non-GET aborted at the router, so
nothing reached the database.

| replacement | what it carries |
| --- | --- |
| `synthetic-after-t1200-390-dark.png` / `-light.png` | a chip whose read is still in flight draws a fixed-width pill and NO numeral |
| `synthetic-after-settled-390-dark.png` / `-light.png` | the same rail once the reads land, drawing its numerals |
| `synthetic-fault-one-read-failed-1440.png` | one entry faulted across every read path draws no numeral while its neighbours draw theirs, and the rail carries one marker for the whole row |
| `synthetic-fault-all-reads-failed-1440.png` | every article read faulted: no numerals anywhere, plus the rail, gallery and feed markers |
| `synthetic-genuine-zero-1440.png` | reads that succeed and find nothing still draw a zero, which is the state a fault must not imitate |
| `synthetic-fault-list-read-failed-1440.png` | a faulted LIST read says the list could not be read, not "Nothing tracked yet" |

They carry the `synthetic-` prefix so no reader mistakes a replacement for the
plate it replaces, and so the deletion is unambiguous in the diff.

Each is clipped to the content pane, below the top chrome and to the right of
the sidebar, because that chrome is where the identity is drawn. A clip is an
honest sub-region of a real render. **Nothing was blurred, masked, redacted or
painted over**, in these or in anything else this directory has contained.

## The two that could not be replaced

`before-t1200-390-dark.png` and `before-t1200-390-light.png` showed the
behaviour before the fix. Reproducing them needs the pre-fix source in the
working tree, which this unit was not permitted to write. Rather than ship a
reconstructed substitute and present it as a render, the plates are dropped and
the result is stated instead:

> Before the fix, at 1200ms into the load with every article read still in
> flight, every chip on the rail drew the numeral `0`. The cause is one
> expression, `count: (articlesByIdentifier[e.identifier] ?? []).length`, which
> cannot tell a read that has not landed from a read that landed empty. The
> `synthetic-after-t1200-*` plates show that same moment drawing no numeral at
> all.

The visual evidence for the before state was removed and not replaced. That is
a real reduction in what this directory proves, and it is stated plainly rather
than papered over.

## Why categories and not values

Naming what an image contained is not free.

A PNG is not indexed and not searchable. A README is. Transcribing an address, a
ticker set or a tally into this file would convert an image into permanent,
crawlable text and make the exposure MORE durable than the plate it replaced,
not less. Four files across three cleanup units made exactly that mistake in one
hour before it was caught.

So this file names the category and never the value, and the same rule was
applied to the commit message that removes the plates. **A later editor should
not complete this file by restoring them.**
