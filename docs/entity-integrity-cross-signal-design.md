# Entity integrity by cross-signal agreement

**Status: DESIGN ONLY. No production code, no migrations, nothing applied.**

Base: `origin/main` = `aa555f92463b74acf749ee2b1ea1678fda62d8a8`, verified by
`git fetch origin` at time of writing.

This revises `docs/entity-integrity-ledger-design.md` (branch
`track-d/repair-ledger`, commit `affe8f0d`). It replaces that document's
four hand-derived invariants with a single agreement check. Section 1 states
exactly what was kept, replaced and dropped.

**Measurement provenance.** Every number below was measured read-only against
prod on 2026-09-01 via SELECT-only PostgREST GETs. No write of any kind was
issued. **Outbound request cap: zero requests to sec.gov**, and 228 GETs to our
own Supabase (25 for `companies` / `cik_tickers` / `aliases`, 198 for a full
keyset walk of `articles`, 5 for title spot-checks). All SEC-derived data was
read from the already-mirrored `cik_tickers` table, so the SEC fair-access rules
(10 req/sec, real User-Agent) were not exercised at all. Any implementation that
escalates to a live authority fetch inherits `backend/edgar/client.sec_get`,
which already carries the mandatory User-Agent and pacing; the cap for that path
is **one SEC request per check cycle, never per row**.

The measurement code is a throwaway script kept in this worktree under
`scripts_throwaway/`. It is not production code and is not proposed for merge.

---

## 1. What was kept, replaced, and dropped

**KEPT, unchanged.**

- **The ledger** (prior section 5). Every automatic change writes what changed,
  from what, to what, why, under what authority, and is reversible in one
  statement with a drift guard. Section 11 restates it with the fields the new
  check needs.
- **The ordering argument** (prior section 6). Ladder, then check, then repair,
  then constraint, then one finite backfill. Section 12 says what cross-signal
  changes about it, which is less than expected.
- **The tautology analysis** (prior section 2). Joining `companies.sec_cik` to
  `cik_tickers` **on ticker** measures the sync job's own output and reports 100%
  agreement forever. The escape is to join on CIK and compare **names**. This
  survives intact and is now the load-bearing axis of the whole design.
- **`cik_tickers.company_name` as the independent authority.** It is SEC's
  registrant title, mirrored verbatim at `cik_mapping.py:31`, and no code path in
  this repo derives `companies.name` from it. `sql/proposals/0037` claims "there
  is no automatic name source in this database." **That claim is false, and this
  column is the counterexample.**
- **Retraction, never reassignment**, as the default repair. Reinforced, not
  weakened, by section 4.
- **The cost model's shape** (prior section 7), re-costed in section 13.

**REPLACED.**

- **I1 / I2 / I3 / I4.** The four invariants are gone. They are not four
  properties; they are four *projections* of one property, and each arrived only
  after a human found its failure class by hand. Section 5's matrix reproduces
  all four as patterns rather than as rules: I1 is `REGISTRY_OUTVOTED` plus
  `NAME_OUTVOTED`, I2 and I3 are the cross-row duplicate case on the name-key
  axis, I4 is the same cross-row case on the ticker axis.
- **"94 I1 violations, ~71 false alarms."** The difflib-ratio comparator that
  produced those numbers is replaced by a relation classifier (section 4.2) that
  scores 26 of 28 on a probe set including every case the ratio comparator got
  wrong (`Meta`, `AMD`, `IBM`, `Truist`).

**DROPPED.**

- **The interior-fragment string test as a detector.** It was proposed as the
  check that "would have caught both of these without anyone hand-adjudicating
  six rows." Measured, it does not work in that role. Section 3 gives the
  numbers. It survives as *remedy evidence* only.
- **`Tier A` / `Tier B` / `Tier C` as a fixed taxonomy.** Confidence is now
  derived from how many *independently sourced* signals coalesce (section 6),
  not assigned to a tier by hand.

---

## 2. Why an invariant list cannot be the answer

The prior design's four invariants each existed because someone found the
failure first. I1 exists because a human noticed cross-wired CIKs. I4 exists
because a human noticed `Rigetti`/`Gett`. That is the pattern the program is
stuck in: every new failure class costs one investigation plus one assertion,
and the list only ever grows.

The alternative is to stop enumerating failures and start enumerating **signals**.
A row carries several claims about which company it is. Those claims either agree
or they do not. Disagreement is the detectable state, and it does not need to be
anticipated: a failure mode nobody has named still produces disagreement, because
producing agreement across independently sourced claims is exactly what being
correct means.

One check. The remedy is not a second decision; it is read off *which* claims
coalesce.

---

## 3. The obvious detector, and why it is not built

The revision brief proposed: "a row whose name is an interior fragment of the
name its own articles point at is a detectable state."

Measured against the twelve hand-adjudicated rows, taking `T` to be the company
each row's tagged articles actually concern, normalized to lowercase
alphanumerics:

| test | score | how it fails |
|---|---|---|
| plain substring `N in T` as detector | **10 / 12** | `Fidelity` in `fidelitynationalinformationservices`, `CSL` in `csllimited`. **A correct short name is a substring of its own full legal name.** Structural, not an edge case. |
| strict interiority (substring, excluding prefix and suffix) | **9 / 12** | fixes the prefixes, breaks the suffixes: `ola` is a suffix of `cocacola`, `excel` of `hexcel`, `vanta` of `novanta`, `motive` of `oreillyautomotive`. Only `hark` in `sharkninja` and `ely` in `ardelyx` are strictly interior. |
| position as a **remedy** rule, given a disagreement already found | **11 / 12** | prefix => name correct, detach; suffix or interior => name mangled, rename; not a substring => name correct, detach. Single exception is `Fidelity`. |

(The coordinator measured 10/12, 7/12 and 11/12 on the same three tests. The
strict-interiority figure differs because the two runs chose different surface
forms for `T` on three rows. **That the score moves by two depending on which
spelling of `T` you pick is itself an argument against the string test.** The
first and third numbers, which are the ones that matter, reproduce exactly.)

Neither string form separates the classes, because **position does not carry the
signal**. The substring relation therefore appears in this design in exactly one
role: once a disagreement has already been detected by other means, it helps
choose between rename and detach, and it tells you what to rename *to*. It is
never the detector.

---

## 4. The signals, and the provenance graph

### 4.1 The signals are not independent, and that is the design's central fact

The revision brief lists a row's signals as name, normalized key, CIK, ticker,
and article evidence, and proposes that two of them outvote a third. **A naive
vote over those five confirms a wrong stamp three times over**, because most of
them are downstream of the name. Verified in code and in prod:

```
companies.name                    ROOT. Written by entity_resolver mint from
                                  Gemini's extracted surface form.
        |
        |  backfill_tickers.py:245  name -> Finnhub fuzzy search -> ticker
        |  resolveOrCreateCompany.ts:216  symbol search -> ticker (ungated)
        v
companies.ticker                  DOWNSTREAM OF NAME
        |
        |  cik_mapping.py:73-94   ticker -> cik_tickers -> cik
        |  entity_resolver.py:408-421 -> populate_sec_cik_for_mint -> :506
        v
companies.sec_cik                 DOWNSTREAM OF TICKER, HENCE OF NAME
        |
        |  ingest.py _resolve_primary_to_canonical SURFACE 4 = companies.ticker
        v
articles.companies[]  (fold path) DOWNSTREAM OF TICKER. FULLY CIRCULAR.

--- the two axes that are NOT downstream of us -------------------------------

cik_tickers.company_name          SEC's registrant title, mirrored verbatim.
                                  Independent of everything we write.
articles.primary_company          Gemini's read of the ARTICLE TEXT, stored
   (when it holds a NAME)         verbatim at ingest.py:2757, never canonicalized.
                                  Independent of everything we write.
```

`_resolve_primary_to_canonical`'s docstring names surface 4 explicitly:
`companies.ticker`, "bare symbols: primary_company holds 'ARM', the join key
lives in a column." So an article whose `primary_company` is a **bare ticker** is
folded onto the canonical name of whatever row holds that ticker, and that name
is written into `articles.companies[]`. The row's own ticker stamp comes back as
"evidence."

**Measured in prod.** Of 165,802 articles carrying a `primary_company`, 18,380
(11.1%) hold a bare ticker, and 15,165 (9.1%) hold a bare ticker *and* a
singleton `companies[]` array, meaning the tag exists only because of the fold.

**Verified row by row, with titles:**

| row | tagging articles | `primary_company` is a bare ticker | titles containing the registrant name |
|---|---|---|---|
| `Ola` [KO, cik 21344] | 10 | 8 | **0** contain "coca" |
| `Hark` [SN] | 12 | 11 | **0** contain "shark" |
| `Ely` [ARDX] | 25 | 24 | **0** contain "ardelyx" |
| `Excel` [HXL] | 11 | 10 | **0** contain "hexcel" |
| `Fidelity` [FIS] | 60 sampled | 26 | **20** contain "fidelity national", 33 contain "Fidelity" |

`Ola`'s only two name-bearing articles are *"Layoffs at Krutrim; PhonePe vs
Paytm"* and *"Gainers & Losers: Nestle, Groww and Ola among 7 big movers"* --
both about Ola of India. So the earlier reading, that Ola's articles and CIK
both say KO, is **wrong**: they are one fact stated twice, and the one
independent article says Ola.

`Fidelity` is the opposite shape and it is the reason the guard works: its
tagging articles carry `primary_company` as a **name**, and the titles say so.

### 4.2 The four claims, after the guard

Each row carries at most four identity claims:

| claim | source | provenance | present on |
|---|---|---|---|
| **NAME** | `companies.name` | root | 5,610 rows, minus 94 whose name **is** their own ticker and therefore restates it |
| **REG** | `cik_tickers.company_name` joined on `sec_cik`, else on `ticker` | SEC | 862 rows |
| **ART** | modal `primary_company` over articles tagging this row **or any of its alias surface forms**, admitting only values that are **not** bare tickers | article text | 1,458 rows at support >= 3 |
| **KEY** | `normalize_*(name)` | derived from NAME | all rows |

**KEY is not a vote.** It is a deterministic function of NAME, so it can never
disagree with it. Its role is to define which rows are claiming the same
identity, which is what makes cross-row disagreement computable. The normalizer
is a **grouping axis, not a signal** (section 10).

The **provenance guard** is the single rule that makes the vote honest:

> An article counts as identity evidence only if its `primary_company` holds a
> **name**, not a bare exchange symbol. Bare-ticker tags are the row's own stamp
> restated through fold surface 4.

Applying it suppresses **19,384 circular tags** across the corpus.

### 4.3 What "agree" means, concretely

Two claim strings denote the same company when their relation is one of:

| relation | meaning | example |
|---|---|---|
| `EQ` | equal after the v2 fold | `HP Inc` / `HP INC` |
| `ABBR` | one is the initials of the other, exactly or as a >=3-letter prefix of them | `IBM` / `International Business Machines Corp`; `LIC` / `Life Insurance Corporation of India` |
| `TPREFIX` | shorter significant-token list is a leading run of the longer | `Meta` / `Meta Platforms, Inc.`; `Truist` / `TRUIST FINANCIAL CORP` |
| `TSUB` | shorter token set (>= 2 tokens) contained in the longer | |
| `NEAR` | difflib ratio >= 0.60 **and** a shared significant token **and** both sides >= 2 tokens | |

and they disagree otherwise. Three refusals are load-bearing and each was forced
by a measured false result:

- **`NEAR` requires a shared token.** Bare difflib scores `AXT`/`Baxter` at 0.67,
  `Excel`/`Hexcel` at 0.91, `Vanta`/`Novanta` at 0.83 -- all above the repo's own
  0.60 bar in `backfill_sec_ciks.py:79`, all different companies. Requiring a
  shared significant token is what separates a spelling variant from a
  coincidental character overlap.
- **`NEAR` requires >= 2 tokens on both sides.** Otherwise `Applied Materials`
  agrees with `Applied Optoelectronics` on a shared generic head.
- **A single significant token contained but not at the head (`TINNER`) is
  refused.** `Vanguard` sits inside `American Vanguard Corp` (AVD, a different
  company) exactly as `Disney` sits inside `Walt Disney Co` (the same company).
  Nothing in the data separates them, so `TINNER` is flagged and never
  auto-applied.

Character-level containment (`CPREFIX` / `CSUFFIX` / `CINNER`) never decides
agreement. It is carried alongside as remedy evidence, per section 3.

Measured on a 28-case probe covering every worked example plus the prior design's
documented false alarms: **26 correct, 2 wrong.** The two misses are instructive
and are reported rather than hidden: `GIC` genuinely is the initials of `Global
Industrial Co` (acronyms collide), and `Revolut`/`Revolution Medicines` is a
character-prefix that routes to the collision class rather than to clean
agreement, which is the right destination for the wrong reason.

---

## 5. The disagreement matrix

Let `A_self` be the qualifying article support for modes agreeing with NAME and
`A_other` the support for modes disagreeing with it. One threshold in the entire
check: a signal is present at support >= 3.

| # | pattern | class | remedy | worked case |
|---|---|---|---|---|
| 1 | all present claims in one coalition | `AGREE` | none | |
| 2 | NAME + ART coalesce, REG dissents | `REGISTRY_OUTVOTED` | **DETACH** the identifiers | **AXT Inc.**: 11 name-bearing articles say AXT, cik 10456 says Baxter |
| 3 | REG + ART coalesce, NAME dissents | `NAME_OUTVOTED` | **RENAME** to the coalesced name | **AAOI** -> Applied Optoelectronics |
| 4 | NAME + REG coalesce, ART dissents | `CONTENT_DISAGREES` | retag review; never touch the row | |
| 5 | NAME vs REG only, no qualifying ART | `TWO_SIGNAL_NAME_VS_REG` | **PROPOSE DETACH** | **Ola**, **Hark**, **Ely**, **Excel**, **Vanta**, **Motive**, **LIC**, **Gett** |
| 6 | NAME vs ART only, no REG | `ARTICLE_ONLY_*` | informational only (section 9) | |
| 7 | all three mutually dissent | `THREE_WAY_SPLIT` | detach, then quarantine the name | `L Catterton`[LOT], `NEA`[LINE] |
| 8 | `A_self` and `A_other` both >= 3, `A_other` larger, **and REG sides with the dissent** | `CONTESTED_NAME` | quarantine | `Raytheon` -> RTX |
| 9 | claims agree, but the corpus uses this NAME for two companies that are not each other | `AMBIGUOUS_NAME` | quarantine, or propose a contested rename | **Fidelity** |
| 10 | REG dissents *and* is echoed in the row's own articles | `QUARANTINE_CORPORATE_ACTION` | quarantine | `TopBuild Corp.` -> QXO |

**The two worked cases the brief demanded, reproduced by the matrix without
being told:**

```
AXT Inc.   NAME 'AXT Inc.'    ART 11 name-bearing articles say AXT
           REG  cik 10456 = 'BAXTER INTERNATIONAL INC'
           NAME and ART coalesce; REG dissents            => REGISTRY_OUTVOTED
                                                          => DETACH

Ola        NAME 'Ola'         ART 1 qualifying article, about Ola of India
           REG  cik 21344 = 'COCA COLA CO'
           the KO ticker came from a fuzzy search ON THE NAME, and the CIK came
           from the ticker, so REG is a single fact, not a second witness
           NAME dissents from REG with no independent corroborator
                                                          => TWO_SIGNAL_NAME_VS_REG
                                                          => PROPOSE DETACH
```

Same check, opposite remedy, decided by **provenance** rather than by count. The
earlier reading of Ola as a rename was an artifact of counting a circular signal
as a witness; the guard removes it and the remedy inverts.

**The third class.** `Fidelity` is neither a mangled fragment nor a wrong stamp.
Its name is a legitimate short form for a *different* company, Fidelity
Investments. Both independent axes say FIS: the registrant name, and 130
name-bearing articles. So the evidence supports renaming to the full form, but
doing so leaves the asset manager with no row at all. The matrix detects it
without external knowledge, via the corpus-ambiguity test: two `primary_company`
values that each strictly agree with `Fidelity` but disagree with each other,
`'Fidelity National Information Services Inc'` and `'Fidelity Core Real Estate
Fund'`. Class `AMBIGUOUS_NAME`, remedy `PROPOSE_RENAME_CONTESTED`. **Detected,
targeted, and explicitly not auto-applied.**

### 5.1 The same check across rows

Rows that share one signal must agree on the others. The shared signal is the
grouping axis and is excluded from the comparison, because comparing names inside
a name-key bucket is a tautology (that is why they are in the bucket), and
comparing registry claims inside a ticker group is the same tautology (`Gett`
holds `Rigetti`'s CIK, so both resolve to `Rigetti Computing`).

| axis | compare | all agree | any disagree |
|---|---|---|---|
| normalized key | REG, ART | `DUPLICATE_SPLIT` -> merge onto the carrier | `CONTESTED_GROUP` -> quarantine |
| ticker | NAME, ART | `DUPLICATE_SPLIT` | `CONTESTED_GROUP` |
| `sec_cik` | NAME, ART | `DUPLICATE_SPLIT` | `CONTESTED_GROUP` |

This is where the prior design's I2, I3 and I4 land, as one rule rather than
three. It also reaches rows the per-row check cannot: **659 of the 3,198
single-signal rows are visible through a name-key group even though they carry
nothing to disagree with on their own.**

---

## 6. Confidence: what may be applied automatically

Confidence is the count of **independently sourced** coalescing claims, not the
count of claims.

| tier | condition | action | rows today |
|---|---|---|---|
| **AUTO** | two independent axes coalesce against the third (SEC registrant + name-bearing articles) | apply, ledger, reversible | **15** (9 `REGISTRY_OUTVOTED`/DETACH + 6 `NAME_OUTVOTED`/RENAME) |
| **PROPOSE** | exactly two claims present and they disagree; the only non-inventive act is retraction | emit a proposal, human applies | **52** `TWO_SIGNAL_NAME_VS_REG` |
| **QUARANTINE** | ambiguity that no in-database signal resolves: `TINNER`, corporate actions, collisions, three-way splits | never auto-changed, ledger row written | **39** |
| **INFORMATIONAL** | article evidence with no registry corroborator | counted, never actioned | **256** |
| **CROSS-ROW MERGE** | a group whose members' claims all agree, exactly one identifier carrier | fold, ledger | **483** name-key groups |
| **CROSS-ROW ELECT** | group with zero carriers | survivor election, out of scope here (`sql/proposals/0035`) | **285** groups |

The rule that produced this tiering, stated once: **the registry must
corroborate the accusation.** A row whose registry stamp still backs its own name
is a secondary actor being out-shouted by the companies it invests in or advises,
not a misidentified row. That single condition moved `Goldman Sachs` (198 self,
404 other) out of the findings and left `AXT Inc.` and `LIC` in.

---

## 7. Measured against prod

All 5,610 `companies` rows. Cross-checked against a full keyset walk of
`articles`: **197,147 rows exactly**, obtained without a `COUNT`, which times out
with SQLSTATE 57014 on this table. (`OFFSET` pagination 500s past ~110k rows;
keyset does not. Both are recorded here because the program keeps rediscovering
them.)

```
PER-ROW
  in agreement                              2,029    36.2%
  in disagreement                             383     6.8%
  undecidable, single signal                3,198    57.0%
                                            -----
                                            5,610

  ARTICLE_ONLY_DIFFUSE                        193
  TWO_SIGNAL_NAME_VS_REG                       52
  CONTESTED_NAME_UNCORROBORATED                50
  AMBIGUOUS_NAME                               30
  CONTENT_DISAGREES                            19
  REGISTRY_OUTVOTED                            13
  ARTICLE_ONLY_CONCENTRATED                    13
  NAME_OUTVOTED                                 6
  THREE_WAY_SPLIT                               5
  CONTESTED_NAME                                2

CROSS-ROW
  axis            groups   rows   mentions   contested
  v1 name key          1      2          2           0
  v2 name key        828  2,239     79,238          58
  ticker              17     37      2,302           9
  sec_cik              0      0          0           0   <- 0036's gate is open
```

The `sec_cik` axis holding zero groups independently reconfirms that
`sql/proposals/0036`'s unique index is applicable today: 793 CIK-bearing rows,
793 distinct, no duplicate holders.

---

## 8. Rediscovery: does one check find what a growing list found?

The check was run without any of the following being named to it. **All eighteen
were rediscovered.**

| case | class | remedy | matches hand adjudication |
|---|---|---|---|
| `Ola` | `TWO_SIGNAL_NAME_VS_REG` | propose detach | yes (corrected reading) |
| `Fidelity` | `AMBIGUOUS_NAME` | propose contested rename | yes, the third class |
| `Gett` | `TWO_SIGNAL_NAME_VS_REG` | propose detach | yes |
| `AXT Inc.` | `REGISTRY_OUTVOTED` | **detach** | yes, exactly |
| `CSL` | `CONTENT_DISAGREES` | retag review | **partial, see below** |
| `Vanguard` | `REGISTRY_OUTVOTED` | quarantine (`TINNER`) | detected, remedy withheld |
| `LIC` | `TWO_SIGNAL_NAME_VS_REG` | propose detach | yes |
| `Hark` `Motive` `Ely` `Excel` `Vanta` | `TWO_SIGNAL_NAME_VS_REG` | propose detach | yes |
| `HP Inc.` [HP, cik 46765] | `REGISTRY_OUTVOTED` | **detach** | yes; 98 name-bearing articles, zero circular |
| `HP` name-key bucket | `CONTESTED_GROUP` | quarantine | yes: `Helmerich & Payne` vs `HP INC` |
| `Rigetti`/`Gett` ticker `RGTI` | `CONTESTED_GROUP` | quarantine | yes, on both NAME and ART |
| `ONEOK` (3 rows) | `DUPLICATE_SPLIT` | merge, 1 carrier | yes |
| `IDACORP` (3 rows) | `DUPLICATE_SPLIT` | merge, 1 carrier | yes |
| `Franklin BSP Realty Trust` (4 rows) | `DUPLICATE_SPLIT` | merge, 1 carrier | yes |

**The one partial.** `CSL` is detected but under-diagnosed. Its name **is** its
own ticker string, so the name axis carries no independent claim, and 131 of its
136 article tags are bare-ticker `CSL` and are suppressed by the provenance
guard. What is left is five qualifying articles pointing at Haemonetics and
Carlisle, which is enough to flag the row but not enough to name the remedy. That
is an honest under-call, and it generalizes: **a row whose name is a bare ticker
symbol loses the name axis, and if its articles are also bare-ticker tagged it
loses the article axis too, leaving nothing to disagree.** 94 rows are in that
shape. They remain reachable through the ticker-group cross-row check.

---

## 9. False positives, hand-adjudicated

Sample sizes are stated. Adjudication was by reading each row's evidence:
registrant name, article modes, mention count, and the fragment relation.

**Auto-apply classes, 100% sampled.**

| class | n | true | false | notes |
|---|---|---|---|---|
| `REGISTRY_OUTVOTED` / DETACH | 9 | 8 | 1 | the one miss is `SpaceX`, whose cik 1181412 really is `SPACE EXPLORATION TECHNOLOGIES CORP`; no string relation links the two |
| `NAME_OUTVOTED` / RENAME | 6 | 6 | 0 | all are ticker-named rows (`AAOI`, `DVN`, `CPB`, `MSTR`, `IBKR`, `UEC`) whose full name is corroborated by **both** independent axes |
| `TWO_SIGNAL_NAME_VS_REG` / propose detach | 52 | ~50 | ~2 | arguable: `Keystone`[FKYS], `Kingswood`[BCG], both plausibly corporate actions |

**Precision on the auto-apply tier: 14 of 15.** On the propose tier: ~96%.

**Three false-positive classes were found by adjudication and each was fixed
structurally, not by tuning a threshold.** The before/after numbers are given
because the failures are more informative than the fixes:

1. **Rows whose name is their own ticker.** `AAOI`, `HWM`, `CPB`, `GPI`, `DVN`,
   `EGO`, `MUSA`, `ACA`, `ALV`, `AMTB`, `MTA`, `CWAN`, `IAG`, `FIZZ`, `BMO` can
   never string-agree with `APPLIED OPTOELECTRONICS` or `Howmet Aerospace`, and
   are all correct. **15 of 19 false positives in `REGISTRY_OUTVOTED` came from
   this one shape.** Fix: the name restates the ticker, so it is marked absent
   rather than dissenting. This is the brief's own principle -- fewer signals,
   fewer ways to disagree. 33 -> 12 rows.
2. **Corporate actions.** `TopBuild` -> `QXO Insulation`, `Allbirds` ->
   `Smartbird`, `Bed Bath & Beyond` -> `Neighborhood Intelligence` are SEC
   registrant renames, not bad stamps. Signature: the registry's name also
   appears as a `primary_company` on the row's **own** articles, with 48 of
   TopBuild's 94 tags saying `QXO`. Routed to quarantine.
3. **Corpus ambiguity computed with a weak comparator.** Using `NEAR` made
   `Applied Materials` "ambiguous" with `Applied Optoelectronics` on a shared
   generic head. Restricting the ambiguity test to `EQ`/`ABBR`/`TPREFIX` cut the
   class from 93 to 30 and left it dominated by real cases: `Ares Management` vs
   `Ares Capital`, `Blackstone` vs `Blackstone Secured Lending`, `Yum! Brands`
   vs `Yum China`, `Hilton Worldwide` vs `Hilton Grand Vacations`, `Fidelity`.

**The measured negative result, which matters most.** `ARTICLE_ONLY_*` (206 rows)
is essentially all false positives. Sampling 25 of `ARTICLE_ONLY_DIFFUSE` and all
14 of `ARTICLE_ONLY_CONCENTRATED`, roughly 37 of 39 are **secondary actors**:
`Y Combinator` -> Robinhood, `Hellman & Friedman` -> Anthropic, `Advent
International` -> PayPal, `TD Cowen` -> Celestica, `Honda` -> QuantumScape,
`Aramco` -> Fluor. This is correct pipeline behaviour: `ingest.py:934` tells the
model that `primary_company` is the main actor and explicitly **not** the
investor or advisor, so `articles.companies[]` names secondary actors by design.
Concentration filtering does not rescue it, because a partnership article has one
dominant counterparty.

> **The article signal is a corroborator, never a lone accuser.** A row's
> articles disagreeing with its name is the *normal* state for a bank, a PE firm
> or an advisor. The signal earns its keep only when the SEC registrant name
> sides with it.

That is the brief's "two signals outvote the name" instruction, and the
measurement shows precisely why the two-signal case does not work and the
three-signal case does.

---

## 10. Coverage: rows with too few signals to decide

**3,198 rows (57.0%) carry one signal and cannot disagree with anything.** The
brief anticipated this and called it fine. It is, and here is the quantification
that makes it checkable:

- They carry **4,990 of 137,457 mentions, 3.6%**. Median mention count 1.
- **59** hold a ticker, **zero** hold a CIK. None can be serving another
  company's filings, which is the failure the whole program is about.
- **659 of them are reachable through a name-key group**, so the cross-row check
  sees them even though the per-row check cannot.
- 783 have no article tags at all; 2,287 have one or two, below the support bar.

So the uncheckable population is 57% of rows, 3.6% of attention, and 0% of the
SEC-attachment blast radius. The blind spot is real and it is small where it
matters.

---

## 11. Honest limits: what the invariant list could see that this cannot

An honest limit is more useful than a design that claims to subsume everything.

1. **Ticker-named rows lose the name axis** (94 rows). `CSL` is under-diagnosed
   for this reason. The old I4 ticker-uniqueness invariant still reaches them
   through the group check, but only when a second row shares the ticker.
2. **A row whose name, ticker and CIK are all wrong in a mutually consistent
   way** produces no disagreement. The old I1 could not see this either, but it
   should be said plainly: agreement is evidence, not proof.
3. **SEC registrant renames are indistinguishable from cross-wires** without the
   CIK's former name, which this database does not store. Quarantined, not
   solved.
4. **Acronym collisions.** `GIC` genuinely is the initials of `Global Industrial
   Co`. The comparator agrees and is wrong. No in-database signal separates a
   real acronym from a coincidental one.
5. **`TINNER` is irreducible.** `Disney` in `Walt Disney Co` and `Vanguard` in
   `American Vanguard Corp` are the same string relation with opposite truths.
   Both are flagged, neither is auto-applied.
6. **`cik_tickers` is a mirror.** It is an *independent* authority, not an
   *external* one, and only as fresh as the last sync.
7. **The corpus-ambiguity test only sees companies the corpus covers.** A name
   colliding with a private or foreign company that never appears as a
   `primary_company` is invisible.

---

## 12. The two-normalizer open decision

The repo holds two normalizers and has not chosen: `normalize_lookup_key`
(`backend/normalize.py`, **stored**, what `aliases.lookup_key` holds) and
`normalize_company_key` (`backend/company_match.py:93`, **documented
"READ-ONLY. Never store this value"**).

Because the key is a **grouping axis rather than a signal**, the choice does not
change a single per-row verdict. Measured both ways, the per-row class
distribution is byte-identical. What it changes is reach:

| | v1 (stored) | v2 (read-only) |
|---|---|---|
| multi-row groups | **1** | **828** |
| rows in them | 2 | 2,239 (39.9%) |
| mentions in them | 2 | **79,238** |
| contested groups | 0 | 58 |
| single-signal rows rescued by the group check | 0 | **659** |

**The design tolerates either choice and does not force it.** Under v1 the
per-row check is unchanged and the cross-row check finds almost nothing. Under v2
the cross-row check reaches 2,239 rows and 79,238 mentions. The decision is
therefore about *coverage*, not correctness, which is a materially easier
decision than the prior design implied, where the same choice moved a hard
constraint's backlog between 1 and 499 violations.

Note the constraint question is unchanged and still hard: a unique index on the
v2 key is impossible today (828 violating groups), and v2 is currently documented
as never-store, so adopting it means changing that contract.

---

## 13. The ledger stays

Unchanged from the prior design in shape and discipline, extended with the two
fields the new check needs.

```
entity_integrity.repair_ledger
  id            bigserial primary key
  run_id        uuid        not null   -- one per check cycle
  klass         text        not null   -- the disagreement class, not an invariant id
  tier          text        not null   -- AUTO | PROPOSE | QUARANTINE | INFORMATIONAL
  table_name    text        not null
  row_id        text        not null   -- text, any pk type (0020b precedent)
  column_name   text        not null
  value_before  jsonb       not null   -- reversal source
  value_after   jsonb       not null   -- drift guard
  signals       jsonb       not null   -- NEW: every claim and its provenance axis
  coalition     jsonb       not null   -- NEW: which claims coalesced, and against what
  authority     text        not null   -- 'cik_tickers.company_name' | 'articles.primary_company'
  evidence      text        not null   -- registrant name, article support, relation, ratio
  applied_at    timestamptz not null default now()
  applied_by    text        not null default current_user
  unique (table_name, row_id, column_name, run_id)
```

Reversible in one statement per column per run:
`UPDATE <table> SET <col> = value_before WHERE id = row_id AND <col> = value_after`.
The `value_after` predicate is the drift guard from `sql/0029`: a row the pipeline
rewrote after the repair is left alone rather than clobbered. Quarantine rows are
written too, with `value_after = value_before`, which is what makes the check's
own false-positive rate measurable over time rather than argued about.

`signals` and `coalition` are new and they are the point. The prior design's
argument was that `articles_companies_backfill` row 1 was catchable **only**
because `resolved_name` was written down. The same argument applies one level up:
without recording that Ola's REG claim was sourced from a ticker that was sourced
from a fuzzy name search, a future reader re-derives the same wrong 2-to-1 vote
this design just corrected.

`financial_facts` (1.44M rows) stays out of the journal, following 0020b's
explicit one-way carve-out.

---

## 14. The order of work

Cross-signal changes **one** thing about the prior ordering and confirms the
rest.

1. **The ladder** (Track A). Unchanged, and still first. The name constraint's
   failure mode is an insert refusal, and today the miss path *creates a company*.
   Add a unique name key while the resolver still misses on
   `"Franklin BSP Realty Trust"` vs `"Franklin BSP Realty Trust, Inc."` and every
   such ingest raises 23505 on a name the resolver cannot resolve -- silently,
   because `cik_mapping.py:96` and `entity_resolver.py:434-442` swallow
   duplicate-shaped exceptions.

2. **The check, alert-only.** Unchanged in position, **cheaper to justify than
   before.** The prior design needed alert-only because three of four invariants
   fired in the hundreds on day one. This check fires 15 times at AUTO
   confidence. The baseline still matters, but the argument is now about
   confirming precision rather than about surviving an alert storm.

3. **NEW, and the one real change: fix fold surface 4 before trusting the article
   axis at scale.** The provenance guard makes the check correct *today* by
   discarding 19,384 circular tags, but it discards them rather than repairing
   them. Until `_resolve_primary_to_canonical` stops folding bare tickers onto
   whatever row holds the symbol, every wrong ticker keeps manufacturing its own
   corroborating evidence, and the check's article coverage stays artificially
   low (1,458 rows instead of the 2,707 the raw tags suggest). **This belongs
   before repair, not after**, because repair without it fixes rows whose
   evidence regenerates on the next ingest.

4. **Repair: AUTO tier, then PROPOSE tier**, both writing the ledger from the
   first row. Detach before merge, unchanged and for the unchanged reason: a
   cross-wired row still holding a CIK can win a group election it has no claim
   to. `Gett` is still the worked example.

5. **The constraints.** `sec_cik` unique (`sql/proposals/0036`, gate confirmed
   open today: 0 duplicate CIK groups) then the normalized-name unique index,
   which is reachable only after step 4 and only after the normalizer decision.

6. **One finite backfill**, last, because it is the only finite step.

`sql/proposals/0037` PHASE 0's interlock still binds: it refuses to run if any
`entity_merge` plan has an approved cluster or any `companies.merged_into`
tombstone exists.

---

## 15. Cost

The prior design costed **6.5 build-weeks**: 2 for the four invariant queries and
the alert harness, 2.5 for tiered auto-repair, 1 for the ledger, 1 for
prevention.

**Re-costed at 5.5 build-weeks.** What moved, and why:

| piece | prior | now | why |
|---|---|---|---|
| the check | 2.0 wk | **1.5 wk** | one query shape instead of four, and no per-invariant promotion harness. Cost moves *into* the comparator and the provenance guard, which is where the correctness actually lives; the throwaway implementation behind this document is ~250 lines. |
| repair | 2.5 wk | **2.0 wk** | the AUTO tier is 15 rows and its remedy is read off the matrix rather than assigned by hand. The merge path is unchanged and still depends on `0020b`. |
| ledger | 1.0 wk | **1.0 wk** | unchanged. Still the firmest estimate: a lightly extended copy of a shape that already exists twice. |
| prevention | 1.0 wk | **1.0 wk** | unchanged: 23505 handling at `cik_mapping.py:94` plus a gate at `resolveOrCreateCompany.ts:216`. |
| **fold surface 4** | -- | **NEW, folded into prevention** | not previously scoped because the circularity was not known. |

**Softest estimate: the comparator.** It is the one component whose correctness
is empirical rather than structural, it scored 26 of 28 on a deliberately hostile
probe, and every false positive found in section 9 traced back either to it or to
a provenance error rather than to the matrix.

**What a human must still do, permanently:** adjudicate the QUARANTINE tier (39
rows today: 3 `TINNER`, 5 three-way splits, 30 ambiguous names, corporate
actions); approve and apply every migration; run the 285 zero-carrier group
elections, which belong to `sql/proposals/0035`; and make the normalizer
decision, which under this design is a coverage choice rather than a correctness
one.

**What becomes automatic:** detection of *any* disagreement pattern every cycle,
including patterns nobody has enumerated, because the check tests agreement
rather than a list of known failures; retraction of a new cross-wire within one
cycle instead of one quarter; folding of single-carrier duplicate groups as they
appear; and a reversible ledger entry, with provenance, for every automatic
change.
