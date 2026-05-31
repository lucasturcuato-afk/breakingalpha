/**
 * ComingSoonTab -- F6/F7/F8/F9 placeholder tab content.
 * Tab IDs LOCKED via PR-A2: F6 Filings, F7 Transcripts, F8 Insider, F9 Comps.
 */

import type { ReactNode } from "react";
import { FileText, Mic, Scale, UserRound } from "lucide-react";
import type { CompanyTabId } from "@/hooks/useCompanyTabState";
import { ComingSoonCard } from "@/components/company/ComingSoonCard";

type ComingSoonTabId = Extract<CompanyTabId, "filings" | "transcripts" | "insider" | "comps">;

interface SlotConfig {
  slot: "f6" | "f7" | "f8" | "f9";
  title: string;
  description: string;
  step: string;
  icon: ReactNode;
}

const ICON = "w-6 h-6";
const SLOTS: Record<ComingSoonTabId, SlotConfig> = {
  filings: {
    slot: "f6",
    title: "Filings",
    description: "SEC filings (10-K, 10-Q, 8-K) summarized with cited deltas.",
    step: "",
    icon: <FileText className={ICON} />,
  },
  transcripts: {
    slot: "f7",
    title: "Transcripts",
    description: "Earnings call transcripts with speaker turns, sentiment, and key Q&A pulls.",
    step: "",
    icon: <Mic className={ICON} />,
  },
  insider: {
    slot: "f8",
    title: "Insider",
    description: "Form 4 insider buys and sells, ranked by signal strength and recency.",
    step: "Pending the SEC Form 4 ingest fix",
    icon: <UserRound className={ICON} />,
  },
  comps: {
    slot: "f9",
    title: "Comps",
    description: "Peer multiples and relative-value snapshots across sector cohorts.",
    step: "Pending the comps data set",
    icon: <Scale className={ICON} />,
  },
};

interface ComingSoonTabProps {
  tabId: ComingSoonTabId;
}

export function ComingSoonTab({ tabId }: ComingSoonTabProps) {
  const c = SLOTS[tabId];
  return (
    <div data-testid="coming-soon-tab">
      <ComingSoonCard slot={c.slot} title={c.title} description={c.description} step={c.step} icon={c.icon} />
    </div>
  );
}

export type { ComingSoonTabProps, ComingSoonTabId };
