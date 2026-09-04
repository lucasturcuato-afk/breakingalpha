"""
Universal output recorder. Writes to the `outputs` table for every AI-generated
output in Signalera. This is the foundation for feedback collection, outcome
grading, and cross-output learning.
"""
from __future__ import annotations

import logging
from typing import Any, Optional, Literal
from uuid import UUID

from supabase import Client

logger = logging.getLogger(__name__)

# Every value this codebase is allowed to write to `outputs.output_type`.
#
# THE THIRD LIST. There are three statements of one fact:
#
#   A. this Literal                        written by a developer editing Python
#   B. OUTPUT_TYPES in src/lib/outputs.ts  written by a developer editing TS
#   C. public.output_type_enum             written by Postgres, and the only one
#                                          that decides anything at runtime
#
# A and B are claims ABOUT C. Postgres rejects a non-member with SQLSTATE 22P02
# and the supabase client surfaces that without raising, so a list that runs
# ahead of the enum fails silently, forever, at runtime only. That is exactly
# what 'company_overview' did on the TypeScript side.
#
# This list had drifted to 14 members against an enum of 16, with nothing
# comparing them. It is now pinned to tests/fixtures/output-type-enum.json,
# which is captured FROM the database by scripts/capture-output-type-enum.mjs
# and is not hand-authored. backend/tests/test_output_type_enum.py enforces it,
# and enforces separately that every output_type any backend module actually
# passes to record_output is a member here. Adding a value requires a migration
# that adds the same value to output_type_enum, declared under "pending" in that
# fixture.
OutputType = Literal[
    'memo', 'brief', 'brief_cluster', 'brief_section', 'chat_answer',
    'thesis', 'thesis_grade', 'contrarian_signal', 'deal_extraction',
    'user_addendum', 'mention_alert', 'cross_reference',
    'sec_filing', 'insider_transaction',
    'radar_clusters', 'radar_cluster_label',
    'company_overview',
]


def record_output(
    supabase: Client,
    *,
    output_type: OutputType,
    content: dict[str, Any],
    generation_context: Optional[dict[str, Any]] = None,
    user_id: Optional[str | UUID] = None,
    source_table: Optional[str] = None,
    source_id: Optional[str | UUID] = None,
) -> Optional[str]:
    """
    Record a generated output. Returns the output id (UUID string) on success, None on failure.
    Failures are logged but do not raise — recording must never block generation.
    """
    try:
        payload: dict[str, Any] = {
            'output_type': output_type,
            'content': content,
            'generation_context': generation_context or {},
        }
        if user_id is not None:
            payload['user_id'] = str(user_id)
        if source_table is not None:
            payload['source_table'] = source_table
        if source_id is not None:
            payload['source_id'] = str(source_id)

        result = supabase.table('outputs').insert(payload).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]['id']
        return None
    except Exception as e:
        logger.error("[outputs] Failed to record %s: %s", output_type, e)
        return None


def record_outputs_batch(
    supabase: Client,
    rows: list[dict[str, Any]],
) -> list[Optional[str]]:
    """
    Batch-insert multiple output rows. Used for brief clusters where one brief
    generation produces many output rows.
    Each dict in `rows` should have the same shape as the kwargs of record_output.
    Returns list of output ids (or None for any that failed) in the same order.
    """
    if not rows:
        return []
    try:
        payloads = []
        for r in rows:
            p: dict[str, Any] = {
                'output_type': r['output_type'],
                'content': r['content'],
                'generation_context': r.get('generation_context') or {},
            }
            if r.get('user_id') is not None:
                p['user_id'] = str(r['user_id'])
            if r.get('source_table') is not None:
                p['source_table'] = r['source_table']
            if r.get('source_id') is not None:
                p['source_id'] = str(r['source_id'])
            payloads.append(p)

        result = supabase.table('outputs').insert(payloads).execute()
        if result.data:
            return [row['id'] for row in result.data]
        return [None] * len(rows)
    except Exception as e:
        logger.error("[outputs] Batch insert failed (%d rows): %s", len(rows), e)
        return [None] * len(rows)
