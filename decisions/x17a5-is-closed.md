# X-17A-5 is closed as an identity source and as a numbers source, and it is not reopened by a better matcher

Date: 2026-09-03
Ruled by: Noah

**Nobody builds on X-17A-5 broker-dealer annual reports.** Not for the elite
boutiques, not for identity prose, not for balance-sheet numbers. Track F
investigated it to a stop verdict with no PR and no code, and the ceiling it found
is structural rather than a matter of effort.

## Why

### The one number that ends the argument

**0 of prod's 774 CIK-bearing company rows is itself an X-17A-5 filer.** Prod's
774 CIKs and EDGAR's 9,698 X-17A-5 filer CIKs are **disjoint sets. Intersection
zero.**

Prod's CIKs are issuer CIKs. X-17A-5 CIKs are broker-dealer registrant CIKs. They
are different namespaces. There is no "we already have the CIK, just ingest the
filings" path for a single row. Every row this source could touch requires
claiming a new and different CIK onto an existing prod row, which is exactly the
linkage step that produces wrong pages, re-entered against a worse candidate pool.

### The ceiling, both pillars

Of the 306 thin prod names, X-17A-5 supplies a true and machine-readable IDENTITY
pillar to **3, at most 7**. It supplies NUMBERS to **0**. And the matcher that
reaches those 7 also produces **7 wrong-company pages**. Net negative at the
widest accept shape, marginal at the narrowest.

### The population the source reaches is the population we cannot render

Filer status was never the constraint. 21 of 25 elite boutique firms are X-17A-5
filers. They split:

- 5 already covered by a public parent
- 1 thin prod row, Rothschild and Co
- **14 have no prod row at all, and all 14 have zero articles in the news pool**

Verified independently against prod on 2026-09-02: Centerview, Qatalyst, Perella,
Guggenheim, Ducera and LionTree all return NO ROW. A row created carrying only
Note 1 prose is one pillar. It does not clear the bar, whatever the bar turns out
to be worth (see `decisions/pillar-bar-is-suspect.md`).

### The prose is real, and it is the only asset here

15 of 15 firms clear a 74-character identity floor, quoted verbatim with CIK and
SEC URL in the report: Centerview 94 characters, Allen 106, Seabury 153, Union
Square 155, Solomon 181, Raine 208, Leerink 214, FT Partners 240, Campbell Lutyens
248, Rothschild 270, Ducera 287, Greenhill 312, BofA Securities 353, Guggenheim
415, Perella Weinberg 468. This is worth recording precisely so that the next
person who notices it does not re-derive it and reopen the question.

### The numbers are not safely extractable, four evidenced failure modes

1. **Scale multiplier in a header line.** Centerview carries `(Dollars in 000's)`.
   Miss it and every figure is off by 1000x.
2. **Labels and numbers in separate streams.** Sixth Street BD's "Total assets" is
   followed in the text stream by `10,587,204` when the truth is `10,629,732`. The
   extractor reads a confident, wrong number.
3. **Spurious spaces inside numbers.** `"39, 905"`.
4. **Font mojibake.** Citadel Securities extracts 64,153 healthy-looking characters
   of unreadable garbage. Length and character-class sanity checks both pass.

### The matcher defects fire harder in this population than anywhere else

Token-set equality does not survive here. It uniquely and confidently matches
`Klein Group` to `THE KLEIN GROUP, LLC` of Florida. It is order-blind, so
`Pinnacle Financial Partners` matches `PINNACLE PARTNERS FINANCIAL CORPORATION`.
**12 of 61 strict matches, 20 percent, would render something false.** Under head
prefix, `BCG` resolves to `BCG Securities`, a Pennsylvania insurance brokerage.
And shell entities attach real balance sheets that are false in effect: Sixth
Street BD, LLC total assets of $10,629,732 rendered on a firm running roughly
$100bn.

Paper filings are not the blocker and should not be cited as one. They cost 2 of
15 firms. Population-wide, 2026 runs 3,020 electronic to 1 paper.

## What would change the answer

**Not a better matcher.** The disjoint-CIK finding is upstream of matching. A
perfect matcher still has to claim a new CIK onto every row it touches.

**Not a better PDF extractor.** The four extraction failure modes are real but
they are the second-order problem. Fixing them changes NUMBERS from 0 to 0,
because the rows that would receive the numbers do not exist.

**The one condition that reopens it:** a decision that Signalera should carry
company rows for firms with zero articles in the pool. That is a product question
about what a company page is for, not a data question. If that answer changes,
14 named boutiques become reachable and the identity prose above is already
verified and waiting. Until then this stays shut.

**Do not re-derive the 25-firm CIK map.** It is hand-verified with per-firm
verdicts in `/Users/noahhanning/bs-out/track-f.md`, along with six rules any future
override must follow.
