"""
adversarial.py — Signalera Adversarial Thesis Testing (Phase 4)

Runs a two-step adversarial review on each thesis:

    1. Ask Gemini to argue the strongest bear case against the thesis
       given its supporting articles (or just the rationale if no
       articles resolve).
    2. Ask Gemini to score bull vs bear on a 0–1 scale and return JSON.

A thesis "passes" when bull > bear.

Per the Phase 0 recon notes the real thesis-generation path is in the
TypeScript API route `src/app/api/theses/route.ts`, so this module runs
as a BATCH step in `run.py` that processes every thesis row where
`passed_adversarial IS NULL`. Downstream consumers filter on
`passed_adversarial = true` to surface only reviewed theses.

All public functions are wrapped in try/except and return None on
failure — the pipeline never crashes from this module.
"""

import os
import json
import logging
from datetime import datetime, timezone

from supabase import create_client
from google import genai
from google.genai.types import GenerateContentConfig, ThinkingConfig


logger = logging.getLogger(__name__)


supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

try:
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
except Exception as e:
    gemini_client = None
    logger.warning("adversarial: Gemini client unavailable (%s)", e)

GEMINI_MODEL = "gemini-2.5-flash"


# ==========================================================================
# DDL — paste into Supabase SQL editor ONCE before this module runs
# ==========================================================================
ADVERSARIAL_DDL = """
-- Signalera adversarial thesis testing
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

alter table theses add column if not exists bear_case          text;
alter table theses add column if not exists adversarial_score  numeric;
alter table theses add column if not exists passed_adversarial boolean;

create index if not exists theses_passed_adversarial_idx
    on theses (passed_adversarial);
"""


# ==========================================================================
# Helpers
# ==========================================================================

def _r4(v):
    """Round a float to 4dp for Supabase storage; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except Exception:
        return None


def _preflight_schema() -> bool:
    """Verify the new columns exist. Returns False (and logs DDL) on miss."""
    try:
        supabase.table("theses").select(
            "id, bear_case, adversarial_score, passed_adversarial"
        ).limit(1).execute()
        return True
    except Exception as e:
        logger.error(
            "adversarial: missing columns on theses (%s). "
            "RUN THIS IN SUPABASE SQL EDITOR:\n%s",
            e, ADVERSARIAL_DDL,
        )
        return False


def _fetch_supporting_articles(article_ids) -> list[dict]:
    """Pull the supporting articles for a thesis. Soft-fail."""
    if not article_ids:
        return []
    if isinstance(article_ids, str):
        try:
            article_ids = json.loads(article_ids)
        except Exception:
            return []
    if not isinstance(article_ids, list) or not article_ids:
        return []
    try:
        resp = (
            supabase.table("articles")
            .select("id, title, summary")
            .in_("id", article_ids)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.warning("adversarial: article fetch failed: %s", e)
        return []


# ==========================================================================
# Gemini calls
# ==========================================================================

_BEAR_SYSTEM = (
    "You are a short-seller at a prominent hedge fund. Given an investment "
    "thesis and the supporting articles its author used, argue the strongest "
    "bear case against it. Be specific — name the weakest assumption, the "
    "most likely failure mode, and any data that contradicts the thesis. "
    "Write a single tight paragraph, no preamble."
)


_SCORE_SYSTEM = (
    "You are an investment committee. Given a thesis, its author's bull "
    "rationale, and a short-seller's bear rebuttal, score each side on a "
    "0–1 scale where 1 = extremely compelling and 0 = no support at all. "
    "Return ONLY valid JSON, no preamble."
)


def _gemini_call(system: str, user_content: str, max_tokens: int = 800,
                 temperature: float = 0.3, json_mime: bool = False) -> str:
    """Shared Gemini helper with thinking disabled."""
    if gemini_client is None:
        raise RuntimeError("Gemini client not initialized")
    cfg_kwargs = dict(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_tokens,
        thinking_config=ThinkingConfig(thinking_budget=0),
    )
    if json_mime:
        cfg_kwargs["response_mime_type"] = "application/json"
    resp = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_content,
        config=GenerateContentConfig(**cfg_kwargs),
    )
    return (resp.text or "").strip()


def generate_bear_case(thesis: dict, articles: list[dict]) -> str:
    """Return a single paragraph bear case. Empty string on failure."""
    try:
        article_block = "\n".join(
            f"- {a.get('title','')}: {(a.get('summary','') or '')[:200]}"
            for a in articles[:5]
        ) or "(no supporting articles resolved)"

        prompt = (
            f"Thesis: {thesis.get('title','')}\n"
            f"Conviction: {thesis.get('conviction','')}\n"
            f"Sector: {thesis.get('sector','')}\n"
            f"Rationale:\n{thesis.get('rationale','')}\n\n"
            f"Catalyst:\n{thesis.get('catalyst','')}\n\n"
            f"Supporting articles:\n{article_block}\n\n"
            "Argue the strongest bear case against this thesis given the evidence above."
        )
        return _gemini_call(_BEAR_SYSTEM, prompt, max_tokens=800, temperature=0.4)
    except Exception as e:
        logger.warning("adversarial: bear case generation failed: %s", e)
        return ""


def score_bull_vs_bear(thesis: dict, bear_case: str) -> dict:
    """Return {bull, bear} scores in [0,1]. Defaults to {0.5, 0.5} on failure."""
    try:
        prompt = (
            f"Thesis title: {thesis.get('title','')}\n"
            f"Bull rationale:\n{thesis.get('rationale','')}\n\n"
            f"Bear rebuttal:\n{bear_case}\n\n"
            'Return JSON exactly like: {"bull": 0.72, "bear": 0.41}. '
            "Numbers are floats in [0,1]."
        )
        raw = _gemini_call(
            _SCORE_SYSTEM, prompt,
            max_tokens=128, temperature=0.1, json_mime=True,
        )
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        bull = float(parsed.get("bull", 0.5))
        bear = float(parsed.get("bear", 0.5))
        bull = max(0.0, min(1.0, bull))
        bear = max(0.0, min(1.0, bear))
        return {"bull": bull, "bear": bear}
    except Exception as e:
        logger.warning("adversarial: scoring failed: %s", e)
        return {"bull": 0.5, "bear": 0.5}


# ==========================================================================
# Per-thesis adversarial review
# ==========================================================================

def run_bear_case(thesis: dict) -> dict | None:
    """
    Run the full adversarial pipeline for one thesis and update its row.
    Returns the update payload on success, None on failure.

    passed_adversarial is True when bull > bear. adversarial_score stores
    the delta (bull - bear) rounded to 4dp so downstream consumers can
    rank by margin.
    """
    thesis_id = thesis.get("id")
    if not thesis_id:
        return None

    try:
        articles = _fetch_supporting_articles(thesis.get("supporting_articles"))
        bear_case = generate_bear_case(thesis, articles)
        scores = score_bull_vs_bear(thesis, bear_case)

        delta = scores["bull"] - scores["bear"]
        passed = scores["bull"] > scores["bear"]

        update = {
            "bear_case": bear_case or None,
            "adversarial_score": _r4(delta),
            "passed_adversarial": bool(passed),
        }
        supabase.table("theses").update(update).eq("id", thesis_id).execute()
        logger.info(
            "adversarial: %s bull=%.2f bear=%.2f passed=%s",
            thesis_id, scores["bull"], scores["bear"], passed,
        )
        return update
    except Exception as e:
        logger.exception("adversarial: run_bear_case failed for %s: %s", thesis_id, e)
        return None


# ==========================================================================
# main()
# ==========================================================================

def main() -> dict | None:
    """
    Find every thesis where `passed_adversarial IS NULL` and run the
    bear-case review. Returns a summary dict.
    """
    try:
        if not _preflight_schema():
            return None
        resp = (
            supabase.table("theses")
            .select(
                "id, title, conviction, sector, rationale, catalyst, "
                "supporting_articles, passed_adversarial"
            )
            .is_("passed_adversarial", "null")
            .order("generated_at", desc=True)
            .limit(50)
            .execute()
        )
        rows = resp.data or []
        reviewed = 0
        for t in rows:
            if run_bear_case(t) is not None:
                reviewed += 1
        print(f"  [adversarial] reviewed={reviewed}/{len(rows)}")
        logger.info("adversarial: reviewed %d/%d", reviewed, len(rows))
        return {"candidates": len(rows), "reviewed": reviewed}
    except Exception as e:
        logger.exception("adversarial.main crashed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
