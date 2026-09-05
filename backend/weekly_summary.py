"""
weekly_summary.py — BreakingAlpha Phase 1 Observation Layer
Weekly cross-run operator digest: aggregates observation metrics across
recent pipeline runs and prints a consolidated summary to stdout.

Intended to run once per week (Monday morning via GitHub Actions), or on
demand via workflow_dispatch. Not called by run.py — fully standalone.

No LLM calls. Pure Supabase reads and Python aggregation only.

Reads from:
  pipeline_runs         — run list, dates, status, headline snapshots
  brief_quality_scores  — per-run headline quality, banned phrases, sections
  selection_audit       — per-run candidate/selection metrics, sector counts
  trend_clusters        — per-cluster rows for cross-run persistence analysis

Writes nothing to Supabase. Prints only.

This digest answers the operator question:
  "What patterns have emerged across the last N pipeline runs?"

It surfaces trends, recurrence, and consistency — not individual run detail.
That is the job of the per-run post-run summary (summarize.py).
"""

import os
import sys
import json
from collections import defaultdict
from datetime import timezone

from supabase import create_client
try:
    from supabase_client import service_client  # cron context: cwd=backend/
except ImportError:  # pragma: no cover - test/dev context: cwd=repo-root
    from backend.supabase_client import service_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Minimum runs required to produce a meaningful digest.
# Below this threshold the script warns and skips pattern-heavy sections.
MIN_RUNS_FOR_PATTERNS = 2

# Persistence threshold: a cluster key seen in this many distinct runs
# is considered a recurring narrative worth naming.
PERSISTENCE_THRESHOLD = 3

# If the persistence threshold yields nothing (window too short), fall back
# to this lower threshold and note it in output.
PERSISTENCE_FALLBACK = 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_json(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _avg(values):
    """Return float average of a list, or None if empty."""
    clean = [v for v in values if v is not None]
    return round(sum(clean) / len(clean), 2) if clean else None


def _pct(numerator, denominator):
    """Return 'N/D (X%)' string, or 'n/a' if denominator is zero."""
    if not denominator:
        return "n/a"
    return f"{numerator}/{denominator}  ({round(100 * numerator / denominator)}%)"


def _fmt_date(ts_str):
    """Return 'Apr 6' from an ISO timestamp string, or '?' on failure."""
    if not ts_str:
        return "?"
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.strftime("%b %-d")
    except Exception:
        return ts_str[:10]


def _best_label(rows):
    """
    Pick the most frequently occurring label for a cluster_key group.
    Cluster labels are deterministically derived from the key, so they
    should be consistent — this guards against any minor variation.
    """
    from collections import Counter
    labels = [r.get("label") for r in rows if r.get("label")]
    if not labels:
        return "—"
    return Counter(labels).most_common(1)[0][0]


def _section_omission_counts(quality_rows):
    """
    Return a list of (section_name, omission_count) tuples sorted descending.
    Only sections omitted in ≥2 runs are included.
    """
    counts = defaultdict(int)
    for row in quality_rows:
        for section in _safe_json(row.get("sections_omitted"), []):
            counts[section] += 1
    return sorted(
        [(s, c) for s, c in counts.items() if c >= 2],
        key=lambda x: -x[1]
    )


def _sector_selection_averages(audit_rows):
    """
    Aggregate sector_counts_selected across runs.
    Return top sectors by mean selection count (min 2 avg selections).
    List of (sector_name, mean_count) sorted descending.
    """
    sector_totals = defaultdict(list)
    for row in audit_rows:
        sector_map = _safe_json(row.get("sector_counts_selected"), {})
        if isinstance(sector_map, dict):
            for sector, count in sector_map.items():
                if count and int(count) > 0:
                    sector_totals[sector].append(int(count))

    averages = [
        (sector, round(sum(vals) / len(vals), 1))
        for sector, vals in sector_totals.items()
        if (sum(vals) / len(vals)) >= 1.5
    ]
    return sorted(averages, key=lambda x: -x[1])[:6]


# ---------------------------------------------------------------------------
# Main summary function
# ---------------------------------------------------------------------------

def print_weekly_summary(brief_type="morning", lookback_runs=10):
    """
    Fetch the last `lookback_runs` pipeline runs of `brief_type` and print
    a cross-run operator digest.

    Parameters
    ----------
    brief_type    : str — 'morning' | 'evening'
    lookback_runs : int — number of recent runs to include (default 10)

    This function never raises. Failures are noted inline.
    """
    label = brief_type.upper()

    # --- 1. Fetch pipeline_runs window ---------------------------------------
    runs = []
    try:
        resp = (
            supabase.table("pipeline_runs")
            .select("id, brief_type, started_at, status, error_notes, headline_snap")
            .eq("brief_type", brief_type)
            .order("started_at", desc=True)
            .limit(lookback_runs)
            .execute()
        )
        runs = resp.data or []
    except Exception as e:
        print(f"[weekly_summary] pipeline_runs fetch failed: {e}")
        return

    if not runs:
        print(f"[weekly_summary] No {brief_type} runs found — nothing to summarize.")
        return

    n = len(runs)
    run_ids = [r["id"] for r in runs if r.get("id")]

    # Date range (runs are desc, so first=newest, last=oldest)
    newest_date = _fmt_date(runs[0].get("started_at"))
    oldest_date = _fmt_date(runs[-1].get("started_at"))
    date_range = f"{oldest_date} – {newest_date}" if oldest_date != newest_date else newest_date

    if n < lookback_runs:
        window_note = f"  (requested {lookback_runs}, only {n} available)"
    else:
        window_note = ""

    # --- 2. Batch-fetch observation tables -----------------------------------
    quality_rows, audit_rows, cluster_rows = [], [], []

    try:
        resp = (
            service_client().table("brief_quality_scores")
            .select(
                "run_id, headline_pass, headline_word_count, "
                "banned_phrase_hits, what_to_watch_banned_hits, "
                "sections_omitted, top_deals_count, soft_flags"
            )
            .in_("run_id", run_ids)
            .execute()
        )
        quality_rows = resp.data or []
    except Exception as e:
        print(f"  [weekly_summary] brief_quality_scores fetch failed: {e}")

    try:
        resp = (
            service_client().table("selection_audit")
            .select(
                "run_id, candidate_count, selected_count, target_count, "
                "score_10_not_selected, score_8_plus_not_selected, "
                "top_unselected_score, mean_selected_score, "
                "sector_concentration_flag, sector_counts_selected"
            )
            .in_("run_id", run_ids)
            .execute()
        )
        audit_rows = resp.data or []
    except Exception as e:
        print(f"  [weekly_summary] selection_audit fetch failed: {e}")

    try:
        resp = (
            supabase.table("trend_clusters")
            .select(
                "run_id, cluster_key, label, cluster_type, "
                "strength_score, underrepresented_flag, novelty_score"
            )
            .in_("run_id", run_ids)
            .execute()
        )
        cluster_rows = resp.data or []
    except Exception as e:
        print(f"  [weekly_summary] trend_clusters fetch failed: {e}")

    # --- 3. Build digest lines -----------------------------------------------
    SEP = "═" * 60

    lines = [
        "",
        SEP,
        f"  WEEKLY DIGEST — {label}  ({n} runs · {date_range}){window_note}",
        SEP,
    ]

    # ── Run Window ──────────────────────────────────────────────────────────
    error_runs = sum(
        1 for r in runs
        if r.get("status") not in ("success", None) or r.get("error_notes")
    )
    headlines = [
        r.get("headline_snap") for r in reversed(runs)
        if r.get("headline_snap")
    ]

    lines += ["", "  Run Window"]
    lines.append(f"    Runs included:    {n}  ({brief_type}  {date_range})")
    if error_runs:
        lines.append(f"    Errors / stubs:   {error_runs}  ⚠")
    else:
        lines.append(f"    Errors / stubs:   0")
    if headlines:
        lines.append(f"    Headlines ({len(headlines)}):")
        for h in headlines[-5:]:           # show up to 5 most recent
            lines.append(f"      · {h[:80]}")
        if len(headlines) > 5:
            lines.append(f"      … +{len(headlines)-5} more")

    # ── Brief Quality Trends ─────────────────────────────────────────────────
    lines += ["", "  Brief Quality Trends"]

    if not quality_rows:
        lines.append("    [no data]")
    else:
        q_n = len(quality_rows)
        hl_passes   = sum(1 for r in quality_rows if r.get("headline_pass"))
        hl_words    = [r["headline_word_count"] for r in quality_rows if r.get("headline_word_count") is not None]
        banned_body = [r["banned_phrase_hits"]       for r in quality_rows if r.get("banned_phrase_hits") is not None]
        banned_wtw  = [r["what_to_watch_banned_hits"] for r in quality_rows if r.get("what_to_watch_banned_hits") is not None]
        deals_vals  = [r["top_deals_count"]           for r in quality_rows if r.get("top_deals_count") is not None]

        avg_words   = _avg(hl_words)
        avg_banned  = _avg(banned_body)
        avg_wtw     = _avg(banned_wtw)
        avg_deals   = _avg(deals_vals)

        omitted_freq = _section_omission_counts(quality_rows)
        omitted_str  = (
            "  |  ".join(f"{s} ({c}×)" for s, c in omitted_freq[:4])
            if omitted_freq else "none recurring"
        )

        soft_flag_counts = defaultdict(int)
        for r in quality_rows:
            for flag in _safe_json(r.get("soft_flags"), []):
                soft_flag_counts[flag] += 1
        top_soft = sorted(soft_flag_counts.items(), key=lambda x: -x[1])[:3]
        soft_str = "  |  ".join(f"{f} ({c}×)" for f, c in top_soft) if top_soft else "none"

        lines += [
            f"    Headline pass:    {_pct(hl_passes, q_n)}"
            + (f"  avg {avg_words}w" if avg_words else ""),
            f"    Banned phrases:   avg {avg_banned or 0:.1f} body  |  {avg_wtw or 0:.1f} watch",
            f"    Omitted sections: {omitted_str}",
        ]
        if avg_deals is not None:
            lines.append(f"    Top deals:        avg {avg_deals:.1f} per run")
        if top_soft:
            lines.append(f"    Soft flags:       {soft_str}")

    # ── Selection Quality Trends ──────────────────────────────────────────────
    lines += ["", "  Selection Quality Trends"]

    if not audit_rows:
        lines.append("    [no data]")
    else:
        a_n = len(audit_rows)
        cand_vals    = [r["candidate_count"]          for r in audit_rows if r.get("candidate_count") is not None]
        miss10_vals  = [r["score_10_not_selected"]    for r in audit_rows if r.get("score_10_not_selected") is not None]
        miss8_vals   = [r["score_8_plus_not_selected"] for r in audit_rows if r.get("score_8_plus_not_selected") is not None]
        top_uns_vals = [r["top_unselected_score"]     for r in audit_rows if r.get("top_unselected_score") is not None]
        mean_sel_v   = [r["mean_selected_score"]      for r in audit_rows if r.get("mean_selected_score") is not None]

        conc_flags = sum(1 for r in audit_rows if r.get("sector_concentration_flag"))

        avg_cands  = _avg(cand_vals)
        avg_m10    = _avg(miss10_vals)
        avg_m8     = _avg(miss8_vals)
        avg_topuns = _avg(top_uns_vals)
        avg_msel   = _avg(mean_sel_v)

        top_sectors = _sector_selection_averages(audit_rows)
        sector_str = (
            "  |  ".join(f"{s} ({v:.1f})" for s, v in top_sectors[:4])
            if top_sectors else "n/a"
        )

        lines += [
            f"    Avg pool size:    {avg_cands or '?'} candidates",
            f"    Avg score-10 miss:{avg_m10 or '?':.1f}"
            + (f"  |  score-8+ miss: {avg_m8:.1f}" if avg_m8 is not None else ""),
            f"    Avg top unsel:    {avg_topuns or '?'}"
            + (f"  |  avg mean sel: {avg_msel:.1f}" if avg_msel is not None else ""),
            f"    Sector conc:      {_pct(conc_flags, a_n)} flagged",
            f"    Top sectors:      {sector_str}",
        ]

    # ── Trend Persistence ────────────────────────────────────────────────────
    lines += ["", "  Trend Persistence"]

    if not cluster_rows:
        lines.append("    [no data]")
    else:
        # Group by cluster_key, deduplicating within the same run_id
        seen = set()
        deduped = []
        for row in cluster_rows:
            key = (row.get("cluster_key"), row.get("run_id"))
            if key not in seen and row.get("cluster_key"):
                seen.add(key)
                deduped.append(row)

        # Build per-key aggregates
        by_key = defaultdict(list)
        for row in deduped:
            by_key[row["cluster_key"]].append(row)

        total_distinct = len(by_key)

        # Determine effective persistence threshold given window size
        threshold = PERSISTENCE_THRESHOLD
        threshold_note = ""
        recurring = {k: v for k, v in by_key.items() if len(v) >= threshold}
        if not recurring and n >= MIN_RUNS_FOR_PATTERNS:
            threshold = PERSISTENCE_FALLBACK
            threshold_note = f"  (threshold lowered to {threshold}+ — window is short)"
            recurring = {k: v for k, v in by_key.items() if len(v) >= threshold}

        # Sort by appearance count desc, then mean strength desc
        def _sort_key(item):
            rows_list = item[1]
            mean_str = _avg([r.get("strength_score") for r in rows_list]) or 0
            return (-len(rows_list), -mean_str)

        sorted_recurring = sorted(recurring.items(), key=_sort_key)

        # Systemic misses: underrep in 2+ distinct runs
        underrep_by_key = defaultdict(int)
        for row in deduped:
            if row.get("underrepresented_flag"):
                underrep_by_key[row["cluster_key"]] += 1
        systemic_misses = {k: v for k, v in underrep_by_key.items() if v >= 2}

        # Single-run clusters (noise floor)
        single_run_count = sum(1 for v in by_key.values() if len(v) == 1)

        # Novelty across all clusters
        nov_all = [r.get("novelty_score") for r in deduped if r.get("novelty_score") is not None]
        avg_nov = _avg(nov_all)

        lines.append(f"    Window:           {n} runs · {total_distinct} distinct cluster keys{threshold_note}")

        if sorted_recurring:
            lines.append(f"    Recurring ({threshold}+ runs):  {len(sorted_recurring)} clusters")
            for ck, rows_list in sorted_recurring[:8]:
                appearances = len(rows_list)
                mean_str = _avg([r.get("strength_score") for r in rows_list])
                underrep_count = sum(1 for r in rows_list if r.get("underrepresented_flag"))
                best_lbl = _best_label(rows_list)
                str_fmt = f"str={mean_str:.2f}" if mean_str is not None else ""
                underrep_fmt = f"  underrep {underrep_count}×" if underrep_count else ""
                lines.append(
                    f"      — {best_lbl:<30}  {appearances}/{n} runs  {str_fmt}{underrep_fmt}"
                )
            if len(sorted_recurring) > 8:
                lines.append(f"      … +{len(sorted_recurring)-8} more")
        else:
            lines.append(f"    Recurring ({threshold}+ runs):  none  (window may be too short)")

        if systemic_misses:
            lines.append(f"    Systemic misses:  {len(systemic_misses)} clusters underrepresented in 2+ runs")
            for ck, count in sorted(systemic_misses.items(), key=lambda x: -x[1])[:4]:
                cluster_label = _best_label(by_key.get(ck, []))
                lines.append(f"      — {cluster_label:<30}  underrep {count}×")
        else:
            lines.append(f"    Systemic misses:  none detected in this window")

        lines.append(f"    Single-run only:  {single_run_count} clusters  (noise floor)")
        if avg_nov is not None:
            lines.append(f"    Avg novelty:      {avg_nov:.2f}  (1.0=all new, 0.0=all recurring)")

    lines += ["", SEP, ""]
    print("\n".join(lines))


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    brief_type    = sys.argv[1] if len(sys.argv) > 1 else "morning"
    lookback_runs = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    if brief_type not in ("morning", "evening"):
        print(f"Usage: python weekly_summary.py [morning|evening] [lookback_runs]")
        sys.exit(1)

    print_weekly_summary(brief_type, lookback_runs)
