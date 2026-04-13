"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { RoleStep } from "@/components/onboarding/role-step";
import { SectorsStep } from "@/components/onboarding/sectors-step";
import { WatchlistStep } from "@/components/onboarding/watchlist-step";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ONBOARDED_KEY_PREFIX = "signalera_onboarded_";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<string | null>(null);
  const [verticals, setVerticals] = useState<string[]>([]);
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [tickers, setTickers] = useState<string[]>([]);

  const toggleVertical = useCallback((v: string) => {
    setVerticals((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }, []);

  const toggleActivityType = useCallback((a: string) => {
    setActivityTypes((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }, []);

  const addTicker = useCallback((ticker: string) => {
    setTickers((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
  }, []);

  const removeTicker = useCallback((ticker: string) => {
    setTickers((prev) => prev.filter((t) => t !== ticker));
  }, []);

  function canProceed(): boolean {
    if (step === 1) return role !== null;
    if (step === 2) return verticals.length > 0;
    if (step === 3) return tickers.length >= 3;
    return false;
  }

  function handleNext() {
    if (step < 3) {
      setStep(step + 1);
    } else {
      // Mark onboarded
      // userId would come from auth context in production
      localStorage.setItem(`${ONBOARDED_KEY_PREFIX}default`, "true");
      router.push("/dashboard");
    }
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="text-center mb-6">
          <Logo className="mx-auto" />
        </div>

        {/* Step indicator */}
        <div className="flex justify-center mb-6">
          <StepIndicator currentStep={step} totalSteps={3} />
        </div>

        {/* Card */}
        <div className="bg-white border border-border-base rounded-2xl p-6">
          {step === 1 && <RoleStep selected={role} onSelect={setRole} />}
          {step === 2 && (
            <SectorsStep
              selectedVerticals={verticals}
              selectedActivityTypes={activityTypes}
              onVerticalToggle={toggleVertical}
              onActivityTypeToggle={toggleActivityType}
            />
          )}
          {step === 3 && (
            <WatchlistStep
              tickers={tickers}
              onAdd={addTicker}
              onRemove={removeTicker}
            />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-subtle">
            {step > 1 ? (
              <Button variant="ghost" size="md" onClick={handleBack}>
                ← Back
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="font-sans text-[11px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                Skip for now
              </button>
            )}

            <Button
              variant={step === 3 ? "gold" : "primary"}
              size="md"
              disabled={!canProceed()}
              onClick={handleNext}
            >
              {step === 3 ? "Launch Signalera →" : "Continue →"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
