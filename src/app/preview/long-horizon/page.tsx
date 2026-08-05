/**
 * LONG-HORIZON PANEL PREVIEW - not a live surface, and not fixtures either.
 *
 * Every number below is REAL OUTPUT from the real grader
 * (backend/grading/price_attribution.py) run against REAL adjusted Tiingo
 * daily bars for the window 2026-02-02 -> 2026-05-01, captured on 2026-08-04.
 * Nothing here is authored by hand: the two objects are verbatim
 * morning_brief_call_outcomes rows as the grader would write them.
 *
 * It exists because no long-horizon call has come due in prod yet (every
 * graded row to date is single-session), and inventing one to look at would be
 * exactly the fabrication this product refuses. Reproduce with:
 *
 *   python - <<'PY'
 *   from backend.grading.price_attribution import PriceAttributionGrader
 *   g = PriceAttributionGrader(ticker_sectors={"AMD":"technology","AVGO":"technology"})
 *   print(g.resolve({"id":"AMD","claim_type":"ticker","target_symbol":"AMD",
 *       "expected_direction":"bullish","brief_date":"2026-05-01",
 *       "window_start":"2026-02-02"}))
 *   PY
 *
 * The pair is the whole point of the panel side by side:
 *   AMD  +52.92% over the quarter, beating XLK by 40 points. An unambiguous
 *        win on the terminal numbers, and the OLD grader credited it. It was
 *        17.67% BEHIND its benchmarks at the first checkpoint and still 6.13%
 *        behind at the second: the entire outperformance arrived in the final
 *        third. Now "no clean read".
 *   AVGO +29.44%, benchmark-relative the whole way. Still a clean win, and it
 *        keeps its credit. The panel discriminates; it does not blanket-punish.
 */

import { ScoredObject } from "@/components/scored-object/ScoredObject";
import { scoredCallProps, type CallOutcomeRow } from "@/lib/scored-object-map";

const TODAY = "2026-05-02";

const AMD_CALL = {
  claim_text: "AMD outperforms on accelerator share gains through the quarter.",
  target_symbol: "AMD",
  claim_type: "ticker",
  brief_date: "2026-02-02",
  created_at: "2026-02-02T14:30:00Z",
};

const AVGO_CALL = {
  claim_text: "Broadcom re-rates as custom-silicon revenue compounds.",
  target_symbol: "AVGO",
  claim_type: "ticker",
  brief_date: "2026-02-02",
  created_at: "2026-02-02T14:30:00Z",
};

/** Verbatim grader output. Do not hand-edit: regenerate with the snippet above. */
const AMD_OUTCOME: CallOutcomeRow = {
  call_id: "amd-real",
  verdict: "partial",
  attribution: "inconclusive",
  actual_pct_change: 0.529202,
  actual_direction: "up",
  verdict_notes: null,
  graded_at: "2026-05-01T22:00:00Z",
  metadata: {
    grader: "price_attribution_v1",
    entity_symbol: "AMD",
    tier: "single_stock",
    thresholds_pct: { dead_band: 3.969, min_excess: 5.953 },
    entity_move_pct: 52.92,
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 12.921, excess_pct: 39.999, meaningful_bar_pct: 3.969 },
      { symbol: "SPY", role: "market", move_pct: 4.795, excess_pct: 48.125, meaningful_bar_pct: 3.969 },
    ],
    benchmark_coverage: "sector_and_market",
    attribution_confidence: 0.6,
    window: { from: "2026-02-02T00:00:00+00:00", to: "2026-05-01T23:59:59+00:00" },
    window_sessions: 63,
    threshold_scale: 7.937,
    horizon_class: "long",
    attribution_grade: "none",
    checkpoints: [
      { fraction: 0.333, date: "2026-03-03", sessions: 21, entity_pct: -19.01, signed_excess_pct: -17.669, bar_pct: 3.437, disagrees: true },
      { fraction: 0.667, date: "2026-04-01", sessions: 42, entity_pct: -10.841, signed_excess_pct: -6.125, bar_pct: 4.861, disagrees: true },
    ],
    panel: {
      agreed: false,
      downgraded: true,
      pre_panel_verdict: "correct",
      pre_panel_attribution: "clean",
    },
  },
};

const AVGO_OUTCOME: CallOutcomeRow = {
  call_id: "avgo-real",
  verdict: "correct",
  attribution: "clean",
  actual_pct_change: 0.294411,
  actual_direction: "up",
  verdict_notes: null,
  graded_at: "2026-05-01T22:00:00Z",
  metadata: {
    grader: "price_attribution_v1",
    entity_symbol: "AVGO",
    tier: "single_stock",
    thresholds_pct: { dead_band: 3.969, min_excess: 5.953 },
    entity_move_pct: 29.441,
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 12.921, excess_pct: 16.52, meaningful_bar_pct: 3.969 },
      { symbol: "SPY", role: "market", move_pct: 4.795, excess_pct: 24.646, meaningful_bar_pct: 3.969 },
    ],
    benchmark_coverage: "sector_and_market",
    attribution_confidence: 0.65,
    window: { from: "2026-02-02T00:00:00+00:00", to: "2026-05-01T23:59:59+00:00" },
    window_sessions: 63,
    threshold_scale: 7.937,
    horizon_class: "long",
    attribution_grade: "moderate",
    checkpoints: [
      { fraction: 0.333, date: "2026-03-03", sessions: 21, entity_pct: 10.52, signed_excess_pct: -2.401, bar_pct: 3.437, disagrees: false },
      { fraction: 0.667, date: "2026-04-01", sessions: 42, entity_pct: 15.83, signed_excess_pct: 1.02, bar_pct: 4.861, disagrees: false },
    ],
    panel: {
      agreed: true,
      downgraded: false,
      pre_panel_verdict: "correct",
      pre_panel_attribution: "clean",
    },
  },
};

function CheckpointTrack({ outcome }: { outcome: CallOutcomeRow }) {
  const cps = outcome.metadata?.checkpoints ?? [];
  if (cps.length === 0) return null;
  return (
    <div className="mt-3" data-testid="checkpoint-track">
      <p className="font-data text-[9.5px] uppercase tracking-[0.12em] text-text-faint mb-1.5">
        Interim reads · benchmark-relative
      </p>
      <div className="flex flex-wrap gap-2">
        {cps.map((c) => (
          <span
            key={c.date}
            className={`rounded-md border px-2 py-1 font-data text-[10px] tabular-nums ${
              c.disagrees
                ? "border-signal-dn/40 text-signal-dn"
                : "border-border-subtle text-text-muted"
            }`}
          >
            {c.date} · {c.signed_excess_pct >= 0 ? "+" : ""}
            {c.signed_excess_pct.toFixed(2)}% vs bar {c.bar_pct}
            {/* Three states, not two: a small negative excess is inside the
                noise bar, and calling it "ahead" would misdescribe it. Only a
                move beyond the bar in either direction is a real read. */}
            {c.disagrees
              ? " · behind"
              : c.signed_excess_pct >= c.bar_pct
                ? " · ahead"
                : " · within noise"}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LongHorizonPreview() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-[24px] font-semibold text-text-primary">
        Long-horizon grading panel
      </h1>
      <p className="mt-1 font-sans text-[13px] text-text-secondary">
        Real grader output over real adjusted prices, 2026-02-02 to 2026-05-01.
        Same terminal rule as before; the panel only decides whether a win reads
        as clean.
      </p>

      <section className="mt-8">
        <h2 className="font-data text-[10px] uppercase tracking-[0.14em] text-signal-dn mb-2">
          Downgraded by the panel
        </h2>
        <ScoredObject {...scoredCallProps(AMD_CALL, AMD_OUTCOME, TODAY)} />
        <CheckpointTrack outcome={AMD_OUTCOME} />
        <p className="mt-2 font-sans text-[11px] text-text-faint">
          Terminal numbers alone said{" "}
          <strong>
            {AMD_OUTCOME.metadata?.panel?.pre_panel_verdict}/
            {AMD_OUTCOME.metadata?.panel?.pre_panel_attribution}
          </strong>
          . The interim reads contradicted it, so it is not counted as a win.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-data text-[10px] uppercase tracking-[0.14em] text-signal-up mb-2">
          Kept clean
        </h2>
        <ScoredObject {...scoredCallProps(AVGO_CALL, AVGO_OUTCOME, TODAY)} />
        <CheckpointTrack outcome={AVGO_OUTCOME} />
      </section>
    </main>
  );
}
