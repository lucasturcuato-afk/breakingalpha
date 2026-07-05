"use client";

/**
 * DESIGN PREVIEW HARNESS — NOT A LIVE SURFACE. Fixture-driven states for
 * the three Radar sub-tabs so light/dark can be eyeballed without prod
 * data. All values below are fixtures; live surfaces render only from
 * real rows. Toggle the app theme to check dark mode.
 */

import { RadarTabs } from "@/components/radar/RadarTabs";
import { WatchlistGallery, type GalleryFilter } from "@/components/radar/WatchlistGallery";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import { EvidenceMap } from "@/components/radar/EvidenceMap";
import { scoredCallProps, type CallOutcomeRow } from "@/lib/scored-object-map";
import { ThesisList } from "@/components/thesis/ThesisList";
import { ThesisDetailPanel } from "@/components/thesis/thesis-detail-panel";
import { ReviewTimeline, type VerdictRow } from "@/components/thesis/TrackedViews";
import type { ThesisItem } from "@/components/thesis";
import { useState } from "react";

const SERIF = "var(--font-playfair-display), serif";
const TODAY = "2026-07-02";

const GALLERY_ENTRIES = [
  { id: "1", identifier: "NVDA", type: "ticker", display_name: "NVIDIA" },
  { id: "2", identifier: "XOM", type: "ticker", display_name: "Exxon Mobil" },
  { id: "3", identifier: "Anthropic", type: "company", display_name: "Anthropic" },
  { id: "4", identifier: "Technology", type: "sector" },
  { id: "5", identifier: "KO", type: "ticker", display_name: "Coca-Cola" },
];
const GALLERY_PRICES = {
  NVDA: { price: "162.10", pct: 2.31 },
  XOM: { price: "114.55", pct: -1.12 },
  KO: { price: "70.02", pct: 0.04 },
};
const GALLERY_ARTICLES = {
  NVDA: [
    { id: "a1", title: "NVIDIA locks multi-year HBM supply as accelerator backlog stretches into 2028", source: "Reuters", published_at: new Date().toISOString(), relevance_score: 9 },
    { id: "a2", title: "Hyperscaler capex guides raised again", source: "FT", published_at: new Date().toISOString(), relevance_score: 7 },
  ],
  Anthropic: [
    { id: "a3", title: "Anthropic expands enterprise agent deployments with new compliance tooling", source: "The Information", published_at: new Date().toISOString(), relevance_score: 8 },
  ],
  Technology: [
    { id: "a4", title: "Chip export rules tighten for a second time this year", source: "Bloomberg", published_at: new Date().toISOString(), relevance_score: 8 },
  ],
};

const CLAIM_CALL = {
  claim_text: "NVDA gives back the ramp hype by earnings",
  target_symbol: "NVDA",
  claim_type: "ticker",
  created_at: "2026-06-20T14:00:00Z",
  brief_date: "2026-06-30",
};
const CLAIM_OUTCOME: CallOutcomeRow = {
  call_id: "fixture",
  verdict: "wrong",
  attribution: "clean",
  actual_pct_change: 0.052,
  actual_direction: "up",
  verdict_notes:
    "NVDA rose 5.2% over the window while its sector added 1.1%; decisively against the call.",
  graded_at: "2026-06-30T22:05:00Z",
  metadata: {
    grader: "price_attribution_v1",
    entity_symbol: "NVDA",
    tier: "single_stock",
    thresholds_pct: { dead_band: 1.12, min_excess: 1.68 },
    entity_move_pct: 5.2,
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 1.1, excess_pct: 4.1, meaningful_bar_pct: 1.12 },
      { symbol: "SPY", role: "market", move_pct: 0.8, excess_pct: 4.4, meaningful_bar_pct: 1.12 },
    ],
    benchmark_coverage: "sector_and_market",
    attribution_confidence: 0.92,
    window: { from: "2026-06-20T00:00:00+00:00", to: "2026-06-30T23:59:59+00:00" },
  },
};


const FIXTURE_THESES: ThesisItem[] = [
  {
    id: "th1",
    title: "Grid interconnect queues become the datacenter bottleneck",
    conviction: "HIGH",
    sector: "Energy & Oil/Gas",
    summary: "Utility interconnect backlogs are now the binding constraint on new datacenter capacity.",
    rationale:
      "Interconnect queues in PJM and ERCOT have stretched past 40 months while hyperscaler capex guides keep rising. If power, not chips, is the binding constraint, the value migrates to whoever controls approved grid capacity.",
    bear_case: "Queue reform and behind-the-meter generation could clear backlogs faster than expected.",
    catalyst_note: "FERC queue-reform order implementation through 2026.",
    status: "active",
    updatedAt: "2026-07-01",
    ticker: "ETR",
    generated_at: "2026-06-12T08:00:00Z",
  },
  {
    id: "th2",
    title: "HBM supply agreements tighten accelerator competition",
    conviction: "MEDIUM",
    sector: "Technology",
    summary: "Multi-year HBM lockups raise the barrier for second-tier accelerator vendors.",
    status: "active",
    updatedAt: "2026-06-28",
    ticker: "MU",
    generated_at: "2026-06-20T08:00:00Z",
  },
  {
    id: "th3",
    title: "BDC marks lag private credit stress",
    conviction: "WATCH",
    sector: "Financial Services",
    summary: "Non-accruals are drifting up while marks stay firm.",
    status: "active",
    updatedAt: "2026-06-25",
    generated_at: "2026-06-22T08:00:00Z",
  },
];
const FIXTURE_LEANINGS: Record<string, string | null> = {
  th1: "Tracking confirmed",
  th2: "Awaiting verdict",
  th3: "Inconclusive after 12d",
};
const FIXTURE_THESIS_ARTICLES = [
  { id: "ta1", title: "PJM interconnection queue tops 3,000 pending projects", source: "Utility Dive", published_at: "2026-06-30T10:00:00Z", sector: "Energy & Oil/Gas", sentiment: "positive" },
  { id: "ta2", title: "Hyperscalers sign behind-the-meter nuclear PPAs", source: "Reuters", published_at: "2026-06-29T10:00:00Z", sector: "Energy & Oil/Gas", sentiment: "neutral" },
];
const FIXTURE_VERDICTS: VerdictRow[] = [
  { id: "v1", verdict: "inconclusive", graded_at: "2026-06-18T09:00:00Z", confidence: 0.55, notes: "Evidence thin; interconnect data mixed.", grader_version: "evidence_grader_v2" },
  { id: "v2", verdict: "confirmed", graded_at: "2026-07-01T09:00:00Z", confidence: 0.72, notes: "Queue growth and PPA activity both support the constraint thesis.", grader_version: "evidence_grader_v2" },
];

const MAP_ARTICLES = [
  { id: "m1", title: "NVIDIA locks multi-year HBM supply as accelerator backlog stretches", source: "Reuters", activity_types: ["Earnings & Results"], published_at: "2026-07-01T10:00:00Z" },
  { id: "m2", title: "NVIDIA data-center revenue guide tops estimates again", source: "Bloomberg", activity_types: ["Earnings & Results"], published_at: "2026-07-01T12:00:00Z" },
  { id: "m3", title: "Hyperscaler capex budgets raised for 2027 buildouts", source: "FT", activity_types: ["Macro & Policy"], published_at: "2026-06-30T09:00:00Z" },
  { id: "m4", title: "Power constraints reshape data-center site selection", source: "WSJ", activity_types: ["Macro & Policy"], published_at: "2026-06-30T15:00:00Z" },
  { id: "m5", title: "Chip export rules tighten for a second time this year", source: "Bloomberg", activity_types: ["Regulation & Legal"], published_at: "2026-06-29T08:00:00Z" },
  { id: "m6", title: "Export control carve-outs debated for allied fabs", source: "Reuters", activity_types: ["Regulation & Legal"], published_at: "2026-06-29T13:00:00Z" },
  { id: "m7", title: "Accelerator startups chase inference niche funding", source: "The Information", activity_types: ["Venture Capital"], published_at: "2026-06-28T11:00:00Z" },
  { id: "m8", title: "NVIDIA networking attach rates climb with rack-scale systems", source: "Reuters", activity_types: ["Earnings & Results"], published_at: "2026-06-28T09:00:00Z" },
  { id: "m9", title: "NVIDIA software revenue becomes the quiet margin story", source: "Bloomberg", activity_types: ["Earnings & Results"], published_at: "2026-06-27T10:00:00Z" },
  { id: "m10", title: "Data-center REITs sign record pre-leases near cheap power", source: "WSJ", activity_types: ["Macro & Policy"], published_at: "2026-06-27T14:00:00Z" },
  { id: "m11", title: "Utilities fast-track interconnects for AI campuses", source: "FT", activity_types: ["Macro & Policy"], published_at: "2026-06-26T08:00:00Z" },
  { id: "m12", title: "Nuclear restart deals priced into hyperscaler PPAs", source: "Bloomberg", activity_types: ["Macro & Policy"], published_at: "2026-06-26T12:00:00Z" },
  { id: "m13", title: "Allied fab carve-outs pass first committee vote", source: "Reuters", activity_types: ["Regulation & Legal"], published_at: "2026-06-25T09:00:00Z" },
  { id: "m14", title: "License backlog grows at export control office", source: "WSJ", activity_types: ["Regulation & Legal"], published_at: "2026-06-25T15:00:00Z" },
  { id: "m15", title: "Inference-chip startup raises series C at higher mark", source: "The Information", activity_types: ["Venture Capital"], published_at: "2026-06-24T11:00:00Z" },
  { id: "m16", title: "Photonics interconnect deals draw strategic investors", source: "FT", activity_types: ["Venture Capital"], published_at: "2026-06-24T16:00:00Z" },
];

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-text-faint font-sans">
        {label}
      </div>
      {children}
    </div>
  );
}

export default function RadarPreviewPage() {
  const [filter, setFilter] = useState<GalleryFilter>("all");
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div
        className="mb-8 rounded-md border px-4 py-3 font-sans"
        style={{
          borderColor: "var(--signal-warn)",
          background: "color-mix(in srgb, var(--signal-warn) 8%, transparent)",
        }}
      >
        <p className="text-sm font-semibold text-text-primary">
          Design preview — not a live surface
        </p>
        <p className="mt-1 text-[13px] text-text-secondary">
          Fixture states for the Radar sub-tabs. Live tabs render only from
          real rows. Toggle the app theme for dark mode.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        <Labeled label="Radar sub-tab bar">
          <RadarTabs active="following" />
        </Labeled>

        <Labeled label="Following — lead development (descriptive copy only)">
          <article className="border-t-2 pt-4" style={{ borderTopColor: "var(--gold)" }}>
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              AI infrastructure capex
              <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">Topic</span>
            </p>
            <h2 className="mt-2 text-text-primary" style={{ fontFamily: SERIF, fontSize: "26px", lineHeight: 1.25, fontWeight: 600 }}>
              Hyperscalers raise 2027 data-center budgets as power constraints reshape site selection
            </h2>
            <p className="mt-2 font-sans text-[12px] text-text-faint">Reuters · 3h ago</p>
          </article>
        </Labeled>

        <Labeled label="Watchlist — entity gallery (hero + moments + quiet collapse)">
          <WatchlistGallery
            entries={GALLERY_ENTRIES}
            prices={GALLERY_PRICES}
            articlesByIdentifier={GALLERY_ARTICLES}
            filter={filter}
            onFilterChange={setFilter}
            onFocus={() => {}}
          />
        </Labeled>

        <Labeled label="Calls — user claim, real verdict, provenance row">
          <div>
            <div className="mb-1 flex items-baseline justify-between px-1 font-sans text-[11px] text-text-faint">
              <span>Your call</span>
              <span>Pin · Archive</span>
            </div>
            <ScoredObject {...scoredCallProps(CLAIM_CALL, CLAIM_OUTCOME, TODAY)} />
          </div>
        </Labeled>

        <Labeled label="Calls — context-only claim (honest absence)">
          <ScoredObject
            {...{
              ...scoredCallProps(
                { claim_text: "Private credit stress shows up in BDC marks within a year", claim_type: "other", brief_date: null, created_at: "2026-06-28T10:00:00Z" },
                null,
                TODAY,
              ),
              state: "notGraded" as const,
              notGradedReason:
                "No bounded price window; tracked as context only.",
            }}
          />
        </Labeled>

        <Labeled label="Evidence map — multi-level relational graph, 16 articles (move the cursor; expand +N orbs)">
          <EvidenceMap
            centerLabel="NVDA gives back the ramp hype by earnings"
            articles={MAP_ARTICLES}
          />
        </Labeled>

        <Labeled label="Evidence map — honest thin state (1 article)">
          <EvidenceMap
            centerLabel="Private credit stress shows up in BDC marks"
            articles={[MAP_ARTICLES[0]]}
          />
        </Labeled>

        <Labeled label="Calls — evidence leaning (Tier 2, deliberately soft)">
          <div className="flex items-baseline justify-between gap-3 rounded-md px-3 py-2 border border-border-subtle">
            <span className="min-w-0 flex-1 truncate text-text-secondary" style={{ fontFamily: SERIF, fontSize: "14px" }}>
              Regional grid operators become the bottleneck trade of the decade
            </span>
            <span className="shrink-0 font-sans text-[11px] italic text-text-muted">
              Leaning supportive
            </span>
          </div>
        </Labeled>

        <Labeled label="Calls — Tracked views: thesis workspace folded inline (list + in-place detail; the live section is a quiet default-closed disclosure)">
          <div className="grid gap-4 md:grid-cols-[1fr_1.6fr]" style={{ height: "540px" }}>
            <div className="min-h-0 overflow-y-auto">
              <ThesisList
                theses={FIXTURE_THESES}
                selectedId={FIXTURE_THESES[0].id}
                onSelect={() => {}}
                filter="all"
                leaningById={FIXTURE_LEANINGS}
              />
            </div>
            <div className="flex min-h-0 flex-col gap-2">
              <div className="min-h-0 flex-1">
                <ThesisDetailPanel
                  thesis={FIXTURE_THESES[0]}
                  articles={FIXTURE_THESIS_ARTICLES}
                  onArchive={() => {}}
                  activeSignalCount={FIXTURE_THESES.length}
                />
              </div>
              <div className="rounded-lg border border-border-subtle bg-elevated px-3.5 py-2.5">
                <p className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Review timeline
                  <span className="ml-2 font-normal normal-case tracking-normal italic text-text-faint">
                    currently leaning supportive
                  </span>
                </p>
                <ReviewTimeline verdicts={FIXTURE_VERDICTS} />
              </div>
            </div>
          </div>
        </Labeled>
      </div>
    </main>
  );
}
