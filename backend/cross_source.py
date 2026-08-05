"""
cross_source.py - Stage 1 cross-source OBSERVATION.

WHAT THIS PRODUCES
------------------
For each same-event group of articles carrying two or more distinct publisher
identities:

    lead / echo   members ordered by published_at, with the lag behind the
                  first item, and a syndicator flag per member
    figures       structural (regex) figure observations: a figure only one
                  member carries, or same-kind figures that differ beyond
                  tolerance

WHAT THIS DOES NOT PRODUCE, DELIBERATELY
----------------------------------------
No accuracy verdict. No "source A was right". No credibility score. A figure
divergence is a flag for a human, not a judgment: two money figures in one
cluster may be revenue and market cap, and neither is wrong. Accuracy resolves
later, against catalysts, and it is NOT part of this module.

"Lead" means FIRST SEEN IN OUR FEEDS, not "broke the story". We poll on a
schedule, Google News has its own indexing lag, and some publishers timestamp at
minute granularity (PR Newswire: 100% second-zero, 30 articles across 20
distinct timestamps in the measured window). Every consumer must say so.

CLUSTERING
----------
Reuses `impact_ranking.cluster_key`, which is free, deterministic and already
tuned for event grouping (macro bucket -> company+event theme -> title
signature). Measured on 6,000 real articles it produced 3,969 clusters, 78.9%
singletons, 208 with 2+ distinct `source` values.

Its known weakness is that a theme bucket is coarser than an event: the largest
groups it produced were `co:palantir:stock` (37 articles) and `co:spacex:stock`
(34), which are topics spanning days rather than single events. So this module
adds a TIME SPLIT on top: within one base key, a gap longer than
EVENT_GAP_HOURS starts a new event instance. That is single-linkage in time, so
a story broken at 23:00 and echoed at 01:00 stays one event, which a calendar-day
bucket would have split.

The result is still imprecise and is labelled as such. It is an observation
surface, not ground truth.

COST AND LOAD
-------------
Zero LLM calls. Zero network calls. One bounded, indexed read over a recent
`ingested_at` window with narrow columns, then pure Python. See
`estimate_llm_cost_per_cluster()` for what an LLM claim-extraction pass WOULD
cost; that path is deliberately not built in this pass.

Usage:
    python backend/cross_source.py --dry-run          # compute + print, no writes
    python backend/cross_source.py --hours 48         # compute + upsert
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

try:
    import impact_ranking as _ir
    from publishers import attribution_identity, is_syndicator
    from figures import compare_figures
except ImportError:  # imported as backend.cross_source
    from backend import impact_ranking as _ir
    from backend.publishers import attribution_identity, is_syndicator
    from backend.figures import compare_figures


#: How far back to look. Two days matches roughly one full ingest window
#: (measured: ~2,643 articles/24h) without widening the read.
DEFAULT_WINDOW_HOURS = 48

#: Hard cap on rows pulled, so this can never grow into a full-corpus scan.
MAX_ARTICLES = 6000

#: Rows per PostgREST page.
PAGE_SIZE = 1000

#: Within one base cluster key, a gap longer than this starts a new event
#: instance. 24h keeps an overnight echo attached to its lead while splitting a
#: multi-day topic bucket into separate events.
EVENT_GAP_HOURS = 24.0

#: A cross-source observation needs at least this many DISTINCT publisher
#: identities. Two feed names for the same publisher do not count twice.
MIN_IDENTITIES = 2

#: Cap on stored members per cluster, so one runaway topic cannot bloat a row.
MAX_MEMBERS_PER_CLUSTER = 25


def _parse_dt(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _member_text(article: dict) -> str:
    """Text a figure extractor sees. Title plus summary when present.

    Measured substrate: 88% of rows have an empty summary and only 0.85% carry
    full text, so this is a headline in the overwhelming majority of cases.
    """
    parts = [str(article.get("title") or "")]
    summary = article.get("summary")
    if summary:
        parts.append(str(summary))
    return " ".join(p for p in parts if p).strip()


def split_by_time_gap(articles: list[dict], gap_hours: float = EVENT_GAP_HOURS) -> list[list[dict]]:
    """Split one base-key group into event instances on publication gaps.

    Articles with no parseable `published_at` fall back to `ingested_at`; items
    with neither are kept in the first instance rather than dropped, because
    dropping them would silently shrink observed breadth.
    """
    dated: list[tuple[datetime, dict]] = []
    undated: list[dict] = []
    for a in articles:
        dt = _parse_dt(a.get("published_at")) or _parse_dt(a.get("ingested_at"))
        if dt is None:
            undated.append(a)
        else:
            dated.append((dt, a))

    if not dated:
        return [undated] if undated else []

    dated.sort(key=lambda t: t[0])
    groups: list[list[dict]] = [[dated[0][1]]]
    prev = dated[0][0]
    for dt, a in dated[1:]:
        if (dt - prev).total_seconds() / 3600.0 > gap_hours:
            groups.append([a])
        else:
            groups[-1].append(a)
        prev = dt

    if undated:
        groups[0].extend(undated)
    return groups


def build_clusters(articles: list[dict]) -> list[dict]:
    """Group articles into cross-source event observations.

    Pure: takes rows, returns cluster dicts. Directly testable with fixtures.
    """
    by_key: dict[str, list[dict]] = defaultdict(list)
    for a in articles:
        try:
            key = _ir.cluster_key(a)
        except Exception:
            continue
        by_key[key].append(a)

    clusters: list[dict] = []
    for base_key, group in by_key.items():
        if len(group) < MIN_IDENTITIES:
            continue
        for idx, instance in enumerate(split_by_time_gap(group)):
            cluster = _build_one(base_key, idx, instance)
            if cluster:
                clusters.append(cluster)

    clusters.sort(
        key=lambda c: (-c["distinct_identities"], -c["article_count"], c["cluster_key"])
    )
    return clusters


def _build_one(base_key: str, instance_idx: int, instance: list[dict]) -> dict | None:
    """Assemble one cluster row, or None when it is not cross-source."""
    members: list[dict] = []
    for a in instance:
        ident = attribution_identity(
            a.get("publisher"), a.get("publisher_domain"), a.get("source")
        )
        if not ident:
            # A Google News feed name is not an identity. Counting it would
            # recreate the false-breadth artifact this module exists to remove.
            continue
        dt = _parse_dt(a.get("published_at")) or _parse_dt(a.get("ingested_at"))
        members.append({
            "article_id": a.get("id"),
            "identity": ident,
            "publisher": a.get("publisher"),
            "publisher_domain": a.get("publisher_domain"),
            "source": a.get("source"),
            "title": a.get("title"),
            "published_at": dt.isoformat() if dt else None,
            "_dt": dt,
            "is_syndicator": is_syndicator(
                a.get("publisher"), a.get("publisher_domain"), a.get("source")
            ),
            "timestamp_basis": (
                "published_at" if _parse_dt(a.get("published_at")) else "ingested_at"
            ),
        })

    identities = {m["identity"] for m in members}
    if len(identities) < MIN_IDENTITIES:
        return None

    members.sort(key=lambda m: (m["_dt"] is None, m["_dt"] or datetime.max.replace(tzinfo=timezone.utc)))
    members = members[:MAX_MEMBERS_PER_CLUSTER]

    first_dt = members[0]["_dt"]
    for rank, m in enumerate(members):
        m["rank"] = rank
        # "lead" is FIRST SEEN IN OUR FEEDS. See module docstring.
        m["role"] = "lead" if rank == 0 else "echo"
        if first_dt and m["_dt"]:
            m["lag_minutes"] = round((m["_dt"] - first_dt).total_seconds() / 60.0, 1)
        else:
            m["lag_minutes"] = None

    # A tie at the front means we cannot honestly name a single first mover.
    tied_lead = bool(
        len(members) > 1 and first_dt and members[1]["_dt"] == first_dt
    )
    if tied_lead:
        for m in members:
            if m["_dt"] == first_dt:
                m["role"] = "lead_tied"

    figure_findings = compare_figures([
        {"id": m["article_id"], "label": m["identity"],
         "text": _member_text(next(a for a in instance if a.get("id") == m["article_id"]))}
        for m in members
    ])

    non_syndicators = {m["identity"] for m in members if not m["is_syndicator"]}
    window_start = members[0]["_dt"]
    window_end = max((m["_dt"] for m in members if m["_dt"]), default=None)

    for m in members:
        m.pop("_dt", None)

    return {
        "cluster_key": f"{base_key}#{instance_idx}",
        "base_key": base_key,
        "article_count": len(members),
        "distinct_identities": len(identities),
        "distinct_non_syndicators": len(non_syndicators),
        "tied_lead": tied_lead,
        "lead_identity": None if tied_lead else members[0]["identity"],
        "window_start": window_start.isoformat() if window_start else None,
        "window_end": window_end.isoformat() if window_end else None,
        "members": members,
        "figure_findings": [f.to_dict() for f in figure_findings],
        "observation_only": True,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# ==========================================================================
# Cost projection for the LLM path (NOT BUILT in this pass)
# ==========================================================================

#: Gemini 2.5 Flash, verified against backend/thesis_grader.py.
_GEMINI_INPUT_PER_TOKEN = 0.30 / 1_000_000
_GEMINI_OUTPUT_PER_TOKEN = 2.50 / 1_000_000


def estimate_llm_cost_per_cluster(members: int, input_tokens_per_member: int = 300,
                                  output_tokens: int = 400) -> float:
    """Projected USD cost of ONE Gemini claim-extraction call over a cluster.

    Not used by any code path here. It exists so the number in the PR is
    derived rather than asserted. Baseline for the token assumptions is the
    measured `filter` step in gemini_usage: ~3,920 prompt tokens and ~332
    output tokens per article-level call.
    """
    in_tokens = max(0, members) * max(0, input_tokens_per_member)
    return round(
        in_tokens * _GEMINI_INPUT_PER_TOKEN + max(0, output_tokens) * _GEMINI_OUTPUT_PER_TOKEN,
        6,
    )


# ==========================================================================
# IO
# ==========================================================================

def load_articles(supabase, hours: int = DEFAULT_WINDOW_HOURS,
                  max_articles: int = MAX_ARTICLES) -> tuple[list[dict], bool]:
    """Bounded read of the recent article window.

    Narrow columns only (never `content`), an indexed `ingested_at` predicate,
    a stable order, and a hard row cap. Returns `(rows, publisher_columns_present)`.

    Raises on query failure. A failed read must NOT be reported as "no data".
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    cols = ("id, source, publisher, publisher_domain, title, summary, "
            "published_at, ingested_at, companies, sector, url")
    have_publisher = True
    try:
        supabase.table("articles").select(cols).limit(1).execute()
    except Exception as e:
        if "publisher" not in str(e):
            raise
        have_publisher = False
        cols = ("id, source, title, summary, published_at, ingested_at, "
                "companies, sector, url")

    rows: list[dict] = []
    for start in range(0, max_articles, PAGE_SIZE):
        r = (
            supabase.table("articles")
            .select(cols)
            .gte("ingested_at", cutoff)
            .order("ingested_at", desc=True)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        page = r.data or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break

    return rows, have_publisher


def upsert_clusters(supabase, clusters: list[dict]) -> int:
    if not clusters:
        return 0
    payload = [{
        "cluster_key": c["cluster_key"],
        "base_key": c["base_key"],
        "article_count": c["article_count"],
        "distinct_identities": c["distinct_identities"],
        "distinct_non_syndicators": c["distinct_non_syndicators"],
        "tied_lead": c["tied_lead"],
        "lead_identity": c["lead_identity"],
        "window_start": c["window_start"],
        "window_end": c["window_end"],
        "members": c["members"],
        "figure_findings": c["figure_findings"],
        "computed_at": c["computed_at"],
    } for c in clusters]
    supabase.table("cross_source_clusters").upsert(
        payload, on_conflict="cluster_key"
    ).execute()
    return len(payload)


def main(hours: int = DEFAULT_WINDOW_HOURS, dry_run: bool = False) -> dict:
    try:
        from supabase_client import get_service_client
    except ImportError:
        from backend.supabase_client import get_service_client

    supabase = get_service_client()

    articles, have_publisher = load_articles(supabase, hours=hours)
    if not have_publisher:
        print("  [cross_source] NOTE: articles.publisher missing (apply "
              "sql/0025_cross_source_observation.sql). Every Google News row "
              "resolves to no identity until it lands, so cross-source coverage "
              "is understated below.")

    clusters = build_clusters(articles)
    with_figures = [c for c in clusters if c["figure_findings"]]

    print(f"  [cross_source] window={hours}h articles={len(articles)} "
          f"publisher_column={'yes' if have_publisher else 'no'}")
    print(f"  [cross_source] cross-source clusters={len(clusters)} "
          f"with figure findings={len(with_figures)}")

    for c in clusters[:12]:
        lead = "TIED" if c["tied_lead"] else (c["lead_identity"] or "?")
        print(f"    {c['cluster_key'][:44]:46s} n={c['article_count']:2d} "
              f"ids={c['distinct_identities']:2d} "
              f"nonsynd={c['distinct_non_syndicators']:2d} lead={lead[:22]:24s} "
              f"figs={len(c['figure_findings'])}")

    if dry_run:
        print("  [cross_source] DRY RUN - nothing written")
        return {"articles": len(articles), "clusters": len(clusters), "dry_run": True}

    written = upsert_clusters(supabase, clusters)
    print(f"  [cross_source] upserted={written}")
    return {"articles": len(articles), "clusters": len(clusters), "upserted": written}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hours", type=int, default=DEFAULT_WINDOW_HOURS)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    try:
        main(hours=args.hours, dry_run=args.dry_run)
    except Exception as e:
        print(f"  [cross_source] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        raise
