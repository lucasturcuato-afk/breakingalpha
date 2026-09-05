"""Execute norm_v2.merge_cluster (sql/proposals/0020b section 4) on a throwaway
Postgres and prove the company_facts repoint by running it, not by reading it.

libpg_query does not parse PL/pgSQL bodies, so test_company_merge_repoints_facts
can only show the block is PRESENT and ordered in the text. This runs it.

Needs a local Postgres. It uses `pgserver` (a pip package bundling the server
binaries) and `psycopg`, neither of which is a repo dependency, so the whole
module skips when they are absent, including in CI. To run it:

    venv/bin/python3.11 -m pip install --target /tmp/pglib pgserver "psycopg[binary]"
    PYTHONPATH=/tmp/pglib venv/bin/python3.11 -m pytest backend/tests/test_company_merge_execution.py -v

A skip here is NOT a pass. Verified green on PostgreSQL 16.2 (pgserver) on
2026-09-05; the negative control below was caught on the same run.

The fixture is the MINIMAL column set the function touches, not a copy of
prod. What it proves is ordering and repointing, not the merge's behaviour
against prod's partial unique indexes (see the CONSTRAINT AUDIT in 0020b).
"""

import re
import shutil
import tempfile
from pathlib import Path

import pytest

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

ROOT = Path(__file__).resolve().parents[2]
SQL_0020B = ROOT / "sql" / "proposals" / "0020b_norm_v2_revised_phases.sql"
SQL_0038 = ROOT / "sql" / "0038_company_facts.sql"


def _merge_fn() -> str:
    m = re.search(r"(CREATE OR REPLACE FUNCTION norm_v2\.merge_cluster.*?\n\$\$;)",
                  SQL_0020B.read_text(encoding="utf-8"), re.S)
    assert m, "merge_cluster not found in 0020b"
    return m.group(1)


def _sql_0038_tables_and_view() -> str:
    s = SQL_0038.read_text(encoding="utf-8")
    i = s.index("CREATE TABLE IF NOT EXISTS public.company_facts")
    j = s.index("-- 2. INDEXES")
    k = s.index("CREATE OR REPLACE VIEW public.company_facts_corroborated")
    return s[i:j] + s[k:s.index(";", k) + 1]


FIXTURE = """
CREATE SCHEMA norm_v2;
CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, ticker text,
  sec_cik bigint, mention_count int, key_themes text[], last_updated timestamptz);
CREATE TABLE public.articles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
CREATE TABLE public.company_mentions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, article_id uuid);
CREATE TABLE public.financial_facts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid);
CREATE TABLE public.sec_filings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid);
CREATE TABLE public.insider_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid);
CREATE TABLE public.user_memo_regeneration_quota (user_id uuid, company_id text, regenerated_at timestamptz);
CREATE TABLE public.resolution_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resolved_canonical_id uuid,
  candidate_canonical_ids jsonb);
CREATE TABLE public.user_events (entity_type text, entity_id text);
CREATE TABLE public.aliases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lookup_key text, canonical_id uuid,
  mention_count int, last_seen_at timestamptz);
CREATE TABLE norm_v2.plan_cluster (
  new_key text PRIMARY KEY, member_count int NOT NULL, survivor_id uuid NOT NULL, survivor_name text NOT NULL,
  distinct_tickers int NOT NULL, distinct_ciks int NOT NULL, distinct_sectors int NOT NULL,
  identified_members int NOT NULL, inherit_ticker text, inherit_cik bigint, risk text NOT NULL, risk_reason text,
  approved boolean NOT NULL DEFAULT false, approved_by text, approved_at timestamptz, merged_at timestamptz,
  built_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE norm_v2.plan_member (
  new_key text NOT NULL REFERENCES norm_v2.plan_cluster(new_key) ON DELETE CASCADE, company_id uuid NOT NULL,
  name text NOT NULL, old_key text NOT NULL, ticker text, sec_cik bigint, sector text, mention_count int,
  is_survivor boolean NOT NULL, row_fingerprint text NOT NULL, PRIMARY KEY (new_key, company_id));
CREATE TABLE norm_v2.moved_row (id bigserial PRIMARY KEY, new_key text NOT NULL, table_name text NOT NULL,
  row_id text NOT NULL, from_company_id uuid NOT NULL, to_company_id uuid NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT now());
-- The ordering oracle: a fact still pointing at a company at DELETE time is
-- exactly the failure the repoint block exists to prevent. The two IFs are
-- nested on purpose: PL/pgSQL resolves a subquery's table when it plans the
-- expression, so a single `guard AND EXISTS (...)` raises UndefinedTable on a
-- database without company_facts. Same reason the merge block uses EXECUTE.
CREATE FUNCTION public.assert_no_facts_on_deleted() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  IF to_regclass('public.company_facts') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.company_facts WHERE company_id = OLD.id) THEN
      RAISE EXCEPTION 'ORDERING VIOLATION: company_facts still points at % at DELETE time', OLD.id;
    END IF;
  END IF;
  RETURN OLD;
END $t$;
CREATE TRIGGER companies_facts_guard BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.assert_no_facts_on_deleted();
"""

FACT_INSERT = """INSERT INTO public.company_facts
  (article_id, company_id, fact_type, claim_text, as_of, source, extractor_version, extraction_model, claim_key)
  VALUES (%s, %s, %s, %s, current_date, 'Yahoo', 'v1', 'm', %s)"""


@pytest.fixture(scope="module")
def conn():
    tmp = Path(tempfile.mkdtemp(prefix="pgfix_"))
    try:
        with pgserver.get_server(tmp) as srv:
            with psycopg.connect(srv.get_uri()) as c:
                c.autocommit = False
                yield c
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _fingerprint(cur, cid):
    return cur.execute(
        "SELECT md5(coalesce(name,'')||'|'||coalesce(ticker,'')||'|'||coalesce(sec_cik::text,'')"
        "||'|'||coalesce(mention_count::text,'')) FROM public.companies WHERE id=%s", (cid,)
    ).fetchone()[0]


def _setup(conn, merge_fn: str, with_facts: bool):
    """Fresh schema inside a transaction; caller rolls back. Returns
    (cursor, survivor_id, loser_id, article_id)."""
    cur = conn.cursor()
    cur.execute(FIXTURE)
    if with_facts:
        cur.execute(_sql_0038_tables_and_view())
    cur.execute(merge_fn)
    surv = cur.execute("INSERT INTO public.companies (name, ticker, mention_count) "
                       "VALUES ('Comcast','CMCSA',5) RETURNING id").fetchone()[0]
    loser = cur.execute("INSERT INTO public.companies (name, mention_count) "
                        "VALUES ('Comcast Corp',2) RETURNING id").fetchone()[0]
    art = cur.execute("INSERT INTO public.articles (title) VALUES ('t') RETURNING id").fetchone()[0]
    cur.execute("INSERT INTO public.company_mentions (company_id, article_id) VALUES (%s,%s)", (loser, art))
    cur.execute("INSERT INTO norm_v2.plan_cluster (new_key, member_count, survivor_id, survivor_name, "
                "distinct_tickers, distinct_ciks, distinct_sectors, identified_members, risk, approved) "
                "VALUES ('comcast', 2, %s, 'Comcast', 1, 1, 1, 1, 'auto', true)", (surv,))
    for cid, name, is_surv in ((surv, "Comcast", True), (loser, "Comcast Corp", False)):
        cur.execute("INSERT INTO norm_v2.plan_member (new_key, company_id, name, old_key, is_survivor, "
                    "row_fingerprint) VALUES ('comcast', %s, %s, 'comcast', %s, %s)",
                    (cid, name, is_surv, _fingerprint(cur, cid)))
    return cur, surv, loser, art


class TestMergeRepointsCompanyFactsByExecution:
    def test_facts_of_a_loser_survive_attached_to_the_survivor(self, conn):
        try:
            cur, surv, loser, art = _setup(conn, _merge_fn(), with_facts=True)
            for n in range(3):
                cur.execute(FACT_INSERT, (art, loser, "commentary", f"claim {n}", f"k1|c|{loser}|{n}"))
            cur.execute(FACT_INSERT, (art, surv, "event", "already on survivor", "k1|e|s|0"))
            res = cur.execute("SELECT norm_v2.merge_cluster('comcast')").fetchone()[0]
            assert res["status"] == "merged"
            assert res["rows_moved"]["company_facts"] == 3
            on_surv, unattached, total = cur.execute(
                "SELECT count(*) FILTER (WHERE company_id=%s), count(*) FILTER (WHERE company_id IS NULL), "
                "count(*) FROM public.company_facts", (surv,)).fetchone()
            assert (on_surv, unattached, total) == (4, 0, 4)
            assert cur.execute("SELECT count(*) FROM public.companies WHERE id=%s", (loser,)).fetchone()[0] == 0
            # journaled for exact rollback, one row per moved fact
            assert cur.execute("SELECT count(*) FROM norm_v2.moved_row WHERE table_name='company_facts' "
                               "AND from_company_id=%s AND to_company_id=%s", (loser, surv)).fetchone()[0] == 3
            # and the read view groups them under the survivor
            assert cur.execute("SELECT n_articles FROM public.company_facts_corroborated "
                               "WHERE company_id=%s AND fact_type='event'", (surv,)).fetchone()[0] == 1
        finally:
            conn.rollback()

    def test_repoint_happens_before_the_delete(self, conn):
        """The BEFORE DELETE trigger in the fixture raises if any fact still
        points at the loser when the DELETE fires. The previous test passing
        already implies this; this one proves the oracle itself works by
        moving the block after the DELETE and expecting the raise."""
        fn = _merge_fn()
        block = re.search(r"  IF to_regclass\('public\.company_facts'\) IS NOT NULL THEN.*?  END IF;\n", fn, re.S)
        assert block, "repoint block not found"
        broken = fn.replace(block.group(0), "")
        broken = broken.replace("  UPDATE norm_v2.plan_cluster SET merged_at",
                                block.group(0) + "  UPDATE norm_v2.plan_cluster SET merged_at")
        assert broken != fn
        try:
            cur, surv, loser, art = _setup(conn, broken, with_facts=True)
            cur.execute(FACT_INSERT, (art, loser, "commentary", "claim", "k1|c|x"))
            with pytest.raises(psycopg.errors.RaiseException, match="ORDERING VIOLATION"):
                cur.execute("SELECT norm_v2.merge_cluster('comcast')")
        finally:
            conn.rollback()

    def test_no_op_when_company_facts_does_not_exist(self, conn):
        """Before sql/0038 is applied the function must still compile, run,
        merge, and report nothing for company_facts."""
        try:
            cur, surv, loser, art = _setup(conn, _merge_fn(), with_facts=False)
            assert cur.execute("SELECT to_regclass('public.company_facts')").fetchone()[0] is None
            res = cur.execute("SELECT norm_v2.merge_cluster('comcast')").fetchone()[0]
            assert res["status"] == "merged"
            assert "company_facts" not in res["rows_moved"]
            assert res["rows_moved"]["company_mentions"] == 1
            assert cur.execute("SELECT count(*) FROM public.companies WHERE id=%s", (loser,)).fetchone()[0] == 0
        finally:
            conn.rollback()
