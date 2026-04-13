"""
observe.py — BreakingAlpha Phase 1 Observation Layer
Run Recorder: post-run observer that captures pipeline metadata and
reconstructs the article selection used for synthesis.

Called as step 4 of run.py after all pipeline steps complete.
No LLM calls. Pure Supabase reads/writes and Python logic only.

Selection note
--------------
Article sets in run_articles are always written with
selection_source='reconstructed'. This means the observer replayed the
same diversify-and-cap query that synthesize.py uses, but made its own
independent Supabase call. The resulting set should closely match what
synthesis actually received, but is not guaranteed to be identical if
Supabase row ordering has any non-determinism or if the synthesis query
window differed slightly. Do not treat reconstructed rows as exact ground
truth. When synthesize.py is instrumented directly (Phase 2+), rows will
carry selection_source='exact'.
"""

import os
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Phase 1 manual snapshots of the model names hardcoded in ingest.py (line 126)
# and synthesize.py (line 133). There is no centralized model config in this
# repo — importing either module to read the constants is not safe (triggers
# Groq/Supabase init). Update these manually when either file changes its model.
MODEL_INGEST = "llama-3.1-8b-instant"
MODEL_SYNTH  = "llama-3.3-70b-versatile"

# Mirrors synthesize._select_articles_for_synthesis() — the current production
# article selector. Update these if synthesize.py changes its selection params.
# Old logic (_diversify_articles, sector_cap=4, total=20) was replaced by PR #37.
_SPINE_SECTOR_CAP = 3    # max articles per sector in the spine (dominant stories)
_SPINE_COUNT      = 12   # max spine articles
_FLOOR_COUNT      = 6    # max floor articles (breadth: one per uncovered sector)
_FLOOR_MIN_SCORE  = 7    # min relevance_score for a floor article to qualify
_COMPANY_CAP      = 2    # max articles per company (applied to spine only)
_POOL_LIMIT       = 60   # article pool size fetched from Supabase (same as synthesize.py)


def _reconstruct_selected(pool):
    """
    Replays the two-bucket spine+floor selection logic used in
    synthesize._select_articles_for_synthesis() to approximate which articles
    were passed to the synthesis model.

    Spine (up to _SPINE_COUNT): greedy walk over the score-sorted pool with
    per-sector cap of _SPINE_SECTOR_CAP and per-company cap of _COMPANY_CAP.
    Captures the dominant editorial stories.

    Floor (up to _FLOOR_COUNT): one best article per sector NOT already covered
    by the spine, minimum score _FLOOR_MIN_SCORE. Adds breadth coverage for
    sectors absent from the spine.

    Returns spine + floor combined. All rows produced from this function carry
    selection_source='reconstructed'.
    """
    sector_counts  = defaultdict(int)
    company_counts = defaultdict(int)
    spine     = []
    spine_ids = set()

    for a in pool:
        sector    = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        companies = a.get("companies") or []
        if isinstance(companies, str):
            try:
                companies = json.loads(companies)
            except Exception:
                companies = []

        if sector_counts[sector] >= _SPINE_SECTOR_CAP:
            continue
        if companies and any(company_counts[c] >= _COMPANY_CAP for c in companies):
            continue

        spine.append(a)
        spine_ids.add(a.get("id"))
        sector_counts[sector] += 1
        for c in companies:
            company_counts[c] += 1

        if len(spine) >= _SPINE_COUNT:
            break

    # Floor: one best (highest-scoring) article per sector not in the spine.
    # Pool is already score-sorted desc, so the first eligible article per
    # sector encountered is automatically the best for that sector.
    covered_sectors = {(a.get("industry_verticals") or [a.get("sector", "")])[0] for a in spine}
    best_per_sector = {}

    for a in pool:
        if a.get("id") in spine_ids:
            continue
        score  = a.get("relevance_score") or 0
        sector = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        if not sector or sector in covered_sectors:
            continue
        if score < _FLOOR_MIN_SCORE:
            continue
        if sector not in best_per_sector:
            best_per_sector[sector] = a  # first = highest score for this sector

    floor = list(best_per_sector.values())[:_FLOOR_COUNT]

    return spine + floor


def record_run(brief_type, started_at, ingest_count=None):
    """
    Records one pipeline_runs row and associated run_articles rows.

    Parameters
    ----------
    brief_type   : str — 'morning' | 'evening'
    started_at   : datetime (timezone-aware UTC) — when run.py started
    ingest_count : int | None — new articles stored by the ingest step;
                   the return value of run_ingestion() in ingest.py.

    Errors are caught and printed locally. This function never raises so
    the caller (run.py) is unaffected by observation failures.
    """
    completed_at = datetime.now(timezone.utc)
    duration_s   = (completed_at - started_at).total_seconds()

    # --- Fetch the briefing written by this run ---------------------------
    # briefings.id is not queried here because its existence in the live schema
    # has not been verified (it is absent from all frontend selects and the
    # HANDOFF schema description). briefing_id is left null for Phase 1 and
    # reserved for Phase 2+ once briefings.id is confirmed.
    headline_snap = None
    status        = "error"
    error_notes   = None
    try:
        br = supabase.table("briefings") \
            .select("headline, created_at") \
            .eq("briefing_type", brief_type) \
            .gte("created_at", started_at.isoformat()) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        row = br.data[0] if br.data else None
        if row:
            headline_snap = row.get("headline")
            if headline_snap == "Market Intelligence Unavailable":
                status      = "stub"
                error_notes = "synthesis_fallback: model error or rate limit caused stub briefing"
            else:
                status = "success"
        else:
            # synthesize.py threw before writing any row, or wrote nothing at all
            error_notes = "no_briefing_row_written_since_run_start"
    except Exception as e:
        print(f"  [observe] briefing lookup failed: {e}")
        error_notes = f"briefing_lookup_error: {str(e)[:200]}"

    # --- Fetch the 24h article pool (mirrors synthesize.py query) --------
    cutoff = (completed_at - timedelta(hours=24)).isoformat()
    pool   = []
    try:
        pool_resp = supabase.table("articles") \
            .select("id, sector, industry_verticals, companies, relevance_score") \
            .gte("ingested_at", cutoff) \
            .order("relevance_score", desc=True) \
            .limit(_POOL_LIMIT) \
            .execute()
        pool = pool_resp.data or []
    except Exception as e:
        print(f"  [observe] article pool fetch failed: {e}")

    candidate_count = len(pool)
    selected        = _reconstruct_selected(pool)
    selected_ids    = {a["id"] for a in selected}
    selected_count  = len(selected)

    # --- Insert pipeline_runs row ----------------------------------------
    run_row = {
        "brief_type":      brief_type,
        "started_at":      started_at.isoformat(),
        "completed_at":    completed_at.isoformat(),
        "duration_s":      round(duration_s, 2),
        "briefing_id":     None,   # reserved for Phase 2+ once briefings.id is verified
        "headline_snap":   headline_snap,
        "status":          status,
        "ingest_count":    ingest_count,
        "candidate_count": candidate_count,
        "selected_count":  selected_count,
        "model_ingest":    MODEL_INGEST,
        "model_synth":     MODEL_SYNTH,
        "error_notes":     error_notes,
    }

    run_id = None
    try:
        ins    = supabase.table("pipeline_runs").insert(run_row).execute()
        run_id = ins.data[0]["id"]
        print(f"  [observe] run recorded — id={run_id}, status={status}, "
              f"ingest={ingest_count}, candidates={candidate_count}, "
              f"selected={selected_count}, duration={duration_s:.1f}s")
    except Exception as e:
        print(f"  [observe] failed to insert pipeline_runs row: {e}")
        return None

    # --- Insert run_articles rows (candidates + selected) ----------------
    if not pool:
        return run_id

    article_rows = [
        {
            "run_id":           run_id,
            "article_id":       a["id"],
            "role":             "selected" if a["id"] in selected_ids else "candidate",
            "relevance_score":  a.get("relevance_score"),
            "selection_source": "reconstructed",
        }
        for a in pool
    ]

    try:
        # Batch in chunks of 50 to stay within Supabase payload limits
        for i in range(0, len(article_rows), 50):
            supabase.table("run_articles").insert(article_rows[i:i+50]).execute()
        print(f"  [observe] {len(article_rows)} run_articles rows written "
              f"({selected_count} selected, "
              f"{candidate_count - selected_count} candidates, "
              f"source=reconstructed)")
    except Exception as e:
        print(f"  [observe] run_articles insert failed (run row still saved): {e}")

    return run_id
