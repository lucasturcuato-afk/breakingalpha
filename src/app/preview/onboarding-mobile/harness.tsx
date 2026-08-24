"use client";

import { useEffect, useState } from "react";
import { MobileOnboarding } from "@/components/onboarding/mobile-onboarding";
import {
  HORIZONS,
  ROLES,
  SECTORS,
  STRATEGIES,
  TOTAL_STEPS,
  WORKFLOWS,
} from "@/components/onboarding/OnboardingWizard";
import type {
  InvestmentHorizon,
  StrategyType,
  UserRole,
  WorkflowStyle,
} from "@/lib/user-profile";

/**
 * Fixture driver for the mobile onboarding screen. Every value here is a
 * fixture and nothing is written anywhere: the harness owns its own state
 * and the submit handlers are inert.
 *
 * The step and the step-7 lifecycle come off the query so a screen audit
 * can walk all seven steps and all three of step 7's states. Read from
 * window.location in an effect rather than through useSearchParams, which
 * would force a Suspense boundary on a page with no other reason for one.
 */

const PREVIEW_FIXTURE = {
  title:
    "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
  sector: "Utilities",
  rationale:
    "Data centre contracting has pulled roughly a third of the nuclear fleet into fixed-price supply agreements, and the auction clears into a market short on firm capacity.",
};

export function OnboardingMobileHarness() {
  const [step, setStep] = useState(1);
  const [lifecycle, setLifecycle] = useState<"ready" | "loading" | "error">("ready");
  // The gated CTA. README mandates --c-locked-bg / --c-locked-ink at
  // 5.39:1 rather than an opacity wash, so the locked treatment has to be
  // reachable for a contrast measurement.
  const [locked, setLocked] = useState(false);
  // The save path can fail after the last step. The component renders it;
  // this is how it gets measured.
  const [saveFailed, setSaveFailed] = useState(false);

  const [firstName, setFirstName] = useState("Maya");
  const [firmOrSchool, setFirmOrSchool] = useState("");
  const [role, setRole] = useState<UserRole | null>("buy_side");
  const [strategy, setStrategy] = useState<StrategyType | null>("equity");
  const [sectors, setSectors] = useState<string[]>([
    "Technology",
    "Energy & Oil/Gas",
    "Financial Services",
  ]);
  const [horizon, setHorizon] = useState<InvestmentHorizon | null>("medium");
  const [workflow, setWorkflow] = useState<WorkflowStyle | null>("monitoring");
  const [tickerInput, setTickerInput] = useState("");
  const [tickers, setTickers] = useState<string[]>(["CEG", "NVO", "MSFT"]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = Number(q.get("step"));
    if (Number.isInteger(s) && s >= 1 && s <= TOTAL_STEPS) setStep(s);
    const p = q.get("preview");
    if (p === "loading" || p === "error") setLifecycle(p);
    if (q.get("locked") === "1") setLocked(true);
    if (q.get("save") === "error") setSaveFailed(true);
  }, []);

  return (
    <MobileOnboarding
      step={step}
      totalSteps={TOTAL_STEPS}
      firstName={firstName}
      onFirstName={setFirstName}
      firmOrSchool={firmOrSchool}
      onFirmOrSchool={setFirmOrSchool}
      roles={ROLES}
      role={role}
      onRole={setRole}
      strategies={STRATEGIES}
      strategy={strategy}
      onStrategy={setStrategy}
      sectorOptions={SECTORS}
      sectors={sectors}
      onToggleSector={(s) =>
        setSectors((prev) =>
          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
        )
      }
      horizons={HORIZONS}
      horizon={horizon}
      onHorizon={setHorizon}
      workflows={WORKFLOWS}
      workflow={workflow}
      onWorkflow={setWorkflow}
      tickerInput={tickerInput}
      onTickerInput={setTickerInput}
      onCommitTickers={() => {
        const tokens = tickerInput
          .toUpperCase()
          .split(/[,\s]+/)
          .filter((t) => /^[A-Z.\-]{1,8}$/.test(t));
        if (tokens.length) setTickers((prev) => [...new Set([...prev, ...tokens])]);
        setTickerInput("");
      }}
      tickers={tickers}
      onRemoveTicker={(t) => setTickers((prev) => prev.filter((x) => x !== t))}
      preview={lifecycle === "ready" ? PREVIEW_FIXTURE : null}
      previewLoading={lifecycle === "loading"}
      previewError={lifecycle === "error" ? "Preview failed (503)" : null}
      onRetryPreview={() => setLifecycle("ready")}
      saveError={saveFailed ? "Failed to save profile (500)" : null}
      ctaLabel={
        step === 1 ? "Get started →" : step === TOTAL_STEPS ? "Enter Signalera →" : "Continue →"
      }
      ctaDisabled={locked}
      onNext={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
      onBack={() => setStep((s) => Math.max(1, s - 1))}
      backDisabled={step === 1}
    />
  );
}
