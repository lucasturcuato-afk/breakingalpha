"""A company merge that deletes absorbed rows must repoint company_facts first.

company_facts.company_id (sql/0038) is ON DELETE SET NULL, so a merge script
that forgets it does not error: it silently drops every fact of every loser
into the unattached pile. Merges here are hand-applied SQL with an enumerated
dependent list (sql/proposals/0020b section 4), so the only thing standing
between a new merge script and that failure is this test. It reads the SQL
files, not a database: the seam it pins is "the file that deletes companies
also repoints company_facts", which is the property, not a symptom of it.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SQL_DIRS = (ROOT / "sql", ROOT / "sql" / "proposals")

#: Files whose companies DELETE is superseded and must never run as written.
#: Do not extend this list; add the repoint block to the new file instead.
SUPERSEDED = {
    # phase 6 is replaced by 0020b section 4, which carries the block
    "sql/proposals/0020_normalize_lookup_key_v2.sql",
}

DELETE_RE = re.compile(r"^\s*DELETE\s+FROM\s+(public\.)?companies\b", re.I | re.M)
REPOINT_RE = re.compile(
    r"UPDATE\s+(public\.)?company_facts\s+SET\s+company_id\s*=", re.I
)


def _live_sql(path: Path) -> str:
    return "\n".join(
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    )


def _merge_scripts() -> list[Path]:
    out = []
    for d in SQL_DIRS:
        for f in sorted(d.glob("*.sql")):
            if DELETE_RE.search(_live_sql(f)):
                out.append(f)
    return out


def _rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


class TestMergeScriptsRepointCompanyFacts:
    def test_the_known_merge_script_is_found(self):
        """Guards the scanner itself: if the regex stops matching 0020b, every
        other test here passes vacuously."""
        assert "sql/proposals/0020b_norm_v2_revised_phases.sql" in {_rel(p) for p in _merge_scripts()}

    def test_every_merge_script_repoints_company_facts(self):
        missing = [
            _rel(p) for p in _merge_scripts()
            if _rel(p) not in SUPERSEDED and not REPOINT_RE.search(_live_sql(p))
        ]
        assert not missing, (
            f"{missing} delete from companies without repointing company_facts. "
            "Add the block from docs/runbooks/ci-hardening-and-hand-apply-sql.md section 7."
        )

    def test_repoint_precedes_the_delete(self):
        """After the DELETE, ON DELETE SET NULL has already fired."""
        for p in _merge_scripts():
            if _rel(p) in SUPERSEDED:
                continue
            text = _live_sql(p)
            first_delete = DELETE_RE.search(text).start()
            repoint = REPOINT_RE.search(text)
            assert repoint and repoint.start() < first_delete, f"{_rel(p)}: repoint after delete"

    def test_repoint_is_journaled(self):
        """Rollback of a cluster is only exact if company_facts rows are in
        norm_v2.moved_row like the other cheap tables."""
        text = _live_sql(ROOT / "sql/proposals/0020b_norm_v2_revised_phases.sql")
        assert re.search(r"'company_facts',\s*f\.id::text,\s*f\.company_id", text)

    def test_superseded_list_only_names_files_that_exist(self):
        for rel in SUPERSEDED:
            assert (ROOT / rel).is_file(), rel

    @pytest.mark.parametrize("rel", sorted(SUPERSEDED))
    def test_superseded_file_is_declared_superseded_by_0020b(self, rel):
        text = (ROOT / "sql/proposals/0020b_norm_v2_revised_phases.sql").read_text(encoding="utf-8")
        assert "SUPERSEDES" in text and Path(rel).name in text
