# XBRL universe expansion: readiness + enablement plan

Read-only recon. No code, schema, or pipeline changed. Builds on PR #413
(`docs/recon/xbrl-expansion-cost.md`). Question: what must be true before
bulk-loading the ~8k-filer universe is safe, and the concrete path to enable it
without breaking dedup or blowing SEC runtime.

Data captured 2026-06-22 against prod Supabase (SELECT only). Code read at
`origin/main` (c17ede9f).

## The decisive fact

The ~8k universe is **already staged in the database**. `cik_tickers` holds
**10,630 rows across 8,113 distinct CIKs**, synced free + static from SEC
`company_tickers.json` (`backend/scripts/backfill_sec_ciks.py:53`,
`reconcile_sec_companies.py`). Bulk-loading companies is an **in-DB
`INSERT ... SELECT` from `cik_tickers`**, not a remote crawl. That removes the
hardest part of the universe-source problem before we start.

Caveat: 10,630 rows / 8,113 CIKs means share classes (GOOG/GOOGL, BRK.A/BRK.B)
carry multiple tickers per CIK. A naive row-for-row load creates 10,630
companies for 8,113 entities — a built-in duplicate generator. Any load must
**collapse to one row per CIK** (pick a primary ticker).

---

## Readiness gates

### Gate 1 — DEDUP SAFETY: NOT MET

Current `companies` indexes (from `pg_indexes`):

```
companies_pkey         UNIQUE (id)
companies_name_key     UNIQUE (name)                       -- exact, case-sensitive
idx_companies_sec_cik  (sec_cik) WHERE sec_cik IS NOT NULL -- NON-unique, partial
```

- No unique constraint on `sec_cik` -> 779 distinct CIKs sit behind 1,016
  CIK-rows today (237 dup-CIK rows already exist).
- `UNIQUE(name)` is exact and case-sensitive, so case/whitespace variants slip
  through (the resolver recon noted ~69% of dupes are case-only).

**Needed before any bulk-load (ordered):**
1. Clean existing duplicates first. A unique index **cannot be created while
   duplicates exist** — the 237 dup-CIK rows and case-variant name dupes must be
   merged/collapsed first.
2. `CREATE UNIQUE INDEX CONCURRENTLY companies_sec_cik_uniq ON companies (sec_cik) WHERE sec_cik IS NOT NULL;`
3. Optional hardening: `CREATE UNIQUE INDEX companies_name_lower_uniq ON companies (lower(btrim(name)));`
   (also blocked until case-variant dupes are merged).
4. Idempotent bulk-load shape, once the unique CIK index exists:
   `INSERT INTO companies (name, ticker, sec_cik) SELECT DISTINCT ON (cik) ... FROM cik_tickers ... ON CONFLICT (sec_cik) WHERE sec_cik IS NOT NULL DO NOTHING;`
   The `ON CONFLICT (sec_cik)` is what makes re-running the load safe and makes
   CIK the identity key.

### Gate 2 — CIK AT MINT: NOT MET

Mint path `entity_resolver._insert_company` (`backend/entity_resolver.py:375-414`)
inserts only:

```python
payload = {
    "name": name,
    "key_themes": themes or [],
    "sentiment_trend": sentiment,
    "mention_count": 0,
}
# ON CONFLICT (name) DO NOTHING
# best-effort ticker via Finnhub (gated to mention_count >= 2, so effectively
# no ticker on fresh rows). NO sec_cik written.
```

Minted rows have `sec_cik = NULL`, so they are excluded from `get_xbrl_ciks`
(`WHERE sec_cik IS NOT NULL`) forever.

**Change to converge minted + bulk-loaded rows on CIK identity:** at mint,
resolve `ticker -> CIK against `cik_tickers` (already in-DB — **no SEC call
needed**) and write `sec_cik`; switch the conflict target to `sec_cik` once the
unique index exists. Then a minted "Apple" and a bulk-loaded "Apple Inc." land
on the same CIK row instead of forking.

### Gate 3 — RUNTIME BUDGET: NOT MET (for one daily job)

XBRL already has a **dedicated** workflow (`.github/workflows/xbrl.yml`, daily
`0 10 * * *`, `timeout-minutes: 120`) separate from the main pipeline
(`schedule.yml`, 90 min) and hourly EDGAR (`edgar_ingestion.yml`, 20 min). So
the question is only whether that XBRL job can absorb 8k CIKs/day.

It cannot as-is. Per #413: ~5 s/CIK -> **8-11 h/day** at full universe, which
exceeds both the 120-min cap and the Actions 6-h per-job hard ceiling. The
single biggest lever is the **cross-endpoint validation** (~18 SEC calls/CIK):

| Refresh design | Per-CIK SEC calls | 8k-universe runtime/day | Fits Actions? |
|---|---|---|---|
| Current (cross-endpoint ON, all daily) | ~18 | 8-11 h | No (>6 h job cap) |
| Cross-endpoint sampled/off, all daily | ~1-2 | ~25-55 min | Yes |
| **Tiered**: hot set daily + long-tail weekly | ~18 | hot ~1 h/day, tail spread | Yes |
| Sliced matrix (N parallel jobs by CIK range) | ~18 | 8-11 h / N | Yes if N>=5 |

Recommended framing (not a decision): **tiered refresh** (covered/high-mention
set daily, long-tail weekly) and/or **relax cross-endpoint validation to
sampling** are the two enablers. Tiering also matches product value — recruiting
students look up recognizable names far more than the long tail.

### Gate 4 — UNIVERSE SOURCE: MET

- Source: SEC `https://www.sec.gov/files/company_tickers.json` — **free, static,
  no per-call $**. Already wired (`backfill_sec_ciks.py`, `reconcile_sec_companies.py`).
- Already materialized in `cik_tickers`: **10,630 rows / 8,113 distinct CIKs**.
- Minimal company row a load needs: `name`, `ticker`, `sec_cik` (CIK). Everything
  else (`mention_count`, `key_themes`, sectors, fundamentals) fills in via the
  existing refresh + pipeline.

---

## Enablement options (tradeoffs, not a recommendation)

All assume Gate 1 (dedup guard) is closed first — non-negotiable for every option.

### A — Bulk-load all 8,113 CIKs now, refresh fills fundamentals

| Dimension | Value |
|---|---|
| Cost | $0 Gemini; ~$1/mo Supabase at steady state |
| Dedup risk | High if guard skipped; LOW once unique-CIK + collapse-by-CIK in place |
| Time-to-coverage | Rows instant (in-DB INSERT...SELECT); fundamentals over the 8-11 h/day steady-state, days-to-weeks to fully fill unless runtime is fixed |
| Table size | `companies` +~8k rows (trivial); `financial_facts` -> ~10 GB / ~17M rows as it fills |
| Refresh runtime | Forces the Gate-3 problem immediately: 8-11 h/day unless tiered/validation-relaxed |

### B — Lazy / on-demand only (mint-with-CIK), zero backfill

| Dimension | Value |
|---|---|
| Cost | $0 Gemini; storage grows only with looked-up names |
| Dedup risk | LOW (one CIK resolved per mint, ON CONFLICT (sec_cik)) — but still needs the unique-CIK guard to be safe |
| Time-to-coverage | Only what users actually request; cold-start gap on first lookup of a new name |
| Table size | Smallest; tracks real demand |
| Refresh runtime | Stays near today's (45-73 min); universe grows slowly, never spikes |

### C — Tiered: curated bulk-load + lazy-mint the tail

| Dimension | Value |
|---|---|
| Cost | $0 Gemini; ~$0.50/mo Supabase (curated set is a fraction of 8k) |
| Dedup risk | LOW (same guard; curated set is small and clean) |
| Time-to-coverage | Recognizable names (S&P 500 + large-cap foreign, ~600-1k CIKs, mostly already covered) ready immediately; long tail fills on demand |
| Table size | Moderate; bounded by curation + actual demand |
| Refresh runtime | Hot set daily fits the 120-min cap; tail enters only when minted, so runtime never spikes |

---

## Bottom line

The expensive part is already done: the 8,113-CIK universe is staged in
`cik_tickers`, free and static, so a load is an in-DB `INSERT ... SELECT`, not a
crawl. Two gates block safety and one blocks scale. **Ordered prerequisites:**
(1) clean the existing 237 dup-CIK + case-variant name dupes, then add
`UNIQUE(sec_cik)` (and ideally `UNIQUE(lower(name))`) — without this any load
multiplies duplicates, made worse by share-class rows (10,630 tickers for 8,113
CIKs); (2) collapse-to-one-row-per-CIK + `ON CONFLICT (sec_cik)` upsert so the
load is idempotent; (3) write `sec_cik` at mint by resolving against
`cik_tickers` (no SEC call), converging minted and bulk rows on CIK identity;
(4) fix the refresh runtime — tier it (hot daily / long-tail weekly) or sample
the cross-endpoint validation (~18 -> ~2 calls/CIK drops 8-11 h to under an
hour) before the universe is large enough to blow the 120-min cap.

**Best-fit path for a recruiting-student product on a Gemini-dominated budget:
Option C (tiered).** XBRL adds $0 to the Gemini bill regardless, so cost is not
the constraint — runtime and dedup integrity are. A curated bulk-load of
recognizable names (most already covered) gives instant value for the names
students actually search, while lazy mint-with-CIK grows the tail on real demand
without ever spiking the refresh window. It closes the same dedup gates as A but
defers the Gate-3 runtime cliff instead of walking into it on day one. Option A
becomes attractive only after the refresh runtime is fixed; Option B alone
leaves a cold-start gap on first lookups that C avoids for the high-value set.

---

## VERIFY

- **Files changed:** only `docs/recon/xbrl-universe-readiness.md`. Zero other
  files touched. No protected files edited.
- **DB access:** read-only. `count(*)`, `count(DISTINCT ...)`, `pg_indexes`
  only. No INSERT/UPDATE/DELETE/DDL, no migration, no pipeline run.
- **Indexes quoted from source:** `companies` and `cik_tickers` index defs
  pulled verbatim from `pg_indexes`. Mint path quoted from
  `backend/entity_resolver.py:375-414`.
- **Options costed against #413:** $0 Gemini, ~$1/mo Supabase, ~10 GB / ~17M
  rows, ~5 s/CIK -> 8-11 h/day, 6-h Actions job ceiling — all carried from
  PR #413's measured numbers.
- **New measured facts:** `cik_tickers` = 10,630 rows / 8,113 distinct CIKs
  (universe already staged); `companies` = 4,175 rows / 779 distinct CIKs;
  `sec_cik` index confirmed NON-unique.
