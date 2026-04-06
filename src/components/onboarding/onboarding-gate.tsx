"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { OnboardingModal } from "./onboarding-modal";

export function OnboardingGate() {
  const [showModal, setShowModal] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Fast path: localStorage check
    const localDone = localStorage.getItem("signalera_onboarded");
    if (localDone) {
      setChecked(true);
      return;
    }

    // Slow path: check if preferences record exists in DB
    async function checkPreferences() {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          // Not signed in — don't show modal
          setChecked(true);
          return;
        }
        const res = await fetch("/api/preferences", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setChecked(true);
          return;
        }
        const { preferences } = await res.json();
        if (preferences === null) {
          setShowModal(true);
        } else {
          // Already has preferences — mark locally so we don't re-check
          localStorage.setItem("signalera_onboarded", "true");
        }
      } catch {
        // Non-fatal — don't block the dashboard
      } finally {
        setChecked(true);
      }
    }

    checkPreferences();
  }, []);

  if (!checked || !showModal) return null;

  return (
    <OnboardingModal
      onComplete={() => setShowModal(false)}
    />
  );
}
