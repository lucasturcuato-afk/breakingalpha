"""
summarize.py — BreakingAlpha Phase 1 Observation Layer
Post-run operator summary: reads observation data for the just-completed run
and prints a consolidated digest to stdout (GitHub Actions log).

Called as step 8 of run.py after trend_mapper.py.
No LLM calls. Pure Supabase reads and Python formatting only.

Reads from:
  brief_quality_scores  — headline quality, banned phrases, section presence
  selection_audit       — candidate/selected counts, score miss signals
  trend_clusters        — cluster count, persistence, underrepresented flags

Writes nothing to Supabase. Prints only.

This step makes the observation data legible to operators without requiring
them to assemble scattered log lines from steps 4–7. It is not a scoring
system, does not recommend changes, and carries no Phase 2 logic.
"""

import os
import json
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


def _safe_json(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def print_summary(brief_type, run_id):
    """
    Read observation rows for this run_id and print a concise operator digest.

    Parameters
    ----------
    brief_type : str      — 'morning' | 'evening'
    run_id     : str|None — id from pipeline_runs; if None, prints a warning and returns

    This function never raises. Failures are printed inline and do not affect
    the pipeline.
    """
    if run_id is None:
        print("  [summary] run_id is None — cannot fetch observation data, skipping")
        return

    label = brief_type.upper()

    # --- Brief quality -------------------------------------------------------
    quality = None
    try:
        resp = (
            supabase.table("brief_quality_scores")
            .select(
                "headline_pass, headline_word_count, banned_phrase_hits, "
                "what_to_watch_banned_hits, sections_present, sections_omitted, "
                "top_deals_count, status, soft_flags"
            )
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        quality = resp.data[0] if resp.data else None
    except Exception as e:
        print(f"  [summary] brief_quality_scores fetch failed: {e}")

    # --- Selection audit -----------------------------------------------------
    selection = None
    try:
        resp = (
            supabase.table("selection_audit")
            .select(
                "candidate_count, selected_count, target_count, "
                "score_10_not_selected, score_8_plus_not_selected, "
                "top_unselected_score, mean_selected_score, "
                "sector_concentration_flag"
            )
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        selection = resp.data[0] if resp.data else None
    except Exception as e:
        print(f"  [summary] selection_audit fetch failed: {e}")

    # --- Trend clusters ------------------------------------------------------
    trends = None
    try:
        resp = (
            supabase.table("trend_clusters")
            .select(
                "num_clusters, num_movers, top_mover_sector, "
                "top_mover_company, volatility_pct"
            )
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        trends = resp.data[0] if resp.data else None
    except Exception as e:
        print(f"  [summary] trend_clusters fetch failed: {e}")

    # --- Format digest -------------------------------------------------------
    lines = [
        "",
        "─" * 52,
        f"  RUN SUMMARY — {label}  (run_id={run_id[:8]}…)",
        "─" * 52,
    ]

    # Brief quality block
    if quality:
        hl_pass = quality.get("headline_pass")
        hl_words = quality.get("headline_word_count")
        banned = quality.get("banned_phrase_hits", 0) or 0
        watch_banned = quality.get("what_to_watch_banned_hits", 0) or 0
        omitted = _safe_json(quality.get("sections_omitted"), [])
        deals = quality.get("top_deals_count")
        soft = _safe_json(quality.get("soft_flags"), [])
        status = quality.get("status", "?")

        hl_label = f"{'PASS' if hl_pass else 'FAIL'} ({hl_words}w)"
        omitted_str = ", ".join(omitted) if omitted else "none"
        soft_str = ", ".join(soft) if soft else "none"

        lines += [
            f"  Brief Quality       [{status}]",
            f"    Headline:         {hl_label}",
            f"    Banned phrases:   {banned} body  |  {watch_banned} watch",
            f"    Sections omitted: {omitted_str}",
            f"    Top deals:        {deals if deals is not None else 'n/a'}",
            f"    Soft flags:       {soft_str}",
        ]
    else:
        lines.append("  Brief Quality       [no data]")

    lines.append("")

    # Selection block
    if selection:
        cands = selection.get("candidate_count", "?")
        sel = selection.get("selected_count", "?")
        tgt = selection.get("target_count", "?")
        miss10 = selection.get("score_10_not_selected", "?")
        miss8 = selection.get("score_8_plus_not_selected", "?")
        top_unsel = selection.get("top_unselected_score", "?")
        mean_sel = selection.get("mean_selected_score", "?")
        conc = selection.get("sector_concentration_flag")
        conc_str = "YES ⚠" if conc else ("no" if conc is False else "n/a")

        lines += [
            f"  Selection Quality",
            f"    Pool → selected:  {cands} candidates → {sel}/{tgt}",
            f"    Score-10 missed:  {miss10}  |  score-8+ missed: {miss8}",
            f"    Top unselected:   {top_unsel}  |  mean selected: {mean_sel}",
            f"    Sector conc:      {conc_str}",
        ]
    else:
        lines.append("  Selection Quality   [no data]")

    lines.append("")

    # Trends block
    if trends:
        num_c = trends.get("num_clusters", "?")
        num_m = trends.get("num_movers", "?")
        top_sec = trends.get("top_mover_sector") or "—"
        top_co = trends.get("top_mover_company") or "—"
        vol = trends.get("volatility_pct")
        vol_str = f"{vol:.0f}%" if vol is not None else "n/a"

        lines += [
            f"  Trend Intelligence",
            f"    Clusters:         {num_c}  |  movers: {num_m}",
            f"    Top mover:        {top_sec} / {top_co}",
            f"    Volatility:       {vol_str}",
        ]
    else:
        lines.append("  Trend Intelligence  [no data]")

    lines += ["─" * 52, ""]

    print("\n".join(lines))
