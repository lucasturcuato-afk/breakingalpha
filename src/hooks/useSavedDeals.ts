"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export interface SavedDeal {
  deal_id: string;
  saved_at: string;
}

export interface Deal {
  id: string;
  company: string;
  acquirer?: string | null;
  deal_type?: string | null;
  stage?: string | null;
  status?: string | null;
  value?: string | null;
  valuation?: string | null;
  sector?: string | null;
  notes?: string | null;
  summary?: string | null;
  thesis?: string | null;
  source?: string | null;
  source_url?: string | null;
  auto_extracted?: boolean;
  updated_at?: string;
  ingested_at?: string;
}

export interface EnrichedDeal extends Deal {
  saved_at: string;
}

interface UseSavedDealsOptions {
  deals?: Deal[];
}

interface UseSavedDealsReturn {
  savedDealIds: Set<string>;
  savedDeals: SavedDeal[];
  enrichedSavedDeals: EnrichedDeal[];
  isSaved: (dealId: string) => boolean;
  toggleSave: (dealId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useSavedDeals(options?: UseSavedDealsOptions): UseSavedDealsReturn {
  const externalDeals = options?.deals;
  const hasExternalDeals = externalDeals !== undefined;

  const [savedDeals, setSavedDeals] = useState<SavedDeal[]>([]);
  const [fetchedDeals, setFetchedDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedIdsRef = useRef<string>("");

  // Load saved deal IDs via API route (server-side auth, correct auth.uid())
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/saved-deals");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("[useSavedDeals] Load error:", res.status, body);
          setIsLoading(false);
          return;
        }
        const { savedDeals: rows } = await res.json();
        if (!cancelled) {
          console.log("[useSavedDeals] Loaded saved IDs:", rows.length, rows);
          setSavedDeals(rows ?? []);
          setIsLoading(false);
        }
      } catch (e) {
        console.error("[useSavedDeals] Load exception:", e);
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // When no external deals provided, fetch full deal data from deal_flow
  useEffect(() => {
    if (hasExternalDeals) return;
    if (isLoading || savedDeals.length === 0) return;

    const ids = savedDeals.map((s) => s.deal_id).sort().join(",");
    if (ids === fetchedIdsRef.current) return;
    fetchedIdsRef.current = ids;

    let cancelled = false;
    getSupabase()
      .from("deal_flow")
      .select("*")
      .in("id", savedDeals.map((s) => s.deal_id))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useSavedDeals] Deal fetch error:", error.message);
        } else {
          setFetchedDeals(data ?? []);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, savedDeals, hasExternalDeals]);

  const savedDealIds = useMemo(
    () => new Set(savedDeals.map((s) => s.deal_id)),
    [savedDeals],
  );

  const enrichedSavedDeals = useMemo((): EnrichedDeal[] => {
    const source = externalDeals ?? fetchedDeals;
    const dealMap: Record<string, Deal> = {};
    for (const d of source) dealMap[d.id] = d;

    return savedDeals
      .map((s): EnrichedDeal | null => {
        const deal = dealMap[s.deal_id];
        if (!deal) return null;
        return { ...deal, saved_at: s.saved_at };
      })
      .filter((d): d is EnrichedDeal => d !== null);
  }, [savedDeals, externalDeals, fetchedDeals]);

  const isSaved = useCallback(
    (dealId: string) => savedDealIds.has(dealId),
    [savedDealIds],
  );

  const toggleSave = useCallback(async (dealId: string) => {
    const alreadySaved = savedDealIds.has(dealId);
    const prev = savedDeals;

    // Optimistic update — fires synchronously before any await
    if (alreadySaved) {
      setSavedDeals((s) => s.filter((d) => d.deal_id !== dealId));
    } else {
      setSavedDeals((s) => [{ deal_id: dealId, saved_at: new Date().toISOString() }, ...s]);
    }

    try {
      const res = await fetch("/api/saved-deals", {
        method: alreadySaved ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[useSavedDeals] toggleSave error:", res.status, body);
        setSavedDeals(prev);
        setError(body.error ?? "Failed to save deal");
      }
    } catch (e) {
      console.error("[useSavedDeals] toggleSave exception:", e);
      setSavedDeals(prev);
      setError("Network error");
    }
  }, [savedDeals, savedDealIds]);

  return { savedDealIds, savedDeals, enrichedSavedDeals, isSaved, toggleSave, isLoading, error };
}
