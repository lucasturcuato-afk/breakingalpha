# A fixture that names a real company picks one whose name carries no banned substring

Date: 2026-09-07
Ruled by: Noah

**When a test, comment or data literal needs the name of a real company, choose
one that does not trip rule 1 of `scripts/design-lint.mjs`.** Roughly nine in ten
SEC registrants qualify, so there is always another example. This is a convention
for authors, not a change to the rule and not an exemption from it.

## Why

Rule 1 matches its list as **substrings, not words**, and its own header says why:
every violation found during design was inside a longer word, and it extends to
identifiers and comments because a compliance grep over source will hit them.

That makes a certain fraction of real company names unusable as fixture data. The
fraction was measured against every registrant name in `cik_tickers`: **about one
name in eleven contains a substring on the list.** One entry on the list accounts
for almost all of it, because it appears inside an extremely common corporate
legal form.

So this is not a rate of false positives. It is the rule working exactly as
designed. A grep is what a reviewer actually runs, and a grep cannot tell a test
fixture from advisory prose. Under that standard a real registrant name **is** a
hit, and renaming it is the correct permanent behaviour rather than a workaround.

### The two fixes that were considered and rejected

**Narrowing the rule to word boundaries.** Measured against the same corpus:
word-boundary matching would keep only about one percent of the matches the rule
currently makes. Almost every hit is substring-only, which is the exact class the
rule exists to catch. This would gut it.

**A data-literal exemption.** Same objection from the other side. The compliance
requirement is that a grep over source finds nothing, and an exemption that
makes the linter quiet does not make the grep quiet. It would move the problem
somewhere a reviewer cannot see it.

Both share a failure mode worth naming: **a false positive that gets suppressed is
how a real violation eventually gets suppressed too.** The way to avoid a
suppression treadmill is not a smarter rule, it is to stop generating the
positives.

### The incident

A test fixture in the name-agreement suite quoted a registrant whose name carried
one of the substrings, and the ratchet failed the branch. Chasing it found
something worse than the lint error: once the offending word and the trailing
legal form were both stripped as low-identity tokens, the two names reduced to
**identical token sets**, so the assertion passed on the equality branch and never
reached the branch it was named for. The test asserted a true thing about code it
never ran.

The replacement pairs were chosen from registrants with clean names, and they now
assert the **reason** as well as the verdict, so a pass on a different branch fails
instead of reading as coverage.

That is the second lesson here and it is independent of compliance: **a fixture
chosen for its words rather than its shape tends not to exercise the shape.**

## What would change the answer

**A change to the compliance standard would.** If the requirement ever becomes
"no banned word in advisory prose" rather than "a grep over source finds
nothing", then a data-literal exemption becomes the right instrument and this
convention retires. That is a decision for a human with the compliance obligation,
not for whoever is writing the test.

**A registrant that has no clean alternative would**, and it has not happened yet.
If a rule genuinely can only be demonstrated by one specific company whose name
trips the linter, the answer is `EXCLUDE_FILES` with a comment saying which
company and why, which is the mechanism already used for the two files whose job
is to contain the banned strings. It is file-level and blunt, so it is a last
resort rather than a convenience.

**Nothing about the size of the fraction.** Whether it is one name in eleven or
one in five, the convention costs an author one substitution and the alternative
costs the rule its teeth.
