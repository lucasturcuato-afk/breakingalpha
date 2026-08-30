# Ask is directory-first, and the separate answer screen retires

Date: 2026-08-30
Ruled by: Noah

Three directions were drawn for `/ask` at 390x844 in both themes, from a source
table that named every field the data carries and every field it does not.
Direction C is chosen and built.

## Why

The owner's reasons, recorded as given:

> the directory becomes the screen rather than a section under a heading, which
> is what makes Company Intel reachable. And retiring the separate answer screen
> kills Ruling 20's prefetch problem, the answer screen's 63% void, and the dead
> 126x14 link in one move.

What C does. The field moves to the top and filters the rows the server has
already read. The company directory becomes the screen rather than a section
below three destination rows. Sector demotes to an inline tail after the name so
the row loses its second line. The three destinations demote to one-line rows
underneath, each carrying a figure with its window spelled beside it. Nothing is
pinned to the bottom except the tab bar, and that is what buys the room: the
scroll window grows by roughly a third, so six companies and all three
destinations clear the fold at 390 where today none of the six does. At 320 it
is six companies and two of three destinations, measured and not rounded up.

`/ask?q=` becomes a state of this screen rather than a second screen. That is
the half with the most consequence, because it settles three separate defects at
once instead of repairing them one at a time.

Why this satisfies Ruling 20 better than repairing the answer screen would.
Nothing links to `/ask?q=`, so the RSC prefetch cannot reach it; the filter runs
on the client over rows already in the payload; and neither server read takes
`q`, so the page reads no `searchParams` at all. Ruling 20 is preserved by
construction rather than by a `prefetch={false}` that was already measured
insufficient.

What was declined, and none of these is an oversight. `mention_count` as a
per-row figure, because a number beside each name invites reading the column as
a ranking of importance when it is a count of articles. `key_themes`, because
the arrays are long and nothing ranks them, so any first-N is arbitrary. The
send button, because a filter has no submit moment and a submit control would
promise a navigation that does not happen.

The known watch item, recorded so it is not later mistaken for a miss. The field
filters on a pole called Ask. The `?q=` state handles that honestly by saying
what was and was not searched, but a reader typing a question into a field
labelled for filtering may still be confused. The instruction was to watch for
it in testing rather than pre-solve it, so no mode toggle, segmented control or
intent-detection affordance was built.

This follows Ruling 23, which authorised the redraw, and Ruling 24, which kept
Company Intel under the Ask pole and required a real directory inside it. C is
that directory. There is no separate Company Intel artboard because the
directory is the surface; `/company/[id]` is a different screen and was not
redrawn.

## What would change the answer

A reader who cannot find a company they know exists. The directory is a head of
the corpus, not the corpus, and if the field's reach turns out to be narrower
than the promise its copy makes, that is a defect in this ruling's premise
rather than in its execution.

A sourced figure for the assistant. It is currently the only destination that
could not carry one, because nothing in the schema records conversations.
