"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { OnboardingModal } from "./OnboardingModal";
import { useUserProfile } from "@/hooks/useUserProfile";

export function OnboardingGate() {
  const { profile, loading } = useUserProfile();
  const [userId, setUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (profile?.onboarding_completed) return;

    async function checkAuth() {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        setUserId(user.id);
        setShowModal(true);
      } catch {
        // Non-fatal — don't block the dashboard
      }
    }
    checkAuth();
  }, [loading, profile]);

  if (!showModal || !userId) return null;

  return (
    <OnboardingModal
      userId={userId}
      onComplete={() => setShowModal(false)}
    />
  );
}
