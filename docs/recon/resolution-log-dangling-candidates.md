# resolution_log.candidate_canonical_ids holds ids of deleted companies

Logged 2026-09-01 during the norm_v2 merge. **Pre-existing, not caused by the
migration.** Filed so it is not lost, not because it is urgent.

## What it is

`resolution_log.candidate_canonical_ids` is a jsonb array of company uuids. Some
of those uuids name companies that no longer exist.

| measure | value |
|---|---|
| dangling (row, element) pairs | 946 |
| rows holding at least one | 884 of 4,297 (20.6%) |
| **distinct dangling company ids** | **16** |
| rows with a dangling `resolved_canonical_id` | **0** |

The headline 946 is a pair count, which is what a
`FROM resolution_log l, jsonb_array_elements_text(...)` query returns. The
population of actually-missing companies is 16.

## It stopped, and that is the most useful fact here

Affected rows span **2026-05-05 to 2026-06-24 only**. Nothing after 24 June.

    2026-05   459 dangling of  848 rows
    2026-06   425 dangling of 1992 rows
    2026-07     0 dangling of  890 rows
    2026-08     0 dangling of  557 rows
    2026-09     0 dangling of   10 rows

So whatever deleted those 16 companies, or whatever wrote arrays referencing
them, ended in late June. This is a bounded historical artifact rather than an
ongoing leak, which is why it can wait.

`resolved_canonical_id`, the scalar column, is **clean at 0 dangling**. Only the
array rotted. That asymmetry is worth keeping in mind: whatever cleaned up after
those deletions handled the scalar and missed the array, which is exactly the
defect 0020b change 5 exists to prevent going forward.

## Does it matter? Probably not, and here is the basis

`resolution_log` has **no read path**. Searched `backend/`, `src/` and `tools/`
on origin/main: eleven references, all in `backend/entity_resolver.py`, and every
one is an INSERT or a comment. No `.select()`, no API route, nothing in the
frontend. The writer's own docstring says:

> Append a row to resolution_log. Used for V2 trigger analysis (design doc
> section 10: ambiguity rate). Failures here are non-fatal to the caller
> (audit-only)

So it is write-only audit data. Nothing serves it to a user and nothing branches
on it. The cost of the rot today is that an analysis nobody has run yet would
over-count ambiguity for May and June if it resolved candidate ids to names.

## Why it is NOT the migration's problem

None of the 16 ids appear in `norm_v2.snapshot_companies`, so those companies
were already gone before the snapshot was taken. None are corning's losers. The
merge correctly reported `resolution_log_candidates: 0` for corning because none
of its losers appear in any candidate array.

## What to do about it, when someone gets to it

Three options, in ascending cost:

1. **Nothing.** Defensible while the table has no reader. Revisit if the V2
   trigger analysis in design doc section 10 is ever actually run.
2. **Prune the dangling elements.** One UPDATE stripping ids that no longer
   resolve. Cheap, but it destroys evidence of what was deleted, and the ids are
   the only remaining trace of those 16 companies.
3. **Find out what deleted the 16** and whether the deletion path still exists.
   This is the one with real value: something removed companies between May and
   June without cleaning the array, and if that path is still live it will rot
   the table again the moment it next runs. The date boundary suggests it is
   gone, but nobody has checked.

Option 3 first. Option 2 only after 3 answers.

## The invariant this broke

`no_dangling_candidates` in 0020b section 5 tested the whole table, so it read
false before the merge ever ran and would have read false afterwards regardless
of whether the merge was correct. It could not have detected the failure it was
written to catch. Replaced with a check scoped to ids this migration actually
deleted; see section 5.
