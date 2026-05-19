"""Route output_type to the appropriate grader function."""
from __future__ import annotations

from typing import Callable, Optional

from supabase import Client

from backend.outcome.types import GradeResult
from backend.outcome.graders import (
    memo,
    brief_section,
    brief_rollup,
    chat_answer,
    thesis_adapter,
    thesis_grade_meta,
    contrarian,
    deal_extraction,
    engagement_only,
)

GraderFn = Callable[[Client, dict, int], GradeResult]

GRADER_REGISTRY: dict[str, GraderFn] = {
    "memo": memo.grade,
    "brief_section": brief_section.grade,
    "brief": brief_rollup.grade,
    "chat_answer": chat_answer.grade,
    "thesis": thesis_adapter.grade,
    "thesis_grade": thesis_grade_meta.grade,
    "contrarian_signal": contrarian.grade,
    "deal_extraction": deal_extraction.grade,
    "user_addendum": engagement_only.grade,
    "mention_alert": engagement_only.grade,
    "cross_reference": engagement_only.grade,
}

# Windows per output type. The evaluator grades each output at each
# applicable window once the output has aged past that many days.
WINDOWS_BY_TYPE: dict[str, list[int]] = {
    "memo": [30, 60],
    "brief_section": [7, 30],
    "brief": [30],  # rollup after child sections
    "chat_answer": [3],
    "thesis": [30, 90],
    "thesis_grade": [90],
    "contrarian_signal": [30, 60],
    "deal_extraction": [7, 30, 60],
    "user_addendum": [7],
    "mention_alert": [7],
    "cross_reference": [7],
}

# Types that cost $0 (no LLM call)
TIER_1_TYPES = {"thesis", "thesis_grade", "brief", "user_addendum", "mention_alert", "cross_reference"}
# Types that use Gemini Flash
TIER_2_TYPES = {"memo", "brief_section", "chat_answer", "contrarian_signal", "deal_extraction"}
