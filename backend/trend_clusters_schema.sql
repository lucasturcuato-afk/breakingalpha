-- Phase 1 observation layer — Trend Mapper cluster memory
-- One or more rows per pipeline run (one per cluster identified).
-- Written by backend/trend_mapper.py after audit.py.
--
-- Purpose
-- -------
-- Answers: what meaningful multi-article narratives existed in this run,
-- which were new vs recurring, and which did the brief actually surface?
--
-- Provenance note
-- ---------------
-- All rows carry provenance='reconstructed'. Article membership is derived
-- from run_articles (itself a reconstructed replay of selection logic).
-- Clustering is heuristic — structured entity overlap + title token similarity.
-- Do not treat these rows as exact editorial ground truth.
-- Cross-run classification (emerging/persistent) is based on cluster_key
-- exact matching, which is deterministic but approximate.
--
-- run_id is nullable for schema consistency; the code never writes a row
-- without a valid run_id in practice.

create table if not exists trend_clusters (
    id                         uuid        primary key default gen_random_uuid(),
    run_id                     uuid        null references pipeline_runs(id),
    brief_type                 text        not null,   -- 'morning' | 'evening'
    created_at                 timestamptz default now(),

    -- Cluster identity
    cluster_key                text,        -- normalized key for cross-run matching
                                            -- format: "{sector}|{top2_companies}|{top_theme}"
    label                      text,        -- human-readable label (e.g. "Microsoft: M&A")
    cluster_type               text,        -- 'emerging' | 'persistent'

    -- Composition
    article_count              int,         -- total articles in the cluster
    source_count               int,         -- distinct outlets contributing
    avg_relevance_score        float,       -- average relevance_score across cluster articles
    max_relevance_score        float,       -- highest relevance_score in cluster

    -- Dominant entities (sorted by frequency within cluster, up to N each)
    top_companies              jsonb,       -- ["company", ...] top 5 by mention count
    top_themes                 jsonb,       -- ["theme", ...] top 5 by mention count
    top_sectors                jsonb,       -- ["sector", ...] top 3 by mention count

    -- Representative articles (first 5 article ids in cluster)
    representative_article_ids jsonb,

    -- Cluster quality scores ∈ [0, 1]
    -- Both scores are explicit and inspectable — not black-box composites.
    -- See trend_mapper.py score_cluster_strength() and score_cluster_confidence()
    -- for the exact ingredient weights.
    strength_score             float,   -- reflects size + source diversity + relevance signal
    confidence_score           float,   -- reflects internal coherence + multi-source corroboration

    -- Surfacing observation flags
    -- True = cluster's dominant entities appeared in that part of the briefing
    -- False = entities absent from that surface (not a failure verdict)
    surfaced_in_headline       boolean,
    surfaced_in_sections       boolean,
    surfaced_in_top_deals      boolean,
    surfaced_anywhere          boolean, -- OR of the three above

    -- Underrepresentation flag
    -- True when: strength_score >= UNDERREPRESENTED_STRENGTH_FLOOR
    --            AND surfaced_anywhere = false
    -- Observational signal only — not a failure verdict. Use for trend
    -- analysis and future Phase 2 selection feedback, not editorial claims.
    underrepresented_flag      boolean,

    -- Cross-run context
    lookback_run_count         int,     -- how many prior successful runs were examined
    matched_prior_cluster_keys jsonb,   -- cluster_keys that matched in prior runs
    novelty_score              float,   -- 1.0 = never seen in lookback; 0.0 = seen every run

    -- Multi-source corroboration signal
    cross_source_flag          boolean, -- true if 3+ distinct sources contributed

    -- Provenance marker
    provenance                 text     -- always 'reconstructed' in Phase 1
);

-- Primary lookup: all clusters for a given run
create index if not exists trend_clusters_run_id_idx
    on trend_clusters (run_id);

-- Cross-run cluster key lookup (used by lookback matching logic in trend_mapper.py)
create index if not exists trend_clusters_key_type_idx
    on trend_clusters (brief_type, cluster_key);

-- Time-series queries (e.g. weekly trend summary)
create index if not exists trend_clusters_created_at_idx
    on trend_clusters (created_at desc);

-- Underrepresented flag queries (efficient filtering for analysis)
create index if not exists trend_clusters_underrepresented_idx
    on trend_clusters (underrepresented_flag)
    where underrepresented_flag = true;

-- Persistent cluster queries (for Phase 2 and weekly summaries)
create index if not exists trend_clusters_type_idx
    on trend_clusters (brief_type, cluster_type);

-- Row-level security consistent with other observation-layer tables
alter table trend_clusters enable row level security;

create policy "Public read"   on trend_clusters for select using (true);
create policy "Public insert" on trend_clusters for insert with check (true);
