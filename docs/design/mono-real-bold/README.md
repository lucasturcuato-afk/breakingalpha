# Twelve plates were removed from this directory, deliberately

Twelve full-page 390x844 renders were committed here on 2026-08-27 and removed
in a later commit on this same branch. This repository is PUBLIC and every one
of the twelve was captured **signed in as the founder account**.

## What came out

```
after-dashboard-dark.png       before-dashboard-dark.png
after-dashboard-light.png      before-dashboard-light.png
after-ledger-dark.png          before-ledger-dark.png
after-ledger-light.png         before-ledger-light.png
after-morning-brief-dark.png   before-morning-brief-dark.png
after-morning-brief-light.png  before-morning-brief-light.png
```

## What they published

Verified by opening each of the twelve individually rather than matching
filenames.

- **The four dashboard plates** carried a greeting naming the reader, the account
  avatar initial in the header, a resolved-overnight card counting the reader's
  own calls checked overnight, and the personal grading tally.
- **The eight brief and ledger plates** carried the followed-sector chip row,
  including a tone preference on four of them, the account avatar initial on the
  dark pair, and a quote strip carrying two non-index tickers with prices, which
  is plausibly watchlist-driven.

**The categories above are named. The values deliberately are not.** Removing
the images and then reprinting their contents precisely would not reduce the
exposure, it would convert it from an image into permanent indexed text, which
is more durable than a PNG rather than less. A search engine cannot read a
screenshot; it can read this file. Naming the class tells a later reader
everything they need to judge the incident. Naming the values only re-runs it.

## What they did NOT publish

No claim text and no review date appears anywhere in the twelve. That is the
specific harm the two earlier incidents in this repository caused, and it is
absent here.

## Filenames did not describe content

`after-ledger-dark.png`, `after-ledger-light.png`, `before-ledger-dark.png` and
`before-ledger-light.png` render the **Morning Brief reader**, not a ledger of
calls. The Ledger nav tab is active and the body underneath it is the brief. The
four morning-brief plates render the same reader with the same tab active.

So eight of the twelve were one surface wearing two names. A name-based sweep
would have read that as two surfaces and mis-scoped the whole review. Only
opening the images found it, which is also how the account data was found.

## What replaced them

Two of the three named surfaces needed nothing. One did.

- **Morning Brief.** `comparison-morning-brief.png` already carried the claim,
  and carries it better than the plates did: a 2.4x crop of the ticker strip and
  the brief stat row, before and after, where an ink change of roughly 20% is
  legible. The four full-page morning-brief plates showed the same surface at
  1x, where 11px to 13px mono moving by 20% is close to unreadable. They were
  the weaker evidence, not the load-bearing evidence.
- **Ledger.** Nothing replaced these, because they were the Morning Brief
  reader. `comparison-morning-brief.png` already covers what they showed.
- **Dashboard.** The one genuinely distinct surface, so
  `comparison-dashboard-market-band.png` was added.

`comparison-17px.png` and the ten `ticker-*` captures were untouched. They are
isolated specimens of a fabricated string and carry no account data at all.

### The dashboard crop, and what it is not

The four panels in `comparison-dashboard-market-band.png` are one fixed
rectangle, `left 0, top 620, width 1170, height 616`, extracted from the four
dashboard plates before they were deleted, then composited at native size onto
a plain sheet with text labels.

**Nothing was blurred, masked, painted over or redacted.** Each panel is an
unaltered sub-region of a real render. The raw RGB of every panel as it sits in
the sheet is md5-identical to the raw RGB of that rectangle in its source plate,
checked after the sheet was written:

```
before-dashboard-light   883b9dacfde2c264c7409885f8ec5626
after-dashboard-light    18dc99aec6d58fc75000b740c7ec3c4e
before-dashboard-dark    b6353523098db7a1a9450c33dbfb7ef3
after-dashboard-dark     277889c1dbb71663ceb96a6442a06bfb
```

The band is the smallest region of that route that carries the change, and it is
also where the change reads most plainly, because the stat values are the
largest mono in the app. It contains S&P 500, VIX, 10Y YIELD and SIGNALS TODAY.
All four are desk-wide or public market values. The greeting, the avatar, the
resolved-overnight card and the personal record row all sit outside the
rectangle.

The sheet was opened and read after it was written, not merely cropped by
geometry and trusted: no name, no greeting, no avatar letter, no personal record
counts, no personalization chips, no watchlist tickers.

The VIX change reads -0.92% in the before panels and -0.99% in the after, and
the 10Y step reads 0.4 bps against 0.6 bps, because the two captures hit live
data minutes apart. The levels, both signal counts and every glyph position are
identical. That is the point of the plate: the only thing that moves is weight.

## Note on removal

Deleting these files at the branch tip does **not** remove the blobs from
history. They stay reachable by commit SHA, and this is an **accepted cost,
decided explicitly**, not an outstanding action item. This branch's history is
not being rewritten and nothing is being force-pushed.

The reasoning of record: three people have access to this repository, the
content is the owner's own account, and no claim text and no review date appears
in any of the twelve. Earlier incidents in this repository were escalated for a
history rewrite precisely because they carried open calls with future review
dates. These do not.

## The rule this directory is under

**Do not commit a screenshot of a signed-in view of this product to this
repository while it is public.** Observing the running app signed in is still
required and is still the only thing that counts as verification. What changes
is the artifact:

- **Fixture and specimen plates are fine.** `comparison-17px.png` and the ten
  `ticker-*` captures render an invented string by construction.
- **A crop is fine when it is an honest sub-region** that carries the claim and
  no account data, and when it has been opened and read rather than trusted.
- **Structural evidence is fine**: `document.fonts`, md5 of captured pixels, ink
  totals, element sweeps, computed styles. Most of this PR's argument already
  rests there.
