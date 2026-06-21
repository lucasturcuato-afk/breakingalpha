"""Soft-fail per-call Gemini token usage logging.

Reads the usage_metadata that every Gemini response already carries and writes
token counts to the gemini_usage side table, so cost becomes queryable by step
and model. This module adds NOTHING to any generate request. It only inspects
the response object after the call returns and writes to a separate table.

Every public function is fully exception isolated. Any failure, including the
gemini_usage table not existing yet, is swallowed. Logging can never affect
generation or crash a run, so this is safe to merge before the migration is
applied.

Two write paths:
  log_gemini_usage(step, model, response, run_id)  one row per call. Use for
      low and medium volume sites (8-K, brief synthesis, deal extractor, etc).
  accumulate_gemini_usage(step, model, response) + flush_gemini_usage(run_id)
      in-memory aggregation for high volume per-article paths (the filter and
      the shadow grader). A 1000 plus article pass costs one insert per
      (step, model), not one insert per article.
"""
from __future__ import annotations

import threading
from collections import defaultdict
from typing import Optional

_client = None
_client_lock = threading.Lock()

# In-memory accumulator for high volume per-article steps, keyed by (step,
# model). Flushed once per run as one aggregated row per bucket.
_ACC_LOCK = threading.Lock()
_ACC = defaultdict(
    lambda: {"calls": 0, "prompt": 0, "candidates": 0, "thoughts": 0, "total": 0}
)


def _get_client():
    """Lazily return a Supabase service-role client, or None. Never raises."""
    global _client
    with _client_lock:
        if _client is not None:
            return _client
        try:
            try:
                from supabase_client import get_service_client
            except Exception:
                from backend.supabase_client import get_service_client
            _client = get_service_client()
        except Exception:
            _client = None
        return _client


def _tokens(response):
    """Pull the four token counts off a response. Returns None if absent."""
    um = getattr(response, "usage_metadata", None)
    if um is None:
        return None

    def _g(name):
        v = getattr(um, name, None)
        return int(v) if v else 0

    return {
        "prompt": _g("prompt_token_count"),
        "candidates": _g("candidates_token_count"),
        "thoughts": _g("thoughts_token_count"),
        "total": _g("total_token_count"),
    }


def log_gemini_usage(step, model, response, run_id: Optional[str] = None) -> None:
    """Write one usage row for a single Gemini call. Soft-fail, never raises."""
    try:
        t = _tokens(response)
        if t is None:
            return
        row = {
            "step": step,
            "model": model,
            "calls": 1,
            "prompt_tokens": t["prompt"],
            "candidates_tokens": t["candidates"],
            "thoughts_tokens": t["thoughts"],
            "total_tokens": t["total"],
        }
        if run_id:
            row["run_id"] = run_id
        client = _get_client()
        if client is None:
            return
        client.table("gemini_usage").insert(row).execute()
    except Exception:
        # Logging must never affect generation. Swallow everything.
        return


def accumulate_gemini_usage(step, model, response) -> None:
    """Add one high volume call's tokens to the in-memory bucket. No DB write.
    Soft-fail. Pair with flush_gemini_usage() once per run."""
    try:
        t = _tokens(response)
        if t is None:
            return
        with _ACC_LOCK:
            b = _ACC[(step, model)]
            b["calls"] += 1
            b["prompt"] += t["prompt"]
            b["candidates"] += t["candidates"]
            b["thoughts"] += t["thoughts"]
            b["total"] += t["total"]
    except Exception:
        return


def flush_gemini_usage(run_id: Optional[str] = None) -> None:
    """Write one aggregated row per accumulated (step, model) bucket, then clear
    the buckets. Soft-fail, never raises. Call once at run end."""
    try:
        with _ACC_LOCK:
            buckets = list(_ACC.items())
            _ACC.clear()
        if not buckets:
            return
        client = _get_client()
        if client is None:
            return
        rows = []
        for (step, model), b in buckets:
            row = {
                "step": step,
                "model": model,
                "calls": b["calls"],
                "prompt_tokens": b["prompt"],
                "candidates_tokens": b["candidates"],
                "thoughts_tokens": b["thoughts"],
                "total_tokens": b["total"],
            }
            if run_id:
                row["run_id"] = run_id
            rows.append(row)
        client.table("gemini_usage").insert(rows).execute()
    except Exception:
        return
