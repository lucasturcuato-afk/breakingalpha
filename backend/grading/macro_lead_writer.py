"""
macro_lead_writer.py: thin, DB-touching companion to macro_lead_grader.

The grader (macro_lead_grader.py) is a PURE function: no network, no DB, no LLM.
This module is the only place that reads persisted tapes and writes grade rows,
keeping that separation intact. run.py calls grade_recent_session() as a
non-blocking, non-gating post-session step.

Which session it grades
-----------------------
The window needs D+1 and D+2 EVENING rows (same_close and t1). Evening rows for
session D land labeled D+1 (created ~02:xx UTC = ~10pm ET of session D). So to
grade session D we need the D+1 and D+2 evening rows to exist. On any given run
we look back and grade the newest morning/evening session whose full window is
reconstructable and not already graded (idempotent via the unique index).

Lead recovery
-------------
The shipped lead is read from pipeline_runs.preselect_decision
(impact_lead_cluster / impact_lead_title). is_lead on morning_brief_calls is NOT
required on this path; the grader reads the lead directly. Deal-led sessions are
skipped (this grader scores MACRO leads only).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from . import macro_lead_grader as mlg


# How many days back to scan for a gradable session. A short lookback keeps the
# post-session step cheap; the unique index makes re-grading a no-op.
LOOKBACK_DAYS = 10


def _client():
    from supabase import create_client
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


def _tape_for(sb, brief_date: str, brief_type: str) -> Optional[dict]:
    resp = (
        sb.table("briefings")
        .select("market_tape")
        .eq("briefing_date", brief_date)
        .eq("briefing_type", brief_type)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    mt = resp.data[0].get("market_tape")
    return mt if isinstance(mt, dict) else None


def _macro_lead_for(sb, brief_date: str, brief_type: str) -> Optional[dict]:
    """Recover the shipped MACRO lead from preselect_decision. Returns
    {cluster, title} or None when the run was deal-led / not found."""
    start = brief_date
    end = (date.fromisoformat(brief_date) + timedelta(days=1)).isoformat()
    resp = (
        sb.table("pipeline_runs")
        .select("preselect_decision,created_at")
        .eq("brief_type", brief_type)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    pd = resp.data[0].get("preselect_decision") or {}
    cluster = pd.get("impact_lead_cluster")
    title = pd.get("impact_lead_title")
    source = (pd.get("lead_source") or "").lower()
    # Only grade macro-led sessions. Deal-led runs have no macro repricing claim.
    if source and source not in ("impact", "macro"):
        return None
    if not cluster or not str(cluster).lower().startswith(("macro", "geo", "commodity")):
        return None
    return {"cluster": cluster, "title": title}


def _already_graded(sb, brief_date: str, brief_type: str) -> bool:
    resp = (
        sb.table("lead_outcome_grades")
        .select("id")
        .eq("brief_date", brief_date)
        .eq("brief_type", brief_type)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def _persist(sb, grade: mlg.LeadGrade) -> None:
    """Upsert one grade row on (brief_date, brief_type). Attempts the full row
    (with anchor columns); if the anchor columns are not applied yet, retries
    with a schema-safe subset so a pre-migration prod does not hard-fail. The
    anchor is still recoverable from the window jsonb + notes in that case."""
    full = grade.to_row()
    try:
        sb.table("lead_outcome_grades").upsert(
            full, on_conflict="brief_date,brief_type"
        ).execute()
        return
    except Exception as e:
        msg = str(e).lower()
        if "anchor_ts" not in msg and "anchor_source" not in msg and "column" not in msg:
            raise
        subset = {k: v for k, v in full.items() if k not in ("anchor_ts", "anchor_source")}
        sb.table("lead_outcome_grades").upsert(
            subset, on_conflict="brief_date,brief_type"
        ).execute()


def grade_recent_session() -> Optional[dict]:
    """Grade the newest macro-led session with a complete, reconstructable
    window that is not already graded. Returns the persisted row dict, or None
    when there is nothing to grade. Raises on hard failure (the run.py caller
    isolates it)."""
    sb = _client()
    today = datetime.now(timezone.utc).date()

    for back in range(2, LOOKBACK_DAYS + 1):
        d = today - timedelta(days=back)
        d_iso = d.isoformat()
        # same_close = D+1 evening; t1 = D+2 evening.
        same_iso = (d + timedelta(days=1)).isoformat()
        t1_iso = (d + timedelta(days=2)).isoformat()

        same_tape = _tape_for(sb, same_iso, "evening")
        t1_tape = _tape_for(sb, t1_iso, "evening")
        if same_tape is None or t1_tape is None:
            continue  # window not yet complete

        for brief_type in ("morning", "evening"):
            if _already_graded(sb, d_iso, brief_type):
                continue
            lead = _macro_lead_for(sb, d_iso, brief_type)
            if lead is None:
                continue  # deal-led or no run; nothing to grade here
            lead_tape = _tape_for(sb, d_iso, brief_type)
            if lead_tape is None:
                continue

            grade = mlg.grade_lead(
                brief_date=d_iso,
                brief_type=brief_type,
                lead_title=lead["title"],
                lead_cluster=lead["cluster"],
                lead_tape=lead_tape,
                same_close_tape=same_tape,
                t1_tape=t1_tape,
            )
            _persist(sb, grade)
            return grade.to_row()

    return None
