"use client";

import { useState, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { StepIndicator } from "./step-indicator";
import { RoleStep } from "./role-step";
import { SectorsStep } from "./sectors-step";
import { WatchlistStep } from "./watchlist-step";
import { Button } from "@/components/ui/button";

interface OnboardingModalProps {
  userId: string;
  onComplete: () => void;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function OnboardingModal({ userId, onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<string | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [tickers, setTickers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSector = useCallback((sector: string) => {
    setSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector],
    );
  }, []);

  const addTicker = useCallback((ticker: string) => {
    setTickers((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
  }, []);

  const removeTicker = useCallback((ticker: string) => {
    setTickers((prev) => prev.filter((t) => t !== ticker));
  }, []);

  function canProceed(): boolean {
    if (step === 1) return role !== null;
    if (step === 2) return sectors.length > 0;
    if (step === 3) return tickers.length >= 3;
    return false;
  }

  function handleSkip() {
    localStorage.setItem(`signalera_onboarded_${userId}`, "true");
    onComplete();
  }

  async function handleNext() {
    if (step < 3) {
      setStep(step + 1);
      return;
    }

    // Final step — persist to DB
    setSaving(true);
    setError(null);

    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Session expired. Please sign in again.");
        setSaving(false);
        return;
      }

      const token = session.access_token;
      const userId = session.user.id;

      // 1. Save preferences
      const prefRes = await fetch("/api/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sectors,
          modules: role ? [role] : [],
          prioritize_watchlist: true,
        }),
      });
      if (!prefRes.ok) {
        const d = await prefRes.json();
        throw new Error(d.error || "Failed to save preferences");
      }

      // 2. Save watchlist tickers
      if (tickers.length > 0) {
        const batchRes = await fetch("/api/watchlist/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entries: tickers.map((t) => ({
              identifier: t,
              type: "ticker",
              user_id: userId,
            })),
          }),
        });
        if (!batchRes.ok) {
          const d = await batchRes.json();
          // Non-fatal: some tickers might already exist or fail validation
          console.warn("Watchlist batch partial error:", d.error);
        }
      }

      localStorage.setItem(`signalera_onboarded_${userId}`, "true");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-espresso/50 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[520px] mx-4">
        {/* Card body */}
        <div className="bg-cream border border-border-base rounded-2xl overflow-hidden shadow-[0_24px_48px_rgba(26,18,8,0.18)]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-subtle">
            <div className="flex items-center gap-3">
              <span className="font-display text-[20px] font-extrabold text-espresso leading-none">
                Signal<span style={{ color: "var(--gold)" }}>era</span>
              </span>
              <span className="font-sans text-[11px] text-text-faint">Personalization</span>
            </div>
            <div className="flex items-center gap-3">
              <StepIndicator currentStep={step} totalSteps={3} />
            </div>
          </div>

          {/* Step content */}
          <div className="px-6 py-5">
            {step === 1 && <RoleStep selected={role} onSelect={setRole} />}
            {step === 2 && <SectorsStep selected={sectors} onToggle={toggleSector} />}
            {step === 3 && (
              <WatchlistStep tickers={tickers} onAdd={addTicker} onRemove={removeTicker} />
            )}

            {error && (
              <p className="mt-3 font-sans text-[12px] text-signal-dn">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 pb-5 pt-2 border-t border-border-subtle">
            {step === 1 ? (
              <button
                type="button"
                onClick={handleSkip}
                className="font-sans text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              >
                Skip for now
              </button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                disabled={saving}
              >
                ← Back
              </Button>
            )}

            <Button
              variant={step === 3 ? "gold" : "primary"}
              size="md"
              disabled={!canProceed() || saving}
              onClick={handleNext}
            >
              {saving
                ? "Saving..."
                : step === 3
                  ? "Launch Signalera →"
                  : "Continue →"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
