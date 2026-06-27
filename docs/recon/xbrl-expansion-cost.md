# XBRL financial-facts coverage: pricing full-universe expansion

Read-only recon. No code, schema, or pipeline changed. Goal: price expanding
XBRL coverage from current state to "every public company," and settle whether
the coverage gap is a refresh bug or reality.

Data captured 2026-06-22 against prod Supabase (SELECT only) and live
data.sec.gov. Code read at `origin/main` (c17ede9f).

## Headline correction

The brief's premise — "~505 of ~1,016 CIK rows covered" — is **wrong/stale**.
True coverage:

- **651 of 779 distinct CIKs have facts (84%).** 128 distinct CIKs uncovered.
- At the company-row level: 867 of 1,016 rows resolve to a CIK with facts.
- The "1,016" counts *rows* with a `sec_cik`; there are only **779 distinct
  CIKs** behind them (237 duplicate-CIK rows — see Sequencing risks).

The refresh is not stuck. The 16% gap is structural, not a bug. Details below.

---

## RECON 1 — Coverage truth

Counts (read-only SELECT, prod):

| Metric | Value |
|---|---|
| `companies` total rows | 4,175 |
| rows with `sec_cik` | 1,016 |
| rows with `ticker` | 1,197 |
| **distinct `sec_cik`** | **779** |
| duplicate-CIK row overhead | 237 rows |
| `financial_facts` rows | ~1.38M |
| `financial_facts` size (table + indexes) | 833 MB |
| distinct CIKs with facts | **651 / 779 (84%)** |
| no-facts distinct CIKs | 128 |

Only 1,016 of 4,175 companies even carry a CIK; XBRL only targets those. The
real reach toward "every public company" is gated first by CIK population
(3,159 companies have no CIK at all), then by XBRL availability for the CIKs we
do have.

### Bucketing the 128-CIK gap (sampled head + tail, checked against live SEC)

Both the high-mention head and the low-mention tail of the no-facts set are
**overwhelmingly foreign private issuers and private/shell entities** — not
ordinary domestic 10-K filers. That alone disconfirms a timeout-tail bug (a
timeout would leave plain domestic filers uncovered; instead both ends are
foreign/private). Live `data.sec.gov/companyfacts` checks split the gap into
three buckets:

**(c) us-gaap filers excluded by the form filter — FIXABLE in code.**
ASML, Alibaba, Arm, NIO (verified HTTP 200 with `facts.us-gaap`), plus Grab,
Spotify, Orix, SMFG, Canadian Solar. These file **20-F / 40-F**, and their
entire us-gaap history is tagged `form: "20-F"` (verified directly for ASML:
`Assets` and `NetIncomeLoss` carry only `20-F`/`20-F/A`). The extractor's
`XBRL_FORMS = {"10-K","10-Q","10-K/A","10-Q/A"}` drops every one of these facts
(`xbrl_facts.py:152`). They have the data; we throw it away. Adding `20-F`,
`40-F` to `XBRL_FORMS` recovers this bucket — the single highest-leverage fix.

**(b) IFRS-only filers — out of scope for the us-gaap extractor.**
Novo Nordisk (verified `facts.ifrs-full`, no us-gaap), RELX, and peers. The
extractor reads only `facts["us-gaap"]` (`xbrl_facts.py:657`). Covering these
needs an IFRS taxonomy path, not just a form-filter change. Reality given
current scope; expandable later.

**(a) Genuinely private / Form-D / shells — uncoverable, reality.**
SpaceX (CIK 1181412: companyfacts returns only `ffd` — Form D Reg-D facts, no
financials), Quantinuum, EagleRock Land LLC, Plutonian Acquisition Corp. No
structured financial XBRL exists. Permanently uncoverable.

---

## RECON 2 — Why the refresh is "stuck" (it isn't)

### `get_xbrl_ciks` is uncapped and reaches everyone

`backend/edgar/submissions.py:80-127`. Selection, quoted:

```python
rows = (
    sb.table("companies")
    .select("id, ticker, sec_cik, name")
    .not_.is_("sec_cik", "null")
    .order("mention_count", desc=True)
    .order("id")
    .range(page * page_size, (page + 1) * page_size - 1)   # page_size = 1000
    .execute()
    .data or []
)
...
if len(rows) < page_size:
    break
page += 1
```

No `.limit()`, no slice, no short-circuit. Only filter is `sec_cik IS NOT NULL`;
dedups by CIK into a `seen` set. It returns **779 distinct CIKs** — which
matches `ciks_processed = 779` on the latest run exactly. The resolver reaches
every CIK we have.

The per-CIK loop in `ingest_xbrl_facts.py:76-83` wraps `_process_cik` in
try/except and only increments an `errors` counter on failure — it never breaks
the loop. `fetch_company_facts` returns `None` on 404/no-XBRL, so non-filers are
silently skipped, not retried into a hang.

### The workflow completes; it does not time out

`.github/workflows/xbrl.yml`: daily cron `0 10 * * *`, `timeout-minutes: 120`,
one run processes the full target list. `pipeline_runs` evidence:

| Run | ciks_processed | duration | status |
|---|---|---|---|
| 06-22 | 779 | 4,391 s (73 min) | partial (errors: 1) |
| 06-21 | 557 | 2,696 s (45 min) | success |
| 06-18..20 | 557 | ~3,000 s (~50 min) | success |

`pipeline_runs` is written **after** the loop finishes (`ingest_xbrl_facts.py:86`),
so each row is a clean completion, not a timeout kill. Runs finish in 45-73 min,
well under the 120-min cap. The jump 557 -> 779 is the CIK universe growing (more
companies got CIKs), not a coverage regression.

**Conclusion: not stuck.** The 84% ceiling is the structural buckets above, not
a refresh fault.

### The cost driver to flag for scaling

`validate_facts` runs a cross-endpoint check (`xbrl_validation.py:276-316`) that
fetches the Company Concept endpoint **once per distinct (taxonomy, tag)** per
CIK. The v1 vocabulary is ~24 concept tags, so a typical CIK costs
**1 companyfacts fetch + ~15-22 concept fetches ≈ ~18 SEC calls**. At 5 req/s
(client paces 0.2 s, `client.py:14`) that is the dominant per-CIK cost and the
real wall at universe scale (see RECON 3).

---

## RECON 3 — Universe + backfill cost

### Addressable universe

US SEC filers with us-gaap companyfacts: **~8,000-10,000** (SEC
`company_tickers.json` lists ~10k tickers; those with us-gaap XBRL ≈ 8k). Source
is **free** `data.sec.gov`, 10 req/s limit (we pace at 5). **No per-call $.**

### Backfill runtime

Observed: 779 CIKs / 4,391 s = 5.6 s/CIK; 557 / 2,696 s = 4.8 s/CIK -> **~5 s/CIK**.

- Full universe ~8,000 CIKs x 5 s ≈ **40,000 s ≈ 11 hours** single-threaded.
- Pure rate-limit floor: ~18 calls/CIK x 8,000 = 144k calls at 5 req/s =
  28,800 s = 8 h. Realistic backfill: **11-15 h**.

### GitHub Actions exposure

- Per-job hard ceiling is 6 h (Actions limit); workflow caps at 120 min. A
  11-15 h backfill must be **sliced into ~6-8 runs** via `--max-ciks` rotation,
  or the cadence reworked.
- Minutes: 11-15 h = **660-900 min**, ≈ ⅓ to ½ of the 2,000 free private-repo
  minutes/month, consumed once. Public repo = unlimited. **Flag this.**
- **Steady-state daily refresh of 8k CIKs ≈ 8-11 h/day** — blows the 120-min
  window and approaches a full day. This is the true scaling wall, driven by the
  cross-endpoint validation. Mitigation before scaling: sample/relax the
  cross-endpoint check, or move from full daily refresh to per-filing
  triggering.

### Supabase storage delta

833 MB / 651 CIKs = **1.28 MB/CIK** (~2,120 fact rows/CIK, full history).

- Universe 8,000 x 1.28 MB ≈ **~10 GB** total (table + indexes), ~17M rows.
- **Bounded**: filing history per company is finite; grows only with new
  quarters.
- Supabase Pro includes 8 GB, then $0.125/GB -> **~$0.30-1.50/mo** overage.
  Negligible.

### Gemini cost — traced, not assumed

Grepped the entire ingest path — `ingest_xbrl_facts.py`, `edgar/xbrl_facts.py`,
`edgar/xbrl_validation.py` — for `genai|gemini|generativeai|llm|anthropic|openai`:
**zero matches.** Extraction is a deterministic JSON parse + arithmetic;
validation is a second deterministic SEC fetch and dollar-compare. **Expanding
XBRL does not touch the Gemini bill at all — $0 on the LLM axis at any scale.**

### Cost table

| Axis | Current (651/779 CIK) | Full universe (~8k) | Notes |
|---|---|---|---|
| Gemini $ | $0 | **$0** | No LLM in path; deterministic parse |
| SEC runtime | ~5 s/CIK, 45-73 min/run | ~11-15 h backfill; **8-11 h/day steady** | ~18 calls/CIK (cross-endpoint) is the driver and the wall |
| GitHub Actions | 1 run/day, <120 min | 6-8 sliced backfill runs; 660-900 min | ⅓-½ of free monthly minutes once; daily steady exceeds 120-min window |
| Supabase storage | 833 MB | ~10 GB / ~17M rows | Bounded; ~$0.30-1.50/mo on Pro |

---

## RECON 4 — Sequencing risks

### Minted companies never get XBRL

`entity_resolver._insert_company` (`backend/entity_resolver.py:379-388`) inserts
`name`, `key_themes`, `sentiment_trend`, `mention_count`, then best-effort
`ticker` (Finnhub). It sets **no `sec_cik`**. `get_xbrl_ciks` filters
`sec_cik IS NOT NULL`, so minted companies are excluded forever.

**Prerequisite for minted-company fundamentals:** resolve and store the CIK in
the mint path (ticker -> CIK via SEC `company_tickers.json`) when the row is
created.

### Bulk-loading the universe re-creates the duplicate problem

`companies` indexes (from `pg_indexes`):

- `companies_name_key` — UNIQUE on `name`, but **exact and case-sensitive**, so
  case/whitespace variants slip through (live state: 779 distinct CIKs behind
  1,016 CIK-rows = 237 dup-CIK rows; ~3,396 total duplicate-row overhead).
- `idx_companies_sec_cik` — **non-unique** partial index. Multiple company rows
  can (and do) share one CIK.

Bulk-loading ~8k SEC entities without (a) a **UNIQUE constraint on `sec_cik`**
and (b) **normalized-name canonicalization** would re-create tonight's duplicate
problem at 8x scale. **Guard required before any universe bulk-load.**

---

## Bottom line

The 505 figure is wrong: true coverage is **651/779 distinct CIKs (84%)**, and
the 16% gap is **not a refresh bug**. `get_xbrl_ciks` is uncapped, reaches all
779 CIKs, and the daily job completes cleanly in 45-73 min — well under its
120-min cap. The 128 uncovered CIKs are structural: foreign **20-F/40-F filers
that have us-gaap facts but are dropped by the `XBRL_FORMS` filter** (fixable —
add 20-F/40-F, the single highest-leverage change), **IFRS-only filers** outside
the us-gaap extractor (Novo), and **genuinely private/shell entities** (SpaceX
files only Form D). Full-universe coverage (~8k filers) costs **$0 in Gemini**
(deterministic parse, verified by grep), **~10 GB Supabase** (~$1/mo, bounded),
and the only real wall is **SEC-rate-limited runtime**: the per-CIK
cross-endpoint validation (~18 calls/CIK) pushes a full daily refresh to
8-11 h, which blows the 120-min window — so scaling requires sampling/relaxing
that validation or moving to per-filing triggering, plus a **unique-CIK +
normalized-name guard** before bulk-loading and a **CIK-at-mint** change so
minted companies ever get fundamentals.

---

## VERIFY

- **Files changed:** only `docs/recon/xbrl-expansion-cost.md` (this file). Zero
  other files touched. No protected files edited.
- **DB access:** read-only. SELECT, `pg_indexes`, `pg_class`,
  `pg_total_relation_size` only. No INSERT/UPDATE/DELETE/DDL, no migration, no
  pipeline run.
- **`get_xbrl_ciks` selection/cap:** quoted verbatim from
  `submissions.py:99-123`. Uncapped, paged `.range()`, only filter
  `sec_cik IS NOT NULL`. Returns 779 distinct CIKs = `ciks_processed` on the
  latest run.
- **Gemini-cost claim:** traced by grep over the full ingest path (zero
  `genai|gemini|llm|...` matches), not assumed.
- **128-CIK gap bucketed against live SEC:** verified HTTP 200 + taxonomy for
  ASML (us-gaap, 20-F forms), Novo (ifrs), Alibaba/Arm/NIO (us-gaap), SpaceX
  (ffd/Form-D only). Both head and tail of the no-facts set sampled.
