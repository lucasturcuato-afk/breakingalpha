# One ruling, one file, no number

## Why this directory exists

`DECISIONS.md` carries rulings 1 to 22, and it will keep them forever. Every
reference in the codebase and in the PR history points at those numbers, so
they do not move.

Rulings after 22 live here instead, one per file, **named and not numbered**.

## The failure this prevents

On 2026-08-29 two units built in parallel, neither aware of the other. Each
read `DECISIONS.md`, saw that the highest ruling was 20, and took 21. The first
merged. The second hit a conflict on rebase, and the resolution was to renumber
one of them by hand.

That is not a mistake either unit made. **It is structural.** Any number of
parallel authors reading "what is the next free number" from a shared file will
all read the same answer, because none of them can see the others.

A placeholder does not fix it. Two units appending `### Ruling NEXT` to the
same anchor in the same file still conflict, because the conflict is the shared
anchor, not the number. **The only thing git merges cleanly and always is a
change to a different file.**

## The rule

- One ruling, one file, in this directory.
- The filename is a slug of the ruling, not a number: `radar-pole-name.md`,
  not `23.md`.
- Do not add a `### Ruling <number>` heading to a file in here. `npm run
  decisions` fails if you do.
- Do not add new numbered rulings to `DECISIONS.md`. It is closed at 22.

Two units picking the same slug is possible, and it is a *useful* collision:
it means they ruled on the same thing and somebody should read both. Two units
picking the same number means nothing except that they both counted.

## Referencing a ruling

By slug: "see `decisions/radar-pole-name.md`". A slug is as referenceable as a
number and cannot be allocated twice by accident.

## Listing them

```
npm run decisions
```

Sorted by the `Date:` line, newest last. There is deliberately no index file to
maintain, because an index carries one line per ruling and would reintroduce
exactly the shared anchor this directory exists to remove.

## The shape of a ruling

```markdown
# <what was ruled, as a sentence>

Date: 2026-08-30
Ruled by: Noah

<the ruling itself, in a sentence or two>

## Why

<the reasoning, and the measurement behind it if there was one>

## What would change the answer

<the condition for reversal, if there is one. Say "nothing" if there is not.>
```

The last section matters. Ruling 22 in `DECISIONS.md` records that a ruling
scoped by a fact about the codebase carries an expiry nobody writes down. This
is where you write it down.
