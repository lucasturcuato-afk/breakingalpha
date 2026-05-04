# FK Audit Results -- companies table

**Audit run:** 2026-05-04 00:00:17 UTC
**Project:** pnfjelfvtypkpnwpflmv
**Tool:** Supabase MCP (read-only)
**Purpose:** Inform the cleanup-delete decision in design doc section 7.

## Query A: FK graph pointing at companies(id)

The information_schema query in design doc section 7 returned an empty result
on this database (constraint-name join shape did not match), so the audit was
re-run against `pg_constraint` directly for an authoritative result. Both
queries were executed; only the pg_constraint query returned data.

| referencing_table | referencing_column | delete_rule | update_rule |
|-------------------|--------------------|-------------|-------------|
| company_mentions  | company_id         | NO ACTION   | NO ACTION   |

That is the complete FK graph pointing at `companies(id)` -- one FK only.

## Query B: Pollution count

`1260 companies rows would be deleted` -- based on join with `wikidata_entity_cache` where `is_company IS NULL`.

For context: those 1260 polluted companies are referenced by 2310 rows in
`company_mentions` (verified via a follow-up count). Because the FK is
`NO ACTION` rather than `CASCADE`, the companies-DELETE will fail with a
foreign key violation unless those 2310 mentions rows are deleted first.

## Query C: Top 50 polluted rows by mention_count

| name | mention_count |
|------|--------------|
| OpenAI | 190 |
| Meta Platforms Inc. | 23 |
| ConocoPhillips | 19 |
| Paramount | 18 |
| Visa | 17 |
| Cursor | 16 |
| Netflix | 16 |
| Polymarket | 15 |
| KKR | 15 |
| Reddit | 15 |
| Samsung | 14 |
| Broadcom | 13 |
| X | 13 |
| TikTok | 11 |
| Morgan Stanley | 11 |
| Alphabet Inc. | 11 |
| Exxon Mobil | 10 |
| Celestica | 10 |
| NVIDIA | 10 |
| Palantir Technologies | 10 |
| Meta Platforms | 10 |
| Kalshi | 9 |
| Amazon.com Inc. | 9 |
| Manus | 9 |
| Alibaba Group Holding Ltd. | 9 |
| Advent | 9 |
| GTCR | 9 |
| United Airlines | 8 |
| Super Micro Computer | 8 |
| Union Pacific | 8 |
| American Airlines | 8 |
| RTX | 8 |
| Samsung Electronics Co. | 7 |
| Astorg | 7 |
| Robinhood Markets | 7 |
| Carlyle | 7 |
| Apollo | 7 |
| Axios | 7 |
| Blue Owl | 7 |
| Micron | 7 |
| Allbirds | 6 |
| Norfolk Southern | 6 |
| Nasdaq | 6 |
| Google Cloud | 6 |
| TheFly | 6 |
| Spotify | 6 |
| AWS | 6 |
| SoFi | 6 |
| Yahoo | 6 |
| CoreWeave Inc. | 6 |

Important read: the top of this list is dominated by names that are
indisputably real companies (OpenAI, Meta, Visa, Netflix, NVIDIA, etc.).
They appear here because their `wikidata_entity_cache.is_company` is `NULL`
(ambiguous classification) -- not because they are wrong. After the flip,
ambiguous => drop, so these rows would be removed and re-ingested. The
re-ingest will re-classify them; whether they come back depends on whether
the classifier produces `True` (keep), `False` (drop), or `None`
(ambiguous => drop) on the next call.

This is a meaningful behavior consequence of the flip. Noah should review
this list before applying the cleanup. If a non-trivial fraction of these
are real companies that the classifier will classify as `None` again, the
cleanup is destroying legitimate data that will not come back. See the
VERDICT section below.

## Classification

| referencing_table | classification | rationale |
|-------------------|----------------|-----------|
| company_mentions  | System         | Internal cache of (article_id, company_id) extraction results; not user-owned state. Safe to delete the dependent rows. Re-populated by the ingest pipeline on the next run. |

No user-state tables (user_events, watchlist, user_briefings, user_saved_deals)
appear in the FK graph. The cascade-destroys-user-history risk that
design doc section 7 calls out does not materialize on this database.

## VERDICT

**FLAGGED** -- no user-state tables are at risk, but two issues need Noah's
attention before applying cleanup.

**Issue 1 (operational, hard blocker):** The single FK is `NO ACTION`, not
`CASCADE`. Design doc section 7 is written as if cascade behavior would
take care of `company_mentions`, but the FK does not cascade. Running the
companies-DELETE as currently described will fail with a foreign-key
violation. The cleanup migration in this PR adds an explicit
`DELETE FROM company_mentions WHERE company_id IN (...)` step (also
commented out) ahead of the companies-DELETE so Noah can run them in
order. This does not change the design doc's intent (system-table cascade
is acceptable); it just makes the cascade explicit since the FK does not
provide it.

**Issue 2 (data-loss judgment, soft flag):** The polluted set includes
extremely high-signal names (OpenAI at 190 mentions, Meta, Visa, Netflix,
NVIDIA, Alphabet, Amazon, etc.). These are in the polluted set only
because Wikidata classification returned `None` (ambiguous), not because
they are incorrect. Hard-deleting them will remove the canonical row plus
2310 `company_mentions` rows referencing them; on the next ingest the rows
will be re-created from scratch but will have lost the historical
`first_seen`, accumulated `mention_count`, `key_themes`, and `notes`
fields. Noah should decide whether (a) running the cleanup as designed is
acceptable given that history is rebuildable from articles, or (b) the
flip should ship without the bulk cleanup and let the new `is_co is True`
behavior simply prevent future pollution while leaving existing rows
alone, or (c) the cleanup should be narrowed to only delete companies
with `mention_count = 0` (pure noise) and leave anything with mentions in
place pending manual review.

The flip itself (backend/wikidata.py change) is independent of the
cleanup decision and can ship regardless.
