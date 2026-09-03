# Wikipedia is the identity lever, and it ships verbatim or it does not ship

Date: 2026-09-03
Ruled by: Noah

**Wikipedia lead paragraphs are the largest available identity source and they may
be reproduced only verbatim, with attribution.** Any path that rewrites the text
through a model converts it into Adapted Material and triggers the ShareAlike
obligation on Signalera's own output. There is no middle setting. A summariser, a
truncation with an appended ellipsis, and a Gemini normalisation are the same
thing under the licence.

## Why

### The size of the lever

Against the 302 thin prod names that lack an IDENTITY pillar, a Wikipedia lead
clears a 74-character floor for **276 of 302, 91.4 percent, median 339
characters** (Wilson 95 percent CI 87.7 to 94.1). That figure is the **union of
two lookup paths** and neither reaches it alone:

| path | coverage | median |
|---|---|---|
| Wikidata sitelink only | 252 of 302 (83.4%) | 340 |
| typed-name lookup only | 256 of 302 (84.8%) | 333 |
| **union of both** | **276 of 302 (91.4%)** | **339** |

The earlier circulating figure of 277 is within measurement noise of 276 and is
not the number to quote, for a different reason: it is the **ungated** union. The
second path carries a 16.5 percent wrong-entity rate and 28 disambiguation hits.
**After a working guard the honest coverage is 238 of 302, 78.8 percent.** Quote
238. See `decisions/coverage-ratios-name-their-denominator.md`.

Nothing else comes close. Yahoo `assetProfile` overlaps this population on
**0 of 302** decisions, and on a 20-company side-by-side Wikipedia wins outright
on private equity and elite boutique names, where Yahoo returns a Capital IQ
strategy tag dump.

### The licence reading, stated once so nobody re-derives it

CC BY-SA 4.0 section 1(a) defines Adapted Material as material "derived from or
based upon the Licensed Material in which the Licensed Material is translated,
altered, arranged, transformed, or otherwise modified". Section 3(b)(1) then
obliges the licensee to license that output under BY-SA or a compatible licence,
and it fires only on Adapted Material.

So the verbatim path carries a section 3(a) attribution obligation and nothing
more. The rewritten path carries ShareAlike on Signalera's own generated prose.
That is the entire distinction and it is why the rule is binary.

Section 3(a)(1) independently requires creator credit, a licence notice, a URI to
the licence, a link to the material, and an indication of whether the material was
modified. **None of that exists in `src/` today.** A grep for `cc by-sa`,
`creativecommons` and `CC-BY-SA` across the frontend returns nothing. Even a
genuinely verbatim rollout ships non-compliant until an attribution surface exists.

### The rewrite path is live right now, and a comment says it is not

Traced hop by hop on `origin/main`:

```
PrimerTab.tsx:112   const sourceSummary = quote?.businessSummary ?? description
  -> POST /api/company-overview
  -> route.ts:92-93   ai.models.generateContent({ model: "gemini-2.5-flash" })
  -> route.ts:102     overview = sanitizeOverview(completion.text)
  -> company-overview.ts:105-113  replaces code fences and quotes, substitutes
       em-dashes for commas, slices to OVERVIEW_MAX_CHARS, appends an ellipsis
  -> PrimerTab.tsx:148  const resolvedDescription = normalized ?? fallbackDescription
```

The rewrite wins. `route.ts` then calls `recordOutput` and writes to `outputs` with
`output_type='company_overview'` **using a service-role client for a cross-user
cache**, so the derivative is persisted and served to every user, not merely
rendered.

`PrimerBusinessOverview.tsx:8` states *"both verbatim (no model generation)"*.
**That comment is false about the file directly above it**, and it is the single
most likely way a licence violation ships unnoticed: a reviewer greps for
"verbatim", finds an assertion that the requirement is met, and stops.

**Consequence, and it is the operative half of this ruling:
`companies.description` is the wrong storage target unless that path changes.**
Writing a Wikipedia lead into that column automatically routes it through the
rewrite.

### The verbatim lock that was built, and what it did and did not do

`track-d/wikipedia-identity` built a real mechanism on both sides. On the
TypeScript side, `declare const VERBATIM_BRAND: unique symbol` mints an opaque
brand only `asVerbatim()` can produce; `slice`, `substring`, `trim`, `replace` and
template interpolation all return plain `string` and lose the brand, so a
truncation between the module and the rendered element is a compile error. A
negative-control probe produced six genuine `TS2322` errors. That half is real,
and adversarial review found **four `tsc`-clean routes to the DOM that bypass it**,
so the mechanism is sound and incompletely applied.

The Python side is the cautionary half. `assert_verbatim(stored, source_extract)`
is strict and correct on every unicode case tested, and the **only production call
site passes the same value as both arguments**, so it enforces nothing. See
`decisions/two-paths-one-guard.md`, instance 3.

### Two hazards that are properties of the source, not of the code

**Vandalism and error reproduce faithfully.** `/company/cursor` would render,
verbatim, "Anysphere, Inc., doing business as Cursor, is a subsidiary of SpaceXAI."
That was false and live on Wikipedia on 2026-09-02. **No revision pin exists in
any spec written so far.** Verbatim reproduction is not a correctness guarantee.

**`prop=extracts` strips the additional-terms banner.** Some articles carry
attribution requirements beyond CC BY-SA 4.0 and the extract API silently drops
the notice. `prop=templates` is free and on the same call and detects that a notice
exists; `action=parse&prop=text` preserves what a reader actually sees.

## What would change the answer

**Nothing about the verbatim rule.** It is a reading of the licence text, not a
judgment call, and the rewrite path being persisted and served cross-user makes
the exposure worse rather than arguable.

**The storage target changes** the day `POST /api/company-overview` stops being
reachable from the description column, either by removing the fallthrough or by
carrying a non-normalizable discriminant end to end. Then `companies.description`
becomes usable and this ruling's operative half retires.

**A revision pin changes the vandalism exposure**, and should be added before any
backfill runs: store `pageid` and `revid` with the text and render from the pinned
revision.

**The coverage number moves** with the guard, not with the source. 276 is the
ceiling and 238 is the current floor. Requote it whenever the guard changes, and
name which one you are quoting.
