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

  // Load saved deal IDs from user_saved_deals
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log("[useSavedDeals] DIAG: no authenticated user", { user });
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_saved_deals")
        .select("deal_id, saved_at")
        .eq("user_id", user.id)
        .order("saved_at", { ascending: false });

      if (cancelled) return;

      console.log("[useSavedDeals] DIAG: query result", { userId: user.id, data, error });

      if (error) {
        console.error("[useSavedDeals] Load error:", error.message);
        setError(error.message);
        setIsLoading(false);
        return;
      }

      const rows = data ?? [];
      console.log("[useSavedDeals] DIAG: setting savedDeals", rows.length, rows);
      setSavedDeals(rows);
      setIsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // When no external deals provided, fetch full deal data from deal_flow
  useEffect(() => {
    if (hasExternalDeals) return;
    if (isLoading || savedDeals.length === 0) return;

    const ids = savedDeals.map((s) => s.deal_id).sort().join(",");
    if (ids === fetchedIdsRef.current) return; // avoid re-fetching same set
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
          console.debug("[useSavedDeals] Fetched full deals:", data?.length, data);
          setFetchedDeals(data ?? []);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, savedDeals, hasExternalDeals]);

  // Memoize Set for O(1) lookups
  const savedDealIds = useMemo(
    () => new Set(savedDeals.map((s) => s.deal_id)),
    [savedDeals],
  );

  // Enrich saved deals with full Deal data + saved_at
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

    // Optimistic update fires synchronously — before any await
    if (alreadySaved) {
      setSavedDeals((s) => s.filter((d) => d.deal_id !== dealId));
    } else {
      setSavedDeals((s) => [{ deal_id: dealId, saved_at: new Date().toISOString() }, ...s]);
    }

    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error("[useSavedDeals] toggleSave: no authenticated user — reverting");
      setSavedDeals(prev);
      return;
    }

    let err: string | null = null;
    if (alreadySaved) {
      const { error } = await supabase
        .from("user_saved_deals")
        .delete()
        .eq("user_id", user.id)
        .eq("deal_id", dealId);
      if (error) err = error.message;
    } else {
      const { error } = await supabase
        .from("user_saved_deals")
        .insert({ user_id: user.id, deal_id: dealId });
      if (error) err = error.message;
    }

    if (err) {
      console.error("[useSavedDeals] toggleSave DB error:", err);
      setSavedDeals(prev);
      setError(err);
    }
  }, [savedDeals, savedDealIds]);

  return { savedDealIds, savedDeals, enrichedSavedDeals, isSaved, toggleSave, isLoading, error };
}
