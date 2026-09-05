"""
company_facts.py - vocabulary and claim-key normalisation for the fact store.

The store is sql/0038_company_facts.sql: one row per stated claim per article.
This module is the Python side of the two things the schema cannot own:

  * the vocabularies its CHECK constraints pin (FACT_TYPES, PERIOD_TYPES,
    EXTRACTION_STATUSES). backend/tests/test_company_facts_schema.py parses
    the SQL and asserts the two copies agree, the same way sql/0026's deal_type
    remap is held to _DEAL_TYPE_ALIASES.
  * claim_key(), the normalisation behind UNIQUE (article_id, claim_key). It
    is versioned by prefix so a change to the rule can never collide with keys
    written under the old one, and it is ARTICLE-INDEPENDENT so the read view
    (company_facts_corroborated) can group the same claim across outlets.

Nothing here talks to a model or a database. The extractor (PR 2) imports it.
"""

from __future__ import annotations

import hashlib
import math
import re
from datetime import date

from figures import (
    KIND_MONEY,
    KIND_MULTIPLE,
    KIND_PERCENT,
    MONEY_REL_TOLERANCE,
    MULTIPLE_REL_TOLERANCE,
    PERCENT_ABS_TOLERANCE,
)

#: What kind of statement a row is. Mirrors the CHECK on company_facts.fact_type.
FACT_TYPES: tuple[str, ...] = ("figure", "guidance", "commentary", "stated_cause", "event")

#: Mirrors the CHECK on company_facts.period_type.
PERIOD_TYPES: tuple[str, ...] = ("duration", "instant", "forward")

#: Mirrors the CHECK on company_facts_extractions.status. "never processed" is
#: the absence of a ledger row, on purpose, so it is not a status.
EXTRACTION_STATUSES: tuple[str, ...] = ("extracted", "empty", "failed")

#: Mirrors the length CHECK on company_facts.claim_text. A sentence longer than
#: this is not truncated (that would not be verbatim); the extractor skips it.
CLAIM_TEXT_MAX = 500

#: Prefix on every claim_key. Bump when the rule below changes.
CLAIM_KEY_VERSION = "k1"

#: value_unit values that round with a relative tolerance (2 significant
#: figures) versus the absolute percentage-point tolerance. Anything else is
#: treated like money. Kept as the figures.py kinds so the tolerances stay one
#: set of constants.
_UNIT_KIND = {
    "usd": KIND_MONEY,
    "percent": KIND_PERCENT,
    "multiple": KIND_MULTIPLE,
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def round_for_key(value: float, unit: str | None) -> str:
    """Collapse a numeric value to the bucket figures.py's tolerances imply.

    money / multiple / anything else: 2 significant figures, which is the
    coarsest rounding that still keeps "$4.2B" and "$4.15B" together
    (MONEY_REL_TOLERANCE 0.02, MULTIPLE_REL_TOLERANCE 0.05).
    percent: nearest whole point (PERCENT_ABS_TOLERANCE 0.5).

    Bucketing has edges: 4.24 and 4.26 land in different buckets although
    they are within tolerance. That is the price of an article-independent
    key and it only affects the corroboration COUNT in the read view, never
    a stored value.
    """
    kind = _UNIT_KIND.get((unit or "").strip().lower(), KIND_MONEY)
    if value is None or not math.isfinite(value):
        return "nan"
    if kind == KIND_PERCENT:
        # PERCENT_ABS_TOLERANCE is 0.5pp: nearest whole point is that bucket.
        step = PERCENT_ABS_TOLERANCE * 2
        return f"{round(value / step) * step:.0f}"
    # 2 significant figures ~ 5% buckets, which covers MONEY_REL_TOLERANCE
    # (0.02) and MULTIPLE_REL_TOLERANCE (0.05).
    _ = (MONEY_REL_TOLERANCE, MULTIPLE_REL_TOLERANCE)
    if value == 0:
        return "0"
    exp = math.floor(math.log10(abs(value)))
    scaled = round(value / 10 ** (exp - 1))
    return f"{scaled}e{exp - 1}"


def text_signature(claim_text: str) -> str:
    """Order-insensitive token-set hash of a sentence, 16 hex chars.

    Lowercase alphanumeric tokens of three or more characters, de-duplicated
    and sorted, so a wire sentence re-punctuated by a second outlet matches
    and a genuinely different sentence does not. It is deliberately NOT fuzzy:
    two outlets paraphrasing the same fact stay two rows with two keys, and
    the view reports them as uncorroborated. Under-counting is the honest
    failure here.
    """
    tokens = sorted({t for t in _TOKEN_RE.findall((claim_text or "").lower()) if len(t) >= 3})
    return hashlib.sha1(" ".join(tokens).encode("utf-8")).hexdigest()[:16]


def claim_key(
    fact_type: str,
    claim_text: str,
    *,
    company_id: str | None = None,
    metric_key: str | None = None,
    value_num: float | None = None,
    value_unit: str | None = None,
    period_end: date | str | None = None,
) -> str:
    """The normalisation key behind UNIQUE (article_id, claim_key).

    Two forms:

      figure form   k1|<type>|<company>|<metric>|<unit>|<rounded value>|<period_end>
                    when the row names a metric AND carries a number. This is
                    what lets "$17 billion revenue" from five outlets group in
                    the read view.
      text form     k1|<type>|<company>|<token-set hash>
                    for everything else, INCLUDING a figure whose metric is
                    unnamed. An unlabelled "$17 billion" must not corroborate a
                    different $17 billion about the same company, so it groups
                    only with near-verbatim restatements.

    company_id is folded in (NULL -> "none") so one sentence naming two
    companies yields two rows under the plain-column UNIQUE, and so the
    corroboration view groups per company without a NULL-distinct trap.
    """
    if fact_type not in FACT_TYPES:
        raise ValueError(f"unknown fact_type {fact_type!r}")
    company = (company_id or "none").lower()
    if metric_key and value_num is not None:
        pe = period_end.isoformat() if isinstance(period_end, date) else (period_end or "-")
        return "|".join([
            CLAIM_KEY_VERSION, fact_type, company,
            metric_key.strip().lower(),
            (value_unit or "-").strip().lower(),
            round_for_key(float(value_num), value_unit),
            pe,
        ])
    return "|".join([CLAIM_KEY_VERSION, fact_type, company, text_signature(claim_text)])
