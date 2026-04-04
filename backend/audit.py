"""
audit.py — BreakingAlpha Phase 1 Observation Layer
Selection Auditor: run-level selection quality recorder.

Called as step 6 of run.py after critique.py.
No LLM calls. Pure Supabase reads/writes and Python logic only.

Reads run_articles for the given run_id, computes aggregate metrics about
the reconstructed candidate and selected sets, and writes one row to
selection_audit.

Provenance note
---------------
All run_articles rows carry selection_source='reconstructed'. The selected
and candidate sets are the observer's replay of the synthesize.py selection
logic — not the exact input synthesize.py received. Aggregate counts (score
distributions, sector concentrations) are stable under this uncertainty.
Per-article claims are not. This module makes no per-article claims.

Design decisions
----------------
- If run_id is None: log and return. No fallback inference. No row written.
- If no run_articles rows exist for the run: log and return. No row written.
- Sector join failure: sector_counts_selected and sector_concentration_flag
  are set to None rather than blocking the row insert.
- All other per-field failures: that field is set to None; row still written.
- This function never raises. The caller (run.py) is unaffected by failures.
"""

import os
import json
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Reference target for selected set size. Mirrors synthesize._select_articles_for_synthesis
# (spine_count=12 + floor_count=6 = 18, or legacy _diversify_articles total=20).
# Used as a fixed reference for how far below target the selection fell.
# Update manually if synthesize.py changes its target count.
_TARGET_COUNT = 20

# Threshold for sector_concentration_flag: if any single sector accounts for
# >= this fraction of the selected set, the flag is set True.
# This is an observational pattern flag, not a failure verdict.
_SECTOR_CONCENTRATION_THRESHOLD = 0.5


def audit_run(brief_type, run_id=None):
    """
    Compute run-level selection audit metrics and write one row to
    selection_audit.

    Parameters
    ----------
    brief_type : str      — 'morning' | 'evening'
    run_id     : str|None — id from pipeline_runs; if None, logs and returns

    This function never raises. All failures are caught and printed locally.
    """
    if run_id is None:
        print("  [audit] run_id is None — skipping selection_audit row")
        return

    # --- Fetch run_articles for this run ----------------------------------
    articles_rows = []
    try:
        resp = (
            supabase.table("run_articles")
            .select("article_id, role, relevance_score")
            .eq("run_id", run_id)
            .execute()
        )
        articles_rows = resp.data or []
    except Exception as e:
        print(f"  [audit] run_articles fetch failed: {e}")
        return

    if not articles_rows:
        print(f"  [audit] no run_articles rows found for run_id={run_id} — skipping")
        return

    # --- Split into selected and candidate sets ---------------------------
    selected_rows = [r for r in articles_rows if r.get("role") == "selected"]
    candidate_rows = [r for r in articles_rows if r.get("role") == "candidate"]

    candidate_count = len(candidate_rows)
    selected_count = len(selected_rows)

    # --- Score metrics (from run_articles directly, no join needed) -------
    cand_scores = [
        r["relevance_score"] for r in candidate_rows
        if r.get("relevance_score") is not None
    ]
    sel_scores = [
        r["relevance_score"] for r in selected_rows
        if r.get("relevance_score") is not None
    ]

    score_10_not_selected = sum(1 for s in cand_scores if s == 10)
    score_8_plus_not_selected = sum(1 for s in cand_scores if s >= 8)
    top_unselected_score = max(cand_scores) if cand_scores else None
    min_selected_score = min(sel_scores) if sel_scores else None
    mean_selected_score = (
        round(sum(sel_scores) / len(sel_scores), 1) if sel_scores else None
    )

    # --- Sector concentration (join to articles table, selected set only) -
    sector_counts_selected = None
    sector_concentration_flag = None

    selected_ids = [r["article_id"] for r in selected_rows if r.get("article_id")]
    if selected_ids:
        try:
            art_resp = (
                supabase.table("articles")
                .select("id, sector")
                .in_("id", selected_ids)
                .execute()
            )
            art_rows = art_resp.data or []

            counts = {}
            for row in art_rows:
                sector = (row.get("sector") or "").strip()
                if sector:
                    counts[sector] = counts.get(sector, 0) + 1

            if counts:
                sector_counts_selected = json.dumps(counts)
                max_sector_count = max(counts.values())
                sector_concentration_flag = (
                    max_sector_count / selected_count >= _SECTOR_CONCENTRATION_THRESHOLD
                    if selected_count > 0
                    else False
                )
            # If counts is empty (all sectors null/blank): fields stay None
        except Exception as e:
            print(f"  [audit] sector join failed (row still written): {e}")
            # sector_counts_selected and sector_concentration_flag remain None

    # --- Write selection_audit row ----------------------------------------
    audit_row = {
        "run_id":                    run_id,
        "brief_type":                brief_type,
        "candidate_count":           candidate_count,
        "selected_count":            selected_count,
        "target_count":              _TARGET_COUNT,
        "score_10_not_selected":     score_10_not_selected,
        "score_8_plus_not_selected": score_8_plus_not_selected,
        "top_unselected_score":      top_unselected_score,
        "min_selected_score":        min_selected_score,
        "mean_selected_score":       mean_selected_score,
        "sector_counts_selected":    sector_counts_selected,
        "sector_concentration_flag": sector_concentration_flag,
        "provenance":                "reconstructed",
    }

    try:
        supabase.table("selection_audit").insert(audit_row).execute()
        print(
            f"  [audit] selection scored — "
            f"candidates={candidate_count}, selected={selected_count}/{_TARGET_COUNT}, "
            f"score10_miss={score_10_not_selected}, "
            f"score8plus_miss={score_8_plus_not_selected}, "
            f"top_unselected={top_unselected_score}, "
            f"min_sel={min_selected_score}, mean_sel={mean_selected_score}, "
            f"concentration={sector_concentration_flag}"
        )
    except Exception as e:
        print(f"  [audit] failed to insert selection_audit row: {e}")
