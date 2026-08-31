# The cluster count is permanently unresolved, and no figure travels without its method

Date: 2026-08-31
Ruled by: Noah

**Nobody quotes a bare cluster count again.** The entity-merge cluster count has
been closed and reopened twice and three triples are still circulating. Every
figure cited from here on carries its method, its snapshot date and its row
count, or it does not get cited.

## Why

The counts move with every ingest run, and the key function that produces them
changed after two of the three figures were taken. `0020b`'s own header already
says the first half: "The counts move with every ingest run: +734 company rows
in 15 days. Rebuild and re-audit immediately before merging; do not trust any
figure here blind." This ruling promotes that line from a comment to a rule and
adds the second half, which is that the method moved too.

### The three figures, each with what produced it and what falsified it

| clusters / members / absorbable | method | snapshot | status |
|---|---|---|---|
| **788 / 2,133 / 1,345** | Python port of `sql/proposals/0020` PHASE 1, replayed over a `companies` snapshot | 2026-08-18, 5,440 rows | **Replays exactly at that prefix.** Not falsified, and not general either. |
| **789 / 2,135 / 1,346** | none | none | **Never measured.** Never hit at any prefix. |
| **819 / 2,218 / 1,399** | the same Python port, over the then-live table | 2026-08-30, 5,599 rows | **Its parity basis was falsified by #775.** A fourth reading, 818 / 2,216 / 1,398, came out of the same run. |

**788 / 2,133 / 1,345 is the only one that replays.** It is the number
`sql/proposals/0035` writes down ("across all 788 live clusters") and the
snapshot `sql/proposals/0036` gates on ("all 5,440 rows", verified read-only
2026-08-18). The two documents agree because they describe the same table on the
same day. That is still not a general answer: it is what one function returned
over one prefix.

**789 / 2,135 / 1,346 is an artifact, not a measurement.** The replay trajectory
brackets it without ever landing on it: 788 / 2,134 / 1,346, then
789 / 2,136 / 1,347, same function, one to two inserts later. Transcription or
timing. It has no method and no snapshot, so under this ruling it has nothing to
be quoted with. Drop it.

**819 / 2,218 / 1,399 came from a port whose parity claim #775 disproved.** The
port was validated at 0 mismatches over 6,226 keys against both
`backend/normalize.py` and the `lookup_key` prod actually stores, and it measured
the SQL-to-Python ambiguities as differing on 0 of 11,825 keys. **That last
measurement is what #775 falsified.** Two reports from the same run also differ
by one row, 818 / 2,216 / 1,398 against 819 / 2,218 / 1,399. The drift is
recorded rather than resolved, because neither reading has a claim on being the
right one.

### What #775 showed, commit `c5bf3500`, on main

Section 3 raised DRIFT on a live run: the EDGAR audit measured 825 clusters and
section 3 built 823. The cause is two characters. `Disney+`'s `+` is U+002B,
Unicode category Sm. `$MIR`'s `$` is U+0024, category Sc. Neither is category P*,
so under this database's UTF-8 LC_CTYPE `[[:punct:]]` left them in and SQL keyed
`disney+` and `$mir` as singletons while the Python matcher folded both. The fix
replaces `regexp_replace(v_punct, '[[:punct:]]', ' ', 'g')` with an explicit
`translate()` over the 32 ASCII punctuation characters, and the comment it lands
with states the general fact: `[[:punct:]]` is locale-dependent and excludes the
nine ASCII symbols `$ + < = > ^ \ | ~` that Python's `string.punctuation`
includes, "so the two diverged silently."

**Sample-validated parity is not parity.** This is the part worth keeping. The
port was correct for every key it was tested against and wrong as a general
claim, and both halves are true at the same time. The two implementations agree
on the character classes that happened to appear in the sample and disagree on
nine ASCII symbols that did not. 6,226 keys and 11,825 keys are large samples,
and a large sample drawn from the corpus can only prove parity over the corpus.

## What would change the answer

**Not a new measurement.** A fresh replay produces a fifth figure, not a
resolution. The same lineage has already produced three more, each correct when
taken: 677 / 1,779 / 1,102 at 4,865 rows on 2026-07-26 in `0020`'s header,
780 clusters and 1,319 absorbed at 5,364 rows on 2026-08-15, and 825 clusters and
1,405 absorbed at 5,599 rows on 2026-08-30 after the fix, both in `0020b`'s.

**The count becomes quotable the day the merge runs and the table stops moving.**
Until then the figure is a property of a snapshot rather than of the product, and
the snapshot is the half that has to travel with it.
