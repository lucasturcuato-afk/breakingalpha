# Keyset pagination on a timestamp alone loses rows silently, and a fix for a timeout is not allowed to be one

Date: 2026-09-04
Ruled by: Noah

**A keyset walk keys on a column set that is unique and non-null, or it does not
keyset.** On `articles` that means `published_at` **plus `id`** as a tiebreaker,
never `published_at` alone. If a walk cannot cover the whole table, it says in the
same sentence which rows it does not reach.

## Why

### The advice that was given, and what is wrong with it

The standing guidance in this repo is that a count over `articles` cannot be taken,
because `Prefer: count=exact` returns SQLSTATE `57014`, and that the safe unbounded
read is therefore a keyset walk rather than a `.limit()` or a `.range()`. That part
is right and it is not in question here.

What was added on top of it, and is wrong, is: when the walk carries a
`published_at` filter, order and keyset on `published_at` instead of `id`. That
advice exists for a real reason. An `id`-ordered walk with a `published_at`
predicate makes the planner filter every page rather than seek, and on this table
that walk hits the same `57014` the count does. Reordering the walk onto
`published_at` genuinely fixes the timeout.

It also introduces two silent losses, which is worse than the failure it replaced,
because the timeout was loud and these are not.

**`published_at` is neither unique nor non-null.** Both halves are properties of
the schema rather than of the data, confirmed read-only against prod through
PostgREST's OpenAPI document, which Postgres itself generates:

```
articles.required     ["id", "title", "industry_verticals", "activity_types"]
articles.id           uuid, default gen_random_uuid(), <pk/>       <- unique, not null
articles.published_at timestamp with time zone, NOT in required    <- nullable
```

`id` is the only column carrying a uniqueness guarantee. `published_at` carries
neither.

**Loss one: ties at a page boundary.** A walk that advances with
`.gt("published_at", last)` skips every row sharing that exact timestamp with the
last row of the page. Ingest writes articles in batches and a publisher feed
regularly stamps many items identically, so ties are not a theoretical edge; they
cluster exactly where the walk is most likely to stop. A tie straddling a page
boundary is dropped, and switching to `.gte` does not fix it, it re-reads the
boundary row and makes the walk non-terminating on a large enough tie group.

**Loss two: NULL timestamps, dropped entirely.** No `>` or `>=` comparison is ever
true for NULL, so every row with a NULL `published_at` is invisible to the walk from
the first page. There is no boundary condition to get right and no page on which
they appear. The affected fraction of `articles` is small, small enough to look like
a rounding error in any total the walk reports, and it is **not zero**, which is the
only fact the guidance needed. The figure is deliberately not published here; this
repo is public and the shape is what makes the rule.

Both losses share the property that makes them expensive: **the walk still
terminates, still looks complete, and still reports a plausible total.** It is the
same class as a bare `.execute()` capping at 1000 rows without erroring, and it is
quieter, because 1000 is a recognisable ceiling and a slightly short walk is not.

### The correct shape

Composite keyset on `(published_at, id)`, using row comparison so the tiebreaker
only engages inside a tie:

```
ORDER BY published_at, id
WHERE (published_at, id) > (:last_published_at, :last_id)
```

`id` is unique, so the composite key is unique, so no two rows can share a cursor
position and no row can be skipped. The `published_at` prefix keeps the index seek
that made the reordering worth doing, so this does not reintroduce the `57014`.

NULLs are a separate decision and must be made explicitly, not by default:

- **Cover them**: run a second pass keyed on `id` alone with
  `.is("published_at", null)`, which is a small, bounded, indexable set.
- **Or exclude them and say so**, in the sentence that reports the result: "this
  count is over rows with a non-null `published_at`".

Silence is the one option this ruling removes.

### Why it is worth a ruling rather than a comment

Because the wrong version is a **correct fix to a real failure**. Nobody proposed
keyset-on-timestamp carelessly; it was proposed to stop a timeout, and it stops the
timeout. The defect is not that the advice was lazy, it is that fixing a loud
failure quietly downgraded it to a silent one, and the report that comes back from
the silent version reads exactly like success.

That is the citable insight, and it generalises past pagination: **when a fix moves
a failure from loud to quiet, the fix is not done until the quiet failure has been
enumerated.** Ask what the new version cannot see, not only whether it stopped
erroring.

It also lands in a family this directory already records. `matchesCanonical` was a
predicate that returned a confident `false`; a truncated `.execute()` returns a
confident short list; this returns a confident short walk. None of them raise. See
`decisions/two-paths-one-guard.md` and
`decisions/evidence-runs-the-real-code.md`.

## What would change the answer

**A `NOT NULL` and a uniqueness guarantee on `published_at` would**, and neither is
coming. The column is populated from publisher feeds that do not always supply a
date, and two articles published in the same second are ordinary rather than
anomalous. The composite key is the durable answer.

**A cheap count would retire the surrounding argument, not this rule.** If
`articles` ever becomes countable without `57014`, the walk still has to be
complete; a count would only make its incompleteness detectable by assertion
(`len(rows) == count`) rather than by reasoning. That assertion is the right thing
to add the day it becomes possible, and it does not replace the tiebreaker.

**Nothing about the NULL disclosure.** Stating which rows a walk cannot reach costs
one clause and there is no condition under which omitting it is better.
