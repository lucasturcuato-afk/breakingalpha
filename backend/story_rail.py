"""Today's Stories rail selection (Option B: reproducible, identity-deduped snapshot).

Runs from run.py AFTER ingest and synthesis (NOT inside synthesize.py, which a
parallel sprint owns). Picks the ordered set of articles for this brief's
Today's Stories rail and persists their IDs on the briefing row, so:

  - the rail is reproducible (the same brief always shows the same stories), and
  - it is deduped by IDENTITY against the prior brief, not by an ingest-time
    clock window. Selection excludes the exact article IDs the prior brief
    already showed. This is deliberate: a story ingested AFTER the morning
    generation can still surface in the evening wrap, because dedup is by ID,
    not by when it was ingested.

Root cause this closes (defect #1, cross-brief duplication): the two rails used
to run an identical live now()-relative query, so consecutive briefs re-showed
the same top stories. Hard-excluding the prior brief's IDs makes consecutive
rails share zero articles.

Storage: briefings.story_rail_ids (jsonb array of article id strings, in render
order). Additive, nullable column (see the migration). Legacy/unpersisted rows
stay NULL and the frontend falls back to the live window query.
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone

from supabase_client import get_service_client, execute_with_retry

# Rail size and candidate recency. RECENCY_DAYS matches the frontend's existing
# published_at floor so the candidate pool is the same shape as before.
RAIL_SIZE = 8
RECENCY_DAYS = 7

# How many immediately-prior briefs to hard-exclude by article ID. One = only
# the single most-recent prior brief (the previous session, any type). This is a
# named policy knob: raise it to exclude more history, or later add a
# re-surfacing rule for updated stories. Deferred knob, not built now.
EXCLUDE_PRIOR_BRIEF_COUNT = 1

# Extra candidates fetched beyond RAIL_SIZE + prior-brief exclusions, so that
# collapsing a within-brief semantic-duplicate pair (money heuristic OR cosine)
# can refill the rail from the next candidate instead of shrinking it. Now
# shared by BOTH collapse passes, so it is a touch larger than the money-only
# era; cosine can drop more pairs (same-event, different wording).
COLLAPSE_HEADROOM = 12

# Embedding-cosine collapse threshold for the same-language semantic-duplicate
# pass. Calibrated on real pairs with gemini-embedding-001: same-language dup
# pairs land in the 0.81-0.93 band; distinct same-ticker pairs land in
# 0.55-0.73; the clean gap between the two bands is +0.085. 0.80 sits just below
# the dup band and well above the distinct band. Deliberately NOT
# thesis_generator.SIMILARITY_THRESHOLD (0.65), which is tuned for cluster->
# thesis coverage and over-merges genuinely distinct same-ticker stories here.
SIMILARITY_THRESHOLD_RAIL = 0.80

# summary is fetched for the cosine pass: title + summary is the text embedded
# on demand for candidates that lack a stored content_embeddings vector.
_ARTICLE_FIELDS = "id, relevance_score, published_at, title, summary, companies"


def _prior_rail_ids(client, before_iso):
    """Article IDs shown by the EXCLUDE_PRIOR_BRIEF_COUNT briefs immediately
    before `before_iso`. Reads the stored story_rail_ids off those rows. Legacy
    rows with a NULL list contribute nothing. Read-only, soft-fails to []."""
    try:
        resp = (
            client.table("briefings")
            .select("story_rail_ids, created_at")
            .lt("created_at", before_iso)
            .order("created_at", desc=True)
            .limit(EXCLUDE_PRIOR_BRIEF_COUNT)
            .execute()
        )
    except Exception as e:
        print(f"  ⚠ story_rail: prior-brief ID lookup failed (no exclusion): {e}")
        return []
    seen = []
    for row in resp.data or []:
        ids = row.get("story_rail_ids")
        if isinstance(ids, list):
            seen.extend(str(x) for x in ids if x)
    return seen


# --- Within-brief semantic-duplicate collapse (FIX 1) ----------------------
# HARD-SIGNAL HEURISTIC, not embeddings. Two articles collapse to one ONLY when
# they share the SAME company AND a matching normalized money amount. Both
# signals are required: ticker/company alone would eat two genuinely distinct
# stories about one company, and a shared amount alone would merge unrelated
# deals that happen to be the same size. This is a deliberate stopgap for the
# deferred embedding-based clustering; it catches the same-ticker-plus-same-
# amount pair class (e.g. the two "Ecolab ... $4.75B CoolIT" wire stories) and
# explicitly does NOT catch same-event pairs with no shared amount or with only
# different framing.

_MONEY_RE = re.compile(
    r"\$\s?([0-9]+(?:\.[0-9]+)?)\s*(trillion|billion|bn|million|mm|thousand|[kmbt])\b",
    re.IGNORECASE,
)
_MONEY_MULT = {
    "trillion": 1e12, "t": 1e12,
    "billion": 1e9, "bn": 1e9, "b": 1e9,
    "million": 1e6, "mm": 1e6, "m": 1e6,
    "thousand": 1e3, "k": 1e3,
}


def _money_amounts(text):
    """Set of normalized dollar figures in `text` so $4.75B == $4.75 billion."""
    out = set()
    for num, unit in _MONEY_RE.findall(text or ""):
        out.add(round(float(num) * _MONEY_MULT.get(unit.lower(), 1.0)))
    return out


def _company_set(row):
    """Lowercased company names on the article row. companies is a jsonb array;
    tolerate a stringified array from older rows."""
    comps = row.get("companies") or []
    if isinstance(comps, str):
        try:
            comps = json.loads(comps)
        except (ValueError, TypeError):
            comps = []
    return {str(c).strip().lower() for c in comps if c}


def _row_signals(row):
    return (_company_set(row), _money_amounts(row.get("title") or ""))


def _is_semantic_dup(a_sig, b_sig):
    """True when the pair shares a company AND a money amount. BOTH required."""
    return bool(a_sig[0] & b_sig[0]) and bool(a_sig[1] & b_sig[1])


def _stronger(a_row, b_row):
    """The row to KEEP from a duplicate pair: higher relevance_score; on a tie,
    the earlier published_at (ISO strings compare correctly for this)."""
    ra, rb = a_row.get("relevance_score") or 0, b_row.get("relevance_score") or 0
    if ra != rb:
        return a_row if ra > rb else b_row
    pa = a_row.get("published_at") or ""
    pb = b_row.get("published_at") or ""
    return a_row if pa <= pb else b_row


# --- Cosine collapse of same-language semantic duplicates (FIX 2) -----------
# The money heuristic above is a cheap hard-signal PRE-FILTER. It cannot catch
# the same-event/different-wording class that shares no dollar amount, e.g.
# Ecolab "Completes acquisition" vs "closes acquisition, updates guidance", or a
# Comcast/NBCU split reported across outlets. This pass closes that gap with an
# embedding cosine, embedding candidates ON DEMAND (rail selection runs at
# pipeline step ~3, before embedding_job at step 14, so fresh candidates are
# unembedded at selection and only ~18% of recent articles carry a stored
# vector). The whole pass SOFT-FAILS: any error returns the money-only
# selection, so the rail can never break or empty.
#
# _cosine choice: an inline numpy cosine (`_cosine_sim`) is used rather than
# importing thesis_generator._cosine. thesis_generator creates supabase + genai
# clients and pulls several heavy modules at import, which is needless weight and
# extra failure surface for the rail. The math is identical (dot / product of L2
# norms). The threshold is the rail's own SIMILARITY_THRESHOLD_RAIL (0.80), NOT
# thesis_generator.SIMILARITY_THRESHOLD (0.65).


def _cosine_sim(a, b, np):
    """Cosine similarity of two vectors, guarding zero-norm."""
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _parse_stored_vec(raw, np):
    """Parse a pgvector column (JSON string like '[0.01,...]' or a list) to a 1-D
    numpy float32 array, or None if unusable."""
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None
    try:
        v = np.asarray(raw, dtype=np.float32)
        if v.ndim != 1 or v.size == 0:
            return None
        return v
    except Exception:
        return None


def _candidate_vectors(client, candidates, np):
    """Vector for each candidate id: prefer a stored article content_embedding,
    else embed title+summary on demand via the SHARED embedding_job util (same
    Gemini model + dimensions used everywhere). Returns {id: np.ndarray}. A
    candidate whose on-demand embed returns None is simply absent (treated as
    non-duplicate downstream). Raises propagate to the caller's soft-fail."""
    import embedding_job

    ids = [str(r.get("id")) for r in candidates]
    vecs = {}
    resp = (
        client.table("content_embeddings")
        .select("content_id, embedding")
        .eq("content_type", "article")
        .in_("content_id", ids)
        .execute()
    )
    for row in resp.data or []:
        v = _parse_stored_vec(row.get("embedding"), np)
        if v is not None:
            vecs[str(row.get("content_id"))] = v
    for row in candidates:
        aid = str(row.get("id"))
        if aid in vecs:
            continue
        text = embedding_job._build_text(row, "article")
        emb = embedding_job._embed_text(text)
        if emb is not None:
            vecs[aid] = np.asarray(emb, dtype=np.float32)
    return vecs


def _cosine_collapse(client, candidates):
    """Collapse same-language semantic duplicates in the ordered candidate list:
    any pair with cosine >= SIMILARITY_THRESHOLD_RAIL merges to one, keeping the
    stronger row (same winner rule as the money heuristic: higher relevance_score,
    tie -> earlier published_at). Order is preserved; the winner stays at the
    earlier slot and later candidates refill toward RAIL_SIZE. SOFT-FAILS: any
    failure (import, embedding API error, missing key, numpy issue) returns the
    input list unchanged so the rail falls back to the money-only selection."""
    if len(candidates) < 2:
        return candidates
    try:
        import numpy as np

        vecs = _candidate_vectors(client, candidates, np)
        kept = []       # representative rows in render order
        kept_vecs = []  # parallel vector (or None) for each kept row
        for row in candidates:
            v = vecs.get(str(row.get("id")))
            dup_idx = None
            if v is not None:
                for i, kv in enumerate(kept_vecs):
                    if kv is not None and _cosine_sim(v, kv, np) >= SIMILARITY_THRESHOLD_RAIL:
                        dup_idx = i
                        break
            if dup_idx is not None:
                winner = _stronger(kept[dup_idx], row)
                kept[dup_idx] = winner
                kept_vecs[dup_idx] = vecs.get(str(winner.get("id")))
                continue
            kept.append(row)
            kept_vecs.append(v)
        return kept
    except Exception as e:
        print(
            "  ⚠ story_rail: cosine collapse failed, falling back to "
            f"money-heuristic selection: {e}"
        )
        return candidates


def select_rail_ids(client, prior_ids):
    """Pick the ordered rail: relevance_score desc, then published_at desc as the
    deterministic tiebreak, from articles published within the recency guard,
    hard-excluding prior_ids, then collapsing within-brief semantic-duplicate
    pairs. Two collapse passes run in order: (1) the cheap money+company
    hard-signal heuristic pre-filter, then (2) the embedding-cosine pass for the
    same-event/different-wording class the heuristic cannot see. Returns up to
    RAIL_SIZE article id strings in render order. Fetches RAIL_SIZE + prior +
    COLLAPSE_HEADROOM candidates so the prior exclusion and both collapse passes
    can refill the rail."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENCY_DAYS)).isoformat()
    limit = RAIL_SIZE + len(prior_ids) + COLLAPSE_HEADROOM
    resp = (
        client.table("articles")
        .select(_ARTICLE_FIELDS)
        .gte("published_at", cutoff)
        .order("relevance_score", desc=True)
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )
    exclude = set(prior_ids)
    # Pass 1: money+company heuristic over the FULL candidate set. No early break
    # at RAIL_SIZE here (unlike before) so the cosine pass and the final slice
    # both keep the fetched headroom to refill from.
    candidates = []   # rows in render order, one representative per money-dup group
    cand_sigs = []    # parallel (company_set, amount_set) for each candidate row
    for row in resp.data or []:
        aid = str(row.get("id"))
        if not aid or aid in exclude:
            continue
        sig = _row_signals(row)
        dup_idx = None
        # Only dedup rows that carry BOTH signals; otherwise never collapse.
        if sig[0] and sig[1]:
            for i, ksig in enumerate(cand_sigs):
                if _is_semantic_dup(sig, ksig):
                    dup_idx = i
                    break
        if dup_idx is not None:
            # Collapse: keep the stronger of the pair at the existing slot, and
            # let a later candidate refill the freed slot toward RAIL_SIZE.
            winner = _stronger(candidates[dup_idx], row)
            candidates[dup_idx] = winner
            cand_sigs[dup_idx] = _row_signals(winner)
            continue
        candidates.append(row)
        cand_sigs.append(sig)

    # Pass 2: embedding-cosine collapse (soft-fails to the pass-1 selection).
    collapsed = _cosine_collapse(client, candidates)
    return [str(r["id"]) for r in collapsed[:RAIL_SIZE]]


def persist_story_rail(brief_type="morning"):
    """Build and persist this brief's Today's Stories rail. Attaches the ordered
    article IDs to the most-recent briefing row of `brief_type` (the row
    synthesize just inserted). Returns the count written. Raises on hard failure
    so run.py can mark the step degraded; the site is unaffected because the
    frontend falls back to the live window query when the column is absent."""
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY required to persist the story rail")
    client = get_service_client()

    cur = (
        client.table("briefings")
        .select("id, created_at")
        .eq("briefing_type", brief_type)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not cur.data:
        print(f"  ⚠ story_rail: no {brief_type} briefing row to attach to; skipping")
        return 0
    brief_id = cur.data[0]["id"]
    created_at = cur.data[0]["created_at"]

    prior_ids = _prior_rail_ids(client, created_at)
    rail_ids = select_rail_ids(client, prior_ids)
    if not rail_ids:
        print("  ⚠ story_rail: candidate pool empty; leaving story_rail_ids NULL (frontend falls back)")
        return 0

    execute_with_retry(
        lambda: client.table("briefings")
        .update({"story_rail_ids": rail_ids})
        .eq("id", brief_id)
        .execute(),
        what="story_rail update",
    )
    print(
        f"  📌 story_rail: wrote {len(rail_ids)} IDs to {brief_type} brief {brief_id} "
        f"(excluded {len(prior_ids)} from prior brief)"
    )
    return len(rail_ids)


if __name__ == "__main__":
    import sys

    persist_story_rail(sys.argv[1] if len(sys.argv) > 1 else "morning")
