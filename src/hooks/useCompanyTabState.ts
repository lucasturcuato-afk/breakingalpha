"use client";

/**
 * Company detail tab URL state.
 *
 * Source of truth lives in the `?tab=` query param so deep-links and reloads
 * preserve the active tab. Default tab is "brief"; we omit the param entirely
 * when activeTab === "brief" to keep canonical URLs clean.
 *
 * Tab IDs are LOCKED per docs/w2-c-phase-1-recon-synthesis.md Section 8.
 * F1 Brief, F2 Articles, F3 Themes, F4 Trend, F5 Sources,
 * F6 Filings, F7 Transcripts, F8 Insider, F9 Comps.
 */

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type CompanyTabId =
  | "brief"
  | "articles"
  | "themes"
  | "trend"
  | "sources"
  | "filings"
  | "transcripts"
  | "insider"
  | "comps";

export const TAB_ORDER: readonly CompanyTabId[] = [
  "brief",
  "articles",
  "themes",
  "trend",
  "sources",
  "filings",
  "transcripts",
  "insider",
  "comps",
] as const;

const TAB_SET = new Set<CompanyTabId>(TAB_ORDER);

const DEFAULT_TAB: CompanyTabId = "brief";

export interface CompanyTabState {
  activeTab: CompanyTabId;
  setActiveTab: (id: CompanyTabId) => void;
  cycleTab: (delta: 1 | -1) => void;
}

export function useCompanyTabState(): CompanyTabState {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const param = searchParams.get("tab");
  const activeTab: CompanyTabId =
    param && TAB_SET.has(param as CompanyTabId)
      ? (param as CompanyTabId)
      : DEFAULT_TAB;

  const setActiveTab = useCallback(
    (id: CompanyTabId) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === DEFAULT_TAB) {
        next.delete("tab");
      } else {
        next.set("tab", id);
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const i = TAB_ORDER.indexOf(activeTab);
      const len = TAB_ORDER.length;
      const next = TAB_ORDER[(i + delta + len) % len];
      setActiveTab(next);
    },
    [activeTab, setActiveTab],
  );

  return { activeTab, setActiveTab, cycleTab };
}
