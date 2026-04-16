"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type {
  InvestmentHorizon,
  RiskAppetite,
  StrategyType,
  UserRole,
  WorkflowStyle,
} from "@/lib/user-profile";
import { trackClientEvent } from "@/lib/track-event";

/* ─── Constants ─── */

const ROLES: { id: UserRole; label: string; description: string }[] = [
  { id: "student_analyst", label: "Student Analyst", description: "Learning equity research" },
  { id: "buy_side", label: "Buy-Side Analyst", description: "Fund research & portfolio" },
  { id: "sell_side", label: "Sell-Side Analyst", description: "Equity research coverage" },
  { id: "private_equity", label: "Private Equity", description: "Deal evaluation & ops" },
  { id: "ria", label: "RIA / Wealth Manager", description: "Managing client capital" },
  { id: "family_office", label: "Family Office", description: "Multi-asset allocation" },
  { id: "other", label: "Other", description: "Custom investor profile" },
];

const STRATEGIES: { id: StrategyType; label: string; description: string }[] = [
  { id: "pe", label: "Private Equity", description: "Durable cash flows, long duration" },
  { id: "equity", label: "Public Equity", description: "Catalyst-driven, valuation-aware" },
  { id: "vc", label: "Venture", description: "Asymmetric upside, runway-sensitive" },
  { id: "macro", label: "Macro", description: "Regime- and policy-aware" },
  { id: "credit", label: "Credit", description: "Coupon safety, spread & default risk" },
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

const HORIZONS: { id: InvestmentHorizon; label: string; description: string }[] = [
  { id: "short", label: "Short", description: "Weeks to a few months" },
  { id: "medium", label: "Medium", description: "6–18 months" },
  { id: "long", label: "Long", description: "Multi-year" },
];

const WORKFLOWS: { id: WorkflowStyle; label: string; description: string }[] = [
  { id: "deep_dive", label: "Deep-dive", description: "Single-name research" },
  { id: "screening", label: "Screening", description: "Systematic shortlists" },
  { id: "monitoring", label: "Monitoring", description: "Existing positions" },
];

const RISK_OPTIONS: { id: RiskAppetite; label: string; description: string }[] = [
  { id: "aggressive", label: "Aggressive", description: "High-conviction, asymmetric" },
  { id: "balanced", label: "Balanced", description: "Risk-adjusted across sectors" },
  { id: "defensive", label: "Defensive", description: "Capital preservation" },
];

const TOTAL_STEPS = 7;

/* Gold on buttons — user specified this specific hex, inline override allowed. */
const CTA_BG = "#C9A84C";
const CTA_FG = "#1A1208";

interface InitialProfile {
  full_name: string;
  role: UserRole | null;
  sectors: string[];
  risk_appetite: RiskAppetite;
  strategy_type: StrategyType | null;
  investment_horizon: InvestmentHorizon | null;
  workflow_style: WorkflowStyle | null;
  firm_or_school: string;
  watchlist_tickers: string[];
}

interface PreviewResult {
  title: string;
  sector: string;
  conviction: string;
  rationale: string;
}

/* ─── Impact strip data helpers ─── */

type RoleBucket = "student" | "junior" | "senior" | "other";

function bucketForRole(role: UserRole | null): RoleBucket {
  if (role === "student_analyst") return "student";
  if (role === "buy_side" || role === "sell_side" || role === "private_equity") return "junior";
  if (role === "ria" || role === "family_office") return "senior";
  return "other";
}

const THESIS_DEPTH_BY_BUCKET: Record<RoleBucket, string> = {
  student: "Teaching tone, glossary-first",
  junior: "Analyst depth, full evidence chain",
  senior: "Capital-allocator brevity",
  other: "Neutral investor tone",
};

const MORNING_BRIEF_BY_BUCKET: Record<RoleBucket, string> = {
  student: "Key movers + glossary notes",
  junior: "Catalyst + consensus read",
  senior: "What changed, what to act on",
  other: "Daily signals roundup",
};

const SECTOR_BRIEF_HINT: Record<string, string> = {
  "Energy & Oil/Gas": "Oil macro + OPEC coverage",
  "Aerospace & Defense": "Defense budgets + geopolitics",
  "Technology": "Earnings + AI capex",
  "Healthcare & Biotech": "FDA cycles + biotech catalysts",
  "Financial Services": "Rate-sensitive financials",
};

const SECTOR_WRAP_HINT: Record<string, string> = {
  "Energy & Oil/Gas": "Energy wrap + supply watch",
  "Aerospace & Defense": "Defense wrap + contract watch",
  "Technology": "Tech wrap + AI flow read",
  "Healthcare & Biotech": "Biotech wrap + FDA calendar",
  "Financial Services": "Financials wrap + rate read",
};

function morningBriefLine(role: UserRole | null, sectors: string[]): string {
  const base = MORNING_BRIEF_BY_BUCKET[bucketForRole(role)];
  const firstHint = sectors.find((s) => SECTOR_BRIEF_HINT[s]);
  return firstHint ? `${SECTOR_BRIEF_HINT[firstHint]} · ${base}` : base;
}

function eveningWrapLine(sectors: string[]): string {
  const firstHint = sectors.find((s) => SECTOR_WRAP_HINT[s]);
  return firstHint ? SECTOR_WRAP_HINT[firstHint] : "Broad market recap + patterns";
}

const THESIS_FRAMING_BY_STRATEGY: Record<StrategyType, string> = {
  pe: "Private-equity lens: durable cash flows",
  equity: "Public-equity lens: catalyst + consensus",
  vc: "Venture lens: asymmetric upside",
  macro: "Macro lens: regime-aware positioning",
  credit: "Credit lens: coupon safety + spread",
};

const BEAR_CASE_BY_STRATEGY: Record<StrategyType, string> = {
  pe: "Durability & leverage fragility",
  equity: "Catalyst reversal + multiple compression",
  vc: "Runway, burn, and dilution",
  macro: "Tail risks & regime shifts",
  credit: "Downgrade & default risk",
};

interface ImpactRow {
  surface: string;
  value: string;
}

function impactRowsFor(
  role: UserRole | null,
  strategy: StrategyType | null,
  sectors: string[],
): ImpactRow[] {
  return [
    { surface: "Thesis depth", value: THESIS_DEPTH_BY_BUCKET[bucketForRole(role)] },
    { surface: "Morning Brief", value: morningBriefLine(role, sectors) },
    {
      surface: "Thesis framing",
      value: strategy ? THESIS_FRAMING_BY_STRATEGY[strategy] : "Pick a strategy to see framing",
    },
    {
      surface: "Bear case",
      value: strategy ? BEAR_CASE_BY_STRATEGY[strategy] : "Pick a strategy to see bear angle",
    },
    { surface: "Evening Wrap", value: eveningWrapLine(sectors) },
  ];
}

/* ─── Progress dots ─── */

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
              isActive
                ? "w-8 bg-gold"
                : isComplete
                  ? "w-4 bg-gold/60"
                  : "w-4 bg-white/15",
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
  const [firmOrSchool, setFirmOrSchool] = useState(initialProfile.firm_or_school);
  const [role, setRole] = useState<UserRole | null>(initialProfile.role);
  const [strategy, setStrategy] = useState<StrategyType | null>(initialProfile.strategy_type);
  const [sectors, setSectors] = useState<string[]>(initialProfile.sectors);
  const [horizon, setHorizon] = useState<InvestmentHorizon | null>(
    initialProfile.investment_horizon,
  );
  const [workflow, setWorkflow] = useState<WorkflowStyle | null>(initialProfile.workflow_style);
  const [riskAppetite, setRiskAppetite] = useState<RiskAppetite>(
    initialProfile.risk_appetite ?? "balanced",
  );
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
    if (step === 3) return strategy !== null;
    if (step === 4) return sectors.length >= 1;
    if (step === 5) return horizon !== null && workflow !== null;
    if (step === 6) return true; // watchlist optional
    if (step === 7) return true;
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
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
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
          firm_or_school: firmOrSchool.trim() || null,
          role,
          strategy_type: strategy,
          sectors,
          investment_horizon: horizon,
          workflow_style: workflow,
          risk_appetite: riskAppetite,
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
        strategy_type: strategy,
        investment_horizon: horizon,
        workflow_style: workflow,
        sectors_count: sectors.length,
        watchlist_count: watchlist.length,
      });
      // Seed sector preferences so ranking already reflects declared interest.
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
    if (step === 6) {
      setStep(7);
      await fetchPreview();
      return;
    }
    if (step === 7) {
      await handleFinish();
      return;
    }
    setStep(step + 1);
  }

  const ctaLabel = saving
    ? "Saving..."
    : step === 1
      ? "Get started \u2192"
      : step === TOTAL_STEPS
        ? "Enter Signalera \u2192"
        : "Continue \u2192";

  const ctaDisabled = !canProceed() || saving || (step === 7 && previewLoading);

  return (
    <main
      className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2"
      style={{ backgroundColor: "var(--espresso)" }}
    >
      {/* ── LEFT PANEL ── */}
      <section
        className="relative flex flex-col min-h-screen border-r border-white/10"
        style={{ padding: "48px" }}
      >
        {/* Header: brand + step dots */}
        <div className="flex items-center justify-between mb-12">
          <span
            className="font-display text-[20px] font-extrabold leading-none"
            style={{ color: "#f5f0e8" }}
          >
            Signal<span style={{ color: CTA_BG }}>era</span>
          </span>
          <StepDots current={step} total={TOTAL_STEPS} />
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col justify-center max-w-[520px]">
          {step === 1 && (
            <StepName
              fullName={fullName}
              onFullNameChange={setFullName}
              firmOrSchool={firmOrSchool}
              onFirmOrSchoolChange={setFirmOrSchool}
            />
          )}
          {step === 2 && <StepRole selected={role} onSelect={setRole} />}
          {step === 3 && <StepStrategy selected={strategy} onSelect={setStrategy} />}
          {step === 4 && (
            <StepSectors
              selected={sectors}
              onToggle={toggleSector}
              onSelectAll={() => setSectors([...SECTORS])}
            />
          )}
          {step === 5 && (
            <StepHorizonWorkflow
              horizon={horizon}
              onHorizonSelect={setHorizon}
              workflow={workflow}
              onWorkflowSelect={setWorkflow}
              risk={riskAppetite}
              onRiskSelect={setRiskAppetite}
            />
          )}
          {step === 6 && (
            <StepWatchlist
              input={tickerInput}
              onInputChange={setTickerInput}
              onAdd={addTicker}
              tickers={watchlist}
              onRemove={removeTicker}
            />
          )}
          {step === 7 && (
            <StepPreview
              preview={preview}
              loading={previewLoading}
              error={previewError}
              onRetry={fetchPreview}
            />
          )}

          {error && (
            <p className="mt-5 font-sans text-[12px]" style={{ color: "#f87171" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer CTA */}
        <div className="flex items-center justify-between mt-10">
          <button
            type="button"
            disabled={step === 1 || saving}
            onClick={() => setStep(Math.max(1, step - 1))}
            className={cn(
              "font-sans text-[12px] font-semibold transition-colors",
              step === 1 || saving
                ? "opacity-30 cursor-not-allowed"
                : "cursor-pointer hover:text-white",
            )}
            style={{ color: "#c0a870" }}
          >
            &larr; Back
          </button>

          <button
            type="button"
            disabled={ctaDisabled}
            onClick={handleNext}
            className={cn(
              "font-sans text-[13px] font-bold px-5 py-2.5 rounded-lg transition-opacity cursor-pointer",
              ctaDisabled ? "opacity-40 cursor-not-allowed" : "hover:opacity-90",
            )}
            style={{ backgroundColor: CTA_BG, color: CTA_FG }}
          >
            {ctaLabel}
          </button>
        </div>
      </section>

      {/* ── RIGHT PANEL ── */}
      <aside
        className="relative min-h-screen hidden md:flex flex-col"
        style={{ backgroundColor: "var(--espresso-light)", padding: "48px" }}
      >
        {step === 1 && <BrandPanel />}
        {step >= 2 && step <= 6 && (
          <ImpactStripPanel
            rows={impactRowsFor(role, strategy, sectors)}
            activeSurface={surfaceForStep(step)}
          />
        )}
        {step === 7 && (
          <LiveThesisPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            onRetry={fetchPreview}
          />
        )}
      </aside>
    </main>
  );
}

/* ─── Right-panel content ─── */

function BrandPanel() {
  return (
    <div className="flex flex-col h-full justify-center max-w-[460px]">
      <p
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] mb-4"
        style={{ color: CTA_BG }}
      >
        Where markets make sense
      </p>
      <h2
        className="font-display text-[40px] font-extrabold leading-[1.1] mb-5"
        style={{ color: "#f5f0e8" }}
      >
        Your market. Your signal.
      </h2>
      <p
        className="font-sans text-[14px] leading-relaxed mb-8"
        style={{ color: "#c0a870" }}
      >
        Signalera reads the market through your lens. Every thesis, brief and
        pattern is tuned to the way you invest — your role, your strategy, your
        sectors and the horizons you trade in.
      </p>
      <div className="flex flex-wrap gap-2">
        {["Morning Brief", "Thesis engine", "Bear-case flips", "Pattern memory", "Evening Wrap"].map(
          (t) => (
            <span
              key={t}
              className="px-3 py-1 rounded-full font-sans text-[11px] font-medium border"
              style={{
                color: "#c0a870",
                borderColor: "rgba(201,168,76,0.25)",
                backgroundColor: "rgba(201,168,76,0.06)",
              }}
            >
              {t}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function surfaceForStep(step: number): string[] {
  // Highlight the row(s) that the current step influences.
  if (step === 2) return ["Thesis depth", "Morning Brief"];
  if (step === 3) return ["Thesis framing", "Bear case"];
  if (step === 4) return ["Morning Brief", "Evening Wrap"];
  return [];
}

function ImpactStripPanel({
  rows,
  activeSurface,
}: {
  rows: ImpactRow[];
  activeSurface: string[];
}) {
  return (
    <div className="flex flex-col h-full max-w-[460px]">
      <p
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] mb-3"
        style={{ color: CTA_BG }}
      >
        How this shapes Signalera
      </p>
      <h2
        className="font-display text-[24px] font-extrabold leading-tight mb-8"
        style={{ color: "#f5f0e8" }}
      >
        Live preview of your surfaces
      </h2>

      <ul className="space-y-4">
        {rows.map((row) => {
          const highlighted = activeSurface.includes(row.surface);
          return (
            <li
              key={row.surface}
              className={cn(
                "grid grid-cols-[140px_20px_1fr] items-start gap-3 transition-opacity duration-[var(--duration-base)]",
                highlighted ? "opacity-100" : "opacity-70",
              )}
            >
              <span
                className="font-sans text-[12px] uppercase tracking-wide"
                style={{ color: "#8a7a60" }}
              >
                {row.surface}
              </span>
              <span
                aria-hidden
                className="font-sans text-[14px] leading-5"
                style={{ color: CTA_BG }}
              >
                &rarr;
              </span>
              <span
                className="font-sans text-[13px] leading-snug font-semibold"
                style={{ color: highlighted ? CTA_BG : "#e8b84b" }}
              >
                {row.value}
              </span>
            </li>
          );
        })}
      </ul>

      <p
        className="mt-auto pt-8 font-sans text-[11px] leading-relaxed"
        style={{ color: "#8a7a60" }}
      >
        Each choice re-tunes these surfaces instantly. You can change any of
        them later from Settings &rarr; Preferences.
      </p>
    </div>
  );
}

function LiveThesisPanel({
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
    <div className="flex flex-col h-full max-w-[460px]">
      <p
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] mb-3"
        style={{ color: CTA_BG }}
      >
        Sample thesis for you
      </p>
      <h2
        className="font-display text-[24px] font-extrabold leading-tight mb-8"
        style={{ color: "#f5f0e8" }}
      >
        What your feed will look like
      </h2>

      {loading && (
        <div
          className="flex items-center gap-2 font-sans text-[12px]"
          style={{ color: "#c0a870" }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: CTA_BG }}
          />
          Generating a preview thesis…
        </div>
      )}

      {error && !loading && (
        <div
          className="rounded-lg p-4 border"
          style={{
            borderColor: "rgba(220,38,38,0.35)",
            backgroundColor: "rgba(220,38,38,0.08)",
          }}
        >
          <p className="font-sans text-[12px] mb-2" style={{ color: "#f87171" }}>
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="font-sans text-[11px] font-semibold cursor-pointer hover:opacity-80"
            style={{ color: CTA_BG }}
          >
            Try again
          </button>
        </div>
      )}

      {preview && !loading && (
        <div
          className="rounded-xl p-5 border"
          style={{
            borderColor: "rgba(201,168,76,0.25)",
            backgroundColor: "rgba(201,168,76,0.06)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className="font-sans text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
              style={{ backgroundColor: CTA_BG, color: CTA_FG }}
            >
              {preview.conviction}
            </span>
            <span
              className="font-sans text-[9px] uppercase tracking-wide"
              style={{ color: "#c0a870" }}
            >
              {preview.sector}
            </span>
          </div>
          <h3
            className="font-display text-[17px] font-bold leading-snug mb-2"
            style={{ color: "#f5f0e8" }}
          >
            {preview.title}
          </h3>
          <p className="font-sans text-[13px] leading-relaxed" style={{ color: "#c0a870" }}>
            {preview.rationale}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Step components (left panel content) ─── */

function SectionTitle({ kicker, title, body }: { kicker?: string; title: string; body?: string }) {
  return (
    <div className="mb-7">
      {kicker && (
        <p
          className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] mb-3"
          style={{ color: CTA_BG }}
        >
          {kicker}
        </p>
      )}
      <h2
        className="font-display text-[32px] font-extrabold leading-[1.1] mb-3"
        style={{ color: "#f5f0e8" }}
      >
        {title}
      </h2>
      {body && (
        <p className="font-sans text-[14px] leading-relaxed" style={{ color: "#c0a870" }}>
          {body}
        </p>
      )}
    </div>
  );
}

function DarkLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] mb-2 block"
      style={{ color: "#8a7a60" }}
    >
      {children}
    </label>
  );
}

function StepName({
  fullName,
  onFullNameChange,
  firmOrSchool,
  onFirmOrSchoolChange,
}: {
  fullName: string;
  onFullNameChange: (v: string) => void;
  firmOrSchool: string;
  onFirmOrSchoolChange: (v: string) => void;
}) {
  return (
    <div>
      <SectionTitle
        kicker="Welcome"
        title="Welcome to Signalera."
        body="Three minutes of setup tailors every thesis, brief and signal to the way you invest."
      />
      <div className="space-y-5 max-w-[420px]">
        <div>
          <DarkLabel>First name</DarkLabel>
          <Input
            value={fullName}
            onChange={(e) => onFullNameChange(e.target.value)}
            placeholder="Jane"
            autoFocus
            className="bg-transparent border-white/15 text-white placeholder:text-white/30 focus-visible:border-gold"
            style={{ color: "#f5f0e8" }}
          />
        </div>
        <div>
          <DarkLabel>Firm or school (optional)</DarkLabel>
          <Input
            value={firmOrSchool}
            onChange={(e) => onFirmOrSchoolChange(e.target.value)}
            placeholder="e.g. Point72, Bridgewater, MIT"
            className="bg-transparent border-white/15 text-white placeholder:text-white/30 focus-visible:border-gold"
            style={{ color: "#f5f0e8" }}
          />
        </div>
      </div>
    </div>
  );
}

function DarkPill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer",
        "px-4 py-3",
      )}
      style={{
        backgroundColor: selected ? "rgba(201,168,76,0.12)" : "rgba(255,255,255,0.02)",
        borderColor: selected ? CTA_BG : "rgba(255,255,255,0.1)",
        color: "#f5f0e8",
      }}
    >
      {children}
    </button>
  );
}

function StepRole({
  selected,
  onSelect,
}: {
  selected: UserRole | null;
  onSelect: (r: UserRole) => void;
}) {
  return (
    <div>
      <SectionTitle
        kicker="Step 2 · Role"
        title="What do you do?"
        body="This shapes the tone, depth and framing of every brief."
      />
      <div className="grid grid-cols-2 gap-2.5">
        {ROLES.map((r) => (
          <DarkPill key={r.id} selected={selected === r.id} onClick={() => onSelect(r.id)}>
            <div className="font-sans text-[13px] font-bold">{r.label}</div>
            <div
              className="font-sans text-[11px] mt-0.5"
              style={{ color: "#8a7a60" }}
            >
              {r.description}
            </div>
          </DarkPill>
        ))}
      </div>
    </div>
  );
}

function StepStrategy({
  selected,
  onSelect,
}: {
  selected: StrategyType | null;
  onSelect: (s: StrategyType) => void;
}) {
  return (
    <div>
      <SectionTitle
        kicker="Step 3 · Strategy"
        title="What's your mandate?"
        body="Drives how theses are framed and which bear-case angle we surface."
      />
      <div className="space-y-2.5">
        {STRATEGIES.map((s) => (
          <DarkPill key={s.id} selected={selected === s.id} onClick={() => onSelect(s.id)}>
            <div className="font-sans text-[13px] font-bold">{s.label}</div>
            <div
              className="font-sans text-[11px] mt-0.5"
              style={{ color: "#8a7a60" }}
            >
              {s.description}
            </div>
          </DarkPill>
        ))}
      </div>
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
      <SectionTitle
        kicker="Step 4 · Sectors"
        title="What sectors do you follow?"
        body="Theses, briefs and trend pages will lean into these first. Pick at least one."
      />
      <div className="flex flex-wrap gap-2 mb-3">
        {SECTORS.map((s) => {
          const isSelected = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => onToggle(s)}
              className="px-3.5 py-2 rounded-lg border font-sans text-[12px] font-medium transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] cursor-pointer"
              style={{
                backgroundColor: isSelected
                  ? "rgba(201,168,76,0.15)"
                  : "rgba(255,255,255,0.02)",
                borderColor: isSelected ? CTA_BG : "rgba(255,255,255,0.12)",
                color: isSelected ? CTA_BG : "#c0a870",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSelectAll}
        className="font-sans text-[11px] font-semibold transition-colors cursor-pointer hover:opacity-80"
        style={{ color: CTA_BG }}
      >
        Select all
      </button>
      {selected.length > 0 && (
        <p className="mt-3 font-sans text-[11px]" style={{ color: "#8a7a60" }}>
          {selected.length} sector{selected.length !== 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}

function StepHorizonWorkflow({
  horizon,
  onHorizonSelect,
  workflow,
  onWorkflowSelect,
  risk,
  onRiskSelect,
}: {
  horizon: InvestmentHorizon | null;
  onHorizonSelect: (h: InvestmentHorizon) => void;
  workflow: WorkflowStyle | null;
  onWorkflowSelect: (w: WorkflowStyle) => void;
  risk: RiskAppetite;
  onRiskSelect: (r: RiskAppetite) => void;
}) {
  return (
    <div>
      <SectionTitle
        kicker="Step 5 · How you work"
        title="Horizon, workflow and risk."
        body="Calibrates the urgency, depth and tone of every signal we surface."
      />

      <div className="mb-6">
        <DarkLabel>Horizon</DarkLabel>
        <div className="grid grid-cols-3 gap-2">
          {HORIZONS.map((h) => (
            <DarkPill
              key={h.id}
              selected={horizon === h.id}
              onClick={() => onHorizonSelect(h.id)}
            >
              <div className="font-sans text-[13px] font-bold">{h.label}</div>
              <div
                className="font-sans text-[11px] mt-0.5"
                style={{ color: "#8a7a60" }}
              >
                {h.description}
              </div>
            </DarkPill>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <DarkLabel>Workflow</DarkLabel>
        <div className="grid grid-cols-3 gap-2">
          {WORKFLOWS.map((w) => (
            <DarkPill
              key={w.id}
              selected={workflow === w.id}
              onClick={() => onWorkflowSelect(w.id)}
            >
              <div className="font-sans text-[13px] font-bold">{w.label}</div>
              <div
                className="font-sans text-[11px] mt-0.5"
                style={{ color: "#8a7a60" }}
              >
                {w.description}
              </div>
            </DarkPill>
          ))}
        </div>
      </div>

      <div>
        <DarkLabel>Risk</DarkLabel>
        <div className="grid grid-cols-3 gap-2">
          {RISK_OPTIONS.map((r) => (
            <DarkPill key={r.id} selected={risk === r.id} onClick={() => onRiskSelect(r.id)}>
              <div className="font-sans text-[13px] font-bold">{r.label}</div>
              <div
                className="font-sans text-[11px] mt-0.5"
                style={{ color: "#8a7a60" }}
              >
                {r.description}
              </div>
            </DarkPill>
          ))}
        </div>
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
      <SectionTitle
        kicker="Step 6 · Watchlist"
        title="Any tickers you watch?"
        body="Optional. We'll prioritise articles and theses that touch these names."
      />
      <div className="flex items-center gap-2 mb-4 max-w-[420px]">
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
          className="uppercase bg-transparent border-white/15 text-white placeholder:text-white/30 focus-visible:border-gold"
          style={{ color: "#f5f0e8" }}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!input.trim()}
          className={cn(
            "font-sans text-[12px] font-bold px-4 py-2 rounded-lg transition-opacity cursor-pointer border",
            !input.trim() ? "opacity-30 cursor-not-allowed" : "hover:opacity-90",
          )}
          style={{ color: CTA_BG, borderColor: "rgba(201,168,76,0.4)" }}
        >
          Add
        </button>
      </div>
      {tickers.length === 0 ? (
        <p className="font-sans text-[11px] italic" style={{ color: "#8a7a60" }}>
          No tickers yet — you can skip and add them later from preferences.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tickers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onRemove(t)}
              className="group flex items-center gap-1.5 px-2.5 py-1 rounded-md font-data text-[11px] font-semibold cursor-pointer transition-colors border"
              style={{
                color: CTA_BG,
                borderColor: "rgba(201,168,76,0.35)",
                backgroundColor: "rgba(201,168,76,0.08)",
              }}
              title="Click to remove"
            >
              {t}
              <span style={{ color: "#8a7a60" }}>&times;</span>
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
      <SectionTitle
        kicker="Step 7 · Review"
        title="Here's what Signalera looks like for you."
        body="A live sample thesis, drafted right now with your preferences."
      />
      {loading && (
        <div
          className="flex items-center gap-2 font-sans text-[12px]"
          style={{ color: "#c0a870" }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: CTA_BG }}
          />
          Generating a preview thesis…
        </div>
      )}
      {!loading && !error && preview && (
        <p className="font-sans text-[13px]" style={{ color: "#c0a870" }}>
          Preview ready on the right &rarr;. Hit <b>Enter Signalera</b> when
          you&apos;re done.
        </p>
      )}
      {!loading && !error && !preview && (
        <p className="font-sans text-[13px]" style={{ color: "#c0a870" }}>
          We&apos;ll generate a sample thesis for you on the right.
        </p>
      )}
      {error && !loading && (
        <button
          type="button"
          onClick={onRetry}
          className="font-sans text-[11px] font-semibold cursor-pointer hover:opacity-80"
          style={{ color: CTA_BG }}
        >
          Retry preview
        </button>
      )}
    </div>
  );
}
