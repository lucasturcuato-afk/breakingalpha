"""Shared Gemini calling logic for Tier 2 graders. Matches thesis_grader.py patterns."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_INPUT_PRICE_PER_TOKEN = 0.30 / 1_000_000
GEMINI_OUTPUT_PRICE_PER_TOKEN = 2.50 / 1_000_000

_PROMPTS_DIR = Path(__file__).parent / "prompts"

# Lazy init — match thesis_grader soft-fail pattern
_client = None
_init_attempted = False


def _get_client():
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True
    try:
        from google import genai
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    except Exception as e:
        logger.warning("outcome/gemini: client unavailable (%s)", e)
        _client = None
    return _client


def load_prompt(name: str) -> str:
    """Load a prompt template from outcome/prompts/{name}.txt."""
    path = _PROMPTS_DIR / f"{name}.txt"
    return path.read_text(encoding="utf-8")


def estimate_cost(usage: Any) -> float:
    """Compute USD cost from Gemini usage_metadata."""
    if usage is None:
        return 0.0
    try:
        in_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        out_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
    except Exception:
        return 0.0
    return round(
        in_tokens * GEMINI_INPUT_PRICE_PER_TOKEN
        + out_tokens * GEMINI_OUTPUT_PRICE_PER_TOKEN,
        6,
    )


def call_gemini_json(
    system: str,
    user: str,
    temperature: float = 0.2,
    max_output_tokens: int = 512,
) -> tuple[Optional[dict], float]:
    """
    Call Gemini with strict JSON output. Retry once on parse failure.
    Returns (parsed_dict, cost_usd). Returns (None, cost) on failure.
    """
    client = _get_client()
    if client is None:
        return None, 0.0

    from google.genai.types import GenerateContentConfig, ThinkingConfig

    config = GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json",
        thinking_config=ThinkingConfig(thinking_budget=0),
    )

    total_cost = 0.0
    last_raw = ""

    for attempt in (1, 2):
        try:
            resp = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=user,
                config=config,
            )
            usage = getattr(resp, "usage_metadata", None)
            total_cost += estimate_cost(usage)
            raw = resp.text or ""
            last_raw = raw

            # Strip code fences if present
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                lines = lines[1:]  # remove opening fence
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned = "\n".join(lines)

            parsed = json.loads(cleaned)
            return parsed, total_cost

        except json.JSONDecodeError as e:
            logger.warning(
                "outcome/gemini: JSON parse failure attempt=%d err=%s raw=%s",
                attempt, e, last_raw[:400],
            )
            if attempt == 2:
                return None, total_cost
        except Exception as e:
            logger.warning("outcome/gemini: call failure attempt=%d err=%s", attempt, e)
            if attempt == 2:
                return None, total_cost

    return None, total_cost
