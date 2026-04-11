"""
summarize.py — Signalera Observation Layer · post-run summary & weekly digest

Two distinct jobs in this module:

  1. print_summary(brief_type, run_id)
     Called as step 8 of run.py after every pipeline run (soft-fail wrapped).
     Reads observation rows for this run_id and prints a single compact block
     to stdout (GitHub Actions log). No Supabase writes, no LLM calls.

  2. generate_weekly_digest(brief_type)
     Called separately from a weekly GitHub Actions cron (NOT from run.py).
     Pulls 7 days of observation data, aggregates it, asks Gemini 2.5 Flash
     to produce (a) a human-readable operator digest and (b) a short
     directive addendum that gets injected into the thesis generation prompt.
     Writes one row to weekly_digests and returns the full digest dict.

  3. get_latest_thesis_addendum(brief_type)
     Read-only helper — fetches the most recent thesis_prompt_addendum row
     for this brief_type. Used by the thesis generation flow to close the
     autonomous feedback loop.

THESIS LOOP INTEGRATION
-----------------------
In frontend/lib/generateThesis.ts (or equivalent), before constructing the
Gemini thesis generation prompt, call the Supabase weekly_digests table:

    SELECT thesis_prompt_addendum FROM weekly_digests
    WHERE brief_type = '{brief_type}'
    ORDER BY generated_at DESC LIMIT 1

Append the result (if non-null) to the thesis generation system prompt as:

    "\n\n[WEEKLY PIPELINE FEEDBACK — incorporate into thesis framing]\n{addendum}"

This closes the autonomous feedback loop:
    pipeline → observe/critique/audit/trend_map → summarize.generate_weekly_digest
    → weekly_digests.thesis_prompt_addendum → frontend thesis generation.

TABLE CREATION — Noah, run this ONCE in the Supabase SQL editor
---------------------------------------------------------------
The weekly_digests table is NOT created automatically. Copy the
WEEKLY_DIGESTS_DDL constant below into the Supabase SQL editor and execute
before running generate_weekly_digest() for the first time. RLS follows the
same public-read / public-insert pattern as every other observation table.
"""

import os
import json
import logging
from collections import Counter
from datetime import datetime, timezone, timedelta

from supabase import create_client
from google import genai
from google.genai import types


logger = logging.getLogger(__name__)

# --- Clients ---------------------------------------------------------------

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Gemini client is lazy-tolerant: print_summary and get_latest_thesis_addendum
# never call Gemini, so the module must still import cleanly if GEMINI_API_KEY
# is not set. generate_weekly_digest checks for None before calling.
try:
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
except Exception as e:  # missing key, network, malformed — all non-fatal at import
    gemini_client = None
    logger.warning("summarize: Gemini client unavailable at import (%s)", e)

GEMINI_MODEL = "gemini-2.5-flash"  # matches synthesize.py; canonical model for this repo

# --- Optional rich console -------------------------------------------------
# Fall back to plain print if rich is not installed. Either path produces
# the same ASCII box layout; rich just makes it prettier in terminals that
# support it.
try:
    from rich.console import Console as _RichConsole
    _rich_console = _RichConsole()
    _HAS_RICH = True
except Exception:
    _rich_console = None
    _HAS_RICH = False


# ==========================================================================
# WEEKLY_DIGESTS_DDL — run once in Supabase SQL editor
# ==========================================================================
WEEKLY_DIGESTS_DDL = """
-- Signalera Observation Layer · weekly operator digest
-- One row per generate_weekly_digest() invocation.
-- Written by backend/summarize.py.generate_weekly_digest().

create table if not exists weekly_digests (
    id                       uuid        primary key default gen_random_uuid(),
    brief_type               text        not null,          -- 'morning' | 'evening'
    generated_at             timestamptz not null default now(),
    period                   text        not null,          -- '7d'
    digest_json              jsonb       not null,          -- full structured digest
    gemini_digest            text,                          -- narrative operator digest
    thesis_prompt_addendum   text                           -- injected into thesis prompts
);

create index if not exists weekly_digests_brief_type_idx
    on weekly_digests (brief_type, generated_at desc);

create index if not exists weekly_digests_generated_at_idx
    on weekly_digests (generated_at desc);

alter table weekly_digests enable row level security;

create policy "Public read"   on weekly_digests for select using (true);
create policy "Public insert" on weekly_digests for insert with check (true);
"""


# ==========================================================================
# Internal helpers
# ==========================================================================

def _safe_json(value, default):
    """Coerce a possibly-stringified JSONB field into a Python list/dict."""
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _r4(v):
    """Round a float to 4 dp for dict storage; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except Exception:
        return None


def _r2(v):
    """Round a float to 2 dp for human display; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 2)
    except Exception:
        return None


def _render_block(lines: list[str]) -> None:
    """Print either via rich (if available) or plain stdout."""
    text = "\n".join(lines)
    if _HAS_RICH and _rich_console is not None:
        _rich_console.print(text)
    else:
        print(text)


# ==========================================================================
# Function 1 — per-run console summary
# ==========================================================================

def print_summary(brief_type: str, run_id: str | None = None) -> None:
    """
    Read observation rows for this run_id and print a single operator block.

    Pulls from four tables (pipeline_runs, brief_quality_scores,
    selection_audit, trend_clusters) and prints ONE consolidated block.
    No Supabase writes, no LLM calls. Never raises.

    If run_id is None (observe step failed), prints a minimal fallback line
    and returns.
    """
    try:
        if run_id is None:
            print("  [summary] Run summary unavailable (observe step failed)")
            return

        label = brief_type.upper()
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        # --- pipeline_runs -----------------------------------------------
        pipeline = None
        try:
            resp = (
                supabase.table("pipeline_runs")
                .select("status, ingest_count, candidate_count, selected_count, "
                        "duration_s, error_notes")
                .eq("id", run_id)
                .limit(1)
                .execute()
            )
            pipeline = resp.data[0] if resp.data else None
        except Exception as e:
            logger.warning("summarize: pipeline_runs fetch failed for %s: %s", run_id, e)

        # --- brief_quality_scores ---------------------------------------
        quality = None
        try:
            resp = (
                supabase.table("brief_quality_scores")
                .select("headline_pass, banned_phrase_hits, soft_flags, status")
                .eq("run_id", run_id)
                .limit(1)
                .execute()
            )
            quality = resp.data[0] if resp.data else None
        except Exception as e:
            logger.warning("summarize: brief_quality_scores fetch failed for %s: %s", run_id, e)

        # --- selection_audit --------------------------------------------
        selection = None
        try:
            resp = (
                supabase.table("selection_audit")
                .select("score_10_not_selected, score_8_plus_not_selected, "
                        "mean_selected_score, sector_concentration_flag")
                .eq("run_id", run_id)
                .limit(1)
                .execute()
            )
            selection = resp.data[0] if resp.data else None
        except Exception as e:
            logger.warning("summarize: selection_audit fetch failed for %s: %s", run_id, e)

        # --- trend_clusters (aggregate per-run rows) --------------------
        trend_rows = []
        try:
            resp = (
                supabase.table("trend_clusters")
                .select("surfaced_anywhere, underrepresented_flag, novelty_score")
                .eq("run_id", run_id)
                .execute()
            )
            trend_rows = resp.data or []
        except Exception as e:
            logger.warning("summarize: trend_clusters fetch failed for %s: %s", run_id, e)

        # --- Format fields ----------------------------------------------
        if pipeline:
            status = pipeline.get("status") or "?"
            ing = pipeline.get("ingest_count")
            can = pipeline.get("candidate_count")
            sel = pipeline.get("selected_count")
            dur = pipeline.get("duration_s")
            ing_s = "?" if ing is None else str(ing)
            can_s = "?" if can is None else str(can)
            sel_s = "?" if sel is None else str(sel)
            dur_s = "?" if dur is None else f"{float(dur):.1f}"
            pipeline_line = (
                f"PIPELINE    status={status} | {ing_s}->{can_s}->{sel_s} articles | {dur_s}s"
            )
        else:
            pipeline_line = "PIPELINE    [no data]"

        if quality:
            hl = quality.get("headline_pass")
            hl_s = "PASS" if hl is True else ("FAIL" if hl is False else "?")
            banned = quality.get("banned_phrase_hits", 0) or 0
            soft_list = _safe_json(quality.get("soft_flags"), [])
            soft_s = ", ".join(soft_list) if soft_list else "NONE"
            quality_line = (
                f"QUALITY     headline={hl_s} | banned_hits={banned} | soft_flags={soft_s}"
            )
        else:
            quality_line = "QUALITY     [no data]"

        if selection:
            mean_score = selection.get("mean_selected_score")
            mean_s = "?" if mean_score is None else f"{_r2(mean_score):.2f}"
            dropped10 = selection.get("score_10_not_selected")
            dropped8 = selection.get("score_8_plus_not_selected")
            conc = selection.get("sector_concentration_flag")
            conc_s = "T" if conc is True else ("F" if conc is False else "?")
            selection_line = (
                f"SELECTION   mean_score={mean_s} | dropped_score10={dropped10} "
                f"| dropped_8+={dropped8} | sector_conc={conc_s}"
            )
        else:
            selection_line = "SELECTION   [no data]"

        if trend_rows:
            n_clusters = len(trend_rows)
            n_surfaced = sum(1 for r in trend_rows if r.get("surfaced_anywhere"))
            n_underrep = sum(1 for r in trend_rows if r.get("underrepresented_flag"))
            nov_vals = [r["novelty_score"] for r in trend_rows
                        if r.get("novelty_score") is not None]
            avg_nov = f"{sum(nov_vals) / len(nov_vals):.2f}" if nov_vals else "?"
            trends_line = (
                f"TRENDS      clusters={n_clusters} | surfaced={n_surfaced} "
                f"| underrep={n_underrep} | avg_novelty={avg_nov}"
            )
        else:
            trends_line = "TRENDS      [no data]"

        # --- Render as a box --------------------------------------------
        header = f"  SIGNALERA RUN SUMMARY — {label} [{ts}]"
        body = [pipeline_line, quality_line, selection_line, trends_line]
        width = max(len(header), max(len(line) for line in body)) + 2

        top = "╔" + "═" * width + "╗"
        mid = "╠" + "═" * width + "╣"
        bot = "╚" + "═" * width + "╝"

        block = [
            "",
            top,
            "║" + header.ljust(width) + "║",
            mid,
        ]
        for line in body:
            block.append("║ " + line.ljust(width - 1) + "║")
        block.append(bot)
        block.append("")

        _render_block(block)

    except Exception as e:
        # Outermost guard — never crash the pipeline on a summary failure.
        logger.error("summarize.print_summary crashed: %s", e)
        print(f"  [summary] crashed: {e}")


# ==========================================================================
# Function 2 — weekly digest with Gemini narrative + thesis prompt addendum
# ==========================================================================

_WEEKLY_DIGEST_SYSTEM = (
    "You are the intelligence layer of Signalera, an AI market intelligence "
    "platform. Analyze pipeline performance data and produce actionable insights "
    "for the engineering and editorial teams."
)

_THESIS_ADDENDUM_SYSTEM = (
    "You are generating a feedback addendum that will be injected into an AI "
    "investment thesis generation prompt. Be concise, directive, and specific. "
    "No preamble."
)


def _gemini_generate(system: str, user_content: str,
                     temperature: float = 0.4, max_tokens: int = 1024) -> str:
    """Shared Gemini call with the same client pattern as synthesize.py."""
    if gemini_client is None:
        raise RuntimeError("Gemini client not initialized (GEMINI_API_KEY missing)")
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (response.text or "").strip()


def generate_weekly_digest(brief_type: str) -> dict:
    """
    Pull 7 days of observation data for this brief_type, aggregate it, ask
    Gemini for a narrative digest + a thesis-prompt addendum, write one row
    to weekly_digests, and return the full digest dict.

    Returns an empty dict if the whole flow fails catastrophically — never
    raises. Individual section failures (a single table query, one Gemini
    call) degrade gracefully with defaults or empty fields.
    """
    try:
        generated_at = datetime.now(timezone.utc)
        cutoff = (generated_at - timedelta(days=7)).isoformat()

        # ---- pipeline_runs (7d) ----------------------------------------
        runs: list[dict] = []
        try:
            resp = (
                supabase.table("pipeline_runs")
                .select("id, status, duration_s, ingest_count")
                .eq("brief_type", brief_type)
                .gte("created_at", cutoff)
                .execute()
            )
            runs = resp.data or []
        except Exception as e:
            logger.warning("weekly_digest: pipeline_runs fetch failed: %s", e)

        total_runs = len(runs)
        # NOTE: pipeline_runs.status uses 'success' | 'stub' | 'error' in
        # observe.py (not 'completed'). Treat 'success' as the positive signal.
        success_runs = sum(1 for r in runs if r.get("status") == "success")
        success_rate = (success_runs / total_runs) if total_runs else 0.0
        durations = [r["duration_s"] for r in runs if r.get("duration_s") is not None]
        avg_duration = (sum(durations) / len(durations)) if durations else 0.0
        total_ingested = sum((r.get("ingest_count") or 0) for r in runs)

        pipeline_health = {
            "total_runs": total_runs,
            "success_rate": _r4(success_rate) or 0.0,
            "avg_duration_s": _r4(avg_duration) or 0.0,
            "total_articles_ingested": int(total_ingested),
        }

        # ---- brief_quality_scores (7d) ---------------------------------
        quality_rows: list[dict] = []
        try:
            resp = (
                supabase.table("brief_quality_scores")
                .select("headline_pass, banned_phrase_hits, soft_flags")
                .eq("brief_type", brief_type)
                .gte("created_at", cutoff)
                .execute()
            )
            quality_rows = resp.data or []
        except Exception as e:
            logger.warning("weekly_digest: brief_quality_scores fetch failed: %s", e)

        if quality_rows:
            hp_vals = [r for r in quality_rows if r.get("headline_pass") is not None]
            headline_pass_rate = (
                sum(1 for r in hp_vals if r.get("headline_pass")) / len(hp_vals)
                if hp_vals else 0.0
            )
            banned_vals = [r.get("banned_phrase_hits") or 0 for r in quality_rows]
            avg_banned = sum(banned_vals) / len(banned_vals) if banned_vals else 0.0
        else:
            headline_pass_rate = 0.0
            avg_banned = 0.0

        soft_flag_counter: Counter = Counter()
        for r in quality_rows:
            flags = _safe_json(r.get("soft_flags"), [])
            if isinstance(flags, list):
                soft_flag_counter.update(str(f) for f in flags if f is not None)
        recurring_soft_flags = [name for name, _ in soft_flag_counter.most_common(5)]

        quality_trends = {
            "headline_pass_rate": _r4(headline_pass_rate) or 0.0,
            "avg_banned_hits": _r4(avg_banned) or 0.0,
            "recurring_soft_flags": recurring_soft_flags,
        }

        # ---- selection_audit (7d) --------------------------------------
        audit_rows: list[dict] = []
        try:
            resp = (
                supabase.table("selection_audit")
                .select("mean_selected_score, score_10_not_selected, "
                        "sector_concentration_flag")
                .eq("brief_type", brief_type)
                .gte("created_at", cutoff)
                .execute()
            )
            audit_rows = resp.data or []
        except Exception as e:
            logger.warning("weekly_digest: selection_audit fetch failed: %s", e)

        if audit_rows:
            mean_vals = [r.get("mean_selected_score") for r in audit_rows
                         if r.get("mean_selected_score") is not None]
            avg_mean_score = sum(mean_vals) / len(mean_vals) if mean_vals else 0.0
            total_missed_score10 = sum(
                (r.get("score_10_not_selected") or 0) for r in audit_rows
            )
            conc_vals = [r.get("sector_concentration_flag") for r in audit_rows
                         if r.get("sector_concentration_flag") is not None]
            sector_conc_rate = (
                sum(1 for v in conc_vals if v) / len(conc_vals)
                if conc_vals else 0.0
            )
        else:
            avg_mean_score = 0.0
            total_missed_score10 = 0
            sector_conc_rate = 0.0

        selection_efficiency = {
            "avg_mean_score": _r4(avg_mean_score) or 0.0,
            "total_missed_score10": int(total_missed_score10),
            "sector_concentration_rate": _r4(sector_conc_rate) or 0.0,
        }

        # ---- trend_clusters (7d) ---------------------------------------
        cluster_rows: list[dict] = []
        try:
            resp = (
                supabase.table("trend_clusters")
                .select("label, strength_score, confidence_score, "
                        "surfaced_anywhere, underrepresented_flag, "
                        "novelty_score, top_themes")
                .eq("brief_type", brief_type)
                .gte("created_at", cutoff)
                .execute()
            )
            cluster_rows = resp.data or []
        except Exception as e:
            logger.warning("weekly_digest: trend_clusters fetch failed: %s", e)

        novelty_vals = [r.get("novelty_score") for r in cluster_rows
                        if r.get("novelty_score") is not None]
        avg_novelty = (sum(novelty_vals) / len(novelty_vals)) if novelty_vals else 0.0

        # Top 5 clusters by strength
        top_by_strength = sorted(
            cluster_rows,
            key=lambda r: (r.get("strength_score") or 0.0),
            reverse=True,
        )[:5]
        top_clusters = [
            {
                "label": r.get("label") or "—",
                "strength": _r4(r.get("strength_score")) or 0.0,
                "confidence": _r4(r.get("confidence_score")) or 0.0,
                "surfaced": bool(r.get("surfaced_anywhere")),
            }
            for r in top_by_strength
        ]

        # Underrepresented clusters, sorted by confidence desc
        underrep_sorted = sorted(
            (r for r in cluster_rows if r.get("underrepresented_flag")),
            key=lambda r: (r.get("confidence_score") or 0.0),
            reverse=True,
        )
        underrepresented_clusters = [
            {
                "label": r.get("label") or "—",
                "confidence": _r4(r.get("confidence_score")) or 0.0,
                "novelty": _r4(r.get("novelty_score")) or 0.0,
            }
            for r in underrep_sorted
        ]

        # Recurring themes — flatten top_themes jsonb arrays across all clusters
        theme_counter: Counter = Counter()
        for r in cluster_rows:
            themes = _safe_json(r.get("top_themes"), [])
            if isinstance(themes, list):
                theme_counter.update(str(t) for t in themes if t is not None)
        recurring_themes = [name for name, _ in theme_counter.most_common(10)]

        cluster_intelligence = {
            "avg_novelty_score": _r4(avg_novelty) or 0.0,
            "top_clusters": top_clusters,
            "underrepresented_clusters": underrepresented_clusters,
            "recurring_themes": recurring_themes,
        }

        # ---- Assemble digest (pre-Gemini) ------------------------------
        digest: dict = {
            "period": "7d",
            "brief_type": brief_type,
            "generated_at": generated_at.isoformat(),
            "pipeline_health": pipeline_health,
            "quality_trends": quality_trends,
            "selection_efficiency": selection_efficiency,
            "cluster_intelligence": cluster_intelligence,
            "gemini_digest": "",
            "thesis_prompt_addendum": "",
        }

        # ---- Gemini call 1: narrative digest ---------------------------
        gemini_digest = ""
        if gemini_client is not None:
            try:
                narrative_input = {
                    k: v for k, v in digest.items()
                    if k not in ("gemini_digest", "thesis_prompt_addendum")
                }
                prompt = (
                    "Here is the last 7 days of pipeline performance and market "
                    f"intelligence data for the {brief_type} brief:\n\n"
                    f"```json\n{json.dumps(narrative_input, indent=2)}\n```\n\n"
                    "Write a 200-250 word weekly digest covering:\n"
                    "1. Pipeline health (runs, success rate, duration trends).\n"
                    "2. Quality issues to address (headline pass rate, banned "
                    "phrases, recurring soft flags).\n"
                    "3. Which market trends are underrepresented and why they matter.\n"
                    "4. One concrete recommendation to improve selection or "
                    "synthesis quality next week.\n\n"
                    "Write in plain prose for engineering + editorial operators. "
                    "No markdown headers, no bullets — just tight paragraphs."
                )
                gemini_digest = _gemini_generate(
                    system=_WEEKLY_DIGEST_SYSTEM,
                    user_content=prompt,
                    temperature=0.4,
                    max_tokens=1024,
                )
            except Exception as e:
                logger.warning("weekly_digest: gemini narrative call failed: %s", e)
        else:
            logger.warning("weekly_digest: skipping narrative — Gemini client unavailable")
        digest["gemini_digest"] = gemini_digest

        # ---- Gemini call 2: thesis prompt addendum ---------------------
        # Pull top patterns from pattern_library so the addendum can cite
        # real win rates from graded thesis history. Never blocks on failure.
        top_pattern_rows: list[dict] = []
        try:
            import pattern_memory  # local import — avoid circular import at boot
            top_pattern_rows = pattern_memory.top_patterns(limit=5, min_n=5)
        except Exception as e:
            logger.warning("weekly_digest: top patterns lookup failed: %s", e)

        thesis_addendum = ""
        if gemini_client is not None:
            try:
                addendum_input = {
                    "recurring_soft_flags": recurring_soft_flags,
                    "underrepresented_clusters": underrepresented_clusters,
                    "recurring_themes": recurring_themes,
                    "total_missed_score10": int(total_missed_score10),
                    "top_patterns": top_pattern_rows,
                }
                prompt = (
                    "Given this weekly pipeline feedback:\n\n"
                    f"```json\n{json.dumps(addendum_input, indent=2)}\n```\n\n"
                    "If there are more than 5 underrepresented clusters, name only "
                    "the top 3 by confidence score. Do not list all clusters.\n\n"
                    "Generate a 3-5 sentence addendum that:\n"
                    "1. Instructs the thesis generator to prioritize the top "
                    "underrepresented clusters by their label name.\n"
                    "2. Warns against any patterns matching the recurring soft flags.\n"
                    "3. Notes the most recurring market themes to weave into "
                    "thesis framing.\n"
                    "4. If top_patterns is non-empty, cite at least one historical "
                    "pattern with its exact win_rate (e.g. 'Energy theses on 30d "
                    "horizon with positive analyst consensus confirm at 71%') so "
                    "the generator can calibrate confidence based on prior graded theses.\n\n"
                    "Format: a single plain paragraph, no headers, no bullets, "
                    "no preamble. This text will be appended directly to a thesis "
                    "generation system prompt."
                )
                thesis_addendum = _gemini_generate(
                    system=_THESIS_ADDENDUM_SYSTEM,
                    user_content=prompt,
                    temperature=0.3,
                    max_tokens=1024,
                )
            except Exception as e:
                logger.warning("weekly_digest: gemini addendum call failed: %s", e)
        else:
            logger.warning("weekly_digest: skipping addendum — Gemini client unavailable")
        digest["thesis_prompt_addendum"] = thesis_addendum

        # ---- Write to Supabase -----------------------------------------
        # supabase-py upsert() requires a unique constraint we have not declared
        # on (brief_type, period, generated_at::date), so we do a plain insert.
        # The weekly cron runs once per brief_type per week, so duplicates are
        # not expected; if they occur the generated_at index keeps the most
        # recent row queryable via ORDER BY generated_at DESC LIMIT 1.
        try:
            row = {
                "brief_type": brief_type,
                "generated_at": generated_at.isoformat(),
                "period": "7d",
                "digest_json": digest,
                "gemini_digest": gemini_digest or None,
                "thesis_prompt_addendum": thesis_addendum or None,
            }
            supabase.table("weekly_digests").insert(row).execute()
            logger.info(
                "weekly_digest: wrote row brief_type=%s runs=%d top_clusters=%d "
                "underrep=%d",
                brief_type, total_runs, len(top_clusters),
                len(underrepresented_clusters),
            )
        except Exception as e:
            logger.error(
                "weekly_digest: insert into weekly_digests failed "
                "(dict still returned): %s — ensure WEEKLY_DIGESTS_DDL has been "
                "executed in Supabase", e,
            )

        return digest

    except Exception as e:
        logger.error("summarize.generate_weekly_digest crashed: %s", e)
        return {}


# ==========================================================================
# Function 3 — latest thesis prompt addendum (frontend loop closer)
# ==========================================================================

def get_latest_thesis_addendum(brief_type: str) -> str | None:
    """
    Return the most recent thesis_prompt_addendum for this brief_type,
    or None if no rows exist (or the read fails).

    The frontend thesis generation flow calls this (directly in Python or
    via an equivalent Supabase query in TypeScript) and appends the result
    to the thesis generation system prompt as described in the module
    docstring.
    """
    try:
        resp = (
            supabase.table("weekly_digests")
            .select("thesis_prompt_addendum")
            .eq("brief_type", brief_type)
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return None
        val = resp.data[0].get("thesis_prompt_addendum")
        return val if val else None
    except Exception as e:
        logger.error("summarize.get_latest_thesis_addendum failed: %s", e)
        return None
