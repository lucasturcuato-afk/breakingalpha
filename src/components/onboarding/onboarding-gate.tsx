"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { OnboardingModal } from "./onboarding-modal";

export function OnboardingGate() {
  const [userId, setUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    async function check() {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // middleware guards /dashboard — this is a safety net

      const key = `signalera_onboarded_${user.id}`;
      if (!localStorage.getItem(key)) {
        setUserId(user.id);
        setShowModal(true);
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
