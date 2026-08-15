# Proposal: an SEC-backed mint path for the cluster-6 residual

Status: **DESIGN ONLY. Nothing built, nothing run, no code in this branch
implements it.** Written at Lucas's request alongside the primary_company fold
resolution fix.

Companion: `scratch/A-primary-company-fold-failure.md` (the diagnosis),
`backend/company_match.py` (the fold resolution this proposal does NOT change).

---

## 1. The problem this addresses, and the problem it does not

The fold resolution fix reaches a primary_company through four surfaces: exact
name, case-insensitive name, `aliases.lookup_key`, `companies.ticker`, and the
suffix/punctuation-normalized form. All five require the company **to already
be in the index**.

Cluster 6 of the diagnosis is the population where it is not: 12,656 rows over
4,102 distinct names, 48.1% of bucket D. The diagnosis established that this is
not mostly private companies. It is led by public mid- and large-caps:
MicroStrategy (179 rows), GE Aerospace (138), Howmet Aerospace (100), Blue Owl
Capital (83), Truist Financial (79), Rigetti Computing (69).

No amount of matching cleverness fixes this. There is nothing to match against.
The name was never minted, because per section 1.1 of the diagnosis a name
enters `companies` only by surviving as a member of some article's
`companies[]`, which requires passing the Wikidata gate, and the gate is exactly
what dropped it.

**This proposal is the only way to close cluster 6 without loosening the
Wikidata gate.**

## 2. Why this is not fabrication

The constraint given was: do not fabricate entity rows for names you cannot
actually resolve. That constraint is about inventing an entity from a string.

This proposal inverts the direction. It does not guess that "GE Aerospace" is a
company. It looks the name up in **SEC EDGAR's `company_tickers.json`**, the
authoritative registry of every issuer with a CIK and a ticker, and mints only
on an exact hit. The provenance is a government filing identifier, not an
inference. A row minted this way carries a `sec_cik`, which is a stronger
identity claim than most rows currently in `companies`: only 792 of 5,352
existing rows have one.

The project already trusts this source. `backend/entity_resolver.py` has
`lookup_cik_for_ticker` and `populate_sec_cik_for_mint`, and
`backend/ingest_sec.py` ingests EDGAR filings directly. This would reuse the
same authority, not introduce a new one.

## 3. Mechanism

**Source.** `https://www.sec.gov/files/company_tickers.json`, roughly 10,000
issuers, each `{cik_str, ticker, title}`. Fetched on a schedule, not per
article. Requires the EDGAR User-Agent header, and per the existing pipeline
note in CLAUDE.md, SEC fetches can 403 and hang, so the existing timeouts apply.

**Trigger.** A name reaches the mint path only when it has already failed every
resolution surface, so this runs on the residual and nothing else. It never
competes with the existing resolver.

**Matching rule.** The candidate `primary_company` must match an EDGAR `title`
under `normalize_company_key` (the same read-only key the fold uses), and that
normalized title must be **unique** in the EDGAR set. Ambiguity fails closed,
exactly as the fold does.

**What gets written.** One `companies` row with `name` set to the EDGAR title,
`ticker`, and `sec_cik`, plus one `aliases` row keyed on the observed surface
form. Both carry a provenance marker (see section 5) so an SEC-minted row is
never confused with a Wikidata-validated one.

**What does NOT change.** The Wikidata gate is untouched. `clean_companies` is
untouched. `company_mentions` and `mention_count` are untouched, preserving the
HARD FREEZE that the fold already respects. This only adds rows to the index
that the fold can then legitimately resolve against.

## 4. Ordering constraint, and why it is the dangerous part

`sql/proposals/0020_normalize_lookup_key_v2.sql` records that the alias miss
path **creates a company**, and that deploying v2 keys against a v1-keyed table
turns 2,172 alias lookups into misses. A mint path that writes alias rows
inherits that hazard directly.

Therefore, in order:

1. Apply the 0020 merge, or explicitly decide not to.
2. Only then build this.

Minting against a table with 677 known duplicate clusters would add rows to an
index that is about to be merged, and the merge would then have to arbitrate
between a Wikidata-minted row and an SEC-minted row for the same company. That
is a worse problem than the one being solved.

**Recommendation: do not build this until 0020 is resolved.**

## 5. Provenance, because this changes what `companies` means

Today `companies` membership implies "passed the Wikidata gate". Adding a
second mint path silently breaks that invariant for every downstream reader.

So the mint path must carry a marker: a `mint_source` column
(`wikidata` | `sec_edgar`), defaulting to NULL for the existing 5,352 rows,
which stay honestly unlabelled rather than being back-filled with an assumption.
Same discipline as `relevance_grade_source` in the observability work.

Rough shape, not a migration:

```sql
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS mint_source text;
```

Any consumer that depends on the Wikidata guarantee then filters on it.
Identifying those consumers is a prerequisite, not a follow-up.

## 6. Expected yield, and how to verify before building

The residual measured by `tools/primary_fold_eval.py` is the exact input set.
Before writing any mint code, the cheap test is offline and read-only:

1. Fetch `company_tickers.json`.
2. Normalize every EDGAR title with `normalize_company_key`.
3. Intersect with the residual names from the eval tool.
4. Report: how many residual ROWS are covered, how many names hit ambiguously,
   and how many remain uncovered (genuinely private or non-registrant).

That yields the real number this work would buy. **It should gate the decision.**
My expectation is that it covers most of the named public mid-caps and none of
the genuinely private companies, but that is a prediction, not a measurement,
and it should not be treated as one.

## 7. Risks

- **Registrant is not the same as the article's subject.** EDGAR titles are
  legal registrant names. "Alphabet Inc." is the registrant; articles say
  "Google". The alias row is what absorbs this, and it means the mint path
  makes the alias table more load-bearing, not less.
- **Ticker reuse across delistings.** A recycled symbol can point at a defunct
  issuer. Matching on normalized title rather than ticker alone mitigates this;
  ticker is written as an attribute, not used as the match key.
- **Index growth.** Roughly 10,000 EDGAR issuers against 5,352 existing rows.
  Minting only on demand, from the residual, bounds this to names actually
  observed in articles.
- **It legitimizes a second writer to `companies`.** Today there is exactly one
  live insert path, which is a real asset for reasoning about the table. This
  proposal spends that. It should be spent knowingly.

## 8. Recommendation

Build it only if, in this order: (a) the section 6 offline coverage test shows
the yield is worth it, (b) 0020 is resolved first, and (c) the provenance
column and its consumers are agreed before any row is written.

Otherwise the fold resolution fix stands on its own, and cluster 6 stays a
known, measured, reported gap rather than an invisible one.
