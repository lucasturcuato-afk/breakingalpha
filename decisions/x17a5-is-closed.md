# X-17A-5 is closed as an identity source and as a numbers source, and it is not reopened by a better matcher

Date: 2026-09-03
Ruled by: Noah

**Nobody builds on X-17A-5 broker-dealer annual reports.** Not for the elite
boutiques, not for identity prose, not for balance-sheet numbers. Track F
investigated it to a stop verdict with no PR and no code, and the ceiling it found
is structural rather than a matter of effort.

## Why

### The one finding that ends the argument

**None of prod's CIK-bearing company rows is itself an X-17A-5 filer.** Prod's
CIKs and EDGAR's X-17A-5 filer CIKs are **disjoint sets. Intersection zero.**

Prod's CIKs are issuer CIKs. X-17A-5 CIKs are broker-dealer registrant CIKs. They
are different namespaces. There is no "we already have the CIK, just ingest the
filings" path for a single row. Every row this source could touch requires
claiming a new and different CIK onto an existing prod row, which is exactly the
linkage step that produces wrong pages, re-entered against a worse candidate pool.

**The disjointness reproduced under an independently built filer set**, assembled
from a different sweep of EDGAR filings and materially smaller than the one this
ruling was first written from. The two filer sets do not agree on size and both
return intersection zero. That is stronger evidence than an exact match would have
been: the result is not sensitive to how the filer set was built, which is what
"structural" means here. It is also why the sizes are not quoted. They were never
the finding.

### The ceiling, both pillars

Of the thin prod names, X-17A-5 supplies a true and machine-readable IDENTITY
pillar to a handful at most. It supplies NUMBERS to **none**. And the matcher that
reaches that handful also produces a comparable number of **wrong-company pages**.
Net negative at the widest accept shape, marginal at the narrowest.

### The population the source reaches is the population we cannot render

Filer status was never the constraint. Almost every elite boutique firm in the
sample is an X-17A-5 filer. They split three ways:

- a few already covered by a public parent
- one thin prod row, Rothschild and Co
- **the rest have no prod row at all, and none of those has any article in the
  news pool**

Verified independently against prod on 2026-09-02: Centerview, Qatalyst, Perella,
Guggenheim, Ducera and LionTree all return NO ROW. A row created carrying only
Note 1 prose is one pillar. It does not clear the bar, whatever the bar turns out
to be worth (see `decisions/pillar-bar-is-suspect.md`).

### The prose is real, and it is the only asset here

Every firm in the sample clears a 74-character identity floor, quoted verbatim
with CIK and SEC URL in the Track F report: Centerview, Allen, Seabury, Union
Square, Solomon, Raine, Leerink, FT Partners, Campbell Lutyens, Rothschild, Ducera,
Greenhill, BofA Securities, Guggenheim, Perella Weinberg. This is worth recording
precisely so that the next person who notices it does not re-derive it and reopen
the question.

### The numbers are not safely extractable, four evidenced failure modes

1. **Scale multiplier in a header line.** Centerview carries `(Dollars in 000's)`.
   Miss it and every figure is off by 1000x.
2. **Labels and numbers in separate streams.** Sixth Street BD's "Total assets" is
   followed in the text stream by a different, entirely plausible figure from
   elsewhere on the page. The extractor reads a confident, wrong number and
   nothing about it looks wrong.
3. **Spurious spaces inside numbers.** `"39, 905"`.
4. **Font mojibake.** Citadel Securities extracts a full page of healthy-looking
   characters of unreadable garbage. Length and character-class sanity checks both
   pass.

### The matcher defects fire harder in this population than anywhere else

Token-set equality does not survive here. It uniquely and confidently matches
`Klein Group` to `THE KLEIN GROUP, LLC` of Florida. It is order-blind, so
`Pinnacle Financial Partners` matches `PINNACLE PARTNERS FINANCIAL CORPORATION`.
**Roughly a fifth of the strict matches would render something false.** Under head
prefix, `BCG` resolves to `BCG Securities`, a Pennsylvania insurance brokerage.
And shell entities attach real balance sheets that are false in effect: Sixth
Street BD, LLC's own total assets rendered on a firm running two orders of
magnitude more.

Paper filings are not the blocker and should not be cited as one. They cost a
couple of firms in the sample, and population-wide the source is overwhelmingly
electronic.

## What would change the answer

**Not a better matcher.** The disjoint-CIK finding is upstream of matching. A
perfect matcher still has to claim a new CIK onto every row it touches.

**Not a better PDF extractor.** The four extraction failure modes are real but
they are the second-order problem. Fixing them changes NUMBERS from zero to zero,
because the rows that would receive the numbers do not exist.

**The one condition that reopens it:** a decision that Signalera should carry
company rows for firms with zero articles in the pool. That is a product question
about what a company page is for, not a data question. If that answer changes, the
named boutiques above become reachable and the identity prose is already verified
and waiting. Until then this stays shut.

**Do not re-derive the boutique CIK map from a matcher.** It was hand-verified
with per-firm verdicts in the Track F sprint report, along with six rules any
future override must follow. That report is a sprint artifact and is not checked
into this repo, so if it is not to hand, rebuild the map by hand adjudication
rather than trusting a matcher on this population. The section above is exactly
why.
