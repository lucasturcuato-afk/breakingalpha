import type { Metadata } from "next";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  scoredCallProps,
  type CallOutcomeRow,
  type OpenCallInput,
} from "@/lib/scored-object-map";

export const metadata: Metadata = {
  title: "Design preview — Scored Object",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS — NOT A LIVE SURFACE.
 *
 * Two sections:
 *  1. Hand-written placeholder props (the original design reference set).
 *  2. Fixture rows driven through the REAL outcome mapper (scoredCallProps),
 *     proving every live state renders correctly without needing prod data.
 * All values on this page are fixtures. Live surfaces (BriefCallsSection)
 * only ever produce resolved states from real morning_brief_call_outcomes
 * rows; this page is the only place fixture data may instantiate them.
 */

const OPEN = {
  state: "open" as const,
  sector: "Semiconductors",
  claim: "NVDA re-rates higher into the next print as data-center demand outruns Street models.",
  calledDate: "Apr 8",
  confidencePct: 70,
  consensus: "Street neutral",
  resolvesWhen: "Apr 22",
  resolvesSource: "the post-earnings close",
};

const RIGHT = {
  state: "right" as const,
  sector: "Semiconductors",
  claim: "NVDA re-rates higher into the next print as data-center demand outruns Street models.",
  calledDate: "Apr 8",
  confidencePct: 70,
  consensus: "Street neutral",
  scoredDate: "Apr 22",
  calibration: "More confident than consensus, and correct — a bold call that paid off.",
  attribution: "Attribution: clean.",
};

const WRONG = {
  state: "wrong" as const,
  sector: "Consumer & Retail",
  claim: "TGT guidance holds; the margin scare is overdone and unwinds within the quarter.",
  calledDate: "Apr 8",
  confidencePct: 64,
  consensus: "Street cautious",
  scoredDate: "Apr 22",
  calibration: "Confident against consensus, and wrong. The margin pressure was real.",
  attribution: "Attribution: clean.",
};

const INCONCLUSIVE = {
  state: "inconclusive" as const,
  sector: "Energy & Oil/Gas",
  claim: "XOM outperforms on disciplined capex as the cycle turns.",
  calledDate: "Apr 8",
  confidencePct: 58,
  consensus: "Street mixed",
  scoredDate: "Apr 22",
  calibration: "The whole sector moved on the crude tape — this can't be credited to the thesis.",
  attribution: "Attribution: confounded.",
};

// ── Mapper-driven fixtures: fixture rows through the REAL scoredCallProps ──
// A fixed "today" keeps the open-vs-expired split deterministic in fixtures.
const FIXTURE_TODAY_PT = "2026-07-02";

const call = (over: Partial<OpenCallInput> & { claim_text: string }): OpenCallInput => ({
  target_symbol: "NVDA",
  claim_type: "ticker",
  confidence: 0.7, // present in data, deliberately never rendered
  created_at: "2026-07-01T13:30:00Z",
  brief_date: "2026-07-01",
  ...over,
});

const outcome = (over: Partial<CallOutcomeRow>): CallOutcomeRow => ({
  call_id: "fixture",
  verdict: "correct",
  attribution: "clean",
  actual_pct_change: 0.0231,
  actual_direction: "up",
  verdict_notes: null,
  graded_at: "2026-07-01T22:05:00Z",
  metadata: {
    grader: "price_attribution_v1",
    entity_symbol: "NVDA",
    tier: "single_stock",
    thresholds_pct: { dead_band: 0.5, min_excess: 0.75 },
    entity_move_pct: 2.31,
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 0.42, excess_pct: 1.89, meaningful_bar_pct: 0.5 },
      { symbol: "SPY", role: "market", move_pct: 0.15, excess_pct: 2.16, meaningful_bar_pct: 0.5 },
    ],
    benchmark_coverage: "sector_and_market",
    attribution_confidence: 0.87,
  },
  ...over,
});

const MAPPED_FIXTURES: { label: string; props: ReturnType<typeof scoredCallProps> }[] = [
  {
    label: "Right — correct + clean",
    props: scoredCallProps(
      call({ claim_text: "NVDA breaks out on AI capex acceleration." }),
      outcome({ verdict_notes: "NVDA moved 2.31% against a flat tape; the move is the thesis's own." }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "Wrong — wrong + clean",
    props: scoredCallProps(
      call({ target_symbol: "BIIB", claim_text: "BIIB fades after the readout disappoints." }),
      outcome({
        verdict: "wrong",
        actual_pct_change: 0.0159,
        verdict_notes: "BIIB rallied 1.59% on its own while the market fell; decisively against the call.",
        metadata: {
          grader: "price_attribution_v1",
          entity_symbol: "BIIB",
          tier: "single_stock",
          thresholds_pct: { dead_band: 0.5, min_excess: 0.75 },
          entity_move_pct: 1.59,
          benchmarks: [
            { symbol: "XLV", role: "sector", move_pct: -0.2, excess_pct: 1.79, meaningful_bar_pct: 0.5 },
            { symbol: "SPY", role: "market", move_pct: -0.35, excess_pct: 1.94, meaningful_bar_pct: 0.5 },
          ],
          benchmark_coverage: "sector_and_market",
          attribution_confidence: 0.8,
        },
      }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "No clean read — confounded (rode the rally)",
    props: scoredCallProps(
      call({ target_symbol: "AAPL", claim_text: "AAPL grinds higher into the product cycle." }),
      outcome({
        verdict: "partial",
        attribution: "confounded",
        actual_pct_change: 0.012,
        verdict_notes: "AAPL rose 1.20%, but the market rallied 1.02% — the tape explains the move.",
        metadata: {
          grader: "price_attribution_v1",
          entity_symbol: "AAPL",
          tier: "single_stock",
          thresholds_pct: { dead_band: 0.5, min_excess: 0.75 },
          entity_move_pct: 1.2,
          benchmarks: [
            { symbol: "XLK", role: "sector", move_pct: 1.1, excess_pct: 0.1, meaningful_bar_pct: 0.5 },
            { symbol: "SPY", role: "market", move_pct: 1.02, excess_pct: 0.18, meaningful_bar_pct: 0.5 },
          ],
          benchmark_coverage: "sector_and_market",
          attribution_confidence: 0.72,
        },
      }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "No clean read — below the attribution bar",
    props: scoredCallProps(
      call({ target_symbol: "MSFT", claim_text: "MSFT firms up as enterprise renewals land." }),
      outcome({
        verdict: "partial",
        attribution: "inconclusive",
        actual_pct_change: 0.004,
        verdict_notes: "MSFT edged up 0.40% on a quiet tape; too small to attribute either way.",
        metadata: {
          grader: "price_attribution_v1",
          entity_symbol: "MSFT",
          tier: "single_stock",
          thresholds_pct: { dead_band: 0.5, min_excess: 0.75 },
          entity_move_pct: 0.4,
          benchmarks: [
            { symbol: "XLK", role: "sector", move_pct: 0.1, excess_pct: 0.3, meaningful_bar_pct: 0.5 },
            { symbol: "SPY", role: "market", move_pct: 0.05, excess_pct: 0.35, meaningful_bar_pct: 0.5 },
          ],
          benchmark_coverage: "sector_and_market",
          attribution_confidence: 0.4,
        },
      }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "Not graded — ungradable (no honest grader)",
    props: scoredCallProps(
      call({ target_symbol: null, claim_type: "aggregate", claim_text: "Risk assets stay bid into quarter end." }),
      outcome({
        verdict: "ungradable",
        attribution: null,
        actual_pct_change: null,
        actual_direction: null,
        metadata: {
          grader: "resolver",
          ungradable_reason: "no_honest_grader",
          ungradable_detail: "aggregate/macro claims have no single-ticker proxy.",
        },
      }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "Not graded — window closed, never graded",
    props: scoredCallProps(
      call({ target_symbol: "IQV", brief_date: "2026-06-27", claim_text: "IQV recovers as bookings stabilize." }),
      null,
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "Not graded — legacy pre-attribution row",
    props: scoredCallProps(
      call({ target_symbol: "TSLA", brief_date: "2026-06-05", claim_text: "TSLA squeezes higher on delivery beat chatter." }),
      outcome({ verdict: "correct", attribution: null, metadata: null, verdict_notes: "Bullish call; up close." }),
      FIXTURE_TODAY_PT,
    ),
  },
  {
    label: "Open — window still live (no outcome row)",
    props: scoredCallProps(
      call({ target_symbol: "AMD", brief_date: FIXTURE_TODAY_PT, claim_text: "AMD closes the gap on the accelerator roadmap." }),
      null,
      FIXTURE_TODAY_PT,
    ),
  },
];

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-text-faint font-[family-name:var(--font-inter)]">
        {label}
      </div>
      {children}
    </div>
  );
}

export default function ScoredObjectPreviewPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      {/* Clear, unmissable non-production banner */}
      <div
        className="mb-8 rounded-md border px-4 py-3 font-[family-name:var(--font-inter)]"
        style={{
          borderColor: "var(--signal-warn)",
          background: "color-mix(in srgb, var(--signal-warn) 8%, transparent)",
        }}
      >
        <p className="text-sm font-semibold text-text-primary">Design preview — not a live surface</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          All values below are fixtures. Live surfaces resolve these states only
          from real grader outcome rows; the second section drives fixture rows
          through the same mapper the live surfaces use. Toggle the app theme to
          check dark mode.
        </p>
      </div>

      <h1
        className="mb-1 text-text-primary"
        style={{ fontFamily: "var(--font-playfair-display), serif", fontSize: "28px", fontWeight: 500 }}
      >
        The scored object
      </h1>
      <p className="mb-8 text-[14px] text-text-secondary font-[family-name:var(--font-inter)]">
        Claim → timestamped receipt → verdict-against-reality → attribution. One
        voice (Newsreader); state carried by the left spine; gold only on the
        resolved seal.
      </p>

      <div className="flex flex-col gap-8">
        <Labeled label="State: Open">
          <ScoredObject {...OPEN} />
        </Labeled>
        <Labeled label="State: Right">
          <ScoredObject {...RIGHT} />
        </Labeled>
        <Labeled label="State: Wrong">
          <ScoredObject {...WRONG} />
        </Labeled>
        <Labeled label="State: Inconclusive">
          <ScoredObject {...INCONCLUSIVE} />
        </Labeled>
      </div>

      <h2
        className="mt-12 mb-1 text-text-primary"
        style={{ fontFamily: "var(--font-playfair-display), serif", fontSize: "22px", fontWeight: 500 }}
      >
        Live mapper fixtures
      </h2>
      <p className="mb-8 text-[14px] text-text-secondary font-[family-name:var(--font-inter)]">
        Fixture outcome rows rendered through scoredCallProps — the exact code
        path Today&apos;s Calls uses. Three honest buckets: a real verdict
        (Right/Wrong, clean attribution), a real &ldquo;No clean read&rdquo;
        (graded, can&apos;t credit the thesis), and &ldquo;Not graded&rdquo;
        (an absence, not a verdict).
      </p>

      <div className="flex flex-col gap-8">
        {MAPPED_FIXTURES.map((f) => (
          <Labeled key={f.label} label={f.label}>
            <ScoredObject {...f.props} />
          </Labeled>
        ))}
      </div>
    </main>
  );
}
