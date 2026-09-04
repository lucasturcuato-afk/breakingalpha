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

Against the thin prod names that lack an IDENTITY pillar, a Wikipedia lead clears
a 74-character identity floor for the large majority. That coverage is the **union
of two lookup paths** and neither reaches it alone:

| path | reaches |
|---|---|
| Wikidata sitelink only | most of the population, and not all of it |
| typed-name lookup only | most of the population, and a different subset |
| **union of both** | **strictly more than either, and it is the ceiling** |

The union is also **ungated**. The second path carries a real wrong-entity rate and
a tail of disambiguation hits, so the guarded coverage is materially lower than the
ungated coverage, and the guarded figure is the only honest one to quote. Quote the
guarded number, name the guard it was measured behind, and never quote the ceiling
as though it were the floor. See
`decisions/coverage-ratios-name-their-denominator.md`.

Nothing else comes close. Yahoo `assetProfile` overlaps this population on **none**
of these decisions, and on a hand-read side-by-side sample Wikipedia wins outright
on private equity and elite boutique names, where Yahoo returns a Capital IQ
strategy tag dump.

### The licence reading, stated once so nobody re-derives it

CC BY-SA 4.0 section 1(a) defines Adapted Material as

> material subject to Copyright and Similar Rights that is derived from or based
> upon the Licensed Material and in which the Licensed Material is translated,
> altered, arranged, transformed, or otherwise modified in a manner requiring
> permission under the Copyright and Similar Rights held by the Licensor.

Quote that clause in full or not at all. An earlier draft of this ruling cut it
after "otherwise modified", which silently drops the qualifier
"in a manner requiring permission under the Copyright and Similar Rights held by
the Licensor" that any argument about this will turn on. Truncating a licence
definition to the half that supports your reading is the same failure this
directory keeps recording, one step up the stack.

Section 3(b)(1) then obliges the licensee to license that output under BY-SA or a
compatible licence, and section 3(b) fires only on Adapted Material.

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

The rewrite wins, and it reaches the reader. **It is served. It is not stored.**

That distinction matters and an earlier draft of this ruling got it wrong. The
draft said the derivative was "persisted and served to every user". Corrected,
with the mechanism, because the mechanism is the interesting part:

- `route.ts:116-120` calls `recordOutput` against the `outputs` table with
  `output_type: "company_overview"`, on a service-role client, intending a
  cross-user cache.
- **`company_overview` is not a member of `output_type_enum` in prod.** Confirmed
  read-only by PostgREST OpenAPI introspection: the enum lists `memo`, `brief`,
  `brief_cluster`, `chat_answer`, `thesis`, `thesis_grade`, `contrarian_signal`,
  `deal_extraction`, `user_addendum`, `mention_alert`, `cross_reference`,
  `brief_section`, `sec_filing`, `insider_transaction`, `radar_clusters` and
  `radar_cluster_label`, and nothing else. The insert is rejected with SQLSTATE
  `22P02`.
- **The TypeScript union claims otherwise, so it typechecks.**
  `src/lib/outputs.ts:20` has carried `| 'company_overview'` since the Primer
  shipped. The union was a claim about the schema that the schema never backed.
- **Nothing surfaces the rejection.** `src/lib/outputs.ts:35` documents that
  `recordOutput` failures "are logged but never thrown", and the cache read at
  `route.ts:72` destructures only `data`, discarding `error`. `supabase-js`
  returns PostgREST errors in the result object rather than throwing, so the
  surrounding `try/catch` is dead code for this failure mode.
- The same missing enum member also rejects the READ filter at `route.ts:75`, so
  the cache could never have hit even if the write had landed.

**PR #818 is the open PR that adds the enum member**, and it found a second defect
on the same insert: `outputs.source_id` is a `uuid` column and `route.ts:120`
passes a company name into it, so the migration alone does not fix the write.

**This is the reason the log exists.** The claim "persisted and served" was wrong,
and it was wrong in a way somebody could check, because it named a table, a column
and a value. Checking it found a live production defect that had been silently
re-billing a model call on every company page view. A vaguer sentence would have
been unfalsifiable and the bug would still be there.

**What survives the correction is the operative half.** ShareAlike attaches to
distribution, not to storage, and the rewrite is distributed to every reader who
loads the page. The exposure is unchanged. So is the consequence:
**`companies.description` is the wrong storage target unless that path changes**,
because writing a Wikipedia lead into that column routes it through the rewrite.

`PrimerBusinessOverview.tsx:8` states *"both verbatim (no model generation)"*.
**That comment is false about the file directly above it**, and it is the single
most likely way a licence violation ships unnoticed: a reviewer greps for
"verbatim", finds an assertion that the requirement is met, and stops.

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
judgment call, and the rewrite being served cross-user is enough on its own; it
does not need to be persisted to be distributed.

**The storage target changes** the day `POST /api/company-overview` stops being
reachable from the description column, either by removing the fallthrough or by
carrying a non-normalizable discriminant end to end. Then `companies.description`
becomes usable and this ruling's operative half retires.

**The cache landing does not change the licence answer**, and it is worth saying so
plainly before #818 merges. Persisting the rewrite makes the exposure easier to
audit and does not create it. Nobody should read the correction above as the
rewrite becoming safe because the insert failed.

**A revision pin changes the vandalism exposure**, and should be added before any
backfill runs: store `pageid` and `revid` with the text and render from the pinned
revision.

**The coverage shape moves** with the guard, not with the source. The union is the
ceiling and the guarded number is the current floor. Requote it whenever the guard
changes, and name which one you are quoting.
