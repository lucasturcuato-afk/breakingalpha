"""BEHAVIOURAL probe: does the primary-company fold actually reach resolve_entity.

Why this module exists. The lane-C gate that #637 reads,
entity_resolver.resolver_contract(), is STRUCTURAL. It reports version 2 the
moment backend/company_match.py exposes token_fold_candidates and index_tokens:

    widened      = callable(getattr(company_match, "token_fold_candidates", None))
    index_merged = callable(getattr(company_match, "index_tokens", None))
    version      = 2 if (widened and index_merged) else 1

#633 shipped that module, so the gate has reported version 2 since it merged,
while backend/ingest.py was still handing resolve_entity the UNFOLDED list. Its
own comment concedes the point: "It does not prove ingest wires them ... It is a
floor, not a certificate." A gate that passes because a file exists is not a gate.

What this probe does instead. It runs the REAL store path,
ingest.store_articles_batch, over one synthetic article, against an in-memory
fake Supabase client, and asserts on the OUTPUT: did a company_mentions row
appear for the canonical company that ONLY a wired fold could have produced.

The fixture is chosen so nothing but the wiring can produce the answer. The
article's companies[] holds one name that is NOT in the index. Its
primary_company is the bare ticker "ARM", which resolves through the fold to the
indexed company "Arm Holdings". A wired fold hands "Arm Holdings" to
resolve_entity and a mention against that company appears. An unwired fold folds
only into the article row, resolve_entity never sees the name, and no such
mention exists. Structural inspection cannot tell those two states apart.

SELECT/INSERT all land on the fake. No network, no live Supabase, no writes to
any real table. Ticker population is disabled so resolve_entity makes no
Finnhub call.
"""
import os


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    """Minimal PostgREST stand-in: the verbs ingest and entity_resolver use."""

    def __init__(self, sb, name):
        self.sb, self.name = sb, name
        self.filters, self.rng, self.pending = [], None, None

    def select(self, *a, **k):
        return self

    def eq(self, key, val):
        self.filters.append(("eq", key, val))
        return self

    def ilike(self, key, val):
        self.filters.append(("ilike", key, val))
        return self

    def in_(self, key, vals):
        self.filters.append(("in", key, list(vals)))
        return self

    def gte(self, key, val):
        self.filters.append(("gte", key, val))
        return self

    def is_(self, key, val):
        self.filters.append(("is", key, val))
        return self

    def not_(self, *a, **k):
        return self

    def limit(self, _n):
        return self

    def order(self, *a, **k):
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def insert(self, payload, *a, **k):
        rows = payload if isinstance(payload, list) else [payload]
        out = []
        for r in rows:
            row = dict(r)
            row.setdefault("id", f"{self.name}-{len(self.sb.data.setdefault(self.name, [] )) + len(out) + 1}")
            out.append(row)
        self.pending = ("insert", out)
        return self

    def update(self, payload, *a, **k):
        self.pending = ("update", dict(payload))
        return self

    def upsert(self, payload, *a, **k):
        self.pending = ("upsert", payload)
        return self

    def _matches(self, row):
        for op, key, val in self.filters:
            if op == "eq" and row.get(key) != val:
                return False
            if op == "ilike" and str(row.get(key) or "").lower() != str(val).lower():
                return False
            if op == "in" and row.get(key) not in val:
                return False
        return True

    def execute(self):
        table = self.sb.data.setdefault(self.name, [])
        if self.pending and self.pending[0] == "insert":
            rows = self.pending[1]
            # UNIQUE(companies.name) is the synchronization primitive
            # resolve_entity's race recovery relies on. Model it, or the probe
            # cannot distinguish a mint from a conflict recovery.
            if self.name == "companies":
                existing = {r.get("name") for r in table}
                for r in rows:
                    if r.get("name") in existing:
                        raise Exception("duplicate key value violates unique constraint")
            table.extend(rows)
            self.sb.writes.append((self.name, "insert", len(rows)))
            return _Resp(rows)
        if self.pending and self.pending[0] == "update":
            hit = [r for r in table if self._matches(r)]
            for r in hit:
                r.update(self.pending[1])
            self.sb.writes.append((self.name, "update", len(hit)))
            return _Resp(hit)
        if self.pending and self.pending[0] == "upsert":
            self.sb.writes.append((self.name, "upsert", 1))
            return _Resp([])
        rows = [r for r in table if self._matches(r)]
        if self.rng is not None:
            lo, hi = self.rng
            rows = rows[lo:hi + 1]
        return _Resp(rows)


class FakeSupabase:
    def __init__(self, data):
        self.data = {k: [dict(r) for r in v] for k, v in data.items()}
        self.writes = []

    def table(self, name):
        return _Table(self, name)


#: The indexed company the bare ticker must fold onto, and the co-mention that
#: is deliberately absent from the index so it cannot be confused with the fold.
CANONICAL_NAME = "Arm Holdings"
CANONICAL_ID = "c-arm"
PRIMARY_INPUT = "ARM"
CO_MENTION = "Zzyzx Unindexed Holdings"

_SEED = {
    "companies": [{"id": CANONICAL_ID, "name": CANONICAL_NAME, "ticker": "ARM",
                   "mention_count": 0}],
    "aliases": [{"id": "a-arm", "lookup_key": "arm holdings",
                 "canonical_id": CANONICAL_ID, "mention_count": 0}],
    "articles": [],
    "company_mentions": [],
    "resolution_log": [],
}

_ARTICLE = {
    "title": "Probe article", "summary": "probe", "url": "https://example.invalid/probe",
    "source": "probe", "published_at": "2026-01-01T00:00:00+00:00",
    "content_type": "snippet",
}
_ANALYSIS = {
    "companies": [CO_MENTION], "primary_company": PRIMARY_INPUT,
    "relevance_score": 9, "relevance_reason": "probe", "themes": [],
    "sentiment": "neutral", "sentiment_reason": None,
    "industry_verticals": [], "activity_types": [], "deal_type": None,
}


def probe_resolver_wiring() -> dict:
    """Run the real store path against a fake client; report what it did.

    Returns a superset of #637's RESOLVER_CONTRACT. The two structural keys are
    computed the same way so a reader can compare them directly against the
    behavioural verdict and see the gap the structural probe cannot see.

    Keys:
      widened / index_merged  structural, identical to entity_resolver's probe
      fold_reaches_resolver   BEHAVIOURAL. True only when the folded canonical
                              name actually produced a company_mentions row.
      minted_names            companies rows the run created. Must not contain
                              the canonical: folding must resolve, never mint.
      flag_enabled            the live value of TAGGING_PRIMARY_FOLD_ENABLED.
                              The wiring is a capability; the flag decides
                              whether it fires in production.
      version                 2 only when the behavioural check passes.
    """
    os.environ.setdefault("DISABLE_TICKER_POPULATION", "1")
    from unittest.mock import patch

    try:
        import ingest                       # cron context: cwd=backend/
        import company_match as _cm
    except ImportError:                     # test/dev context: cwd=repo-root
        from backend import ingest
        from backend import company_match as _cm

    widened = callable(getattr(_cm, "token_fold_candidates", None))
    index_merged = callable(getattr(_cm, "index_tokens", None))
    flag_enabled = bool(ingest.TAGGING_PRIMARY_FOLD_ENABLED)

    sb = FakeSupabase(_SEED)
    before_names = {r["name"] for r in sb.data["companies"]}

    prev_flag = ingest.TAGGING_PRIMARY_FOLD_ENABLED
    prev_pub = ingest._PUBLISHER_COLUMNS_AVAILABLE
    prev_grade = ingest._GRADE_SOURCE_COLUMN_AVAILABLE
    try:
        # Probe the CAPABILITY, not the deployment. Forced in-process only; the
        # deployed default is reported separately as flag_enabled.
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = True
        ingest._PUBLISHER_COLUMNS_AVAILABLE = False
        ingest._GRADE_SOURCE_COLUMN_AVAILABLE = False
        ingest._PRIMARY_INDEXED_CACHE.clear()
        ingest._ENTITY_SNAPSHOT = None
        ingest._RUN_VALID_COMPANY_CACHE.clear()
        ingest._RUN_ENTITY_RESOLUTION_CACHE.clear()
        ingest._RUN_COMPANY_MENTION_TALLY.clear()
        ingest._RUN_ALIAS_MENTION_TALLY.clear()
        with patch.object(ingest, "supabase", sb), \
             patch.object(ingest, "is_valid_company", return_value=True), \
             patch.object(ingest, "is_blocked_entity", return_value=False):
            ingest.store_articles_batch(
                [(dict(_ARTICLE), dict(_ANALYSIS))], dedup_sets=(set(), set())
            )
        mentions = sb.data.get("company_mentions", [])
        stored_articles = sb.data.get("articles", [])
        after_names = {r["name"] for r in sb.data["companies"]}
    finally:
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = prev_flag
        ingest._PUBLISHER_COLUMNS_AVAILABLE = prev_pub
        ingest._GRADE_SOURCE_COLUMN_AVAILABLE = prev_grade
        ingest._PRIMARY_INDEXED_CACHE.clear()
        ingest._ENTITY_SNAPSHOT = None
        ingest._RUN_VALID_COMPANY_CACHE.clear()
        ingest._RUN_ENTITY_RESOLUTION_CACHE.clear()
        ingest._RUN_COMPANY_MENTION_TALLY.clear()
        ingest._RUN_ALIAS_MENTION_TALLY.clear()

    fold_reaches_resolver = any(m.get("company_id") == CANONICAL_ID for m in mentions)
    minted = sorted(after_names - before_names)
    article_companies = list(stored_articles[0].get("companies", [])) if stored_articles else []

    return {
        "version": 2 if (widened and index_merged and fold_reaches_resolver) else 1,
        "widened": widened,
        "index_merged": index_merged,
        "fold_reaches_resolver": fold_reaches_resolver,
        "minted_names": minted,
        "canonical_was_minted": CANONICAL_NAME in minted,
        "article_companies": article_companies,
        "flag_enabled": flag_enabled,
    }


RESOLVER_WIRING = None  # computed on demand; the probe runs a store path


if __name__ == "__main__":
    import json
    print(json.dumps(probe_resolver_wiring(), indent=2, sort_keys=True))
