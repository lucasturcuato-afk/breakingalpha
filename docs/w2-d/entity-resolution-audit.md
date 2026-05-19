# Entity Resolution Audit -- W2-D Thread C

Scope: WD72, WD61, WD62, WD64, WD03, WD06, WD26, WD60.
Status: READ-ONLY recon. No SQL has been executed against the database; every SQL block below is a recommendation to be reviewed and applied by a write-capable thread.
Run date: 2026-05-11.

## Headline counts

- 3,001 rows in `companies`. 974 (32.5 percent) have a non-null `ticker`. 747 have `mention_count > 1`. 165 have `mention_count > 5`.
- 8,236 rows in `articles`. 4,127 have non-null `primary_company`; **0** of those are UUID-shaped (Section 4 -- WD64).
- Duplicate-name clusters (case + punctuation insensitive): 100+ clusters; top single bucket is the empty-string slug at 220 rows (Section 1).
- Ticker-collision clusters (multiple companies sharing one ticker): 100+ clusters; worst offenders carry 7 (TSM), 6 (NVDA), 5 (AMD, TSLA, PSKY, SMCI, WBD).
- Confirmed misclassified rows (descriptors, parentheticals, "no specific company mentioned"): 17 (Section 2).
- Confirmed business-segment-as-company rows: 4 (AWS, Facebook, Instagram, TikTok -- Section 3).
- Anti-pattern token-fragment rows with wrong tickers: 10+ (Section 6 -- WD06).

---

## Section 1 -- Duplicate clusters (WD72)

Two duplicate signals were measured:

1. Name-slug duplicates (`lower(regexp_replace(name,'[^a-z0-9]','','g'))`).
2. Ticker collisions (rows sharing one ticker via aliasResolver, or via different canonical phrasings).

### 1.1 Name-slug duplicate clusters (top representative rows)

| Slug | Count | Sample names | Action |
|---|---|---|---|
| `(empty)` | 220 | HGGC, KBW, IOCL, YPF, ABC, MSTR, TSLA, ... | Names that strip to nothing under the regex (all-uppercase, short, or punctuation-only). Not a true duplicate cluster -- false positive of the metric. Treat as separate rows. |
| `advancedicroevicesnc` | 4 | Advanced Micro Devices Inc/Inc./(AMD)/, Inc. | Merge into canonical AMD row (`75d78915-8d2f-4058-a653-11aa35403e53`). |
| `taiwanemiconductormanufacturingcompanyimited` | 2 + 5 others | TSMC / Taiwan Semiconductor / TSM (TSM) variants | Merge 7 TSM-ticker rows into TSMC (`fc7a1b64-5d1a-4d60-875b-db46da7954af`, mention_count 26). |
| `eslanc` + `esla` | 3 + 2 | Tesla Inc / Tesla, Inc. / Tesla Inc.; Tesla / Tesla (TSLA) | Merge 5 TSLA-ticker rows. |
| `etflixnc` | 2 | Netflix, Inc. / Netflix Inc. | Merge with `Netflix` (`070a8fdb-...`, 16 mentions). |
| `etalatformsnc` | 2 | Meta Platforms Inc. / Meta Platforms, Inc. | Merge into `Meta` canonical. |
| `pplenc` | 2 | Apple Inc. / Apple Inc | Merge into `Apple` (`ab7a1328-...`). |
| `oeingo` | 2 | Boeing Co / Boeing Co. | Merge into `Boeing` (`94cb9ef8-...`). |
| `eevaystemsnc` | 2 | Veeva Systems Inc. / Veeva Systems Inc | Merge into `Veeva` (`8996442a-...`). |
| `paceobilenc` | 3 | AST SpaceMobile Inc / Inc. / , Inc. | Merge into `AST SpaceMobile` (`0fb29d1b-...`). |
| `iotlatformsnc` | 2 + others | Riot Platforms Inc / Inc. / RIOT Platforms | 4 rows total under ticker RIOT. |
| `oiechnologiesnc` | 2 | SoFi Technologies Inc. / Inc., Inc. | 4 rows total under ticker SOFI. |
| `obinhoodarketsnc` | 2 | Robinhood Markets Inc. / , Inc. | 4 rows total under ticker HOOD. |
| `nthropic` | 2 | Anthropic / Anthropic PBC | Merge -- canonical row is `80ab72f5-...` (204 mentions, ticker null since private). |
| `xxonobil` | 2 | ExxonMobil / Exxon Mobil | Treated under WD60 (Section 7). |
| `organhase` + `organhaseo` + `organ` | 2 + 2 + 3 | JPMorganChase / JPMorgan Chase / JPMorgan Chase & Co + variants | Treated under WD60 (Section 7). |
| `arnerrosiscovery` | 3 | WBD (Warner Bros Discovery) / Warner Bros Discovery / Warner Bros. Discovery | Merge under ticker WBD. |
| `irius` | 2 | Sirius XM / SiriusXM | Merge. |
| `iemens` | 2 | Siemens / Siemens AG | Merge into `Siemens` (`0fd2327e-...`). |
| `oodysatings` | 2 | Moody's Ratings / Moody's Ratings | Same name -- one row uses curly apostrophe, one uses straight. Unicode-normalize and merge. |
| `evercore` | 2 | Evercore / Evercore ISI | Decision call: `Evercore ISI` is a research brand; merge if both refer to the same publicly-traded entity (EVR). |
| `irmaerkonehitus` | 2 | AS Merko Ehitus / Merko Ehitus | Merge. |
| `nio` (under `io` slug) | 2 | Nio / NIO | Merge. |
| `juno`/`suno` (`uno`) | 2 | Juno / Suno | NOT a duplicate -- different companies. Slug collision only. Flag as false positive. |

Full list (220+ slug clusters) attached to the audit query output. **Decision criterion**: collapse only when (a) tickers match, OR (b) both rows are tickerless and name slugs match after Unicode + suffix normalization, OR (c) one row is verifiably a legal-suffix variant of the other.

### 1.2 Ticker-collision clusters (high-impact merges)

| Ticker | Cluster size | Canonical row (keep) | Other rows (merge in) | Notes |
|---|---|---|---|---|
| TSM | 7 | TSMC `fc7a1b64-...` (26 mentions) | Taiwan Semiconductor x6 | High volume, do first. |
| NVDA | 6 | NVIDIA `c2ecc62c-...` | Nvidia / NVIDIA Corp / Corporation / etc. x5 | All same entity. |
| AMD | 5 | AMD `75d78915-...` | Advanced Micro Devices x4 + "Advanced Micro" (fragment, see WD06) | One row is the fragment "Advanced Micro" -- delete or merge mention. |
| TSLA | 5 | Tesla `02bd75c3-...` | Tesla Inc / Inc. / TSLA / , Inc. / (TSLA) | "TSLA" name row is a slug artifact (see WD61 row id `a8843c0a-...`). |
| PSKY | 5 | Paramount Skydance | Paramount / Skydance / variants | Skydance + Paramount merged in real life. |
| SMCI | 5 | Super Micro Computer | Super Micro / variants + fragment | |
| WBD | 5 | Warner Bros. Discovery | Warner Bros / Warner Bros. / WBD / **Cove** (fragment, WD06) | "Cove" should NOT carry ticker WBD -- bug. |
| RIOT | 4 | Riot Platforms | variants | |
| META | 4 | Meta | Meta Platforms / Inc / Inc. | |
| GD | 4 | General Dynamics | variants + **AMI** (fragment, WD06) | "AMI" row should NOT carry ticker GD. |
| RTX | 4 | RTX (`577bcdf9-...`) | Raytheon / RTX Corporation / RTX Corp | Cross-ref WD06 -- backfill made these match. |
| UNH | 4 | UnitedHealth Group | UnitedHealth / **Uni** / **United** (fragments, WD06) | Two fragments share ticker UNH. |
| DELL | 4 | Dell Technologies | Dell / Dell Tech / Inc. | |
| ASTS | 4 | AST SpaceMobile | + 3 Inc-suffix variants | |
| VEEV | 4 | Veeva Systems | Veeva / Inc / Inc. | |
| MU | 4 | Micron Technology | + Inc/Inc. variants + "Micron" | |
| NCLH | 4 | Norwegian Cruise Line Holdings | + 3 short variants | |
| NOC | 4 | Northrop Grumman | + Northrop + NOC + Corporation | |
| SOFI | 4 | SoFi Technologies | + 3 Inc variants | |
| EBAY | 4 | eBay | + Inc. variants (Cases differ) | |
| JPM | 4 | JPMorgan Chase & Co. | JPMorgan / JPMorgan Chase / & Co | See Section 7. |
| SPGI | 4 | S&P Global | + 3 variants incl. S&P Global Ratings (questionable) | "Ratings" is a sub-brand; verify whether it should be split. |
| BA | 4 | Boeing | BOEING CO / Boeing Co / Co. | |
| SSNLF | 4 | Samsung | + 3 Electronics variants | |
| CAT | 4 | Caterpillar | + Inc/Inc. + **Pillar** (fragment, WD06) | "Pillar" should NOT carry ticker CAT. |
| HOOD | 4 | Robinhood | + 3 Markets variants | |

### 1.3 Recommended merge SQL skeleton (NOT EXECUTED)

For each cluster, the merge requires three steps:

```sql
-- 1. Repoint article references from duplicate name to canonical.
--    NOTE: articles.companies is text[]; primary_company is text (see Section 4).
--    Repointing must touch BOTH array entries AND primary_company.
UPDATE articles
SET    companies = array_replace(companies, '<duplicate_name>', '<canonical_name>')
WHERE  '<duplicate_name>' = ANY(companies);

UPDATE articles
SET    primary_company = '<canonical_name>'
WHERE  primary_company = '<duplicate_name>';

-- 2. Roll up mention_count and merge key_themes.
UPDATE companies
SET    mention_count = mention_count + (SELECT mention_count FROM companies WHERE id = '<duplicate_id>'),
       key_themes = (
         SELECT array_agg(DISTINCT t) FROM (
           SELECT unnest(key_themes) AS t FROM companies WHERE id IN ('<canonical_id>', '<duplicate_id>')
         ) s
       )
WHERE  id = '<canonical_id>';

-- 3. Delete duplicate row.
DELETE FROM companies WHERE id = '<duplicate_id>';
```

Required preconditions: (a) FK `company_mentions.company_id` must be repointed first if `company_mentions` references duplicate (Thread B should confirm). (b) `aliasResolver` may need an entry so future ingestions route the alias to the canonical row.

---

## Section 2 -- Misclassified entity rows (WD61)

Rows whose `name` contains parenthetical descriptions, "no specific company mentioned" boilerplate, or LLM-extraction artifacts. These rows should be deleted or normalized.

| id | name | Action |
|---|---|---|
| `c5fe0c6d-9e9a-4244-b3b8-3168736a2293` | Furniture retailers (no specific company mentioned) | DELETE (sector-level extraction artifact). |
| `8bbd4f6f-5d1d-4501-8c67-9046a2e10fa6` | Electronic Arts (EA) | RENAME to "Electronic Arts" then merge with `66a47afd-...`. |
| `990fe657-a569-4c1f-8197-37d0b516f580` | Valve Corporation (Steam) | RENAME to "Valve Corporation" (Steam is product). |
| `d8d2d55c-2d2d-4da6-b372-8d2ff86be59f` | Micro-Star International (MSI) | RENAME to "Micro-Star International" (or "MSI" if MSI is the public ticker on TWSE). |
| `3451ce20-b2ed-4b21-bad5-1c1e4c7098d2` | 5(c) Capital | KEEP -- "5(c) Capital" is the actual fund name. |
| `4013c87e-c825-4d0e-8452-cc7127b0fc1a` | Big Tech companies (e.g. Google, Amazon, Facebook, Apple) | DELETE (extraction artifact -- multi-entity reference). |
| `0bbc8d4a-02d4-42f7-bd6c-d460d4c9ef17` | IBA (Ion Beam Applications S.A.) | RENAME to "Ion Beam Applications". |
| `4f407d59-87b6-4c3c-84e6-84c2a477457f` | Taiwan Semiconductor Manufacturing Company Limited (TSM) | RENAME and merge into TSMC canonical. |
| `3b2b8cd3-1797-45de-b0c5-294f0b6aa63f` | Applied Optoelectronics (AAOI) | RENAME, merge into `4b017978-...`. |
| `d5453440-a10a-4114-b7cc-d10e6c495a57` | 14 firms (tapped to compete for the contract) | DELETE (extraction artifact). |
| `cb0ada53-9650-4436-81ee-dd0dab623fb8` | The Global Health Innovative Technology (GHIT) Fund | RENAME to "Global Health Innovative Technology Fund" or keep `GHIT Fund`. |
| `eb524f15-1167-4e0c-941c-20c98633a23d` | United Bank for Africa (UBA) Plc | RENAME to "United Bank for Africa". |
| `fc266eef-b104-4fed-a9a0-eef52d65fd31` | WBD (Warner Bros Discovery) | RENAME and merge into WBD canonical. |
| `cbfe26e2-962d-495a-9503-d71c1ef8755a` | Tesla (TSLA) | RENAME to "Tesla" and merge. |
| `f77f08a9-2324-46c0-8d06-0e77ec95474d` | Madison Square Garden Sports (MSGS) | RENAME and merge with `99b68749-...`. |
| `d9740d4d-494b-4e58-906b-a6a2ebc5bae0` | Advanced Micro Devices, Inc. (AMD) | RENAME and merge into AMD canonical. |
| `1e535333-91d2-4c33-97bc-511240b30f3c` | Advanced Micro Devices (AMD) | Same as above. |

Recommended SQL pattern (NOT EXECUTED):

```sql
-- For each row above: either rename + merge, or delete + repoint.
-- Example DELETE for extraction artifacts:
DELETE FROM companies
WHERE  id IN ('c5fe0c6d-...', '4013c87e-...', 'd5453440-...');

-- Re-run merge skeleton from Section 1.3 for rename-and-merge cases.
```

---

## Section 3 -- Business-segment-as-company anti-pattern (WD62)

The extraction pipeline currently treats sub-brands and business segments as separate companies. Worst offenders:

| id | name | ticker | mention_count | Parent company | Action |
|---|---|---|---|---|---|
| `4584e7b0-8184-4dc3-a67e-cafd2eed9eeb` | AWS | **JWSMF** | 6 | Amazon (AMZN) | Ticker is dangerously wrong -- JWSMF is "Jacksons Wholesale Sales Inc." or similar OTC ghost. Delete row or merge into Amazon. |
| `4c603dfe-e823-4903-a0f2-441349203e6a` | Facebook | null | 5 | Meta (META) | Canonicalize on ingest -- already in CANONICAL map as `facebook -> Meta`. The row exists because backfill never ran on legacy rows. Merge into `Meta` canonical row. |
| `62e45dc7-c0f9-40f5-bba1-76485c323803` | Instagram | null | 2 | Meta (META) | Delete or merge into Meta. |
| `a3105a07-8fb6-45f5-b3aa-3a8a0b144575` | TikTok | null | 11 | ByteDance (private) | KEEP as private if ByteDance not yet in `companies`; otherwise merge. |

Additional probable segment-as-company rows that did NOT match the antipattern query but are known to be problematic (manual recon, not scanned):

- `YouTube` (Alphabet segment)
- `WhatsApp` / `Messenger` (Meta)
- `Azure` / `Xbox` / `LinkedIn` (Microsoft -- `LinkedIn` IS in DB as `1cf892e4-...`, no ticker)
- `Google Cloud` / `Google Ads` / `Google Search` (Alphabet)

**Ingestion-side recommendation**: add `SEGMENT_BLOCKLIST` to `src/lib/company-intel.ts` that returns a normalized parent-company name during canonicalize. Already partially present (Facebook -> Meta), but the rule does NOT run on existing rows -- needs a one-time backfill.

```sql
-- Backfill alias rollup (NOT EXECUTED, illustrative):
WITH segment_to_parent AS (
  SELECT 'Facebook'  AS seg, 'Meta'   AS parent UNION ALL
  SELECT 'Instagram', 'Meta'                    UNION ALL
  SELECT 'WhatsApp',  'Meta'                    UNION ALL
  SELECT 'YouTube',   'Alphabet'                UNION ALL
  SELECT 'Google Cloud', 'Alphabet'             UNION ALL
  SELECT 'AWS',       'Amazon'
)
SELECT s.seg, s.parent, c.id AS seg_id, p.id AS parent_id
FROM   segment_to_parent s
JOIN   companies c ON c.name = s.seg
LEFT   JOIN companies p ON p.name = s.parent;
-- Review output, then run merge skeleton from Section 1.3.
```

---

## Section 4 -- `articles.primary_company` schema decision (WD64)

### Measured state

```
SELECT COUNT(*) FILTER (WHERE primary_company ~ '^[0-9a-f]{8}-[0-9a-f]{4}') AS uuid_shape,
       COUNT(*) FILTER (WHERE primary_company IS NOT NULL)                  AS non_null,
       COUNT(*)                                                              AS total
FROM   articles;
-- Result: { uuid_shape: 0, non_null: 4127, total: 8236 }
```

**Conclusion**: `articles.primary_company` is `text` and stores **company display names** (e.g. "OpenAI", "Apple", "Eli Lilly"), NOT UUIDs. Zero rows are UUID-shaped.

### Schema-decision options

| Option | Pros | Cons |
|---|---|---|
| (A) Keep as text-name (status quo). | Zero migration cost. Easy to read. | Brittle: name change in `companies` breaks join. Cannot enforce FK. Duplicates in `companies` mean joins are non-deterministic. |
| (B) Migrate to UUID FK (`articles.primary_company_id uuid REFERENCES companies(id)`). | Strict integrity. Joins are O(1) and unambiguous. Dedup work in `companies` no longer leaks into `articles`. | Migration risk: 4,127 rows must be mapped before flipping. Some `primary_company` values may not exist in `companies` (orphans). |
| (C) Dual columns during transition. | Zero downtime; backfill jobs can run incrementally. | Code complexity; can drift. |

**Recommendation**: Option (B), implemented as Option (C) in practice (additive column + dual-write + cutover). Rationale: every other entity surface that joins articles -> companies already pays the lookup cost via name-match; FK eliminates that cost AND eliminates the silent-orphan bug class.

### Migration sketch (NOT EXECUTED -- write-capable thread to apply)

```sql
-- Phase 1: add nullable FK column
ALTER TABLE articles ADD COLUMN primary_company_id uuid;

-- Phase 2: populate by name match (one-shot backfill)
UPDATE articles a
SET    primary_company_id = c.id
FROM   companies c
WHERE  a.primary_company IS NOT NULL
  AND  c.name = a.primary_company;

-- Phase 3: orphan report
SELECT a.primary_company, COUNT(*)
FROM   articles a
LEFT   JOIN companies c ON c.name = a.primary_company
WHERE  a.primary_company IS NOT NULL
  AND  c.id IS NULL
GROUP  BY 1 ORDER BY 2 DESC;
-- Expect: zero rows after Section 1 + Section 2 + Section 3 cleanup.

-- Phase 4: add FK constraint
ALTER TABLE articles
  ADD CONSTRAINT articles_primary_company_id_fkey
  FOREIGN KEY (primary_company_id) REFERENCES companies(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Phase 5: stop writing primary_company (text), dual-read for one release
-- Phase 6: drop primary_company (text), rename primary_company_id -> primary_company
```

### `articles.companies` (text[]) also requires a decision

`articles.companies` is `text[]`. It stores display names too. The same brittleness applies. A linking table is cleaner:

```sql
CREATE TABLE article_companies (
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, company_id)
);
```

Out of scope for this thread to implement; **filed as WD candidate**.

---

## Section 5 -- Ingestion-side prevention proposals

### 5.1 `pg_trgm` (WD26)

`pg_trgm` extension is **AVAILABLE but NOT installed** (`pg_extension` query returned 0 rows; `default_version` is `1.6`).

Recommendation: enable + index `companies.name` and `companies.ticker` for fuzzy match at ingest:

```sql
-- NOT EXECUTED -- requires DDL privileges and migration review.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX companies_name_trgm_idx ON companies USING gin (lower(name) gin_trgm_ops);
CREATE INDEX companies_ticker_trgm_idx ON companies USING gin (upper(ticker) gin_trgm_ops) WHERE ticker IS NOT NULL;
```

### 5.2 Ingestion hook: pre-insert dedup

Today `aliasResolver.ts` handles read-side clustering, but the write path inserts new rows unconditionally when canonicalize misses. Proposal:

```
on extractCompanyName(name):
  canon = canonicalize(name)                      # string lookup
  hit   = SELECT id FROM companies WHERE name = canon
  if !hit:
    fuzzy = SELECT id, name, similarity(lower(name), lower(:canon)) AS s
            FROM companies
            WHERE lower(name) % lower(:canon)       # trgm % operator
            ORDER BY s DESC LIMIT 1
    if fuzzy.s > 0.85:
      hit = fuzzy
  if !hit:
    INSERT INTO companies (name, ticker) VALUES (canon, fetchTickerFromFinnhub(canon))
    on conflict update mention_count = mention_count + 1
```

Threshold 0.85 catches `JPMorganChase` vs `JPMorgan Chase` while avoiding `Juno` vs `Suno`.

### 5.3 Validation gates at ingest

A new `validateExtractedCompanyName(name)` function should reject:

- Names containing `(`, `)`, `e.g.`, `etc.`, `such as`, `including`, `no specific company`.
- Names that are pure prepositions, geographies, government agencies (`SEC`, `FAA`, `FBI`, `NATO`, `NASA`, `US`, `China`).
- Names shorter than 2 chars OR longer than 80 chars.
- Fragments matching `^(Uni|United|Cove|Pillar|Rocket|Advanced Micro|Mach|AMI|MMV|NS|US)$` (token-stem artifacts -- see WD06).

`fetchTickerFromFinnhub` should NOT be called for names rejected by the validator. The gate prevents catastrophic mistypes like NASA -> RNST, NATO -> STVN, "US" -> IBM.

### 5.4 Index baseline (today's gap)

```sql
-- NOT EXECUTED
CREATE UNIQUE INDEX companies_name_lower_uq ON companies (lower(name));  -- prevent case-only dupes
CREATE INDEX companies_ticker_idx ON companies (ticker) WHERE ticker IS NOT NULL;
```

`companies_name_lower_uq` cannot be added today because duplicates already exist (Section 1). Sequence is: clean -> index.

---

## Section 6 -- ADR / wrong-class-share systematic sweep (WD06)

Today's 18 backfills added `HARD_TICKER_OVERRIDES` for CLS, TSM, SSNLF, RTX, ASML, NVO, BCS in `src/lib/finnhub-ticker.ts`. Cross-check vs. current DB:

| Ticker | Canonical row found | Mentions | Status |
|---|---|---|---|
| ASML | ASML | 26 | OK |
| BCS | Barclays | 11 | OK; `Barclays Plc` variant (1 mention) is a merge candidate. |
| CLS | Celestica | 10 | OK |
| NVO | Novo Nordisk | 16 | OK; `Novo Nordisk A/S` variant (3 mentions) is a merge candidate. |
| RTX | RTX | 8 | OK; `Raytheon` (7), `RTX Corporation` (1), `RTX Corp` (1) all carry ticker RTX. **`Raytheon` should be a strict alias, not its own row.** |
| SSNLF | Samsung | 14 | OK; 4 Samsung variants share the ticker. Merge candidate. |
| TSM | TSMC | 26 | OK; 7 variants share the ticker. Largest merge cluster in the DB. |

### Systematic foreign-ADR sweep result

Querying `companies WHERE ticker IS NULL AND name ~* '(plc|adr|n\.v\.|nv|sa|ag|se|spa|ltd|s\.a\.)' AND mention_count > 5` returned exactly **one** row outside today's backfill set:

| id | name | ticker | mentions | Recommendation |
|---|---|---|---|---|
| `66459799-e828-46ce-9725-c7c49811e7ee` | Tencent Holdings Ltd. | null | 6 | Add to `HARD_TICKER_OVERRIDES`: `"tencent holdings": "TCEHY"` and `"tencent": "TCEHY"` (ADR). Pink-sheet on US; primary listing 0700.HK. |

### Wrong-class-share fragments (NOT foreign ADR but related WD06 issue)

These rows are short token fragments that were incorrectly assigned famous tickers by Finnhub's first-2-tokens or single-token retry path. They are the most dangerous class because they look correct in the UI:

| id | name | wrong ticker | Correct action |
|---|---|---|---|
| `4d8cc381-24f5-4bc4-a3f8-c63d8b82f219` | AMI | GD | NULL the ticker; row is fragment of "General Dynamics AMI" or noise. |
| `48f74d80-54e5-47a6-ae7b-ea49c694e84a` | Pillar | CAT | NULL; row is fragment of "Caterpillar Pillar" or noise. |
| `56d5ee2a-c997-425e-84d2-9fccfd43591f` | Cove | WBD | NULL; row is fragment, possibly "Discovery Cove" -- not WBD. |
| `c9948b16-3240-42d8-916b-3ed179a4f6cc` | Uni | UNH | NULL or DELETE. |
| `e1e148e8-df0e-4299-a1c5-33c799fd4d4b` | United | UNH | NULL or DELETE -- "United" alone is too generic. |
| `252286fa-b0bd-41bf-8ae5-6b82d2d0d103` | Rocket | RKLB | Decision call: "Rocket" alone is ambiguous (Rocket Companies = RKT, Rocket Lab = RKLB). NULL to be safe. |
| `e7d94830-ed3b-4c5d-a83f-e183b0cf6acc` | MMV | CVLT | NULL; fragment. |
| `9ca347d4-e8ca-4e11-8635-03e9ce48096f` | Mach | IBM | NULL; "Mach" is not IBM. |
| `a7367431-0dd1-40e7-b361-33bb379b1ba9` | NS | JNJ | NULL; "NS" is not Johnson & Johnson. |
| `0904d024-a02b-4ea3-b7e5-2450e3545fc0` | Advanced Micro | AMD | Merge into AMD canonical row, OR delete fragment. |
| `4584e7b0-8184-4dc3-a67e-cafd2eed9eeb` | AWS | JWSMF | **NULL urgently** -- JWSMF is not Amazon (Section 3). |
| `ffaebc39-65f4-4ef5-85de-3c8257dd2cfa` | NASA | RNST | NULL or DELETE (NASA is not a company; see Section 5.3). |
| `ca9c1bfe-f83e-4bd7-b3e4-ca8e7fe02f17` | NATO | STVN | NULL or DELETE. |
| `d2d5ef2f-40e7-46a6-8726-4bb39fc6f1f2` | US | IBM | DELETE; "US" is a geography. |
| `70e0bc60-8bd8-4223-85e5-820e0f28f6ea` | Khosla Ventures | KVSD | NULL; Khosla Ventures is a private VC firm, not the public KVSD ticker. |
| `2eefcee3-a379-40eb-a7a5-dfe2bc680c5a` | Accel | ARX | NULL; Accel is private VC, ARX is unrelated. |
| `6f172ab0-e3ca-4ab8-98c0-f664e53df711` | Sierra | BSRR | NULL; "Sierra" alone is too generic. |
| `558356ce-ac9f-4095-b638-947c963bf307` | Ford | F | OK (this one is correct). |

```sql
-- NOT EXECUTED -- recommended NULL'ing sweep
UPDATE companies SET ticker = NULL
WHERE  id IN (
  '4d8cc381-24f5-4bc4-a3f8-c63d8b82f219', -- AMI/GD
  '48f74d80-54e5-47a6-ae7b-ea49c694e84a', -- Pillar/CAT
  '56d5ee2a-c997-425e-84d2-9fccfd43591f', -- Cove/WBD
  'c9948b16-3240-42d8-916b-3ed179a4f6cc', -- Uni/UNH
  'e1e148e8-df0e-4299-a1c5-33c799fd4d4b', -- United/UNH
  '252286fa-b0bd-41bf-8ae5-6b82d2d0d103', -- Rocket/RKLB
  'e7d94830-ed3b-4c5d-a83f-e183b0cf6acc', -- MMV/CVLT
  '9ca347d4-e8ca-4e11-8635-03e9ce48096f', -- Mach/IBM
  'a7367431-0dd1-40e7-b361-33bb379b1ba9', -- NS/JNJ
  '4584e7b0-8184-4dc3-a67e-cafd2eed9eeb', -- AWS/JWSMF
  'ffaebc39-65f4-4ef5-85de-3c8257dd2cfa', -- NASA/RNST
  'ca9c1bfe-f83e-4bd7-b3e4-ca8e7fe02f17', -- NATO/STVN
  '70e0bc60-8bd8-4223-85e5-820e0f28f6ea', -- Khosla Ventures/KVSD
  '2eefcee3-a379-40eb-a7a5-dfe2bc680c5a', -- Accel/ARX
  '6f172ab0-e3ca-4ab8-98c0-f664e53df711'  -- Sierra/BSRR
);
```

---

## Section 7 -- ExxonMobil + JPMorgan Chase Finnhub anomaly (WD60)

### Measured state

```
SELECT id, name, ticker, mention_count FROM companies
WHERE  lower(name) LIKE '%exxon%' OR lower(name) LIKE '%jpmorgan%' OR lower(name) LIKE '%jp morgan%';
```

| name | ticker | mentions |
|---|---|---|
| ExxonMobil | **NULL** | 20 |
| Exxon Mobil | XOM | 10 |
| Exxon | XOM | 7 |
| Exxon Mobil Corporation | XOM | 2 |
| JPMorgan | JPM | 15 |
| JPMorgan Chase & Co. | JPM | 8 |
| JP Morgan | **NULL** | 8 |
| JPMorgan Chase | JPM | 7 |
| J.P. Morgan | **NULL** | 2 |
| JPMorgan Chase & Co | JPM | 1 |
| JPMorganChase | **NULL** | 1 |
| JPMorgan Asset Management | NULL | 1 |

### Root cause -- confirmed (yes)

Reading `src/lib/finnhub-ticker.ts`:

1. `MIN_MENTION_COUNT_FOR_LOOKUP = 2`. This explains why `JPMorganChase` (mention_count=1) and `J.P. Morgan` (mention_count=2 borderline) are not auto-tickered. The 2-floor gate is by design.
2. `canonicalize("ExxonMobil")` returns `"ExxonMobil"` (line 141 of `company-intel.ts`: `exxonmobil: "ExxonMobil"`). Finnhub `/search?q=ExxonMobil` does NOT return `XOM`; the result list is empty or contains no `Common Stock`/`ADR`/`NY Reg Shrs` types.
3. The retry chain SHOULD save this: `camelCaseSplit("ExxonMobil")` -> `"Exxon Mobil"` -> Finnhub returns `XOM`. **BUT** the retry chain only runs at ingestion time, not on backfill of legacy rows. Legacy rows that pre-date Patch J (f) (the camelCase split) sit with `ticker = NULL` forever.
4. `canonicalize("JP Morgan")` returns `"JPMorgan Chase"` (line 99). Finnhub search "JPMorgan Chase" returns JPM. **So why is `JP Morgan` row tickerless?** Because the row was created before the canonicalize alias was added -- the row's `name` field still reads `JP Morgan`, never got rewritten.
5. The same legacy-row reason explains `J.P. Morgan` (2 mentions) -- canonicalize key `j.p. morgan` is NOT in the CANONICAL map.

### Recommended fix in `src/lib/finnhub-ticker.ts`

```ts
// Add to HARD_TICKER_OVERRIDES (lines 34-52):
"exxonmobil":      "XOM",
"exxon mobil":     "XOM",
"exxon":           "XOM",
"jpmorganchase":   "JPM",
"jpmorgan chase":  "JPM",
"jpmorgan":        "JPM",
"jp morgan":       "JPM",
"j.p. morgan":     "JPM",
```

This is a defensive override layer: even if canonicalize fails to rewrite the name (legacy rows, new variants), the ticker is correct.

### Recommended fix in `src/lib/company-intel.ts`

Add aliases for ExxonMobil + JPMorgan variants the CANONICAL map currently misses:

```ts
// In CANONICAL (around line 96-100):
"j.p. morgan":   "JPMorgan Chase",
"jpmorganchase": "JPMorgan Chase",

// In CANONICAL (around line 141):
exxonmobil:     "ExxonMobil",
"exxon mobil":  "ExxonMobil",
exxon:          "ExxonMobil",
```

### Recommended backfill job (NOT EXECUTED)

A scheduled job that re-runs `fetchTickerFromFinnhub` for every `companies WHERE ticker IS NULL AND mention_count >= 2` would catch the legacy-row drift. Should be added to the existing cron set.

```sql
-- READ-ONLY -- target list for the backfill job:
SELECT id, name, mention_count
FROM   companies
WHERE  ticker IS NULL
  AND  mention_count >= 2
ORDER  BY mention_count DESC;
```

---

## Section 8 -- Filed-WD candidates list

New WD tickets recommended by this thread:

1. **WD-A** `companies` name normalization sweep: Unicode (curly vs straight quotes), case-only, suffix-only duplicates. 100+ candidate rows. Tooling: `src/scripts/normalize-company-names.ts`.
2. **WD-B** `articles.primary_company` UUID FK migration. See Section 4. Phased; needs Section 1/2/3 cleanup as prerequisite.
3. **WD-C** `articles.companies` text[] -> link table (`article_companies`). See Section 4.
4. **WD-D** Enable `pg_trgm` + add fuzzy-match hook in ingestion pre-insert. See Section 5.
5. **WD-E** Add `validateExtractedCompanyName` reject list (geos, agencies, parentheticals, fragments). See Section 5.3. Blocks new NASA/NATO/US/etc. rows.
6. **WD-F** NULL the 15 fragment-row wrong tickers identified in Section 6 (one-shot UPDATE).
7. **WD-G** Add ExxonMobil + JPMorgan + Tencent overrides + canonicalize aliases (Section 7 + Section 6).
8. **WD-H** Scheduled `null-ticker-backfill` cron that re-runs `fetchTickerFromFinnhub` for legacy null-ticker rows above the mention floor (Section 7).
9. **WD-I** Segment-as-company blocklist + parent-rollup ingestion guard (AWS, Facebook, Instagram, YouTube, WhatsApp, Azure, etc.). See Section 3.
10. **WD-J** Index baseline: `companies(lower(name))` unique, `companies(ticker)` partial (Section 5.4). Prerequisite: dedup completion.
11. **WD-K** `aliasResolver` must be informed whenever a HARD_TICKER_OVERRIDE or CANONICAL entry is added so old DB rows route to the new canonical. Currently silent.
12. **WD-L** "Pillar/Cove/AMI/MMV/Uni/Mach/NS" token-stem fragment investigator: where do these short single-token rows come from in the LLM extraction pipeline? They share the pathology that whatever produced them is also the source of the wrong-ticker assignments. Trace upstream.

---

End of audit.
