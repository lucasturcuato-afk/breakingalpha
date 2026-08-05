"""
brief_feedback_loop.py — Signalera Brief Feedback Loop

Two functions:

  1. score_brief(brief_text, brief_type, run_id)
     Sends a completed brief to Gemini 2.5 Flash for quality scoring on
     signal clarity, source diversity, actionability, and novelty. Stores
     the LLM scores in the brief_quality_scores.soft_flags JSONB column.

  2. build_brief_improvement_addendum(brief_type, lookback_days=7)
     Aggregates recent LLM quality scores, recurring weaknesses, and top
     pattern_library rows by win_rate, then asks Gemini for a 4-6 sentence
     improvement directive to prepend to the synthesis system prompt.

     The `source_credibility` top-N block was REMOVED. It selected the top 5
     rows ORDER BY win_rate DESC with no minimum sample size, and that table's
     win_rate counts unresolved theses as losses, so the rows it surfaced were
     the three sources sitting at a perfect 1.0 on a SINGLE thesis each. Naming
     those to the model as "sources to lean into" is a confident instruction
     built on one observation.

Wired into backend/run.py as soft-fail steps after synthesize.run().
"""

from __future__ import annotations

import os
import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone, timedelta

from supabase import create_client
from google import genai
from google.genai import types


logger = logging.getLogger(__name__)

# --- Clients ---------------------------------------------------------------

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

try:
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
except Exception as e:
    gemini_client = None
    logger.warning("brief_feedback_loop: Gemini client unavailable at import (%s)", e)

from models import GEMINI_MODEL


# ==========================================================================
# Internal helpers
# ==========================================================================

def _gemini_generate(system: str, user_content: str,
                     temperature: float = 0.3, max_tokens: int = 1200) -> str:
    """Shared Gemini call matching synthesize.py / summarize.py pattern."""
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


def _parse_json_robustly(raw: str) -> dict:
    """Strip markdown code fences and parse JSON, with fallback extraction."""
    cleaned = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Fallback: extract first {...} block
    match = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    raise ValueError(f"Could not parse JSON from: {raw[:200]}")


# ==========================================================================
# Function 1 — score_brief
# ==========================================================================

_SCORE_SYSTEM = (
    "You are a senior market analyst. Score this AI-generated brief on:\n"
    " 1. Signal clarity (0-10): Are the key market signals clearly surfaced?\n"
    " 2. Source diversity (0-10): Does it draw from multiple source types?\n"
    " 3. Actionability (0-10): Can an analyst act on this information?\n"
    " 4. Novelty (0-10): Does it surface non-obvious insights?\n"
    " 5. Identified weaknesses (list): What patterns should be avoided in future briefs?\n"
    "Return JSON only, no code fences:\n"
    '{"signal_clarity": N, "source_diversity": N, "actionability": N, '
    '"novelty": N, "weaknesses": ["..."]}'
)


def score_brief(brief_text: str, brief_type: str, run_id: str | None) -> dict:
    """
    Send brief_text to Gemini for quality scoring. Store results in the
    brief_quality_scores.soft_flags JSONB column.

    Returns the parsed scores dict on success, {} on failure.
    """
    try:
        raw = _gemini_generate(
            system=_SCORE_SYSTEM,
            user_content=f"Brief to evaluate:\n\n{brief_text}",
            temperature=0.3,
            max_tokens=1200,
        )
        scores = _parse_json_robustly(raw)

        # Build soft_flags payload
        soft_flags = {
            "llm_scores": {
                "signal_clarity": scores.get("signal_clarity"),
                "source_diversity": scores.get("source_diversity"),
                "actionability": scores.get("actionability"),
                "novelty": scores.get("novelty"),
            },
            "llm_weaknesses": scores.get("weaknesses", []),
        }

        # Insert into brief_quality_scores
        row = {
            "run_id": run_id,
            "brief_type": brief_type,
            "status": "success",
            "soft_flags": json.dumps(soft_flags),
        }
        supabase.table("brief_quality_scores").insert(row).execute()
        logger.info("score_brief: stored LLM scores for run_id=%s", run_id)

        return scores

    except Exception as e:
        logger.error("score_brief failed: %s", e)
        return {}


# ==========================================================================
# Function 2 — build_brief_improvement_addendum
# ==========================================================================

_IMPROVEMENT_SYSTEM = (
    "You are generating a feedback addendum that will be prepended to an AI "
    "market briefing synthesis prompt. Be concise, directive, and specific. "
    "Write 4-6 sentences of plain prose. No headers, no bullets, no preamble."
)


def build_brief_improvement_addendum(brief_type: str, lookback_days: int = 7) -> str:
    """
    Aggregate recent LLM quality scores and weaknesses, combine with
    pattern_library top performers, then ask Gemini for a 4-6 sentence
    improvement directive. Source credibility is deliberately NOT included;
    see the module docstring.

    Returns the directive string, or "" on failure.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

        # ---- Recent quality scores from soft_flags -------------------------
        quality_rows: list[dict] = []
        try:
            resp = (
                supabase.table("brief_quality_scores")
                .select("soft_flags")
                .eq("brief_type", brief_type)
                .gte("created_at", cutoff)
                .not_.is_("soft_flags", "null")
                .execute()
            )
            quality_rows = resp.data or []
        except Exception as e:
            logger.warning("build_brief_improvement_addendum: quality fetch failed: %s", e)

        # Extract LLM scores and compute averages
        score_keys = ["signal_clarity", "source_diversity", "actionability", "novelty"]
        score_totals = {k: [] for k in score_keys}
        weakness_counter: Counter = Counter()

        for row in quality_rows:
            sf = row.get("soft_flags")
            if isinstance(sf, str):
                try:
                    sf = json.loads(sf)
                except Exception:
                    continue
            if not isinstance(sf, dict):
                continue

            llm_scores = sf.get("llm_scores", {})
            if isinstance(llm_scores, dict):
                for k in score_keys:
                    val = llm_scores.get(k)
                    if val is not None:
                        try:
                            score_totals[k].append(float(val))
                        except (ValueError, TypeError):
                            pass

            weaknesses = sf.get("llm_weaknesses", [])
            if isinstance(weaknesses, list):
                weakness_counter.update(str(w) for w in weaknesses if w)

        score_averages = {}
        for k in score_keys:
            vals = score_totals[k]
            if vals:
                score_averages[k] = round(sum(vals) / len(vals), 2)

        # Weaknesses appearing in 3+ rows
        recurring_weaknesses = [w for w, count in weakness_counter.items() if count >= 3]

        # ---- Top pattern_library rows by win_rate --------------------------
        top_patterns: list[dict] = []
        try:
            resp = (
                supabase.table("pattern_library")
                .select("sector, horizon, dominant_signal, win_rate, n_observed")
                .gte("n_observed", 5)
                .order("win_rate", desc=True)
                .limit(5)
                .execute()
            )
            top_patterns = resp.data or []
        except Exception as e:
            logger.warning("build_brief_improvement_addendum: pattern_library fetch failed: %s", e)

        # ---- source_credibility block REMOVED ------------------------------
        # It was `select(source, win_rate, n_theses).order(win_rate desc).limit(5)`
        # with NO sample-size filter, feeding "sources to lean into" into the
        # synthesis prompt. See the module docstring for why that ranking is
        # meaningless: win_rate = n_confirmed / n_theses counts inconclusive and
        # ungradable in the denominator, so 18 of 22 sources read 0.0 and the
        # top of the sort is whoever has one lucky thesis. Do not reinstate this
        # until an outcome-based signal clears a sample bar; see
        # backend/source_reliability.py (today: 0 identities at n>=10).

        # ---- Build Gemini prompt -------------------------------------------
        aggregates = {
            "score_averages": score_averages,
            "recurring_weaknesses": recurring_weaknesses,
            "n_briefs_analyzed": len(quality_rows),
            "top_patterns": top_patterns,
        }

        prompt = (
            f"Given this {lookback_days}-day quality feedback for the "
            f"{brief_type} brief:\n\n"
            f"```json\n{json.dumps(aggregates, indent=2)}\n```\n\n"
            "Generate a 4-6 sentence improvement directive for the next "
            "brief generation. Address:\n"
            "1. Which quality dimensions need the most improvement based "
            "on average scores.\n"
            "2. Recurring weaknesses to avoid.\n"
            "3. High-win-rate patterns to lean into.\n\n"
            "Write plain prose — no headers, no bullets, no preamble. "
            "This text will be prepended directly to a synthesis system prompt."
        )

        addendum = _gemini_generate(
            system=_IMPROVEMENT_SYSTEM,
            user_content=prompt,
            temperature=0.3,
            max_tokens=1200,
        )
        logger.info(
            "build_brief_improvement_addendum: generated %d-char addendum "
            "for brief_type=%s from %d quality rows",
            len(addendum), brief_type, len(quality_rows),
        )
        return addendum

    except Exception as e:
        logger.error("build_brief_improvement_addendum failed: %s", e)
        return ""
