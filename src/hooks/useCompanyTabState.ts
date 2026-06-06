"use client";

/**
 * Company detail tab state.
 *
 * The active tab is mirrored into the `?tab=` query param via
 * window.history.replaceState so deep-links and reloads preserve the active
 * tab — but the mirror is deliberately a *native* History API call, not
 * router.replace(), so it does NOT trigger a Next.js soft navigation /
 * RSC refetch on every click. Default tab is "brief"; we omit the param
 * entirely when activeTab === "brief" to keep canonical URLs clean.
 *
 * Implementation uses useSyncExternalStore: the URL itself is the external
 * store. Server snapshot returns DEFAULT_TAB (no window); client snapshot
 * reads window.location. setActiveTab writes via replaceState and notifies
 * subscribers so any other hook instance on the page stays in sync.
 *
 * The CompanyTabId union keeps the full LOCKED id vocabulary (docs/
 * w2-c-phase-1-recon-synthesis.md Section 8) so a stale ?tab=themes /
 * ?tab=sources / ?tab=transcripts deep-link still validates and falls back
 * cleanly. TAB_ORDER -- the array that actually renders the tab bar -- is the
 * shipped set: Brief, Articles, Price & Tone, Filings, Financials, Insider,
 * Comps. Themes and Sources were cut; Transcripts is dropped from the bar
 * (no button). 'financials' extends the Section 8 vocabulary (approved
 * 2026-06-04): validated XBRL facts via financial_facts_latest.
 */

import { useCallback, useSyncExternalStore } from "react";

export type CompanyTabId =
  | "brief"
  | "articles"
  | "themes"
  | "trend"
  | "sources"
  | "filings"
  | "financials"
  | "transcripts"
  | "insider"
  | "comps";

export const TAB_ORDER: readonly CompanyTabId[] = [
  "brief",
  "articles",
  "trend",
  "filings",
  "financials",
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

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getClientSnapshot(): CompanyTabId {
  const param = new URLSearchParams(window.location.search).get("tab");
  return param && TAB_SET.has(param as CompanyTabId)
    ? (param as CompanyTabId)
    : DEFAULT_TAB;
}

function getServerSnapshot(): CompanyTabId {
  return DEFAULT_TAB;
}

function writeTabToUrl(id: CompanyTabId) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id === DEFAULT_TAB) {
    params.delete("tab");
  } else {
    params.set("tab", id);
  }
  const qs = params.toString();
  const url = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
  listeners.forEach((listener) => listener());
}

export function useCompanyTabState(): CompanyTabState {
  const activeTab = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const setActiveTab = useCallback((id: CompanyTabId) => {
    writeTabToUrl(id);
  }, []);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const i = TAB_ORDER.indexOf(activeTab);
      const len = TAB_ORDER.length;
      const next = TAB_ORDER[(i + delta + len) % len];
      writeTabToUrl(next);
    },
    [activeTab],
  );

  return { activeTab, setActiveTab, cycleTab };
}
