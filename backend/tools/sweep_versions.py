"""Replay every stored run at offset 0 and dump the winner. Run once per code
version, then diff the JSON. Uses the faithful harness from #562."""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay_lead as rl  # noqa: E402

out = {}
for run in rl.load_runs():
    key = f"{run['started_at'][:10]}|{run['brief_type']}"
    res = rl.replay(run, sweep_minutes=(0,))
    if not res:
        continue
    s = res["sweep"][0]
    out[key] = {
        "winner": s["winner"], "cluster": s["cluster"], "score": s["score"],
        "stored": run["stored_winner"], "stored_score": run["stored_score"],
        "shipped": run["shipped"], "tape_regime": res["tape_regime"],
    }
    print(f"{key:26} {str(s['cluster'])[:38]:40} {s['score']}")

json.dump(out, open(sys.argv[1], "w"), indent=1)
print(f"\nwrote {len(out)} runs to {sys.argv[1]}")
