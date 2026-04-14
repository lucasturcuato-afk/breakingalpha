"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { OnboardingModal } from "./OnboardingModal";

export function OnboardingGate() {
  const [userId, setUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Check profile in DB
        const res = await fetch("/api/user-profile");
        if (!res.ok) {
          // If API fails, don't block the user
          return;
        }
        const profile = await res.json();

        if (!profile.onboarding_completed) {
          setUserId(user.id);
          setShowModal(true);
        }
      } catch {
        // Non-fatal — don't block the dashboard
      }
    }
    check();
  }, []);

  if (!showModal || !userId) return null;

  return (
    <OnboardingModal
      userId={userId}
      onComplete={() => setShowModal(false)}
    />
  );
}
