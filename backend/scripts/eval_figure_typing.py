"""
Synthesis regression for the FIGURE-TYPING guard (mirrors the filter-eval pattern).
Validates the guard added to MORNING_SYSTEM / EVENING_SYSTEM in synthesize.py
against the cert-run #145 failure case: the evening wrap typed SpaceX's ~$75B
IPO RAISE as a "$75B valuation" (true valuation ~$1.75T). Source articles
separated the two correctly, so this is a synthesis conflation.

Method (read-only DB, live Gemini flash synthesis, NO writes):
  1. SpaceX before/after: run EVENING_SYSTEM with the guard STRIPPED (before) vs
     patched (after), N trials at the production temperature (0.3), on a diluted
     pool (3 SpaceX articles + filler) that mimics the noisy full pool where the
     stochastic conflation surfaced. Count outputs that type $75B AS a valuation.
  2. No-regression: a figure-bearing non-SpaceX set (a $650M IPO raise, a $13.8B
     energy capex, a buyout price, revenue) must keep each figure's type correct
     under the guard, and still parse.

Run: cd backend && ../.venv/bin/python scripts/eval_figure_typing.py
"""
import json, re
import synthesize as S

NEW = S.EVENING_SYSTEM
OLD = re.sub(r"\nFIGURE-TYPING RULE [^\n]*\n", "\n", NEW)   # reconstruct pre-guard prompt
assert "FIGURE-TYPING RULE" in NEW and "FIGURE-TYPING RULE" not in OLD, "guard strip failed"
sb = S.supabase
N_TRIALS = 6

# True error ONLY: $75B directly typed AS a valuation (NOT "$75B raise and ... valuation").
TRUE_ERR = re.compile(
    r"valuation\s+(of\s+|at\s+|around\s+|near\s+|~\s*)?\$?\s*75\s*(billion|b)\b"
    r"|\$?\s*75\s*(billion|b)\s+valuation\b"
    r"|targeting\s+(a\s+)?\$?\s*75\s*(billion|b)[^.\n]{0,12}valuation", re.I)

def fetch(ids):
    rows = sb.table("articles").select(
        "id,title,summary,sector,relevance_reason").in_("id", ids).execute().data or []
    by = {r["id"]: r for r in rows}
    return [by[i] for i in ids if i in by]

def serialize(arts):
    return "Today's articles:\n\n" + "\n\n".join(
        f"[{a.get('sector','')}] {a.get('title','')}\n{(a.get('summary') or '')[:300]}"
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in arts)

def all_text(js):
    o = []
    def w(x):
        if isinstance(x, str): o.append(x)
        elif isinstance(x, dict): [w(v) for v in x.values()]
        elif isinstance(x, list): [w(v) for v in x]
    w(js); return "  ".join(o)

def synth(system, uc, temp):
    r = S.gemini_generate(system, uc, temperature=temp, max_tokens=4096)
    if r.startswith("```"):
        r = r.split("```")[1]; r = r[4:] if r.startswith("json") else r
    try: return json.loads(r.strip())
    except Exception: return None

def spacex_sentence(t):
    for s in re.split(r"(?<=[.!?])\s+", t):
        if re.search(r"75\s*(billion|b)\b", s, re.I) and re.search(r"valuat|trillion|raise|ipo", s, re.I):
            return s.strip()[:170]
    return "(no 75B sentence)"

# ---------------------------------------------------------------------------
# 1. SpaceX before/after, diluted pool, temp 0.3
# ---------------------------------------------------------------------------
core = fetch([
    "eb10ea0c-8beb-4e1b-b210-540b845ff639",  # Bloomberg: 555.6M @ $135 = $75B IPO
    "a1c22cd1-1d54-4fbf-aac5-7cf97673cfe2",  # SeekingAlpha: $75B raise + $1.7-2.0T valuation
    "57003993-1b9a-4ecc-964a-9edd5f0e9e6d",  # Reuters: $135/share record IPO
])
filler = sb.table("articles").select("id,title,summary,sector,relevance_reason").gte(
    "ingested_at", "2026-06-02 00:00:00+00").not_.ilike("source", "SEC %").order(
    "relevance_score", desc=True).limit(14).execute().data or []
pool = core + [a for a in filler if a["id"] not in {c["id"] for c in core}][:12]
uc = serialize(pool)
print(f"SpaceX pool: {len(pool)} articles (3 SpaceX + filler), {N_TRIALS} trials @ temp 0.3\n")

def trials(label, system):
    err = 0
    print(f"=== {label} ===")
    for i in range(N_TRIALS):
        js = synth(system, uc, 0.3); t = all_text(js) if js else ""
        bad = bool(TRUE_ERR.search(t)) if js else None
        err += 1 if bad else 0
        print(f"  t{i+1} $75B-as-valuation={bad}: {spacex_sentence(t)}")
    print(f"  >>> $75B typed AS a valuation: {err}/{N_TRIALS}\n")
    return err

before = trials("BEFORE (guard stripped)", OLD)
after  = trials("AFTER (guard)", NEW)
print(f"SpaceX VERDICT: before={before}/{N_TRIALS}  after={after}/{N_TRIALS}  "
      f"(guard target: after=0)\n")

# ---------------------------------------------------------------------------
# 2. No-regression: figure-bearing non-SpaceX set
# ---------------------------------------------------------------------------
nr = fetch([
    "8e1f4edf-85ce-4aad-937f-5af7fe027728",  # Applied Aerospace $650M IPO raise
    "eba4a65b-3527-4e67-a01b-de567c4dac1c",  # Chevron $13.8B Argentina project (capex)
])
nr += (sb.table("articles").select("id,title,summary,sector,relevance_reason")
       .gte("ingested_at", "2026-06-02 00:00:00+00")
       .or_("title.ilike.%price target%,title.ilike.%guidance%,summary.ilike.%revenue%")
       .order("relevance_score", desc=True).limit(3).execute().data or [])
uc2 = serialize(nr)
oldj, newj = synth(OLD, uc2, 0.0), synth(NEW, uc2, 0.0)
nt = all_text(newj) if newj else ""
print("=== NO-REGRESSION (figure-bearing non-SpaceX) ===")
print(f"  parse: OLD={'ok' if oldj else 'FAIL'}  NEW={'ok' if newj else 'FAIL'}")
print("  650M typed as raise/IPO (not valuation):",
      bool(re.search(r"650\s*million[^.\n]{0,30}(rais|ipo|offering)", nt, re.I))
      and not re.search(r"650\s*million\s*valuation", nt, re.I))
print("  13.8B typed as project/investment (not valuation/market cap):",
      not bool(re.search(r"13\.8\s*billion\s*(valuation|market cap)", nt, re.I)))
