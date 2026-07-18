"""Lead-weight calibrator (contract C4) - deterministic, offline, re-runnable.

WHAT THIS IS
------------
An OFFLINE JOB (not a live-path call) that fits the four UNIFIED_LEAD contest
weights - w = (materiality, session_fit, confirmation, breadth) - against
Signalera's graded record, so the weights become DATA-DRIVEN instead of
hand-tuned. It runs offline, writes a NEW versioned row to `lead_weights`
(migration sql/0015), and the LIVE scorer (impact_ranking.compute_unified_lead)
just READS the active row. This module NEVER touches the live path and contains
NO LLM anywhere - it is pure arithmetic over the graded history.

CONTRACTS CONSUMED
------------------
- C1 = pipeline_runs.preselect_decision.unified_candidates (written by Agent S1
  when UNIFIED_LEAD logs the shadow pick). Per past run this is the feature
  matrix: each candidate's raw components {c_materiality, c_session_fit,
  c_confirmation, c_breadth}, its unified_score, and which candidate is the
  shipped lead (matched by title against preselect_decision.shipped_lead).
- C3 = lead_outcome_grades (written by Agent GRADER). Per graded lead:
  grade_score in [-1, 1] and confidence in [0, 1]. Joined to the run by
  (brief_date, lead_title).

A "lead-attributable graded day" is a run that has BOTH a logged unified
candidate set (C1) AND a resolved grade (C3) for its shipped lead.

OBJECTIVE
---------
Fit w so the argmax over candidates (weighted_score under w) tends to select the
candidate that, when shipped, graded well. Concretely we maximize:

    OBJ(w) = sum over graded days of  confidence_d * grade_score_d
             where day d's argmax pick under w == that day's shipped-and-graded
             candidate.

i.e. weights are rewarded when the argmax they induce lands on a well-graded
lead and penalized (via a negative grade_score) when it lands on a badly graded
one. The method is TRANSPARENT: bounded coordinate ascent over a per-weight grid,
and we print WHY each weight moved (which graded days pushed it up or down).

GUARDRAILS (hard)
-----------------
(a) REFUSE to emit learned weights if N < MIN_TRAIN_DAYS confidence-weighted
    lead-attributable graded days. Keep the safe defaults 4/4/3/1.5. Log the N.
(b) BOUND weight movement per recalibration: each weight may move at most
    MAX_WEIGHT_DELTA_FRAC of the prior weight per recalibration. No wild swings
    on a thin new sample.
(c) JUL 13 INVARIANT as a hard PRE-WRITE check: any weight set the calibrator
    would emit MUST still make the Jul 13 case pass (the material macro story
    leads, the penny stock does NOT). Reuses the Jul 13 candidate set. Never
    writes weights that fail it.

Run:  python3.11 backend/lead_weight_calibrator.py            (real history)
      python3.11 backend/lead_weight_calibrator.py --synthetic (fit demo)
"""

from __future__ import annotations

import argparse
import datetime
import itertools
import json
import os
from dataclasses import dataclass, field
from typing import Optional

# ── Named constants (the ONE place the calibrator's knobs live) ──────────────

# The four contest dimensions, in the canonical order used everywhere here.
DIMS = ("materiality", "session_fit", "confirmation", "breadth")

# Safe hand-tuned defaults - MUST match impact_ranking.W_* and the seed row in
# sql/0015_lead_weights.sql. The reversion target when the calibrator refuses.
DEFAULT_WEIGHTS: dict[str, float] = {
    "materiality": 4.0,
    "session_fit": 4.0,
    "confirmation": 3.0,
    "breadth": 1.5,
}

# Guardrail (a): minimum confidence-weighted lead-attributable graded days
# before we will emit LEARNED weights. Below this we hold defaults.
MIN_TRAIN_DAYS = 20.0

# Guardrail (b): per-recalibration movement cap. A weight may move at most this
# fraction of its PRIOR value in a single recalibration. 0.25 == a weight can
# swing at most +/-25% off the prior weights on any one thin new sample.
MAX_WEIGHT_DELTA_FRAC = 0.25

# Bounded JOINT grid. Each weight is probed at these multiplicative offsets from
# the PRIOR, clamped to the movement cap. The search evaluates every COMBINATION
# (a full 4-D grid), so it finds combined moves that no single-axis step reaches
# (the objective is a step function of the argmax; a lead often only flips when
# several weights move together, which pure coordinate ascent cannot escape). The
# grid is small and every point is inspectable - no gradient, no black box, no
# LLM. 5^4 = 625 weight sets max, each a handful of float ops.
_GRID_STEPS = (-0.25, -0.125, 0.0, 0.125, 0.25)
_WEIGHT_FLOOR = 0.1  # weights never go to zero (a dimension is never fully muted)


# ── Data shapes ──────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    """One row of C1: a single candidate's four raw components in [0,1]."""
    title: str
    materiality: float
    session_fit: float
    confirmation: float
    breadth: float
    is_shipped_lead: bool = False

    def score(self, w: dict[str, float]) -> float:
        return (
            w["materiality"] * self.materiality
            + w["session_fit"] * self.session_fit
            + w["confirmation"] * self.confirmation
            + w["breadth"] * self.breadth
        )


@dataclass
class GradedDay:
    """One lead-attributable graded day: a full candidate set (C1) joined to the
    shipped lead's resolved grade (C3)."""
    brief_date: str
    lead_title: str
    grade_score: float   # C3, in [-1, 1]
    confidence: float    # C3, in [0, 1]
    candidates: list[Candidate] = field(default_factory=list)

    def argmax_title(self, w: dict[str, float]) -> Optional[str]:
        if not self.candidates:
            return None
        # Deterministic tie-break: highest score, then title asc (stable).
        best = max(self.candidates, key=lambda c: (c.score(w), c.title))
        return best.title

    def shipped_candidate(self) -> Optional[Candidate]:
        for c in self.candidates:
            if c.is_shipped_lead:
                return c
        return None


# ── Objective ────────────────────────────────────────────────────────────────

def objective(days: list[GradedDay], w: dict[str, float]) -> float:
    """OBJ(w) = sum over days of confidence * grade_score WHEN the argmax pick
    under w is that day's shipped-and-graded candidate.

    A day rewards w only if w's induced argmax lands on the candidate that was
    actually shipped and graded. A well-graded day (grade_score > 0) pulls the
    objective up; a badly graded day (grade_score < 0) that w still picks pulls
    it down - so w learns to AVOID the argmax that led to a bad grade."""
    total = 0.0
    for d in days:
        picked = d.argmax_title(w)
        if picked is not None and picked == d.lead_title:
            total += d.confidence * d.grade_score
    return total


def _per_day_contributions(days: list[GradedDay], w: dict[str, float]) -> list[tuple]:
    """Diagnostic: (brief_date, contribution, picked_shipped) per day under w."""
    out = []
    for d in days:
        picked = d.argmax_title(w)
        hit = picked is not None and picked == d.lead_title
        contrib = (d.confidence * d.grade_score) if hit else 0.0
        out.append((d.brief_date, contrib, hit))
    return out


# ── Coordinate-ascent fit (transparent) ──────────────────────────────────────

def _clamp_to_cap(value: float, prior: float) -> float:
    """Guardrail (b): clamp a proposed weight to within MAX_WEIGHT_DELTA_FRAC of
    the PRIOR weight, and never below the floor."""
    lo = max(_WEIGHT_FLOOR, prior * (1.0 - MAX_WEIGHT_DELTA_FRAC))
    hi = prior * (1.0 + MAX_WEIGHT_DELTA_FRAC)
    return max(lo, min(hi, value))


@dataclass
class FitTrace:
    """Full record of a fit for transparency and the migration `notes` field."""
    prior: dict[str, float]
    fitted: dict[str, float]
    obj_before: float
    obj_after: float
    movements: list[str] = field(default_factory=list)  # per-weight rationale
    cap_bound: list[str] = field(default_factory=list)   # which caps bound


def fit_weights(
    days: list[GradedDay],
    prior: dict[str, float],
) -> FitTrace:
    """Bounded JOINT grid over the four weights. Enumerate every combination of
    per-weight grid points (each clamped to the movement cap vs the PRIOR), score
    the objective on each, and keep the argmax - deterministic tie-break toward
    the smallest total movement off the prior, so a thin sample never gets a
    bigger swing than it earned. Every accepted move is logged with WHY (which
    graded days flipped into or out of the argmax-hit set, and their signed
    contributions). Transparent and re-runnable: same input -> same weights."""
    obj_before = objective(days, prior)

    # Per-weight candidate values, deduped and clamped to the cap.
    axis_vals: dict[str, list[float]] = {}
    for dim in DIMS:
        vals = sorted({_clamp_to_cap(prior[dim] * (1.0 + s), prior[dim])
                       for s in _GRID_STEPS})
        axis_vals[dim] = vals

    best_w = dict(prior)
    best_obj = obj_before
    best_move = 0.0  # total |delta| off prior, for the tie-break
    for combo in itertools.product(*(axis_vals[d] for d in DIMS)):
        w = dict(zip(DIMS, combo))
        o = objective(days, w)
        move = sum(abs(w[d] - prior[d]) for d in DIMS)
        if o > best_obj + 1e-12 or (abs(o - best_obj) <= 1e-12 and move < best_move - 1e-12):
            best_obj = o
            best_w = w
            best_move = move

    trace = FitTrace(prior=dict(prior), fitted=dict(best_w),
                     obj_before=obj_before, obj_after=best_obj)

    # WHY each weight moved: per-dimension direction + the days that flipped into
    # the argmax-hit set (gained) or out of it (a mispick removed), between the
    # prior and the fitted set.
    before = {d.brief_date: h for d, (_, _, h) in zip(days, _per_day_contributions(days, prior))}
    after = {d.brief_date: (contrib, h) for d, (_, contrib, h) in zip(days, _per_day_contributions(days, best_w))}
    flips_up, flips_down = [], []
    for d in days:
        was = before.get(d.brief_date, False)
        contrib, now_hit = after.get(d.brief_date, (0.0, False))
        if now_hit and not was:
            flips_up.append((d.brief_date, contrib))
        elif was and not now_hit:
            flips_down.append((d.brief_date, d.confidence * d.grade_score))

    for dim in DIMS:
        cur, new = prior[dim], best_w[dim]
        if abs(new - cur) <= 1e-9:
            trace.movements.append(f"{dim}: held at {cur:.3f} (no move improved the objective)")
            continue
        direction = "UP" if new > cur else "DOWN"
        trace.movements.append(f"{dim}: {cur:.3f} -> {new:.3f} ({direction})")
        # Cap-binding note (guardrail b visibility).
        hi = prior[dim] * (1.0 + MAX_WEIGHT_DELTA_FRAC)
        lo = max(_WEIGHT_FLOOR, prior[dim] * (1.0 - MAX_WEIGHT_DELTA_FRAC))
        if abs(new - hi) < 1e-9:
            trace.cap_bound.append(
                f"{dim} hit the UPPER movement cap (+{int(MAX_WEIGHT_DELTA_FRAC*100)}% "
                f"of prior {prior[dim]:.3f} = {hi:.3f})")
        elif abs(new - lo) < 1e-9:
            trace.cap_bound.append(
                f"{dim} hit the LOWER movement cap (-{int(MAX_WEIGHT_DELTA_FRAC*100)}% "
                f"of prior {prior[dim]:.3f} = {lo:.3f})")

    if flips_up:
        trace.movements.append(
            "days that STARTED being picked correctly (grades now captured): "
            + ", ".join(f"{bd}(+{c:.3f})" for bd, c in flips_up))
    if flips_down:
        trace.movements.append(
            "days that STOPPED being mispicked (bad grades shed): "
            + ", ".join(f"{bd}({-c:+.3f} removed)" for bd, c in flips_down))

    return trace


# ── Jul 13 invariant (guardrail c) ───────────────────────────────────────────

def jul13_candidate_set() -> GradedDay:
    """The Jul 13 case, reconstructed as a unified candidate set. On the
    2026-07-13 evening brief the tape moved materially (rates / oil / a sector
    dropped) yet a PENNY STOCK led - the exact clobber the unified contest exists
    to prevent (see synthesize.py ~line 4805). The invariant: under ANY weights
    the calibrator would emit, the MATERIAL MACRO story must win the argmax and
    the penny stock must NOT.

    Components are the [0,1] shape the live scorer emits (impact_ranking):
      - macro/market-wide move: high materiality (tape-consistent, market-wide
        earned edge), a real macro/confirmed event, broadly covered.
      - penny stock: single-name non-driver noise (low materiality), thin
        coverage (low breadth), speculative/unconfirmed (low confirmation)."""
    macro = Candidate(
        title="Treasury yields jump and oil slides as rate-cut bets fade (market-wide)",
        materiality=0.90,   # tape-consistent + market-wide earned edge
        session_fit=0.80,   # fresh, right for the evening session
        confirmation=0.85,  # hard macro print (real event)
        breadth=0.90,       # broadly covered across distinct sources
    )
    penny = Candidate(
        title="Tiny biotech penny stock spikes 40% on unconfirmed buyout chatter",
        materiality=0.20,   # single-name non-driver noise on the tape
        session_fit=0.85,   # can be JUST as fresh - freshness must not save it
        confirmation=0.15,  # speculative (in talks / rumored)
        breadth=0.15,       # thin, one or two sources
    )
    # A confirmed single-name deal as a third, realistic competitor.
    deal = Candidate(
        title="MidCap Corp agrees to acquire Rival Inc for $6B (confirmed)",
        materiality=0.55,
        session_fit=0.70,
        confirmation=1.00,  # confirmed mega-deal
        breadth=0.55,
    )
    return GradedDay(
        brief_date="2026-07-13",
        lead_title=macro.title,      # the CORRECT lead
        grade_score=1.0,
        confidence=1.0,
        candidates=[macro, penny, deal],
    )


def jul13_invariant_passes(w: dict[str, float]) -> tuple[bool, str]:
    """True iff, under weights w, the Jul 13 argmax is the material macro story
    AND the penny stock is NOT the pick. Returns (passed, explanation)."""
    day = jul13_candidate_set()
    scores = sorted(
        ((c.score(w), c.title) for c in day.candidates),
        key=lambda t: (-t[0], t[1]),
    )
    winner_title = scores[0][1]
    macro_title = day.lead_title
    penny_title = next(c.title for c in day.candidates if "penny stock" in c.title)
    passed = (winner_title == macro_title) and (winner_title != penny_title)
    detail = "; ".join(f"{t[:40]}={s:.3f}" for s, t in scores)
    verdict = "PASS" if passed else "FAIL"
    return passed, f"[{verdict}] winner={winner_title[:40]!r} | scores: {detail}"


# ── Effective-N (guardrail a) ────────────────────────────────────────────────

def confidence_weighted_n(days: list[GradedDay]) -> float:
    """Guardrail (a)'s N: the sum of per-day confidence over lead-attributable
    graded days. A day graded at confidence 0.5 counts as half a day. This is the
    'confidence-weighted lead-attributable graded days' the guardrail refuses
    below MIN_TRAIN_DAYS on."""
    return sum(max(0.0, min(1.0, d.confidence)) for d in days)


# ── C1 + C3 load and join (real history) ─────────────────────────────────────

def _iso_date(ts: Optional[str]) -> Optional[str]:
    if not ts:
        return None
    return str(ts)[:10]


def _parse_candidates(candidates: list) -> list[Candidate]:
    """Map C1 `preselect_decision.unified.candidates[]` rows to Candidate objects.

    CANONICAL C1 SHAPE (persisted by Agent S1, confirmed against synthesize.py's
    _cand_c1 builder). Each row is:
        { title, cluster, source, is_shipped_lead: bool, below_cap: bool,
          components: { materiality, session_fit, confirmation, breadth },
          weighted_score: float }
    The RAW pre-weight components live NESTED under `components.*` (not flat
    c_* keys), the shipped pick is the `is_shipped_lead` BOOLEAN that S1 already
    resolved (we do NOT title-match), and the score key is `weighted_score`. The
    shipped cluster is guaranteed present via below_cap even when it ranked
    outside the top-10 audit, so is_shipped_lead resolves on the merged path."""
    out: list[Candidate] = []
    for row in (candidates or []):
        if not isinstance(row, dict):
            continue
        # The nested `components` dict is the canonical C1 signature. A row
        # lacking it is a malformed / legacy-shape row (e.g. the old flat c_*
        # audit); SKIP it rather than admit an all-zero candidate that would
        # silently distort the argmax.
        comp = row.get("components")
        if not isinstance(comp, dict) or not comp:
            continue
        title = str(row.get("title") or "").strip()
        try:
            c = Candidate(
                title=title,
                materiality=float(comp.get("materiality") or 0.0),
                session_fit=float(comp.get("session_fit") or 0.0),
                confirmation=float(comp.get("confirmation") or 0.0),
                breadth=float(comp.get("breadth") or 0.0),
                is_shipped_lead=bool(row.get("is_shipped_lead")),
            )
        except (TypeError, ValueError):
            continue
        out.append(c)
    return out


def load_graded_days(sb) -> tuple[list[GradedDay], dict]:
    """Read C1 (pipeline_runs.preselect_decision.unified.candidates) and C3
    (lead_outcome_grades), join by (brief_date, lead_title), and return the
    lead-attributable graded days plus a diagnostics dict. SELECT-only.

    C1 lead_title for the grade join is the run's `unified.shipped_title` (the
    served headline S1 records), NOT a candidate title - GRADER keys its grades
    off the shipped brief's lead_title. is_shipped_lead is S1's resolved boolean.
    A run is SKIPPED (join integrity) if shipped_in_audit is false: the shipped
    cluster was not present in the logged candidate set, so any join would be a
    mis-join (pre-merge legacy call, or the shipped cluster was never scored).

    Forward-only reality: until S1's unified logging and GRADER's grades exist in
    prod, this returns [] and the diagnostics explain WHY. Never raises - a
    data-starved read is a valid, expected state."""
    diag = {
        "runs_scanned": 0,
        "runs_with_c1": 0,
        "c1_skipped_no_shipped_in_audit": 0,
        "c3_rows": 0,
        "c3_table_present": False,
        "joined_days": 0,
        "reason": "",
    }

    # --- C1: runs with a logged unified candidate set (canonical shape) ---
    c1_runs: dict[str, dict] = {}  # (date|shipped_title) -> {date, lead_title, candidates}
    try:
        resp = (sb.table("pipeline_runs")
                .select("id,created_at,brief_type,preselect_decision")
                .order("created_at", desc=True)
                .limit(2000)
                .execute())
        rows = resp.data or []
        diag["runs_scanned"] = len(rows)
        for r in rows:
            pd = r.get("preselect_decision") or {}
            if not isinstance(pd, dict):
                continue
            uni = pd.get("unified")
            if not isinstance(uni, dict):
                continue
            cands_raw = uni.get("candidates")
            if not cands_raw:
                continue
            cands = _parse_candidates(cands_raw)
            # Join integrity: the shipped cluster MUST be present in the logged
            # candidate set (S1 forces it in via below_cap). If S1 recorded
            # shipped_in_audit false, or no candidate is flagged is_shipped_lead,
            # the join would mis-attribute - skip the run.
            has_shipped = any(c.is_shipped_lead for c in cands)
            if uni.get("shipped_in_audit") is False or not has_shipped:
                diag["c1_skipped_no_shipped_in_audit"] += 1
                continue
            # GRADER keys grades on the SERVED lead_title. Prefer S1's recorded
            # shipped_title; fall back to the is_shipped_lead candidate's title.
            shipped_title = uni.get("shipped_title")
            if not shipped_title:
                shipped_title = next((c.title for c in cands if c.is_shipped_lead), None)
            bd = _iso_date(r.get("created_at"))
            if not (bd and shipped_title and cands):
                continue
            key = f"{bd}|{shipped_title.strip().lower()[:80]}"
            c1_runs[key] = {"brief_date": bd, "lead_title": shipped_title,
                            "candidates": cands}
        diag["runs_with_c1"] = len(c1_runs)
    except Exception as e:  # pragma: no cover - defensive; SELECT should not raise
        diag["reason"] = f"C1 read failed: {str(e)[:120]}"
        return [], diag

    # --- C3: resolved lead grades ---
    grades: dict[str, dict] = {}
    try:
        gresp = (sb.table("lead_outcome_grades")
                 .select("brief_date,lead_title,grade_score,confidence")
                 .limit(5000)
                 .execute())
        diag["c3_table_present"] = True
        grows = gresp.data or []
        diag["c3_rows"] = len(grows)
        for g in grows:
            bd = _iso_date(g.get("brief_date"))
            lt = str(g.get("lead_title") or "").strip().lower()[:80]
            if not (bd and lt):
                continue
            grades[f"{bd}|{lt}"] = {
                "grade_score": float(g.get("grade_score") or 0.0),
                "confidence": float(g.get("confidence") or 0.0),
            }
    except Exception as e:
        diag["c3_table_present"] = False
        diag["reason"] = f"C3 table absent / unreadable: {str(e)[:120]}"

    # --- Join: a lead-attributable graded day needs BOTH C1 and C3 ---
    days: list[GradedDay] = []
    for key, run in c1_runs.items():
        g = grades.get(key)
        if not g:
            continue
        days.append(GradedDay(
            brief_date=run["brief_date"],
            lead_title=run["lead_title"],
            grade_score=g["grade_score"],
            confidence=g["confidence"],
            candidates=run["candidates"],
        ))
    diag["joined_days"] = len(days)
    if not days and not diag["reason"]:
        if diag["runs_with_c1"] == 0:
            diag["reason"] = ("no C1 rows: no pipeline_runs carry "
                              "preselect_decision.unified.candidates with a "
                              "resolved shipped lead yet (shadow-clock logging "
                              "is forward-only).")
        elif not diag["c3_table_present"]:
            diag["reason"] = "lead_outcome_grades (C3) does not exist yet (GRADER forward-only)."
        else:
            diag["reason"] = "C1 and C3 both present but no (brief_date, lead_title) overlap yet."
    return days, diag


# ── Synthetic fixture (clearly labeled) ──────────────────────────────────────

def synthetic_graded_days() -> list[GradedDay]:
    """SYNTHETIC, clearly labeled. Construct >= 20 confidence-weighted graded
    days so the fit actually MOVES the weights.

    Design intent: the correct, WELL-GRADED lead on the Block-A days is a
    CONFIRMED deal, but under the default weights (4/4/3/1.5) the broad macro
    competitor out-scores it (materiality+breadth dominate), so defaults MISPICK
    the macro story and lose that day's positive grade. Coordinate ascent has to
    move CONFIRMATION UP and MATERIALITY/BREADTH DOWN (all within the 25% cap) to
    flip the argmax onto the deal and capture those grades. Block B keeps a real
    macro read as the correct lead so materiality/session_fit are not free to
    collapse. Block C is a noisy negative-grade day that keeps the fit honest.
    The known-good target the search should approach is roughly
    (materiality 3.0 / session_fit 4.0 / confirmation 3.75 / breadth 1.125).

    NOT production data. Deterministic (fixed hand-built rows)."""
    days: list[GradedDay] = []

    # Block A (12 days): CONFIRMED deal is the correct, well-graded lead; defaults
    # MISPICK the broad macro competitor. Under (4,4,3,1.5): deal=8.150 <
    # macro=8.650. A within-cap combined move (m 4->3, cf 3->3.75, br 1.5->1.125)
    # flips it to deal=8.213 > macro=8.088. Shipped = the deal; graded WELL.
    for i in range(12):
        d_deal = Candidate(f"Confirmed $8B acquisition announced (day {i})",
                           materiality=0.50, session_fit=0.60,
                           confirmation=1.00, breadth=0.50, is_shipped_lead=True)
        d_macro = Candidate(f"Broad index drift, no single driver (day {i})",
                            materiality=0.72, session_fit=0.70,
                            confirmation=0.60, breadth=0.78)
        d_noise = Candidate(f"Single-name penny pop (day {i})",
                            materiality=0.20, session_fit=0.60,
                            confirmation=0.15, breadth=0.20)
        days.append(GradedDay(
            brief_date=f"2026-08-{i+1:02d}",
            lead_title=d_deal.title,
            grade_score=0.85, confidence=0.95,
            candidates=[d_deal, d_macro, d_noise],
        ))

    # Block B (8 days): a genuinely material MACRO print was correct and well
    # graded; defaults already pick it. These REWARD the status quo and keep
    # materiality/session_fit from collapsing under the Block-A pressure. Shipped
    # = macro; graded WELL. (macro clearly out-scores the deal here even after the
    # Block-A move, so it stays a stable positive.)
    for i in range(8):
        d_macro = Candidate(f"CPI hotter than expected, yields jump (day {i})",
                            materiality=0.92, session_fit=0.80,
                            confirmation=0.85, breadth=0.90, is_shipped_lead=True)
        d_deal = Candidate(f"Mid-size funding round closes (day {i})",
                           materiality=0.45, session_fit=0.65,
                           confirmation=0.80, breadth=0.45)
        d_noise = Candidate(f"Rumored SPAC chatter (day {i})",
                            materiality=0.20, session_fit=0.60,
                            confirmation=0.15, breadth=0.20)
        days.append(GradedDay(
            brief_date=f"2026-09-{i+1:02d}",
            lead_title=d_macro.title,
            grade_score=0.80, confidence=0.90,
            candidates=[d_macro, d_deal, d_noise],
        ))

    # Block C (3 days): a BAD lead the defaults picked and it graded NEGATIVE - a
    # speculative single-name that should not have led. Shipped = noise; graded
    # BADLY. The macro competitor out-scores the noise under defaults, so these
    # days do not contribute under defaults (the argmax is the macro, not the
    # shipped noise) - they exist as honest noise in the record, not a lever.
    for i in range(3):
        d_noise = Candidate(f"Unconfirmed buyout rumor led (day {i})",
                            materiality=0.35, session_fit=0.90,
                            confirmation=0.15, breadth=0.25, is_shipped_lead=True)
        d_macro = Candidate(f"Material rate move ignored (day {i})",
                           materiality=0.88, session_fit=0.55,
                           confirmation=0.82, breadth=0.88)
        d_deal = Candidate(f"Real confirmed deal ignored (day {i})",
                          materiality=0.50, session_fit=0.70,
                          confirmation=1.00, breadth=0.55)
        days.append(GradedDay(
            brief_date=f"2026-10-{i+1:02d}",
            lead_title=d_noise.title,
            grade_score=-0.70, confidence=0.85,
            candidates=[d_noise, d_macro, d_deal],
        ))

    return days


# ── Emit decision (ties the guardrails together) ─────────────────────────────

@dataclass
class CalibrationResult:
    emitted: bool
    is_default: bool
    weights: dict[str, float]
    n_train: float
    obj_before: float
    obj_after: float
    prior_weights: dict[str, float]
    jul13_passed: bool
    notes: str
    trace: Optional[FitTrace] = None


def calibrate(days: list[GradedDay], prior: dict[str, float]) -> CalibrationResult:
    """The full decision. Applies guardrails (a) N<20 refusal, (b) movement cap
    (inside fit_weights), and (c) Jul 13 invariant PRE-WRITE. Returns what would
    be written (never writes here - the caller persists)."""
    n = confidence_weighted_n(days)

    # Guardrail (a): refuse below the floor, hold defaults.
    if n < MIN_TRAIN_DAYS:
        note = (f"REFUSED to learn: confidence-weighted lead-attributable graded "
                f"days N={n:.2f} < MIN_TRAIN_DAYS={MIN_TRAIN_DAYS:.0f}. Holding safe "
                f"defaults {_fmt_w(DEFAULT_WEIGHTS)}. (raw days seen: {len(days)})")
        passed, jdetail = jul13_invariant_passes(DEFAULT_WEIGHTS)
        note += f" | Jul13 on defaults: {jdetail}"
        return CalibrationResult(
            emitted=False, is_default=True, weights=dict(DEFAULT_WEIGHTS),
            n_train=n, obj_before=objective(days, DEFAULT_WEIGHTS),
            obj_after=objective(days, DEFAULT_WEIGHTS),
            prior_weights=dict(prior), jul13_passed=passed, notes=note,
        )

    # Enough data: fit (guardrail b enforced inside fit_weights).
    trace = fit_weights(days, prior)
    fitted = trace.fitted

    # Guardrail (c): HARD pre-write Jul 13 invariant check on the emitted set.
    passed, jdetail = jul13_invariant_passes(fitted)
    if not passed:
        note = (f"REJECTED fitted weights {_fmt_w(fitted)}: Jul 13 invariant "
                f"FAILED before write. {jdetail}. Holding safe defaults "
                f"{_fmt_w(DEFAULT_WEIGHTS)} instead. This is guardrail (c): never "
                f"emit weights where the penny stock beats the material macro story.")
        dpass, ddetail = jul13_invariant_passes(DEFAULT_WEIGHTS)
        note += f" | defaults still pass: {ddetail}"
        return CalibrationResult(
            emitted=False, is_default=True, weights=dict(DEFAULT_WEIGHTS),
            n_train=n, obj_before=trace.obj_before, obj_after=trace.obj_before,
            prior_weights=dict(prior), jul13_passed=dpass, notes=note, trace=trace,
        )

    # Emit the learned weights.
    move_lines = " || ".join(trace.movements) if trace.movements else "no weight moved"
    cap_lines = ("; ".join(trace.cap_bound)
                 if trace.cap_bound else "no movement cap bound")
    note = (f"LEARNED weights emitted. N={n:.2f} conf-weighted graded days. "
            f"objective {trace.obj_before:.4f} -> {trace.obj_after:.4f}. "
            f"prior {_fmt_w(prior)} -> fitted {_fmt_w(fitted)}. "
            f"movement cap {int(MAX_WEIGHT_DELTA_FRAC*100)}% per weight. "
            f"WHY: {move_lines}. CAP: {cap_lines}. Jul13 {jdetail}")
    return CalibrationResult(
        emitted=True, is_default=False, weights=dict(fitted),
        n_train=n, obj_before=trace.obj_before, obj_after=trace.obj_after,
        prior_weights=dict(prior), jul13_passed=passed, notes=note, trace=trace,
    )


def _fmt_w(w: dict[str, float]) -> str:
    return ("(" + "/".join(f"{w[d]:.2f}" for d in DIMS) + ")"
            + " [" + ", ".join(DIMS) + "]")


# ── Migration-row builder (the calibrator PREPARES the row; it never applies) ─

def next_version(sb) -> int:
    """The next strictly increasing version int. Reads max(version); a fresh
    store (only the seed row 0) yields 1. SELECT-only; never writes."""
    try:
        r = (sb.table("lead_weights").select("version")
             .order("version", desc=True).limit(1).execute())
        if r.data:
            return int(r.data[0]["version"]) + 1
    except Exception:
        pass
    return 1


def build_row(result: CalibrationResult, version: int) -> dict:
    """The lead_weights row this calibration WOULD write. The caller (a human, or
    a future service-role writer) inserts it; the calibrator NEVER applies."""
    w = result.weights
    return {
        "version": version,
        "fit_ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "w_materiality": round(w["materiality"], 6),
        "w_session_fit": round(w["session_fit"], 6),
        "w_confirmation": round(w["confirmation"], 6),
        "w_breadth": round(w["breadth"], 6),
        "n_train": int(round(result.n_train)),
        "objective_before": round(result.obj_before, 6),
        "objective_after": round(result.obj_after, 6),
        "prior_weights": {k: round(v, 6) for k, v in result.prior_weights.items()},
        "is_default": result.is_default,
        "jul13_invariant_passed": result.jul13_passed,
        "notes": result.notes,
    }


# ── Prior-weights load ───────────────────────────────────────────────────────

def load_prior_weights(sb) -> dict[str, float]:
    """The weights to move FROM: the active (max-version) lead_weights row, else
    the hand-tuned defaults. SELECT-only."""
    try:
        r = (sb.table("lead_weights")
             .select("w_materiality,w_session_fit,w_confirmation,w_breadth,version")
             .order("version", desc=True).limit(1).execute())
        if r.data:
            row = r.data[0]
            return {
                "materiality": float(row["w_materiality"]),
                "session_fit": float(row["w_session_fit"]),
                "confirmation": float(row["w_confirmation"]),
                "breadth": float(row["w_breadth"]),
            }
    except Exception:
        pass
    return dict(DEFAULT_WEIGHTS)


# ── CLI ──────────────────────────────────────────────────────────────────────

def _print_result(result: CalibrationResult, version: int, header: str) -> None:
    print("=" * 78)
    print(header)
    print("=" * 78)
    print(f"  emitted:            {result.emitted}")
    print(f"  is_default:         {result.is_default}")
    print(f"  N (conf-weighted):  {result.n_train:.2f}  (MIN_TRAIN_DAYS={MIN_TRAIN_DAYS:.0f})")
    print(f"  prior weights:      {_fmt_w(result.prior_weights)}")
    print(f"  chosen weights:     {_fmt_w(result.weights)}")
    print(f"  objective before:   {result.obj_before:.4f}")
    print(f"  objective after:    {result.obj_after:.4f}")
    print(f"  jul13 invariant:    {'PASS' if result.jul13_passed else 'FAIL'}")
    if result.trace and result.trace.movements:
        print("  per-weight movement rationale:")
        for m in result.trace.movements:
            print(f"    - {m}")
    if result.trace and result.trace.cap_bound:
        print("  movement-cap bindings:")
        for c in result.trace.cap_bound:
            print(f"    - {c}")
    print("  notes:")
    print(f"    {result.notes}")
    print("  row that WOULD be written to lead_weights (NOT applied):")
    print("    " + json.dumps(build_row(result, version), indent=2).replace("\n", "\n    "))
    print()


def _connect():
    """Best-effort SELECT-only prod client. Returns None if env is absent (the
    real-history path then reports data-starved rather than crashing)."""
    try:
        from dotenv import load_dotenv
        load_dotenv("/Users/noahhanning/breakingalpha/backend/.env")
    except Exception:
        pass
    url = os.environ.get("SUPABASE_URL")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_ANON_KEY"))
    if not (url and key):
        return None
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception:
        return None


def run_real(sb) -> CalibrationResult:
    if sb is None:
        print("  (no Supabase env; treating real history as empty / data-starved)")
        days, diag = [], {"reason": "no Supabase client (env absent)",
                          "runs_scanned": 0, "runs_with_c1": 0,
                          "c3_rows": 0, "joined_days": 0}
    else:
        days, diag = load_graded_days(sb)
    prior = load_prior_weights(sb) if sb is not None else dict(DEFAULT_WEIGHTS)
    version = next_version(sb) if sb is not None else 1
    print("-" * 78)
    print("REAL HISTORY (C1 x C3 join)")
    print("-" * 78)
    print(f"  pipeline_runs scanned:            {diag.get('runs_scanned')}")
    print(f"  runs WITH unified.candidates:     {diag.get('runs_with_c1')}  (C1, shipped resolved)")
    print(f"  runs SKIPPED (no shipped_in_audit):{diag.get('c1_skipped_no_shipped_in_audit')}")
    print(f"  lead_outcome_grades rows:         {diag.get('c3_rows')}  (C3)")
    print(f"  lead-attributable graded days:    {diag.get('joined_days')}")
    print(f"  reason:                           {diag.get('reason')}")
    print()
    result = calibrate(days, prior)
    _print_result(result, version, "REAL-HISTORY CALIBRATION DECISION")
    return result


def run_synthetic() -> CalibrationResult:
    print("#" * 78)
    print("# SYNTHETIC FIXTURE (NOT production data) - proves the fit RUNS at N>=20")
    print("#" * 78)
    days = synthetic_graded_days()
    n = confidence_weighted_n(days)
    print(f"  synthetic days: {len(days)}  |  confidence-weighted N: {n:.2f}")
    prior = dict(DEFAULT_WEIGHTS)
    result = calibrate(days, prior)
    _print_result(result, 1, "SYNTHETIC CALIBRATION DECISION (fit RUNS)")
    return result


def demo_jul13_rejection() -> None:
    """Show a candidate weight set that FAILS the Jul 13 invariant getting
    REJECTED before write. We hand-craft weights that would crown the penny stock
    (crank breadth+session_fit, mute materiality+confirmation) and confirm the
    calibrator refuses to emit them."""
    print("~" * 78)
    print("~ Jul 13 INVARIANT: a bad weight set is REJECTED before write")
    print("~" * 78)
    # Genuinely invariant-FAILING weights: session_fit so dominant that the penny
    # (highest session_fit in the set) wins, materiality/confirmation/breadth
    # muted. Under these the penny beats the macro story - exactly what must never
    # ship. (Contrast: a merely session-fit-heavy set like 0.5/8/0.5/0.5 still
    # PASSES because macro's materiality+breadth carry it; the invariant only
    # fails when the OTHER three are muted enough for session_fit to decide.)
    bad = {"materiality": 0.1, "session_fit": 10.0,
           "confirmation": 0.1, "breadth": 0.1}
    passed, detail = jul13_invariant_passes(bad)
    print(f"  hand-crafted BAD weights {_fmt_w(bad)}")
    print(f"  invariant check: {detail}")
    print(f"  -> invariant PASSES: {passed}  (must be False for a bad set)")
    print(f"  -> a fit that produced these would be REJECTED before write: {not passed}")

    # Prove the pre-write rejection path in calibrate() end to end: feed it the
    # bad set as the PRIOR and 25 penny-rewarding days, so the fit stays near the
    # bad prior (the movement cap keeps it there) and the emitted set FAILS the
    # invariant. calibrate() must REFUSE and fall back to defaults. Deep-copy the
    # candidates so the shipped-lead flip does not mutate the shared template.
    import copy
    forced = []
    for i in range(25):  # N >= 20 so refusal is the INVARIANT, not the N floor
        cands = copy.deepcopy(jul13_candidate_set().candidates)
        for c in cands:
            c.is_shipped_lead = "penny stock" in c.title
        penny_title = next(c.title for c in cands if "penny stock" in c.title)
        forced.append(GradedDay(
            brief_date=f"2026-11-{i+1:02d}",
            lead_title=penny_title, grade_score=0.9, confidence=1.0,
            candidates=cands,
        ))
    res = calibrate(forced, bad)
    print(f"  forced fit (prior={_fmt_w(bad)}, 25 penny-rewarding days, N=25):")
    print(f"    emitted={res.emitted}, is_default={res.is_default}, "
          f"jul13_passed={res.jul13_passed}")
    print(f"    fitted-but-rejected weights would have been {_fmt_w(res.trace.fitted)}"
          if res.trace else "    (no trace)")
    print(f"    -> {res.notes[:260]}")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description="Lead-weight calibrator (offline, deterministic).")
    ap.add_argument("--synthetic", action="store_true",
                    help="Run the synthetic >=20-day fixture (fit RUNS).")
    ap.add_argument("--all", action="store_true",
                    help="Run real history AND synthetic AND the Jul13 rejection demo.")
    args = ap.parse_args()

    sb = _connect()

    if args.synthetic:
        run_synthetic()
        return
    if args.all:
        run_real(sb)
        run_synthetic()
        demo_jul13_rejection()
        return
    # default: real history only (the production-safe path)
    run_real(sb)


if __name__ == "__main__":
    main()
