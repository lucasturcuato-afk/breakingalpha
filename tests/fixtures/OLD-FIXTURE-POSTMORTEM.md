# What the old fixture was actually measuring

`tests/fixtures/entity-subject-cases.json`, 86 cases, 52 accept and 34 reject. It reports
precision 1.000 and recall 1.000 against the predicate it ships with. Both numbers are real.
Neither is evidence that the predicate works.

## It is a binary instrument measuring a three way predicate

`classifyEntitySubject` returns SUBJECT, MENTION or ABSENT. The fixture asserts only `accept`
or `reject`, and `reject` collapses MENTION and ABSENT into one bucket. Every change that does
not cross the accept line is invisible to it.

That is not a theoretical gap. Measured by neutering one component at a time and re-reading
the whole fixture:

```
baseline            tp=52 fp=0 tn=34 fn=0  P=1.000 R=1.000

ablated          binaryFlips  verdictFlips   binary result
D1                  0           0        tp=52 fp=0 tn=34 fn=0  P=1.000 R=1.000
D2                  2           2        tp=52 fp=2 tn=32 fn=0  P=0.963 R=1.000
D3                  0           0        tp=52 fp=0 tn=34 fn=0  P=1.000 R=1.000
exchangeStrip       0          10        tp=52 fp=0 tn=34 fn=0  P=1.000 R=1.000

3 way verdict distribution baseline: {"ABSENT":22,"MENTION":12,"SUBJECT":52}
3 way after exchangeStrip ablation:  {"MENTION":22,"ABSENT":12,"SUBJECT":52}
```

`stripExchangeQualifiers` changes **10 verdicts** and swaps ABSENT and MENTION across 22
cases. The fixture registers **zero**.

## Two components are genuinely never exercised

`isRosterElement` (D1) and `isAnalystAttributor` (D3) flip **zero** binary decisions and
**zero** verdicts. Delete either one and the fixture still reports 1.000 and 1.000. D1 is the
rule written for the AfterQuery roster failure that names the whole commit. D3 is the rule
written for the analyst attribution pages. Both shipped uncertified.

An earlier review reported that three components contribute nothing, counting the exchange
strip among them. That reading is correct about the binary and wrong about the predicate. The
accurate statement is that two components do nothing and one does real work the fixture cannot
see. Corrected here rather than carried forward.

## The negatives largely name themselves

Four hand picked classes make up 44 percent of the fixture, and 22 of the 34 negatives
collapse to lexicon entries naming the exact tokens involved. `seaport`, `shore`, `shores` and
`lakeshore` are the first four entries of `placeAndCommonTokens`. A negative that is rejected
because its own token was added to a list is a test of the list, not of the predicate.

## Nothing is pinned

Neither suite asserts `fn`. Recall 1.000 is printed, not gated. Setting `VERB_WINDOW = 0` in
TypeScript only drops recall to 0.9808 and the suite still passes green. Twelve of the fifteen
lexicon lists can be deleted wholesale and ship green, including `ACTION_VERBS` at 246
entries. Four tuned constants give the identical 52/0/34/0 across their whole useful range,
including the one the lexicon calls "the tuning knob".

## What this fixture does instead

Three way expected verdicts, so MENTION and ABSENT are distinguishable and a component that
moves rows between them is visible. Every case tagged with the components it exercises, with a
floor of three cases per component, so no rule can ship uncertified again. Positives at least
matched to negatives, so rejecting everything cannot score well. Cases drawn from real
production rows with provenance, and expected values set by reading the text before running
anything.

## What the new fixture measures, on the same predicate

348 cases, 192 positive and 156 negative, verdicts three way.

```
OVERALL  exact3way 0.606   SUBJECT precision 0.734  recall 0.531  f1 0.616
         tp 102  fp 37  fn 90

component            n   pos   prec  recall
D1                  39    10  0.143  0.100
D2                  27    12  0.667  0.333
D3                  61    36  0.588  0.278
exchangeStrip       46    23  0.667  0.348
nameCompleteness   238   136  0.753  0.537

ABLATION            exact3way   prec  recall   verdictsFlipped
baseline               0.606  0.734  0.531
D1                     0.592  0.703  0.542      9
D2                     0.603  0.719  0.547      7
D3                     0.644  0.727  0.651     33
exchangeStrip          0.615  0.731  0.594     25
```

Same predicate, same code, 1.000 and 1.000 on the old fixture and 0.734 and 0.531 here.

**Every disqualifier is net negative on recall.** Removing any one of the four raises recall.
Removing `D3` raises recall from 0.531 to 0.651 and three way accuracy from 0.606 to 0.644,
at a precision cost of 0.007. On this evidence `isAnalystAttributor` should be deleted rather
than tuned.

Failure shape, 137 of 348:

```
want SUBJECT got ABSENT     45      want MENTION got SUBJECT    19
want SUBJECT got MENTION    45      want ABSENT  got SUBJECT    18
want ABSENT  got MENTION     9      want MENTION got ABSENT      1

false negatives by deciding reason        false positives by promoting rule
  45  no reason fired, the name never       20  P1:segment-lead
      matched its own headline                7  P5:ticker-in-segment
  21  D3:analyst-attributor                   5  P3:action-verb
  13  M:mention-only                          5  P4:self-reference-noun
                                              4  P2:possessive
```

Half the false negatives are not a judgment error. The name completeness machinery never
found the company in its own headline at all, which is the `Northern Oil And Gas`, `AT&T`,
`Yum! Brands` and `Q2 Holdings` class. And `P1:segment-lead` alone drives more than half the
false positives, because leading a segment promotes unconditionally.

## What this fixture is not

It is weighted toward hard cases on purpose, so 0.531 recall is not a corpus wide estimate.
It is the score on a set built to exercise every component, and the point of it is the shape
of the failures and the ablation deltas, not the headline number. Roughly 44 percent of the
cases are true positives drawn from ordinary production rows, so it is not adversarial only.

Labels were set by reading the text, before and independently of any predicate run. Where a
label and the predicate disagree, the label stands and the disagreement is the finding.
