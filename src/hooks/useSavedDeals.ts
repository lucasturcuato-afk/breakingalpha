"use client";

import { useState, useEffect, useCallback } from "react";
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

interface UseSavedDealsReturn {
  savedDealIds: Set<string>;
  savedDeals: SavedDeal[];
  isSaved: (dealId: string) => boolean;
  toggleSave: (dealId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useSavedDeals(): UseSavedDealsReturn {
  const [savedDeals, setSavedDeals] = useState<SavedDeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsLoading(false); return; }

      const { data, error } = await supabase
        .from("user_saved_deals")
        .select("deal_id, saved_at")
        .eq("user_id", user.id)
        .order("saved_at", { ascending: false });

      if (!cancelled) {
        if (error) setError(error.message);
        else setSavedDeals(data ?? []);
        setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const savedDealIds = new Set(savedDeals.map((s) => s.deal_id));

  const isSaved = useCallback(
    (dealId: string) => savedDealIds.has(dealId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedDeals],
  );

  const toggleSave = useCallback(async (dealId: string) => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const alreadySaved = savedDealIds.has(dealId);

    // Optimistic update
    const prev = savedDeals;
    if (alreadySaved) {
      setSavedDeals((s) => s.filter((d) => d.deal_id !== dealId));
    } else {
      setSavedDeals((s) => [{ deal_id: dealId, saved_at: new Date().toISOString() }, ...s]);
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
      setSavedDeals(prev);
      setError(err);
    }
  }, [savedDeals, savedDealIds]);

  return { savedDealIds, savedDeals, isSaved, toggleSave, isLoading, error };
}
