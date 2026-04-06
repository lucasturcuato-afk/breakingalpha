import type { Metadata } from "next";
import { AppShell } from "@/components/shell";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id.toUpperCase()} — Signalera` };
}
import { CompanyHeader } from "@/components/company/company-header";
import { CompanyTabs } from "@/components/company/company-tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LeadStoryCard, CompactStoryCard } from "@/components/dashboard/story-card";
import { FileText, TrendingUp, Database, Activity } from "lucide-react";
import type { StoryData } from "@/components/dashboard";

// Mock data — will be replaced with real Supabase queries
const mockDevelopments: StoryData[] = [
  {
    id: "cd1",
    title: "NVIDIA Export Restrictions Tighten as US-China Chip War Escalates",
    source: "Reuters",
    timestamp: "12m ago",
    sentiment: "risk-off",
    sector: "Technology M&A",
    summary:
      "New Commerce Department rules will further restrict NVIDIA's ability to sell advanced AI chips to China, potentially impacting $5B+ in annual revenue.",
    tags: ["Export Controls", "China", "AI Chips"],
    read: false,
  },
  {
    id: "cd2",
    title: "NVIDIA H200 Shipments Accelerate, Data Center Revenue Surges 400% YoY",
    source: "Bloomberg",
    timestamp: "3h ago",
    sentiment: "bullish",
    sector: "Technology M&A",
    read: false,
  },
  {
    id: "cd3",
    title: "Jensen Huang Keynote: Blackwell Architecture to Drive Next AI Compute Wave",
    source: "The Verge",
    timestamp: "1d ago",
    sentiment: "bullish",
    sector: "Technology M&A",
    read: true,
  },
];

const mockTheses = [
  {
    id: "ct1",
    conviction: "BULLISH" as const,
    title: "AI Infra Consolidation Wave",
    preview: "NVIDIA's moat widening as custom silicon alternatives fail to deliver competitive performance.",
    updatedAt: "2h ago",
  },
  {
    id: "ct2",
    conviction: "BEARISH" as const,
    title: "China Export Risk Overhang",
    preview: "Revenue impact from tightening export controls could exceed $8B by FY2026.",
    updatedAt: "1d ago",
  },
];

const mockMemos = [
  { id: "cm1", title: "NVIDIA Competitive Analysis — H200 vs AMD MI300X", date: "Mar 28, 2024", type: "Competitive" },
  { id: "cm2", title: "Export Restriction Impact Assessment", date: "Mar 15, 2024", type: "Risk" },
  { id: "cm3", title: "Data Center TAM Expansion Model", date: "Feb 22, 2024", type: "Growth" },
];

const mockMetadata = {
  founded: "1993",
  headquarters: "Santa Clara, CA",
  employees: "29,600",
  ceo: "Jensen Huang",
  website: "nvidia.com",
  exchange: "NASDAQ",
  industry: "Semiconductors",
  fiscalYearEnd: "January",
};

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticker = id.toUpperCase();

  return (
    <AppShell pageTitle="Company Intel" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      {/* Company header */}
      <CompanyHeader
        name="NVIDIA Corporation"
        ticker={ticker}
        sector="Technology M&A"
        price="875.28"
        change={-2.41}
        marketCap="$2.16T"
        status="watching"
      />

      {/* Tabs */}
      <CompanyTabs>
        {{
          /* Live Developments */
          developments: (
            <div className="space-y-2 max-w-[800px]">
              <LeadStoryCard story={mockDevelopments[0]} />
              {mockDevelopments.slice(1).map((story, i) => (
                <CompactStoryCard key={story.id} story={story} number={i + 2} />
              ))}
            </div>
          ),

          /* Research & Theses */
          research: (
            <div className="space-y-3 max-w-[800px]">
              {mockTheses.map((thesis) => (
                <div
                  key={thesis.id}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-border-base bg-white hover:border-border-hover transition-colors"
                >
                  <Badge
                    variant={thesis.conviction === "BULLISH" ? "bullish" : "bearish"}
                  >
                    {thesis.conviction}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-display text-[13px] font-bold text-espresso">
                      {thesis.title}
                    </h4>
                    <p className="font-sans text-[11px] text-text-secondary mt-0.5 line-clamp-2">
                      {thesis.preview}
                    </p>
                  </div>
                  <span className="font-data text-[10px] text-text-faint flex-shrink-0">
                    {thesis.updatedAt}
                  </span>
                </div>
              ))}
            </div>
          ),

          /* Deal Memos */
          memos: (
            <div className="space-y-2 max-w-[800px]">
              {mockMemos.map((memo) => (
                <div
                  key={memo.id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border-base bg-white hover:border-border-hover transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-gold-muted border border-gold-border flex items-center justify-center flex-shrink-0">
                    <FileText size={13} className="text-gold" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-sans text-[13px] font-semibold text-text-primary">
                      {memo.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="muted">{memo.type}</Badge>
                      <span className="font-data text-[10px] text-text-faint">
                        {memo.date}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ),

          /* Metadata */
          metadata: (
            <div className="max-w-[500px]">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {Object.entries(mockMetadata).map(([key, value]) => (
                  <div key={key}>
                    <p className="font-sans text-[10px] uppercase tracking-widest text-text-faint mb-0.5">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="font-sans text-[13px] text-text-primary font-medium">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ),

          /* Monitoring */
          monitoring: (
            <EmptyState
              icon={<Activity size={32} />}
              title="Monitoring not configured"
              description="Set up alerts for price movements, news mentions, and SEC filings for this company."
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[12px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                >
                  Configure Alerts
                </button>
              }
            />
          ),
        }}
      </CompanyTabs>
    </AppShell>
  );
}
