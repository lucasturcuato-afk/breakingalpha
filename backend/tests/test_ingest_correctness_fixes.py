"""Three verified correctness bugs from scratch/INGEST_RECON.md.

1. content_type was set from the article's SOURCE at fetch time, while
   articles.content is only ever written by the Tail-A enrichment pass, which
   covers a DISJOINT set of sources. Measured full-table before the fix: 1,768
   rows claimed full_text (exactly SEC 8-K 976 + SEC 10-Q 730 + Federal Reserve
   62) and ZERO held content, while all 5,635 rows that DID hold content were
   labelled snippet. Exactly inverted, on every row.

2. The [filter:usage] estimate priced output at $2.50/1M and input at $0.30/1M.
   Those are the full-Flash rates; the filter runs on Flash-Lite.

3. The gate comment and both funnel log lines said "passed relevance >= 6" while
   the gate has been >= RELEVANCE_NEW_GATE (1) since 2026-06-19.

The load-bearing test is
TestContentTypeIsNeverSetFromSource::test_fetch_never_labels_a_row_full_text:
nothing may claim full text before any full text exists.
"""

from __future__ import annotations

import ast
import os
import re
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-role-not-used")

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import ingest  # noqa: E402

SOURCE = (BACKEND / "ingest.py").read_text(encoding="utf-8")


def _code() -> str:
    """ingest.py with comments and docstrings stripped.

    Each fix is documented in a comment that necessarily quotes the wrong value
    it replaced, so asserting against raw source would match the explanation
    instead of the code.
    """
    tree = ast.parse(SOURCE)
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = getattr(node, "body", None)
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


# ---------------------------------------------------------------------------
# BUG 1 — content_type
# ---------------------------------------------------------------------------

class TestContentTypeIsNeverSetFromSource:
    def test_fetch_never_labels_a_row_full_text(self):
        """THE property. `content` is not populated at insert time by any path,
        so no row may claim full_text before enrichment has run."""
        code = _code()
        assert '"full_text" if source in FULL_TEXT_SOURCES' not in code
        assert "if source in FULL_TEXT_SOURCES" not in code

    def test_full_text_sources_no_longer_drives_content_type(self):
        """The constant may survive as documentation, but nothing may branch on
        it. It is the disjoint-set half of the inversion."""
        code = _code()
        uses = [ln for ln in code.splitlines() if "FULL_TEXT_SOURCES" in ln]
        assert all("=" in ln and "{" in ln for ln in uses), (
            f"FULL_TEXT_SOURCES is still read somewhere: {uses}"
        )

    def test_the_two_source_sets_are_still_disjoint(self):
        """The premise of the bug. If these ever overlap the reasoning changes."""
        from fulltext import SCRAPEABLE_SOURCES
        assert not (ingest.FULL_TEXT_SOURCES & SCRAPEABLE_SOURCES)

    def test_enrichment_writes_content_and_content_type_together(self):
        """A row gains full text and its label in the SAME update, so they can
        never disagree."""
        code = _code()
        assert re.search(
            r"update\(\s*\{\s*['\"]content['\"]:\s*full_text\s*,\s*"
            r"['\"]content_type['\"]:\s*['\"]full_text['\"]",
            code,
        ), "the enrichment update must set content and content_type together"

    def test_content_type_is_not_written_anywhere_else(self):
        """Only three forms may set it, walked via AST rather than regex so a
        dict literal spanning one long line cannot be mis-split:
          - the 'snippet' default at fetch
          - the 'full_text' promotion in the enrichment update
          - the passthrough in _article_row
        A conditional expression here would be the original bug returning."""
        allowed = {"'snippet'", "'full_text'", "article.get('content_type', 'snippet')"}
        found = set()
        for node in ast.walk(ast.parse(SOURCE)):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "content_type":
                    found.add(ast.unparse(value))
        assert found, "no content_type write found at all"
        assert found <= allowed, f"unexpected content_type write: {found - allowed}"

    def test_no_content_type_write_is_a_conditional(self):
        """The bug was literally a ternary on source. Ban the shape."""
        for node in ast.walk(ast.parse(SOURCE)):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "content_type":
                    assert not isinstance(value, ast.IfExp), (
                        f"content_type set by a conditional: {ast.unparse(value)}"
                    )


# ---------------------------------------------------------------------------
# BUG 2 — filter pricing
# ---------------------------------------------------------------------------

class TestFilterPricingMatchesTheFilterModel:
    def test_rates_are_the_flash_lite_rates(self):
        assert ingest.FILTER_INPUT_PRICE_PER_1M == 0.10
        assert ingest.FILTER_OUTPUT_PRICE_PER_1M == 0.40

    def test_the_full_flash_rates_are_gone_from_the_usage_estimate(self):
        code = _code()
        assert "2.50 / 1_000_000" not in code
        assert "0.30 / 1_000_000" not in code

    def test_per_token_constants_derive_from_the_per_million_ones(self):
        assert ingest.FILTER_INPUT_PRICE_PER_TOKEN == pytest.approx(0.10 / 1e6)
        assert ingest.FILTER_OUTPUT_PRICE_PER_TOKEN == pytest.approx(0.40 / 1e6)

    def test_the_filter_model_really_is_flash_lite(self):
        """If the filter is ever moved to full Flash these rates must move too."""
        assert "flash-lite" in ingest.FILTER_MODEL

    def test_the_printed_line_names_the_model_it_priced(self):
        code = _code()
        assert "model={FILTER_MODEL}" in code

    def test_the_estimate_still_labels_itself_estimated(self):
        assert "ESTIMATED" in _code()
        assert "meter is truth" in _code()


# ---------------------------------------------------------------------------
# BUG 3 — stale threshold statements
# ---------------------------------------------------------------------------

class TestLogsStateTheActualThreshold:
    def test_no_hardcoded_six_in_the_funnel_lines(self):
        code = _code()
        assert "passed relevance >= 6" not in code

    def test_funnel_lines_interpolate_the_real_gate(self):
        code = _code()
        assert code.count("passed relevance >= {ingest_gate}") == 2

    def test_the_gate_expression_is_unchanged(self):
        """This is a comment/log fix. The gate logic itself must not move."""
        code = _code()
        assert "ingest_gate = RELEVANCE_NEW_GATE if RELEVANCE_GRADE_MODE == 'new' else 6" in code

    def test_relevance_new_gate_default_is_still_one(self):
        assert ingest.RELEVANCE_NEW_GATE == 1


class TestCommentsMatchProduction:
    @pytest.mark.parametrize("stale", [
        "DEFAULT shadow is\n    # prod-neutral: it leaves relevance_score and the >=6 gate untouched",
        "DEFAULT OFF so merging changes nothing until Noah",
        "Under legacy/shadow it is the unchanged >=6",
    ])
    def test_stale_claim_is_gone(self, stale):
        assert stale not in SOURCE

    @pytest.mark.parametrize("required", [
        "PRODUCTION RUNS `new`",
        "PRODUCTION SETS IT TO 1",
        "IN PRODUCTION THIS IS >= RELEVANCE_NEW_GATE",
    ])
    def test_production_reality_is_stated(self, required):
        assert required in SOURCE


# ---------------------------------------------------------------------------
# Nothing else moved
# ---------------------------------------------------------------------------

class TestNoCollateralBehaviourChange:
    def test_module_compiles(self):
        compile(SOURCE, str(BACKEND / "ingest.py"), "exec")

    def test_the_primary_company_fold_is_untouched(self):
        """Explicitly out of scope for this change; it needs measuring first."""
        code = _code()
        assert "def _fold_primary_into_companies" in code
        assert "if not TAGGING_PRIMARY_FOLD_ENABLED:" in code

    def test_the_ingest_gate_predicate_is_untouched(self):
        """ast.unparse parenthesises the comparison, so assert on the parts."""
        code = _code()
        assert "result.get('relevant')" in code
        assert "result.get('relevance_score', 0) >= ingest_gate" in code

    def test_freshness_window_is_untouched(self):
        assert ingest.INGEST_FRESHNESS_DAYS == 7


class TestBackfillSqlMatchesTheCodeSemantics:
    SQL = REPO / "sql" / "0027_content_type_backfill.sql"

    def test_sql_file_exists(self):
        assert self.SQL.is_file(), f"missing {self.SQL}"

    def test_sql_demotes_rows_claiming_full_text_without_content(self):
        text = self.SQL.read_text(encoding="utf-8")
        assert re.search(
            r"SET\s+content_type\s*=\s*'snippet'\s*\n\s*WHERE\s+content_type\s*=\s*'full_text'\s*\n\s*AND\s+content\s+IS\s+NULL",
            text,
        )

    def test_sql_promotes_rows_holding_content(self):
        text = self.SQL.read_text(encoding="utf-8")
        assert re.search(
            r"SET\s+content_type\s*=\s*'full_text'\s*\n\s*WHERE\s+content\s+IS\s+NOT\s+NULL",
            text,
        )

    def test_sql_has_an_inspect_section_before_any_update(self):
        text = self.SQL.read_text(encoding="utf-8")
        assert text.index("SELECT") < text.index("UPDATE")
