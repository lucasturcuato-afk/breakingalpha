"""Measure #566's clause-scope gap. RECON ONLY, no behaviour change.

#566 checks a prior-direction claim only when the clause NAMES its series. This
counts how often a real render puts a directional claim about a release series in a
clause that does NOT name it, which is the population #566 cannot see.

CLASSIFICATION, deterministic:
  CHECKED    a directional word attributed to the series (nearest-subject-wins, the
             same rule the guard uses) inside a clause that names the series.
  UNCHECKED  a directional word in a clause that does NOT name any series, whose
             NEAREST subject is not a competing subject (indices, sectors, yields,
             oil, VIX), inside a sentence that names exactly one series. Those are
             the plausible anaphoric references to that series.
  OUT OF SCOPE  a directional word whose nearest subject is a competing subject.
             Tape language, never the guard's business.
"""
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for k, v in (("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
             ("SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
             ("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")):
    os.environ.setdefault(k, os.environ.get(v, ""))

from supabase_client import get_service_client  # noqa: E402
import impact_ranking as ir  # noqa: E402
import macro_surprise as ms  # noqa: E402
import macro_direction_guard as g  # noqa: E402
import synthesize as syn  # noqa: E402

sb = get_service_client()
SER = ("nonfarm_payrolls", "unemployment", "cpi", "core_cpi", "pce", "core_pce", "ppi", "gdp")
DAYS = ("2026-06-25", "2026-07-02", "2026-07-14", "2026-07-15", "2026-07-30", "2026-08-07")


def fired_for(day):
    rows = (sb.table("briefings").select("created_at,macro_panel")
            .eq("briefing_type", "morning").lte("created_at", f"{day}T23:59:59Z")
            .order("created_at", desc=True).limit(6).execute()).data or []
    rows = [r for r in rows if (r.get("macro_panel") or {}).get("periods")]
    if len(rows) < 2:
        return []
    cp, pp = rows[0]["macro_panel"]["periods"], rows[1]["macro_panel"]["periods"]
    return [k for k in SER if pp.get(k) and cp.get(k) and pp[k] != cp[k]]


def classify(narrative, ctxs):
    """Returns (checked, unchecked, out_of_scope, unchecked_examples)."""
    checked = unchecked = oos = 0
    examples = []
    keys = [c["release_key"] for c in ctxs]
    for sent, sbase in g._sentences(narrative):
        named = [k for k in keys if ms.RELEASE_KINDS[k][1].search(sent)]
        for cl, cs, ce in g._clauses_of(sent, sbase):
            cl_named = [k for k in keys if ms.RELEASE_KINDS[k][1].search(cl)]
            for rx in (g._FLAT_RX, g._DOWN_RX, g._UP_RX):
                for m in rx.finditer(cl):
                    mid = (m.start() + m.end()) // 2
                    rival = min((abs(((x.start() + x.end()) // 2) - mid)
                                 for x in g._OTHER_SUBJECT_RX.finditer(cl)), default=None)
                    if cl_named:
                        sm = ms.RELEASE_KINDS[cl_named[0]][1].search(cl)
                        sdist = abs(((sm.start() + sm.end()) // 2) - mid)
                        if rival is not None and rival < sdist:
                            oos += 1
                        else:
                            checked += 1
                        continue
                    # No series in this clause.
                    if rival is not None:
                        oos += 1
                    elif len(named) == 1:
                        unchecked += 1
                        examples.append({"series": named[0], "word": m.group(0),
                                         "clause": cl.strip()})
                    else:
                        oos += 1
    return checked, unchecked, oos, examples


def stories(now):
    sp = (sb.table("articles")
          .select("id,title,summary,companies,sector,relevance_score,ingested_at,published_at")
          .gte("ingested_at", (now - datetime.timedelta(hours=24)).isoformat())
          .lt("ingested_at", now.isoformat())
          .gte("published_at", (now - datetime.timedelta(hours=48)).isoformat())
          .lt("published_at", now.isoformat())
          .order("relevance_score", desc=True).order("ingested_at", desc=True)
          .limit(60).execute()).data or []
    return syn._pulse_top_stories(sp, None, lambda a: a.get("companies") or [])


tot_c = tot_u = tot_o = 0
all_ex = []
n = 0
REPS = int(os.environ.get("REPS", "2"))
for day in DAYS:
    br = (sb.table("briefings").select("id,created_at,market_tape,macro_panel")
          .eq("briefing_type", "morning").gte("created_at", f"{day}T00:00:00Z")
          .lte("created_at", f"{day}T23:59:59Z").order("created_at").limit(1).execute()).data[0]
    now = datetime.datetime.fromisoformat(br["created_at"].replace("Z", "+00:00"))
    fired = fired_for(day)
    pool = ir.fetch_release_text_pool(sb, now)
    ctxs = ms.build_release_context(pool, releases=(br["macro_panel"] or {}).get("releases"),
                                   fired_keys=fired)
    strip = "\n".join(x for x in (ms.format_release_strip_line(c) for c in ctxs) if x)
    st = stories(now)
    for rep in range(REPS):
        nar = syn.generate_market_pulse("morning", br["market_tape"], strip, st,
                                        prior_ctx=None, macro_is_release_day=True,
                                        release_ctx=ctxs)
        if not nar:
            print(f"{day} rep{rep}: generation returned None, skipped")
            continue
        n += 1
        c, u, o, ex = classify(nar, ctxs)
        tot_c += c
        tot_u += u
        tot_o += o
        all_ex += [dict(e, day=day, rep=rep) for e in ex]
        print(f"{day} rep{rep}: checked={c} unchecked={u} out_of_scope={o}")
        if u:
            for e in ex:
                print(f"    UNCHECKED [{e['series']}] {e['word']!r} in {e['clause'][:90]!r}")

print()
print(f"live renders: {n}")
print(f"directional claims about a release series: checked={tot_c} unchecked={tot_u}")
den = tot_c + tot_u
print(f"UNCHECKED RATE: {tot_u}/{den} = {(100.0 * tot_u / den) if den else 0:.1f}%")
print(f"(tape / competing-subject words excluded as out of scope: {tot_o})")
json.dump({"renders": n, "checked": tot_c, "unchecked": tot_u, "oos": tot_o,
           "examples": all_ex}, open("/tmp/scope_gap.json", "w"), default=str)
