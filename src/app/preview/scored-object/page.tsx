import type { Metadata } from "next";
import { ScoredObject } from "@/components/scored-object/ScoredObject";

export const metadata: Metadata = {
  title: "Design preview — Scored Object",
  robots: { index: false, follow: false },
};

/**
 * DESIGN PREVIEW HARNESS — NOT A LIVE SURFACE.
 *
 * This route exists only to let the ScoredObject component be previewed before
 * it is wired into real surfaces. Every value below is a hand-written placeholder
 * prop. The resolved states (right / wrong / inconclusive) are PRESENTATIONAL
 * ONLY — there is no resolution logic and no data source behind them yet. This
 * page is the ONLY place those states are instantiated, so no placeholder grade
 * can leak into the real brief or scorecard.
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
          All values below are placeholder props. The resolved states
          (Right / Wrong / No clean read) are presentational only — there is no
          resolution logic or data source behind them yet. Toggle the app theme to
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
    </main>
  );
}
