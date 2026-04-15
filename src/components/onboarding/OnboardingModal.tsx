"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserProfile } from "@/hooks/useUserProfile";

/* ─── Types ─── */

interface OnboardingModalProps {
  userId: string;
  onComplete: () => void;
}

interface RoleOption {
  id: string;
  label: string;
  emoji: string;
}

interface RiskOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

/* ─── Constants ─── */

const ROLES: RoleOption[] = [
  { id: "student_analyst", label: "Student Analyst", emoji: "\uD83C\uDF93" },
  { id: "buy_side", label: "Buy-Side Analyst", emoji: "\uD83D\uDCC8" },
  { id: "sell_side", label: "Sell-Side Analyst", emoji: "\uD83D\uDCCA" },
  { id: "private_equity", label: "Private Equity", emoji: "\uD83C\uDFE2" },
  { id: "ria", label: "RIA / Wealth Manager", emoji: "\uD83D\uDCBC" },
  { id: "family_office", label: "Family Office", emoji: "\uD83C\uDFE6" },
  { id: "other", label: "Other", emoji: "\u26A1" },
];

const SECTORS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Geopolitics & Macro",
];

const RISK_OPTIONS: RiskOption[] = [
  {
    id: "aggressive",
    label: "Aggressive",
    emoji: "\uD83D\uDD25",
    description: "High conviction, asymmetric opportunities",
  },
  {
    id: "balanced",
    label: "Balanced",
    emoji: "\u2696\uFE0F",
    description: "Risk-adjusted signals across sectors",
  },
  {
    id: "defensive",
    label: "Defensive",
    emoji: "\uD83D\uDEE1\uFE0F",
    description: "Capital preservation, macro awareness",
  },
];

/* ─── Step Dots ─── */

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center",
                "font-sans text-[11px] font-bold transition-all duration-[var(--duration-base)]",
                isActive && "bg-gold text-cream",
                isComplete && "bg-espresso text-cream",
                !isActive && !isComplete && "bg-parchment-mid border border-border-base text-text-faint",
              )}
            >
              {isComplete ? "\u2713" : step}
            </div>
            {step < total && (
              <div
                className={cn(
                  "w-8 h-0.5 rounded-full transition-colors duration-[var(--duration-base)]",
                  step < current ? "bg-espresso" : "bg-border-base",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Toast ─── */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-2.5 rounded-xl bg-espresso text-cream font-sans text-[13px] font-medium shadow-lg animate-[fadeIn_0.2s_ease-out]">
      {message}
    </div>
  );
}

/* ─── Main Component ─── */

export function OnboardingModal({ userId, onComplete }: OnboardingModalProps) {
  const { refetch: refetchGlobalProfile } = useUserProfile();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<string | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [riskAppetite, setRiskAppetite] = useState<string | null>(null);
  const [firm, setFirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape to skip
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleSkip();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSector = useCallback((s: string) => {
    setSectors((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  const selectAllSectors = useCallback(() => {
    setSectors([...SECTORS]);
  }, []);

  function canProceed(): boolean {
    if (step === 1) return role !== null;
    if (step === 2) return sectors.length >= 1;
    if (step === 3) return riskAppetite !== null;
    return false;
  }

  async function handleSkip() {
    try {
      await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_completed: true }),
      });
      refetchGlobalProfile();
    } catch {
      // Non-fatal — just close the modal
    }
    onComplete();
  }

  async function handleFinish() {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          sectors,
          risk_appetite: riskAppetite,
          firm: firm.trim() || null,
          onboarding_completed: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save profile (${res.status})`);
      }

      refetchGlobalProfile();
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
        onComplete();
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    handleFinish();
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-espresso/60 backdrop-blur-sm" />

        {/* Modal card */}
        <div className="relative z-10 w-full max-w-lg mx-4">
          <div className="bg-cream border border-border-base rounded-2xl overflow-hidden shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <span className="font-display text-[20px] font-extrabold text-espresso leading-none">
                  Signal<span style={{ color: "var(--gold)" }}>era</span>
                </span>
                <span className="font-sans text-[11px] text-text-faint">Setup</span>
              </div>
              <StepDots current={step} total={3} />
            </div>

            {/* Step content */}
            <div className="px-6 py-5">
              {step === 1 && (
                <RoleStepContent selected={role} onSelect={setRole} />
              )}
              {step === 2 && (
                <SectorsStepContent
                  selected={sectors}
                  onToggle={toggleSector}
                  onSelectAll={selectAllSectors}
                />
              )}
              {step === 3 && (
                <RiskStepContent
                  selected={riskAppetite}
                  onSelect={setRiskAppetite}
                  firm={firm}
                  onFirmChange={setFirm}
                />
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
                  &larr; Back
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
                    ? "Finish setup \u2192"
                    : "Continue \u2192"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Toast message="Profile saved! Welcome to Signalera." visible={showToast} />
    </>,
    document.body,
  );
}

/* ─── Step 1: Role ─── */

function RoleStepContent({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (role: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        Tell us who you are.
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        Signalera personalizes your intelligence feed based on your role.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex items-center gap-3 p-3.5 rounded-xl border-2 text-left",
              "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              "cursor-pointer bg-parchment",
              selected === r.id
                ? "border-gold"
                : "border-transparent hover:border-border-hover",
            )}
          >
            <span className="text-xl flex-shrink-0">{r.emoji}</span>
            <span className="font-sans text-[12px] font-semibold text-text-primary">
              {r.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 2: Sectors ─── */

function SectorsStepContent({
  selected,
  onToggle,
  onSelectAll,
}: {
  selected: string[];
  onToggle: (s: string) => void;
  onSelectAll: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        What markets do you follow?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-4">
        Select all that apply. We&apos;ll surface the signals that matter to you.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {SECTORS.map((s) => {
          const isSelected = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => onToggle(s)}
              className={cn(
                "px-3.5 py-2 rounded-lg border",
                "font-sans text-[12px] font-medium",
                "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                "cursor-pointer",
                isSelected
                  ? "border-gold bg-gold/15 text-gold-dark"
                  : "border-border-base bg-white text-text-secondary hover:border-border-hover",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onSelectAll}
        className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
      >
        Select all
      </button>

      {selected.length > 0 && (
        <p className="mt-3 font-sans text-[11px] text-text-muted">
          {selected.length} sector{selected.length !== 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}

/* ─── Step 3: Risk Appetite ─── */

function RiskStepContent({
  selected,
  onSelect,
  firm,
  onFirmChange,
}: {
  selected: string | null;
  onSelect: (risk: string) => void;
  firm: string;
  onFirmChange: (value: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        What&apos;s your risk appetite?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        This shapes how Signalera frames signals and thesis confidence.
      </p>

      <div className="space-y-2.5 mb-5">
        {RISK_OPTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex items-center gap-4 w-full p-4 rounded-xl border-2 text-left",
              "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              "cursor-pointer bg-parchment",
              selected === r.id
                ? "border-gold"
                : "border-transparent hover:border-border-hover",
            )}
          >
            <span className="text-2xl flex-shrink-0">{r.emoji}</span>
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary">
                {r.label}
              </h3>
              <p className="font-sans text-[11px] text-text-muted mt-0.5">
                {r.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div>
        <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">
          Firm (optional)
        </label>
        <Input
          value={firm}
          onChange={(e) => onFirmChange(e.target.value)}
          placeholder="e.g. Goldman Sachs, Bridgewater"
        />
      </div>
    </div>
  );
}
