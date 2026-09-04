# A mutation proof is only valid if the mutation is the only thing reverted

Date: 2026-09-04
Ruled by: Noah

**Commit the change before mutating it.** A mutation proof that reverts with
`git checkout -- <path>` on an uncommitted working tree does not revert the
mutation. It reverts the file, which deletes the fix as well, and every mutation
after the first then runs against a tree that is part fix and part original.

## What happened

Four review fixes were made to the EDGAR shard-coverage work and left
uncommitted. The proof loop was:

```
apply mutation -> run the gate -> git checkout -- <the file>
```

That is correct only when the tree's committed state IS the fix. Here the
committed state was the pre-fix branch, so the first `checkout` threw away both
the mutation and the fix in the same stroke. `M1-a` was valid, because it ran
before any revert. Everything after it ran against a half-state: two files back
at the original, three still carrying fixes.

The output did not look like an error. It looked like mutations with enormous
blast radius: 19, 21 and 20 red tests where the honest answers were 2, 2 and 5.
A reviewer skimming the tags would have recorded those numbers as findings about
the code. They were findings about the harness.

It was caught by `git status` at the end of the run showing three files still
modified and two not, which is the shape a correct revert can never produce.

## The rule

- **Commit first, then mutate.** After the commit, `git checkout -- .` restores
  exactly the state under test and nothing else.
- **Assert the restore, do not assume it.** Every revert is followed by
  `git diff --quiet` and the result is printed. A silent restore step is the one
  that fails silently.
- **A blast radius that jumps is a harness smell before it is a finding.** A
  guard whose deletion reddens twenty tests across six unrelated classes is
  usually not a load-bearing guard; it is usually a broken tree. Re-run the
  clean gate before writing the number down.
- **Tag only what actually reddens.** Unchanged, and this is the reason it keeps
  needing saying: a prior PR tagged eight tests when four reddened, and this
  harness bug would have inflated a tag list in the opposite direction.

## Not this

Reverting with `git stash` instead. It has the same failure on an uncommitted
tree and adds a second one: the pop can conflict, and a conflicted pop leaves
the mutation half-applied with no error loud enough to stop the loop. Commit.
