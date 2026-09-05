"""sql/0038_company_facts.sql and backend/company_facts.py are two hand-written
copies of one vocabulary and one set of write-time rules. If they drift, the
extractor writes a fact_type the CHECK rejects, or a key the UNIQUE was not
designed around, and nothing catches it until an insert 400s in production.
This parses the SQL and compares, the way test_deal_type_validation holds
sql/0026 to _DEAL_TYPE_ALIASES.

The claim_key tests pin the property the schema depends on: the key is
article-independent and versioned, so UNIQUE (article_id, claim_key) is
idempotent per article and the read view can group across articles.
"""

import re
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from company_facts import (  # noqa: E402
    CLAIM_KEY_VERSION,
    CLAIM_TEXT_MAX,
    EXTRACTION_STATUSES,
    FACT_TYPES,
    PERIOD_TYPES,
    claim_key,
    round_for_key,
    text_signature,
)

SQL = Path(__file__).resolve().parents[2] / "sql" / "0038_company_facts.sql"


def _sql() -> str:
    return SQL.read_text(encoding="utf-8")


def _live_sql() -> str:
    """The SQL with comment lines removed, so a quoted example in a comment
    cannot satisfy an assertion about the DDL."""
    return "\n".join(
        line for line in _sql().splitlines() if not line.lstrip().startswith("--")
    )


def _check_set(column: str) -> tuple[str, ...]:
    """The literal set inside `CHECK (<column> IN (...))`."""
    m = re.search(rf"CHECK\s*\(\s*{column}\s+IN\s*\(([^)]*)\)", _live_sql())
    assert m, f"no CHECK ... IN for {column}"
    return tuple(re.findall(r"'([^']+)'", m.group(1)))


def _table_body(table: str) -> str:
    m = re.search(
        rf"CREATE TABLE IF NOT EXISTS public\.{table}\s*\((.*?)\n\);", _live_sql(), re.S
    )
    assert m, f"no CREATE TABLE for {table}"
    return m.group(1)


def _column_line(table: str, column: str) -> str:
    for line in _table_body(table).splitlines():
        if re.match(rf"\s*{column}\s+\w", line):
            return line
    raise AssertionError(f"{table}.{column} not declared")


class TestSqlFileExists:
    def test_sql_file_exists(self):
        assert SQL.is_file(), f"missing {SQL}"

    def test_sql_parses(self):
        """Full parse with libpg_query when it is installed locally; skipped in
        CI where pglast is not a dependency. Not a substitute for applying it."""
        pglast = pytest.importorskip("pglast")
        stmts = pglast.parse_sql(_sql())
        assert len(stmts) >= 12, "expected tables, indexes, view, policy, grants"


class TestVocabulariesMatchTheCode:
    def test_fact_type_check_matches_python(self):
        assert _check_set("fact_type") == FACT_TYPES

    def test_period_type_check_matches_python(self):
        assert _check_set("period_type") == PERIOD_TYPES

    def test_extraction_status_check_matches_python(self):
        assert _check_set("status") == EXTRACTION_STATUSES

    def test_claim_text_cap_matches_python(self):
        m = re.search(r"length\(claim_text\)\s+BETWEEN\s+1\s+AND\s+(\d+)", _live_sql())
        assert m and int(m.group(1)) == CLAIM_TEXT_MAX


class TestWriteTimeRules:
    """Each of the settled design decisions that the schema, not the extractor,
    has to enforce."""

    def test_company_id_is_nullable_and_set_null_on_delete(self):
        line = _column_line("company_facts", "company_id")
        assert "NOT NULL" not in line
        assert "ON DELETE SET NULL" in line

    def test_article_id_is_required_and_cascades(self):
        line = _column_line("company_facts", "article_id")
        assert "NOT NULL" in line and "ON DELETE CASCADE" in line

    def test_speaker_and_role_are_nullable(self):
        assert "NOT NULL" not in _column_line("company_facts", "speaker")
        assert "NOT NULL" not in _column_line("company_facts", "speaker_role")

    def test_role_without_speaker_is_rejected(self):
        assert re.search(
            r"CHECK\s*\(\s*speaker_role IS NULL OR speaker IS NOT NULL\s*\)", _live_sql()
        )

    def test_a_number_requires_its_verbatim_token(self):
        assert re.search(
            r"CHECK\s*\(\s*value_num IS NULL OR value_raw IS NOT NULL\s*\)", _live_sql()
        )

    def test_unique_id_article_for_child_tables(self):
        assert re.search(r"UNIQUE\s*\(\s*id\s*,\s*article_id\s*\)", _live_sql())

    def test_unique_article_claim_key_for_idempotent_rewrites(self):
        assert re.search(r"UNIQUE\s*\(\s*article_id\s*,\s*claim_key\s*\)", _live_sql())

    def test_no_uniqueness_spans_articles(self):
        """Dedup lives in the read view. Any UNIQUE that does not lead with
        article_id (or id) would collapse corroborating rows on write."""
        body = _table_body("company_facts")
        for cols in re.findall(r"UNIQUE\s*\(([^)]*)\)", body):
            first = cols.split(",")[0].strip()
            assert first in ("id", "article_id"), f"UNIQUE ({cols}) dedups across articles"

    def test_no_inferred_columns(self):
        body = _table_body("company_facts").lower()
        for banned in ("sentiment", "confidence", "score"):
            assert not re.search(rf"^\s*{banned}\w*\s+\w", body, re.M), f"{banned} column present"

    def test_provenance_is_copied_not_joined(self):
        assert "NOT NULL" in _column_line("company_facts", "source")
        assert "NOT NULL" in _column_line("company_facts", "as_of")
        for col in ("publisher", "publisher_domain", "article_published_at"):
            assert "NOT NULL" not in _column_line("company_facts", col), (
                f"{col} is NULL on a measured share of prose rows; it cannot be required"
            )


class TestLedger:
    def test_ledger_unique_per_article_and_version(self):
        assert re.search(
            r"UNIQUE\s*\(\s*article_id\s*,\s*extractor_version\s*\)", _live_sql()
        )

    def test_extracted_status_agrees_with_count(self):
        assert re.search(
            r"CHECK\s*\(\s*\(status = 'extracted'\) = \(facts_written > 0\)\s*\)", _live_sql()
        )


class TestIndexes:
    def _indexes(self) -> dict[str, str]:
        out = {}
        for m in re.finditer(
            r"CREATE INDEX (CONCURRENTLY )?(IF NOT EXISTS )?(\w+)\s+ON public\.(\w+)\s*\(([^)]*)\)"
            r"(\s*WHERE [^;]*)?;",
            _live_sql(),
        ):
            assert m.group(1), f"{m.group(3)} is not CONCURRENTLY (sql/0024 rule)"
            assert m.group(2), f"{m.group(3)} lacks IF NOT EXISTS"
            out[m.group(3)] = re.sub(r"\s+", " ", m.group(5)).strip() + (m.group(6) or "")
        return out

    def test_company_window_query_is_indexed(self):
        idx = self._indexes()["company_facts_company_asof_idx"]
        assert idx.startswith("company_id, as_of DESC")

    def test_type_window_query_is_indexed(self):
        idx = self._indexes()["company_facts_type_asof_idx"]
        assert idx.startswith("fact_type, as_of DESC")

    def test_unattached_backlog_is_indexed(self):
        idx = self._indexes()["company_facts_unattached_idx"]
        assert "WHERE company_id IS NULL" in idx

    def test_no_separate_article_id_index(self):
        """company_facts_article_claim_uq already leads with article_id."""
        for name, cols in self._indexes().items():
            assert not cols.startswith("article_id"), f"{name} duplicates the UNIQUE"


class TestReadView:
    def _view(self) -> str:
        m = re.search(
            r"CREATE OR REPLACE VIEW public\.company_facts_corroborated AS(.*?);", _live_sql(), re.S
        )
        assert m
        return m.group(1)

    def test_corroboration_counts_distinct_articles(self):
        assert re.search(r"count\(DISTINCT f\.article_id\)", self._view())

    def test_corroboration_never_counts_publisher(self):
        """publisher is NULL on most prose rows; a distinct-publisher count
        reads 1 for nearly everything. publisher_domain is allowed as a
        secondary column only."""
        assert not re.search(r"DISTINCT f\.publisher\)", self._view())

    def test_view_groups_on_the_indexed_filter_columns(self):
        assert re.search(r"GROUP BY f\.company_id, f\.fact_type, f\.claim_key", self._view())

    def test_view_does_not_order_by_the_wide_column(self):
        assert "claim_text" not in self._view(), "claim_text is hydrated by id, never grouped/sorted"


class TestClaimKey:
    def test_key_is_versioned(self):
        assert claim_key("event", "Acme acquired Beta.").startswith(CLAIM_KEY_VERSION + "|")

    def test_key_is_article_independent(self):
        """No article input exists, so two articles with the same sentence get
        the same key: that is what the read view groups on."""
        a = claim_key("commentary", "Coverage flagged capex pressure.", company_id="c1")
        b = claim_key("commentary", "Coverage flagged capex pressure.", company_id="c1")
        assert a == b

    def test_company_is_folded_in(self):
        a = claim_key("event", "Acme and Beta merged.", company_id="c1")
        b = claim_key("event", "Acme and Beta merged.", company_id="c2")
        n = claim_key("event", "Acme and Beta merged.", company_id=None)
        assert len({a, b, n}) == 3
        assert "|none|" in n

    def test_money_within_tolerance_shares_a_key(self):
        a = claim_key("figure", "Revenue was $4.2 billion.", company_id="c",
                      metric_key="revenue", value_num=4.2e9, value_unit="USD")
        b = claim_key("figure", "Revenue came in at $4.15B.", company_id="c",
                      metric_key="revenue", value_num=4.15e9, value_unit="usd")
        assert a == b

    def test_different_periods_do_not_share_a_key(self):
        a = claim_key("guidance", "x", company_id="c", metric_key="revenue",
                      value_num=1e9, value_unit="USD", period_end=date(2026, 12, 31))
        b = claim_key("guidance", "x", company_id="c", metric_key="revenue",
                      value_num=1e9, value_unit="USD", period_end=date(2027, 12, 31))
        assert a != b

    def test_unlabelled_figure_falls_back_to_the_sentence(self):
        """An unnamed $17B must not corroborate a different $17B."""
        a = claim_key("figure", "The buyback totals $17 billion.", company_id="c",
                      value_num=17e9, value_unit="USD")
        b = claim_key("figure", "Revenue reached $17 billion.", company_id="c",
                      value_num=17e9, value_unit="USD")
        assert a != b
        assert a == claim_key("figure", "The buyback totals $17 billion.", company_id="c")

    def test_text_signature_is_order_and_punctuation_insensitive(self):
        assert text_signature("Nvidia flagged capex pressure.") == text_signature(
            "capex PRESSURE, flagged: Nvidia"
        )
        assert text_signature("Nvidia flagged capex pressure.") != text_signature(
            "Nvidia flagged margin pressure."
        )

    def test_percent_rounds_to_the_absolute_tolerance(self):
        assert round_for_key(71.4, "percent") == round_for_key(71.0, "percent")
        assert round_for_key(71.4, "percent") != round_for_key(73.0, "percent")

    def test_unknown_fact_type_is_refused(self):
        with pytest.raises(ValueError):
            claim_key("opinion", "x")
