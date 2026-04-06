"use client";

import { useState, useEffect } from "react";
import { OnboardingModal } from "./onboarding-modal";

export function OnboardingGate() {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Middleware guarantees /dashboard is authenticated.
    // If the localStorage flag isn't set, the user hasn't completed onboarding.
    const done = localStorage.getItem("signalera_onboarded");
    if (!done) setShowModal(true);
  }, []);

  if (!showModal) return null;

  return <OnboardingModal onComplete={() => setShowModal(false)} />;
}
