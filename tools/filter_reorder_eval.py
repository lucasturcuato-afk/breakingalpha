"""
Offline equivalence eval for the FILTER_PROMPT reorder (FILTER_PROMPT_CACHE).

WHY: reordering the filter prompt (moving the article fields from the middle to
the tail so the static rubric/schema becomes a cacheable leading prefix) is an
LLM byte-order change. The explicit cache itself is billing-only and does NOT
change what the model sees, so the ONLY behavioural risk is the reorder. This
script measures that risk on real articles: it runs each sampled article through
BOTH prompt orders (uncached, on gemini-2.5-flash-lite) and reports whether the
relevance score, the >=GATE keep/cut decision, sentiment, and the extracted
companies stay stable.

THIS SCRIPT IS READ-ONLY. It SELECTs a sample from the articles table and makes
Gemini count-as-usage generate calls. It writes NOTHING back to the database and
never touches the pipeline. Run it AFTER the Gemini account has headroom.

The flag must stay OFF until this eval shows the keep/cut decision does not
drift. A handful of within-1 score wobbles are expected and fine; a flip across
the >=GATE boundary is the thing to watch.

USAGE (from repo root, with prod-style creds in the environment):
    python tools/filter_reorder_eval.py
    EVAL_PER_BAND=40 EVAL_BATCH=25 python tools/filter_reorder_eval.py

ENV KNOBS:
    EVAL_PER_BAND   articles sampled per relevance band (default 25)
    EVAL_BATCH      articles per batch before a sleep (default 25)
    EVAL_SLEEP_SEC  seconds slept between batches (default 5)
    EVAL_GATE       ingest keep threshold to test decisions at (default 6)

NOTE ON SAMPLE BIAS: stored articles skew toward relevance_score >= GATE (the
gate keeps those), so the low bands may be thin. That is fine: the decision
boundary at >=GATE is exactly where a flip matters, and the kept population is
the one whose stability protects the live feed. The per-band counts are printed
so the bias is visible.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import ingest  # noqa: E402  (constructs the genai + supabase clients from env)
from google.genai import types  # noqa: E402


PER_BAND = int(os.getenv("EVAL_PER_BAND", "25"))
BATCH = int(os.getenv("EVAL_BATCH", "25"))
SLEEP_SEC = float(os.getenv("EVAL_SLEEP_SEC", "5"))
GATE = int(os.getenv("EVAL_GATE", "6"))

# Bounded exponential backoff for transient Gemini errors (503 UNAVAILABLE,
# 429 RESOURCE_EXHAUSTED). Without this a transient 503 silently drops the
# article from the sample, which is exactly why throttled runs under-sample.
# Sequence at the defaults: 2s, 4s, 8s, 16s, then give up. Bounded by attempts,
# so it cannot infinite-loop.
MAX_RETRIES = int(os.getenv("EVAL_MAX_RETRIES", "5"))
BACKOFF_BASE_SEC = float(os.getenv("EVAL_BACKOFF_BASE_SEC", "2"))
BACKOFF_CAP_SEC = float(os.getenv("EVAL_BACKOFF_CAP_SEC", "30"))

# Relevance bands to stratify the sample across. (lo, hi) inclusive.
BANDS = [(0, 3), (4, 5), (6, 7), (8, 10)]


def _sample_articles():
    """Read-only stratified pull of recent articles, newest first per band."""
    rows = []
    seen = set()
    for lo, hi in BANDS:
        try:
            resp = (
                ingest.supabase.table("articles")
                .select("title,summary,source,relevance_score,sentiment,companies")
                .gte("relevance_score", lo)
                .lte("relevance_score", hi)
                .order("ingested_at", desc=True)
                .limit(PER_BAND)
                .execute()
            )
        except Exception as ex:
            print(f"  [eval] band {lo}-{hi} query failed: {ex}")
            continue
        band_rows = resp.data or []
        for r in band_rows:
            key = (r.get("title"), r.get("source"))
            if key in seen or not r.get("title"):
                continue
            seen.add(key)
            rows.append(r)
        print(f"  [eval] band {lo}-{hi}: {len(band_rows)} rows")
    return rows


def _fields(a):
    return {
        "title": a.get("title") or "",
        "summary": a.get("summary") or "",
        "source": a.get("source") or "",
    }


def _grade(prompt_text):
    """One uncached filter call on the production model/config. Returns the
    parsed dict, or raises on a rate-limit so the caller can stop cleanly."""
    resp = ingest.gemini_client.models.generate_content(
        model=ingest.FILTER_MODEL,
        contents=prompt_text,
        config=types.GenerateContentConfig(
            temperature=0.2,
            max_output_tokens=2048,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_mime_type="application/json",
            response_schema=ingest.FilterDecision,
        ),
    )
    text = (resp.text or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _is_unavailable_error(ex) -> bool:
    """True for transient Gemini 503 UNAVAILABLE (the Google capacity blip).
    Distinct from _is_rate_limit_error, which covers 429/RESOURCE_EXHAUSTED."""
    s = str(ex)
    return "503" in s or "UNAVAILABLE" in s


def _grade_with_retry(prompt_text, label, item_idx):
    """_grade with bounded exponential backoff on transient Gemini errors so a
    503/429 blip does not silently drop the article from the sample. Non-transient
    errors raise immediately. If every attempt fails, the last exception is
    re-raised so the caller can halt (persistent rate-limit) or skip (503)."""
    last_ex = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return _grade(prompt_text)
        except Exception as ex:
            last_ex = ex
            transient = _is_unavailable_error(ex) or ingest._is_rate_limit_error(ex)
            if not transient or attempt == MAX_RETRIES:
                raise
            backoff = min(BACKOFF_CAP_SEC, BACKOFF_BASE_SEC * (2 ** (attempt - 1)))
            print(
                f"  [eval] item {item_idx} {label} transient error "
                f"(attempt {attempt}/{MAX_RETRIES}, backoff {backoff:.0f}s): "
                f"{type(ex).__name__}"
            )
            time.sleep(backoff)
    raise last_ex  # defensive: loop always returns or raises above


def _companies(parsed):
    """Lower-cased set of company names from a parsed filter result."""
    out = set()
    for c in (parsed.get("companies") or []):
        if isinstance(c, dict):
            name = (c.get("name") or "").strip().lower()
        else:
            name = str(c).strip().lower()
        if name:
            out.add(name)
    return out


def main():
    print(
        f"  [eval] FILTER reorder equivalence | model={ingest.FILTER_MODEL} "
        f"per_band={PER_BAND} batch={BATCH} sleep={SLEEP_SEC}s gate>={GATE}"
    )
    articles = _sample_articles()
    total = len(articles)
    print(f"  [eval] sampled {total} unique articles\n")
    if not total:
        print("  [eval] no articles sampled; nothing to do.")
        return

    n = 0
    skipped = 0
    score_exact = score_within1 = gate_agree = sentiment_agree = companies_exact = 0
    flips = []
    stopped_early = False

    for i, a in enumerate(articles):
        if i and i % BATCH == 0:
            print(f"  [eval] ...{i}/{total} done, sleeping {SLEEP_SEC}s")
            time.sleep(SLEEP_SEC)
        f = _fields(a)
        try:
            old = _grade_with_retry(ingest.FILTER_PROMPT.format(**f), "old", i)
            new = _grade_with_retry(ingest.FILTER_PROMPT_REORDERED.format(**f), "new", i)
        except Exception as ex:
            # Persistent rate-limit means no account headroom: halt cleanly and
            # report the partial. A persistent 503 (or any other error) only
            # costs us this one article, so count it skipped and keep going.
            if ingest._is_rate_limit_error(ex):
                print(f"  [eval] rate-limited at item {i} after retries; stopping cleanly with {n} completed.")
                stopped_early = True
                break
            skipped += 1
            print(f"  [eval] item {i} skipped after retries ({type(ex).__name__}: {ex}).")
            continue

        n += 1
        os_, ns = old.get("relevance_score"), new.get("relevance_score")
        try:
            os_i, ns_i = int(os_), int(ns)
        except (TypeError, ValueError):
            os_i = ns_i = None
        if os_i is not None and ns_i is not None:
            if os_i == ns_i:
                score_exact += 1
            if abs(os_i - ns_i) <= 1:
                score_within1 += 1
            old_keep, new_keep = os_i >= GATE, ns_i >= GATE
            if old_keep == new_keep:
                gate_agree += 1
            else:
                flips.append({
                    "title": (a.get("title") or "")[:80],
                    "old_score": os_i, "new_score": ns_i,
                    "old_keep": old_keep, "new_keep": new_keep,
                })
        if (old.get("sentiment") or "") == (new.get("sentiment") or ""):
            sentiment_agree += 1
        if _companies(old) == _companies(new):
            companies_exact += 1

    print("\n  ===== FILTER REORDER EQUIVALENCE REPORT =====")
    print(f"  graded (old,new) pairs ... {n}" + ("  [PARTIAL: rate-limited]" if stopped_early else ""))
    print(f"  skipped (after retries) .. {skipped}")
    print(f"  attempted ................ {n + skipped} of {total} sampled"
          + ("  [PARTIAL: halted early, remainder not attempted]" if stopped_early else ""))
    if n:
        pct = lambda x: f"{x}/{n} ({100.0 * x / n:.1f}%)"
        print(f"  relevance_score exact .... {pct(score_exact)}")
        print(f"  relevance_score within-1 . {pct(score_within1)}")
        print(f"  >={GATE} keep/cut agree ... {pct(gate_agree)}   <-- THE GATE THAT MATTERS")
        print(f"  sentiment agree .......... {pct(sentiment_agree)}")
        print(f"  companies set identical ... {pct(companies_exact)}")
    print(f"\n  decision FLIPS across the >={GATE} gate: {len(flips)}")
    for fl in flips:
        verb = "KEPT->CUT" if fl["old_keep"] and not fl["new_keep"] else "CUT->KEPT"
        print(f"    [{verb}] old={fl['old_score']} new={fl['new_score']}  {fl['title']}")
    print("\n  VERDICT GUIDANCE: keep FILTER_PROMPT_CACHE OFF unless the >="
          f"{GATE} keep/cut agreement is effectively 100% and the flip list is")
    print("  empty (or every flip is a defensible within-1 wobble at the boundary).")


if __name__ == "__main__":
    main()
