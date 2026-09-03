# THROWAWAY measurement scripts

Not production code. Not proposed for merge. These exist only to make the
numbers in `docs/entity-integrity-cross-signal-design.md` reproducible.

SELECT-only. `_conn.py` issues GET requests and nothing else; there is no
code path here that writes to the database.

- `_conn.py`            paginated read-only PostgREST GET helper
- `pull_articles.py`    keyset walk of `articles` (OFFSET 500s past ~110k rows)
- `relation.py`         the name-relation classifier from design section 4.3
- `crosscheck_final.py` the cross-signal check from design sections 4-6
- `classify.py`         an earlier iteration, kept for the before/after numbers
