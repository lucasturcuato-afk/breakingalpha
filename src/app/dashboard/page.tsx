import type { Metadata } from "next";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Dashboard — Signalera",
};
import { PanelWidget } from "@/components/shell/right-panel";
import {
  PersonalizationBanner,
  Greeting,
  StatCard,
  AISignalBar,
  LeadStoryCard,
  CompactStoryCard,
  DailyBriefsWidget,
  ActiveThesesWidget,
  WatchlistWidget,
  OnboardingBanner,
} from "@/components/dashboard";
import type { StoryData } from "@/components/dashboard";
import Link from "next/link";

// Mock data — will be replaced with real API calls
const mockStories: StoryData[] = [
  {
    id: "1",
    title: "NVIDIA Export Restrictions Tighten as US-China Chip War Escalates",
    source: "Reuters",
    timestamp: "12m ago",
    sentiment: "risk-off",
    sector: "Technology M&A",
    summary:
      "New Commerce Department rules will further restrict NVIDIA's ability to sell advanced AI chips to China, potentially impacting $5B+ in annual revenue. The restrictions expand beyond H100s to include custom variants designed for the Chinese market.",
    tags: ["NVDA", "Semiconductors", "Geopolitics"],
    read: false,
    saved: false,
  },
  {
    id: "2",
    title: "Fed Minutes Signal Patience on Rate Cuts Despite Cooling Inflation",
    source: "Bloomberg",
    timestamp: "1h ago",
    sentiment: "bearish",
    sector: "Public Markets",
    read: false,
    saved: false,
  },
  {
    id: "3",
    title: "Stripe Acquisition of Lemon Squeezy Signals Fintech Consolidation",
    source: "TechCrunch",
    timestamp: "2h ago",
    sentiment: "bullish",
    sector: "Fintech & Crypto",
    read: true,
    saved: false,
  },
  {
    id: "4",
    title: "OpenAI Closes $6.6B Round at $157B Valuation, Largest VC Deal Ever",
    source: "The Information",
    timestamp: "3h ago",
    sentiment: "bullish",
    sector: "Venture Capital",
    read: true,
    saved: true,
  },
];

const sparkSP = [4380, 4395, 4370, 4410, 4425, 4415, 4440, 4455, 4460, 4472, 4468, 4480];
const sparkVIX = [18.5, 17.2, 16.8, 15.9, 15.2, 14.8, 14.5, 14.1, 14.3, 14.6, 14.2, 14.2];
const sparkYield = [4.52, 4.48, 4.45, 4.42, 4.40, 4.38, 4.35, 4.33, 4.30, 4.28, 4.25, 4.22];
const sparkSignals = [3, 5, 2, 7, 4, 8, 6, 9, 5, 11, 8, 14];

export default function DashboardPage() {
  return (
    <AppShell
      pageTitle="Dashboard"
      mood="risk-off"
      moodHeadline="Risk-Off regime"
      moodDetails={["VIX 18.5 ▲", "10Y 4.52%", "DXY strengthening"]}
      rightPanel={
        <>
          <PanelWidget title="Daily Briefs">
            <DailyBriefsWidget />
          </PanelWidget>
          <PanelWidget title="Active Theses">
            <ActiveThesesWidget />
          </PanelWidget>
          <PanelWidget title="Watchlist">
            <WatchlistWidget />
          </PanelWidget>
        </>
      }
    >
      <div className="p-6 space-y-5 max-w-[960px]">
        {/* Onboarding banner */}
        <OnboardingBanner />

        {/* Personalization banner */}
        <PersonalizationBanner />

        {/* Greeting */}
        <Greeting
          storyCount={14}
          context="markets are adjusting to new export policy data."
        />

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard
            label="S&P 500"
            value="4,480.22"
            change={0.38}
            accentGold
            sparkData={sparkSP}
            detailRows={[
              { label: "Day range", value: "4,370 – 4,482" },
              { label: "52w high", value: "4,818.62" },
            ]}
          />
          <StatCard
            label="VIX Fear Index"
            value="14.22"
            change={-3.12}
            sparkData={sparkVIX}
            detailRows={[
              { label: "5d avg", value: "15.1" },
              { label: "Regime", value: "Low Vol" },
            ]}
          />
          <StatCard
            label="10Y Yield"
            value="4.22%"
            change={-0.08}
            sparkData={sparkYield}
            detailRows={[
              { label: "30Y spread", value: "+42bps" },
              { label: "Real rate", value: "1.85%" },
            ]}
          />
          <StatCard
            label="Signals Today"
            value="14"
            change={16.67}
            accentGold
            sparkData={sparkSignals}
            detailRows={[
              { label: "Bullish", value: "8" },
              { label: "Bearish", value: "6" },
            ]}
          />
        </div>

        {/* AI signal bar */}
        <AISignalBar
          text="Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in."
          boldParts={["Fed language shift", "dovish pivot probability rising"]}
        />

        {/* Stories section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Top Stories — hover to expand
            </h2>
            <Link
              href="/live-feed"
              className="font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
            >
              View all →
            </Link>
          </div>

          {/* Lead story */}
          <LeadStoryCard story={mockStories[0]} />

          {/* Compact stories */}
          <div className="mt-2 space-y-0">
            {mockStories.slice(1).map((story, i) => (
              <CompactStoryCard key={story.id} story={story} number={i + 2} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
