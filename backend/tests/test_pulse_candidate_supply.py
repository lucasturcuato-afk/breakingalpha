"""Agent SUPPLY: the pulse's top_stories must be able to name the day's tape
driver even when relevance_score saturation drops that driver cluster from the
relevance-top-60 synthesis pool.

Proven regression (2026-07-29 morning): 576 articles tied at relevance_score 10;
`articles ORDER BY relevance_score DESC LIMIT 60` returned an arbitrary 60 that
held ZERO of the Middle East / oil cluster explaining WTI +7.75%. Since
_pulse_top_stories reads only the spine/floor derived from that pool, the pulse
could not name the driver. The fix pulls a narrow deterministic driver query and
guarantees the recovered driver a front spine slot.

synthesize.py is not offline-importable (it builds Supabase / Gemini clients at
import), so the real helpers are exec-loaded in isolation, matching the pattern in
test_lead_overview_offline.py. This exercises the shipped code, not a copy.
"""

import ast
import json
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent


def _load_synth_helpers():
    src = (_BACKEND / "synthesize.py").read_text()
    tree = ast.parse(src)
    wanted_funcs = {
        "_select_articles_for_synthesis",
        "_pulse_top_stories",
    }
    wanted_consts = {"FLOOR_MIN_SCORE"}
    nodes = [
        n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in wanted_funcs)
        or (isinstance(n, ast.Assign)
            and any(getattr(t, "id", "") in wanted_consts for t in n.targets))
    ]
    ns = {"json": json}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<synth>", "exec"), ns)  # noqa: S102
    return ns


def _art(title, sector, score, url, deal_type=None, summary="x"):
    return {
        "title": title, "sector": sector, "industry_verticals": [sector],
        "relevance_score": score, "url": url, "summary": summary,
        "companies": [], "deal_type": deal_type,
    }


class PulseCandidateSupplyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ns = _load_synth_helpers()

    def _cof(self, a):
        return []

    def _corporate_pool(self):
        # 12 corporate score-10 stories; NO geo/oil (the starved top-60 case).
        return [
            _art(f"Corp {i} Q2 Earnings", "Technology", 10, f"http://c/{i}")
            for i in range(12)
        ]

    def test_guaranteed_driver_reaches_top_stories(self):
        sel = self.ns["_select_articles_for_synthesis"]
        top = self.ns["_pulse_top_stories"]
        pool = self._corporate_pool()
        driver = _art(
            "Shipping Risks Rise Across Crucial Middle East Oil Routes",
            "Energy & Oil/Gas", 10, "http://geo/1", deal_type="Geopolitical",
        )

        before = top(*sel(pool), self._cof, limit=5)
        self.assertFalse(
            any("Oil" in s["title"] for s in before),
            "precondition: starved pool has no oil driver in top_stories",
        )

        after = top(*sel(pool, guaranteed=[driver]), self._cof, limit=5)
        self.assertTrue(
            any(s["title"] == driver["title"] for s in after),
            "driver must reach top_stories after supply injection",
        )
        # Lead slot 0 is preserved; the driver lands right behind it.
        self.assertEqual(after[0]["title"], before[0]["title"])
        self.assertEqual(after[1]["title"], driver["title"])

    def test_empty_guaranteed_is_noop(self):
        sel = self.ns["_select_articles_for_synthesis"]
        pool = self._corporate_pool()
        base_spine, base_floor = sel(pool)
        g_spine, g_floor = sel(pool, guaranteed=[])
        self.assertEqual([a["url"] for a in base_spine], [a["url"] for a in g_spine])
        self.assertEqual([a["url"] for a in base_floor], [a["url"] for a in g_floor])

    def test_driver_already_present_not_duplicated(self):
        sel = self.ns["_select_articles_for_synthesis"]
        driver = _art("Oil Prices Jump on Hormuz", "Energy & Oil/Gas", 10,
                      "http://geo/2", deal_type="Geopolitical")
        pool = [driver] + self._corporate_pool()
        spine, floor = sel(pool, guaranteed=[dict(driver)])
        urls = [a["url"] for a in spine + floor]
        self.assertEqual(urls.count("http://geo/2"), 1,
                         "a driver already in the pool must not be duplicated")


if __name__ == "__main__":
    unittest.main()
