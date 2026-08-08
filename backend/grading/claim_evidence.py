"""claim_evidence - a daily, shared pass that records supporting and challenging
stories against OPEN user claims while they wait for their window to close.

WHY THIS EXISTS. A committed claim used to sit in dead silence between commit and
resolution. This pass fills that window with real, attributable observations: for
each open claim it finds recent stories about the claim's subject whose sentiment
points a direction, and records each as supporting or challenging. It does NOT
decide the outcome. The price-attribution grader remains the only thing that
resolves a claim; this is a running observation log, never a verdict and never a
score.

THE MATCHING RULE (deterministic, NO model call):
  A story matches a claim when
    (1) its SUBJECT overlaps the claim's subject, and
    (2) its sentiment is DIRECTIONAL (bullish or bearish; neutral records nothing).
  Then:
    sentiment == claim.expected_direction  -> supporting
    sentiment opposes  claim.expected_direction -> challenging

  Subject overlap by claim_type:
    ticker : the article's companies[] contains the claim's target_symbol (or one
             of its evidence_entities). primary_company is folded into companies
             at ingest, so companies containment already covers it.
    sector : the claim's target_symbol is a sector ETF (XLI, XLE, ...); it maps to
             an article sector label via SECTOR_ETF_MAP and the article's sector
             must equal that label.
    index / aggregate / other : NEVER matched. A market-wide claim has no clean
             per-story subject, and inventing one is the exact fabrication this
             product exists not to do.

WHAT IT DELIBERATELY WILL NOT MATCH: neutral stories (80% of the feed, by design
the common case), stories about a different subject, index/aggregate/other claims,
and claims whose expected_direction is neutral. Absence is the expected state.

The article fetch reuses outcome.evidence.fetch_subsequent_articles rather than
forking a second query. This module is import-safe with no side effects; run()
reads the EVIDENCE_LEDGER_MODE flag and no-ops unless it is 'active'.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

DIRECTIONAL = ("bullish", "bearish")
_OPPOSITE = {"bullish": "bearish", "bearish": "bullish"}

# Sector ETF ticker -> the article taxonomy label ingest writes to articles.sector.
# Only confident, unambiguous mappings. An ETF absent here maps to nothing, so its
# sector claim honestly records no evidence rather than matching the wrong feed.
SECTOR_ETF_MAP = {
    "XLK": "Technology",
    "XLE": "Energy & Oil/Gas",
    "XLI": "Industrials & Manufacturing",
    "XLV": "Healthcare & Biotech",
    "XBI": "Healthcare & Biotech",
    "XLF": "Financial Services",
    "KRE": "Financial Services",
    "XLY": "Consumer & Retail",
    "XLP": "Consumer & Retail",
    "XLB": "Materials & Mining",
    "XLRE": "Real Estate",
    "XAR": "Aerospace & Defense",
    "ITA": "Aerospace & Defense",
    "XLC": "Media & Telecom",
}


def evidence_ledger_mode(env: Optional[dict] = None) -> str:
    """Resolve EVIDENCE_LEDGER_MODE. Unknown or unset -> 'off'.

    off    : the pass writes nothing and changes nothing.
    shadow : the pass matches and logs what it WOULD write, but writes nothing.
    active : the pass writes rows.
    """
    source = env if env is not None else os.environ
    raw = (source.get("EVIDENCE_LEDGER_MODE") or "").strip().lower()
    return raw if raw in {"off", "shadow", "active"} else "off"


def _norm(v: Any) -> str:
    return str(v).strip().lower() if v is not None else ""


def _subject_tokens(claim: dict) -> set[str]:
    """Case-folded subject aliases for a ticker claim: target_symbol plus any
    declared evidence_entities (the claim's own subject aliases)."""
    tokens = set()
    sym = claim.get("target_symbol")
    if sym:
        tokens.add(_norm(sym))
    for e in claim.get("evidence_entities") or []:
        if e:
            tokens.add(_norm(e))
    return {t for t in tokens if t}


def _article_matches_ticker(article: dict, tokens: set[str]) -> bool:
    companies = article.get("companies") or []
    company_set = {_norm(c) for c in companies if c}
    if _norm(article.get("primary_company")) in tokens:
        return True
    return bool(company_set & tokens)


def match_articles_to_claim(
    claim: dict,
    articles: list[dict],
    observed_on: str,
) -> list[dict]:
    """Pure, deterministic. Given a claim and already-fetched candidate articles,
    return the claim_evidence rows to record. No DB, no network, no model.

    Neutral stories, non-overlapping subjects, neutral-direction claims, and
    index/aggregate/other claim types all return nothing.
    """
    direction = _norm(claim.get("expected_direction"))
    if direction not in DIRECTIONAL:
        return []  # a neutral (or missing) claim direction has nothing to support

    claim_type = _norm(claim.get("claim_type"))
    if claim_type == "ticker":
        tokens = _subject_tokens(claim)
        if not tokens:
            return []
        basis = "ticker"

        def subject_ok(a: dict) -> bool:
            return _article_matches_ticker(a, tokens)

    elif claim_type == "sector":
        label = SECTOR_ETF_MAP.get(_norm(claim.get("target_symbol")).upper())
        if not label:
            return []
        basis = "sector"

        def subject_ok(a: dict) -> bool:
            return _norm(a.get("sector")) == _norm(label)

    else:
        # index / aggregate / other: no clean per-story subject. Record nothing.
        return []

    rows: list[dict] = []
    seen: set[str] = set()  # guard against the same article twice in one batch
    for a in articles:
        aid = a.get("id")
        if not aid or aid in seen:
            continue
        if not subject_ok(a):
            continue
        sentiment = _norm(a.get("sentiment"))
        if sentiment not in DIRECTIONAL:
            continue  # neutral (or unknown) records nothing
        if sentiment == direction:
            stance = "support"
        elif sentiment == _OPPOSITE[direction]:
            stance = "challenge"
        else:
            continue
        seen.add(aid)
        rows.append(
            {
                "claim_id": claim.get("id"),
                "article_id": aid,
                "stance": stance,
                "article_sentiment": sentiment,
                "claim_direction": direction,
                "match_basis": basis,
                "relevance_score": a.get("relevance_score"),
                "article_published_at": a.get("published_at"),
                "observed_on": observed_on,
            }
        )
    return rows


def _fetch_open_claims(sb, today: str) -> list[dict]:
    """Open claims currently inside their window. Shared across all users in one
    query; never per-user."""
    resp = (
        sb.table("user_claims")
        .select(
            "id, claim_type, target_symbol, expected_direction, evidence_entities, "
            "resolution_window_start, resolution_window_end, status"
        )
        .eq("status", "open")
        .lte("resolution_window_start", today)
        .gte("resolution_window_end", today)
        .limit(1000)
        .execute()
    )
    return resp.data or []


def run(sb=None, env: Optional[dict] = None, fetch_fn=None) -> dict:
    """The daily shared pass. Fail-open: any error returns a summary, never raises.

    off    -> writes nothing, touches no table.
    shadow -> matches and reports counts, writes nothing.
    active -> upserts rows, deduped by the table's unique(claim_id, article_id).

    fetch_fn defaults to outcome.evidence.fetch_subsequent_articles (reused, not
    forked); it is injectable so the pass is testable without the supabase import.
    """
    mode = evidence_ledger_mode(env)
    summary = {"mode": mode, "claims_scanned": 0, "matched": 0, "written": 0}
    if mode == "off":
        return summary

    try:
        if fetch_fn is None:
            from outcome.evidence import fetch_subsequent_articles as fetch_fn

        if sb is None:
            from supabase import create_client

            sb = create_client(
                os.environ["SUPABASE_URL"],
                os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            )

        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        claims = _fetch_open_claims(sb, today)
        summary["claims_scanned"] = len(claims)

        pending: list[dict] = []
        for claim in claims:
            try:
                start = claim.get("resolution_window_start")
                after = _parse_day(start) if start else now
                ctype = _norm(claim.get("claim_type"))
                if ctype == "ticker":
                    ticker = claim.get("target_symbol")
                    articles = fetch_fn(
                        sb, ticker=ticker, after=after, before=now, limit=100
                    )
                elif ctype == "sector":
                    label = SECTOR_ETF_MAP.get(_norm(claim.get("target_symbol")).upper())
                    if not label:
                        continue
                    articles = fetch_fn(
                        sb, sector=label, after=after, before=now, limit=100
                    )
                else:
                    continue
                pending.extend(match_articles_to_claim(claim, articles, today))
            except Exception as e:  # one bad claim never stops the pass
                logger.warning("claim_evidence: claim %s skipped: %s", claim.get("id"), e)

        summary["matched"] = len(pending)

        if mode == "shadow":
            logger.info("claim_evidence[shadow]: would write %d rows", len(pending))
            print(f"  [claim_evidence] shadow: matched {len(pending)} rows, wrote 0")
            return summary

        if pending:
            # Idempotent by the table constraint unique(claim_id, article_id):
            # a re-run over an overlapping window adds no duplicate row.
            sb.table("claim_evidence").upsert(
                pending, on_conflict="claim_id,article_id", ignore_duplicates=True
            ).execute()
        summary["written"] = len(pending)
        print(f"  [claim_evidence] active: matched {len(pending)} rows across {len(claims)} open claims")
        return summary
    except Exception as e:  # fail-open: never break the grading run
        logger.exception("claim_evidence: pass failed (fail-open): %s", e)
        print(f"  ⚠ claim_evidence: pass failed (fail-open): {e}")
        summary["error"] = str(e)
        return summary


def _parse_day(raw: str) -> datetime:
    try:
        return datetime.fromisoformat(str(raw)).replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


if __name__ == "__main__":  # manual: EVIDENCE_LEDGER_MODE=shadow python -m grading.claim_evidence
    logging.basicConfig(level=logging.INFO)
    print(run())
