"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RiskAppetite, UserRole } from "@/lib/user-profile";
import { trackClientEvent } from "@/lib/track-event";

/* ─── Constants ─── */

const ROLES: { id: UserRole; label: string; emoji: string }[] = [
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

const RISK_OPTIONS: {
  id: RiskAppetite;
  label: string;
  emoji: string;
  description: string;
}[] = [
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

const TOTAL_STEPS = 6;

interface InitialProfile {
  full_name: string;
  role: UserRole | null;
  sectors: string[];
  risk_appetite: RiskAppetite;
  firm_or_school: string;
  watchlist_tickers: string[];
}

interface PreviewResult {
  title: string;
  sector: string;
  conviction: string;
  rationale: string;
}

/* ─── Step Dots ─── */

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div
            key={step}
            className={cn(
              "h-1.5 rounded-full transition-all duration-[var(--duration-base)]",
              isActive ? "w-8 bg-gold" : isComplete ? "w-4 bg-espresso" : "w-4 bg-border-base",
            )}
          />
        );
      })}
    </div>
  );
}

/* ─── Wizard ─── */

export function OnboardingWizard({ initialProfile }: { initialProfile: InitialProfile }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState(initialProfile.full_name);
  const [role, setRole] = useState<UserRole | null>(initialProfile.role);
  const [sectors, setSectors] = useState<string[]>(initialProfile.sectors);
  const [riskAppetite, setRiskAppetite] = useState<RiskAppetite>(
    initialProfile.risk_appetite ?? "balanced",
  );
  const [firmOrSchool, setFirmOrSchool] = useState(initialProfile.firm_or_school);
  const [tickerInput, setTickerInput] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>(initialProfile.watchlist_tickers);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSector = useCallback((s: string) => {
    setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }, []);

  const addTicker = useCallback(() => {
    const t = tickerInput.trim().toUpperCase();
    if (!t) return;
    if (!/^[A-Z.\-]{1,8}$/.test(t)) {
      setTickerInput("");
      return;
    }
    setWatchlist((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTickerInput("");
  }, [tickerInput]);

  const removeTicker = useCallback((t: string) => {
    setWatchlist((prev) => prev.filter((x) => x !== t));
  }, []);

  function canProceed(): boolean {
    if (step === 1) return fullName.trim().length > 0;
    if (step === 2) return role !== null;
    if (step === 3) return sectors.length >= 1;
    if (step === 4) return riskAppetite !== null;
    if (step === 5) return true; // watchlist optional
    if (step === 6) return true;
    return false;
  }

  async function fetchPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/onboarding/preview-thesis", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          sectors,
          risk_appetite: riskAppetite,
          watchlist_tickers: watchlist,
        }),
      });
      if (!res.ok) {
        throw new Error(`Preview failed (${res.status})`);
      }
      const data = (await res.json()) as PreviewResult;
      setPreview(data);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Could not generate preview");
    } finally {
      setPreviewLoading(false);
    }
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
          full_name: fullName.trim() || null,
          role,
          sectors,
          risk_appetite: riskAppetite,
          firm_or_school: firmOrSchool.trim() || null,
          watchlist_tickers: watchlist,
          onboarding_completed: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save profile (${res.status})`);
      }
      trackClientEvent("onboarding_completed", {
        role,
        risk_appetite: riskAppetite,
        sectors_count: sectors.length,
        watchlist_count: watchlist.length,
      });
      // Seed sector preferences so the first day's ranking already reflects
      // the user's declared interests — one event per sector.
      for (const s of sectors) {
        trackClientEvent("sector_filter_applied", { sector: s });
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    if (step === 5) {
      // Move to step 6 AND kick off preview
      setStep(6);
      await fetchPreview();
      return;
    }
    if (step === 6) {
      await handleFinish();
      return;
    }
    setStep(step + 1);
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="bg-cream border border-border-base rounded-2xl overflow-hidden shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <span className="font-display text-[22px] font-extrabold text-espresso leading-none">
              Signal<span style={{ color: "var(--gold)" }}>era</span>
            </span>
            <span className="font-sans text-[11px] text-text-faint uppercase tracking-wide">
              Setup · {step}/{TOTAL_STEPS}
            </span>
          </div>
          <StepDots current={step} total={TOTAL_STEPS} />
        </div>

        {/* Body */}
        <div className="px-8 py-7 min-h-[360px]">
          {step === 1 && (
            <StepWelcome fullName={fullName} onChange={setFullName} />
          )}
          {step === 2 && (
            <StepRole
              selected={role}
              onSelect={setRole}
              firmOrSchool={firmOrSchool}
              onFirmOrSchoolChange={setFirmOrSchool}
            />
          )}
          {step === 3 && (
            <StepSectors
              selected={sectors}
              onToggle={toggleSector}
              onSelectAll={() => setSectors([...SECTORS])}
            />
          )}
          {step === 4 && (
            <StepRisk selected={riskAppetite} onSelect={setRiskAppetite} />
          )}
          {step === 5 && (
            <StepWatchlist
              input={tickerInput}
              onInputChange={setTickerInput}
              onAdd={addTicker}
              tickers={watchlist}
              onRemove={removeTicker}
            />
          )}
          {step === 6 && (
            <StepPreview
              preview={preview}
              loading={previewLoading}
              error={previewError}
              onRetry={fetchPreview}
            />
          )}

          {error && (
            <p className="mt-4 font-sans text-[12px] text-signal-dn">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 pb-6 pt-3 border-t border-border-subtle">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 1 || saving}
            onClick={() => setStep(Math.max(1, step - 1))}
          >
            &larr; Back
          </Button>

          <Button
            variant={step === TOTAL_STEPS ? "gold" : "primary"}
            size="md"
            disabled={!canProceed() || saving || (step === 6 && previewLoading)}
            onClick={handleNext}
          >
            {saving
              ? "Saving..."
              : step === TOTAL_STEPS
                ? "Enter Signalera \u2192"
                : "Continue \u2192"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Step components ─── */

function StepWelcome({
  fullName,
  onChange,
}: {
  fullName: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[26px] font-extrabold text-espresso mb-1">
        Welcome to Signalera.
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-6">
        A three-minute setup tailors every thesis, brief and signal to the way you invest.
      </p>
      <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">
        What should we call you?
      </label>
      <Input
        value={fullName}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Jane Chen"
        autoFocus
      />
    </div>
  );
}

function StepRole({
  selected,
  onSelect,
  firmOrSchool,
  onFirmOrSchoolChange,
}: {
  selected: UserRole | null;
  onSelect: (r: UserRole) => void;
  firmOrSchool: string;
  onFirmOrSchoolChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        What do you do?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        This shapes the tone, depth and framing of every brief.
      </p>
      <div className="grid grid-cols-2 gap-2.5 mb-5">
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
      <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">
        Firm or school (optional)
      </label>
      <Input
        value={firmOrSchool}
        onChange={(e) => onFirmOrSchoolChange(e.target.value)}
        placeholder="e.g. Point72, Bridgewater, MIT"
      />
    </div>
  );
}

function StepSectors({
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
        What sectors do you follow?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-4">
        Pick at least one. Theses, briefs and trend pages will lean into these first.
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
                "px-3.5 py-2 rounded-lg border font-sans text-[12px] font-medium",
                "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer",
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

function StepRisk({
  selected,
  onSelect,
}: {
  selected: RiskAppetite;
  onSelect: (r: RiskAppetite) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        How do you want ideas framed?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        Affects how aggressively we surface contrarian theses and high-beta catalysts.
      </p>
      <div className="space-y-2.5">
        {RISK_OPTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex items-center gap-4 w-full p-4 rounded-xl border-2 text-left bg-parchment",
              "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer",
              selected === r.id ? "border-gold" : "border-transparent hover:border-border-hover",
            )}
          >
            <span className="text-2xl flex-shrink-0">{r.emoji}</span>
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary">{r.label}</h3>
              <p className="font-sans text-[11px] text-text-muted mt-0.5">{r.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepWatchlist({
  input,
  onInputChange,
  onAdd,
  tickers,
  onRemove,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  tickers: string[];
  onRemove: (t: string) => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        Any tickers you watch?
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        Optional. We&apos;ll prioritise articles and theses that touch these names.
      </p>
      <div className="flex items-center gap-2 mb-4">
        <Input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="e.g. NVDA"
          className="uppercase"
        />
        <Button variant="secondary" size="md" onClick={onAdd} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {tickers.length === 0 ? (
        <p className="font-sans text-[11px] text-text-muted italic">
          No tickers yet — you can skip this and add them later from preferences.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tickers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onRemove(t)}
              className="group flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gold-muted text-gold-dark font-data text-[11px] font-semibold cursor-pointer hover:bg-gold/30 transition-colors"
              title="Click to remove"
            >
              {t}
              <span className="text-text-faint group-hover:text-signal-dn transition-colors">
                &times;
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepPreview({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        Here&apos;s what Signalera looks like for you.
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        A live sample thesis drafted for your profile. Briefs and trends use the same logic.
      </p>
      {loading && (
        <div className="flex items-center gap-2 text-text-muted font-sans text-[12px]">
          <span className="inline-block h-2 w-2 rounded-full bg-gold animate-pulse" />
          Generating a preview thesis…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-signal-dn/30 bg-signal-dn/5 p-3">
          <p className="font-sans text-[12px] text-signal-dn mb-2">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}
      {preview && !loading && (
        <div className="rounded-xl border border-border-base bg-parchment p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-gold text-cream uppercase tracking-wide">
              {preview.conviction}
            </span>
            <span className="font-sans text-[9px] text-text-muted uppercase tracking-wide">
              {preview.sector}
            </span>
          </div>
          <h3 className="font-display text-[15px] font-bold text-espresso leading-snug mb-2">
            {preview.title}
          </h3>
          <p className="font-sans text-[12px] text-text-secondary leading-relaxed">
            {preview.rationale}
          </p>
        </div>
      )}
    </div>
  );
}
