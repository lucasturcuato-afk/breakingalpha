"use client";

import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";

export type CompanyTab =
  | "developments"
  | "research"
  | "memos"
  | "metadata"
  | "monitoring";

interface TabDef {
  key: CompanyTab;
  label: string;
}

const tabs: TabDef[] = [
  { key: "developments", label: "Live Developments" },
  { key: "research", label: "Research & Theses" },
  { key: "memos", label: "Deal Memos" },
  { key: "metadata", label: "Metadata" },
  { key: "monitoring", label: "Monitoring" },
];

interface CompanyTabsProps {
  children: Record<CompanyTab, ReactNode>;
}

export function CompanyTabs({ children }: CompanyTabsProps) {
  const [active, setActive] = useState<CompanyTab>("developments");

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b border-border-base px-6 flex items-center gap-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "px-4 py-3 font-sans text-[13px] font-medium",
              "border-b-2 -mb-px transition-colors duration-[var(--duration-base)]",
              "cursor-pointer",
              active === tab.key
                ? "border-b-gold text-espresso"
                : "border-b-transparent text-text-muted hover:text-text-primary hover:border-b-border-base",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6 py-5">
        {children[active]}
      </div>
    </div>
  );
}
