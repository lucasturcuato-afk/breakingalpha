"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  first_name: string;
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

/* ─── Preview thesis card content (client-side illustrative, not API) ─── */

const TITLE_BY_STRATEGY: Record<StrategyType, (sector: string) => string> = {
  pe: (s) => `Platform rollup forming in ${s}`,
  equity: (s) => `Pricing power emerging in ${s}`,
  vc: (s) => `Category leader shaping up in ${s}`,
  macro: (s) => `Regime rotation into ${s}`,
  credit: (s) => `Spread opportunity opening in ${s}`,
};

const RATIONALE_BY_STRATEGY: Record<StrategyType, string> = {
  pe: "Framed as a durability thesis — cash flow quality, integration risk, exit multiples.",
  equity: "Framed for catalyst + consensus — what's priced in and what isn't.",
  vc: "Framed as an asymmetric call — runway, burn, and path to escape velocity.",
  macro: "Framed as a regime read — rates, liquidity, and policy inflection points.",
  credit: "Framed as a spread read — coupon safety, downgrade risk, and recovery.",
};

const RATIONALE_BY_BUCKET: Record<RoleBucket, string> = {
  student: "Written to teach the logic — every claim tied to evidence.",
  junior: "Analyst-depth with a full evidence chain.",
  senior: "Tight — what changed, what to do about it.",
  other: "Neutral investor tone, catalyst-first.",
};

const CONVICTION_BY_RISK: Record<RiskAppetite, string> = {
  aggressive: "HIGH CONVICTION",
  balanced: "WATCHING",
  defensive: "CAUTION",
};

function illustrativePreview(
  role: UserRole | null,
  strategy: StrategyType | null,
  sectors: string[],
  risk: RiskAppetite,
): PreviewResult {
  const primarySector = sectors[0] || "Technology";
  return {
    title: strategy
      ? TITLE_BY_STRATEGY[strategy](primarySector)
      : `A thesis shaping up in ${primarySector}`,
    sector: primarySector,
    conviction: CONVICTION_BY_RISK[risk],
    rationale: strategy
      ? RATIONALE_BY_STRATEGY[strategy]
      : RATIONALE_BY_BUCKET[bucketForRole(role)],
  };
}

function contextualCopyFor(
  role: UserRole | null,
  strategy: StrategyType | null,
): string {
  const bucket = bucketForRole(role);
  if (bucket === "student") return "Signalera explains the why, not just the what.";
  if (bucket === "junior") {
    if (strategy === "pe") return "Deal flow intelligence, built around your strategy.";
    if (strategy === "equity") return "Public-market edge, earned through research.";
    if (strategy === "vc") return "Early-stage conviction, filtered for signal.";
    if (strategy === "macro") return "Regime reads that frame every position.";
    if (strategy === "credit") return "Spread discipline, priced for patience.";
    return "Analyst-grade signals, tuned to your desk.";
  }
  if (bucket === "senior") return "Edge-focused signals. No noise.";
  if (bucket === "other") return "Your portfolio lens, applied to every signal.";
  return "Every signal, shaped by your lens.";
}

/* ─── Persona bar helpers ─── */

const ROLE_SHORT: Record<UserRole, string> = {
  student_analyst: "Student",
  buy_side: "Buy-side",
  sell_side: "Sell-side",
  private_equity: "Private Equity",
  ria: "RIA",
  family_office: "Family Office",
  other: "Investor",
};

const STRATEGY_SHORT: Record<StrategyType, string> = {
  pe: "PE",
  equity: "Equity",
  vc: "Venture",
  macro: "Macro",
  credit: "Credit",
};

const HORIZON_SHORT: Record<InvestmentHorizon, string> = {
  short: "7–30d",
  medium: "6–18mo",
  long: "Multi-yr",
};

const WORKFLOW_SHORT: Record<WorkflowStyle, string> = {
  deep_dive: "Deep Research",
  screening: "Screening",
  monitoring: "Monitoring",
};

/* ─── Surface description pills ─── */

const SURFACE_BRIEF_BY_STRATEGY: Record<
  string,
  Record<string, string>
> = {
  "Morning Brief": {
    pe: "PE deal flow · carve-outs",
    equity: "Pre-market catalyst scan",
    vc: "Funding rounds · exits",
    macro: "Rates · policy · flows",
    credit: "Spreads · downgrades",
    _default: "Key signals · macro",
  },
  "Thesis Board": {
    pe: "Durability · cash flow",
    equity: "Catalyst · valuation setups",
    vc: "Asymmetric · runway plays",
    macro: "Regime · positioning",
    credit: "Coupon · spread opps",
    _default: "Signal-weighted theses",
  },
  "Evening Wrap": {
    pe: "M&A activity · fund news",
    equity: "Earnings · flows · after-hours",
    vc: "Late-stage deals · marks",
    macro: "Close recap · curve moves",
    credit: "Credit events · new issues",
    _default: "Market recap · patterns",
  },
};

function surfaceDescFor(
  surface: string,
  strategy: StrategyType | null,
  sectors: string[],
): string {
  const map = SURFACE_BRIEF_BY_STRATEGY[surface];
  if (!map) return "";
  if (surface === "Thesis Board" && sectors.length > 0) {
    const label =
      sectors.length <= 2
        ? sectors.map((s) => s.split(" ")[0]).join(" · ")
        : `${sectors[0].split(" ")[0]} +${sectors.length - 1}`;
    return `${label} weighted`;
  }
  return (strategy ? map[strategy] : null) ?? map._default ?? "";
}

/* ─── Step 5 right-panel data ─── */

const HORIZON_SLOTS: {
  id: string;
  label: string;
  match: InvestmentHorizon[];
  catalysts: string;
}[] = [
  { id: "7d", label: "7d", match: ["short"], catalysts: "Earnings · Fed meetings · CPI" },
  { id: "30d", label: "30d", match: ["short", "medium"], catalysts: "M&A announcements · Guidance · Rotations" },
  { id: "90d", label: "90d", match: ["medium", "long"], catalysts: "Deal closes · Regulatory · Launches" },
  { id: "1yr+", label: "1yr+", match: ["long"], catalysts: "Structural trends · Cycle turns · ESG" },
];

/* ─── Step 7 headline lookups ─── */

const MORNING_HEADLINES: Record<string, Record<string, string>> = {
  pe: {
    "Energy & Oil/Gas": "Defense carve-out volume hits 18-month high as oil majors accelerate divestitures",
    "Technology": "Enterprise SaaS M&A accelerates as PE sponsors hunt recurring revenue",
    "Healthcare & Biotech": "Pharma carve-out pipeline swells — 3 new processes launched this week",
    "Aerospace & Defense": "Defense consolidation play: mid-cap target emerges as budget cycle peaks",
    "Financial Services": "Insurance roll-up thesis gaining steam — sponsor activity up 40% YoY",
    _default: "Sponsor-backed deal flow picks up across mid-market industrials",
  },
  equity: {
    "Technology": "Semiconductor earnings revisions accelerating ahead of Q2 cycle",
    "Energy & Oil/Gas": "Oil services margin expansion outpacing consensus as rig counts stabilize",
    "Healthcare & Biotech": "Biotech catalyst calendar heats up — 4 PDUFA dates in next 30 days",
    "Financial Services": "Bank earnings beat across the board — NIM expansion surprises to upside",
    _default: "Earnings revision breadth improving across large-cap growth",
  },
  vc: {
    "Technology": "AI infra funding round sizes up 3x vs last quarter — new unicorn minted",
    "Healthcare & Biotech": "Biotech Series B window reopens — crossover rounds priced above marks",
    _default: "Late-stage valuations stabilizing as public-market multiples compress",
  },
  macro: {
    "Geopolitics & Macro": "Fed minutes signal extended pause — rates vol compresses to 6-month low",
    "Energy & Oil/Gas": "OPEC+ production decision looms — crude vol picking up into the meeting",
    _default: "Dollar index testing resistance — EM flows rotate on carry differential",
  },
  credit: {
    "Financial Services": "IG spreads tighten to post-GFC lows — HY outperforming duration",
    "Energy & Oil/Gas": "Energy HY names rally on improved FCF — upgrades outnumber downgrades 3:1",
    _default: "New issue volume picks up — investor demand absorbs $12B in IG supply",
  },
  _default: {
    _default: "Markets steady as investors digest earnings — macro data in focus this week",
  },
};

const EVENING_HEADLINES: Record<string, Record<string, string>> = {
  pe: {
    "Energy & Oil/Gas": "Energy M&A: 2 new sponsor processes launched, LMT up 3.2% on contract news",
    "Technology": "SaaS take-private rumor lifts mid-cap software — PE names circle $4B target",
    _default: "PE deal flow steady — 3 new platform announcements today",
  },
  equity: {
    "Technology": "Semis lead as NVDA prints new high — broad tech +1.8% into close",
    "Geopolitics & Macro": "Fed speakers push back on cut timeline — duration underperforms, dollar firms",
    _default: "Broad market +0.4% — growth outperforms value, semis lead",
  },
  vc: {
    "Technology": "Two AI startups close $100M+ rounds — Series B window widening for infra plays",
    _default: "Late-stage marks stable — one IPO filing adds liquidity signal for sector",
  },
  macro: {
    _default: "Dollar firms into close — 10yr +4bp, EM underperforms on carry unwind",
  },
  credit: {
    _default: "HY spreads -3bp on risk-on tone — 2 new fallen angel candidates on watch",
  },
  _default: {
    _default: "Markets close mixed — volume light ahead of tomorrow's data releases",
  },
};

function headlineFor(
  table: Record<string, Record<string, string>>,
  strategy: StrategyType | null,
  sectors: string[],
): string {
  const stratMap = table[strategy ?? ""] ?? table._default ?? {};
  const hit = sectors.find((s) => stratMap[s]);
  return hit ? stratMap[hit] : stratMap._default ?? table._default?._default ?? "";
}

function todayLabel(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
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
  const [firstName, setFirstName] = useState(initialProfile.first_name);
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
    if (step === 1) return firstName.trim().length > 0;
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
          first_name: firstName.trim() || null,
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
              firstName={firstName}
              onFirstNameChange={setFirstName}
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
        style={{
          backgroundColor: "var(--espresso-light)",
          backgroundImage:
            "radial-gradient(ellipse 55% 40% at 50% 38%, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 45%, transparent 75%)",
          padding: "48px",
        }}
      >
        {step === 1 && <BrandPanel />}
        {step >= 2 && step <= 6 && step !== 5 && (
          <SignalPreviewPanel
            role={role}
            strategy={strategy}
            sectors={sectors}
            risk={riskAppetite}
            horizon={horizon}
            workflow={workflow}
          />
        )}
        {step === 5 && (
          <Step5Panel
            role={role}
            strategy={strategy}
            sectors={sectors}
            risk={riskAppetite}
            horizon={horizon}
            workflow={workflow}
          />
        )}
        {step === 7 && (
          <Step7FeedPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            onRetry={fetchPreview}
            role={role}
            strategy={strategy}
            sectors={sectors}
            risk={riskAppetite}
            horizon={horizon}
            workflow={workflow}
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

/* ─── SignalPreviewPanel — premium thesis card + contextual copy + impact strip ─── */

const FADE_MS = 400;

function SignalPreviewPanel({
  role,
  strategy,
  sectors,
  risk,
  horizon,
  workflow,
}: {
  role: UserRole | null;
  strategy: StrategyType | null;
  sectors: string[];
  risk: RiskAppetite;
  horizon: InvestmentHorizon | null;
  workflow: WorkflowStyle | null;
}) {
  const preview = illustrativePreview(role, strategy, sectors, risk);
  const copy = contextualCopyFor(role, strategy);
  const rows = impactRowsFor(role, strategy, sectors);

  // Key that represents card+copy identity — when it changes, fade.
  const contentKey = `${preview.title}|${preview.sector}|${preview.conviction}|${preview.rationale}|${copy}`;

  const [isUpdating, setIsUpdating] = useState(false);
  const firstRenderRef = useRef(true);
  const prevContentKeyRef = useRef(contentKey);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      prevContentKeyRef.current = contentKey;
      return;
    }
    if (contentKey === prevContentKeyRef.current) return;
    prevContentKeyRef.current = contentKey;
    setIsUpdating(true);
    const t = setTimeout(() => setIsUpdating(false), FADE_MS);
    return () => clearTimeout(t);
  }, [contentKey]);

  // Per-row pulse when a specific row's value changes.
  const prevRowsRef = useRef<ImpactRow[]>(rows);
  const [pulsingRows, setPulsingRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed = new Set<string>();
    rows.forEach((row) => {
      const prev = prevRowsRef.current.find((r) => r.surface === row.surface);
      if (prev && prev.value !== row.value) changed.add(row.surface);
    });
    prevRowsRef.current = rows;
    if (changed.size === 0) return;
    setPulsingRows(changed);
    const t = setTimeout(() => setPulsingRows(new Set()), FADE_MS);
    return () => clearTimeout(t);
  }, [rows]);

  return (
    <div className="flex flex-col h-full max-w-[460px]">
      {/* Label above card */}
      <p
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.22em] mb-3 transition-colors"
        style={{ color: isUpdating ? "#8a7a60" : CTA_BG }}
      >
        {isUpdating ? "Updating your signal" : "Your first signal"}
      </p>

      {/* Premium thesis card — fades on content change */}
      <div
        className="rounded-xl transition-opacity ease-out"
        style={{
          padding: "24px",
          borderLeft: `3px solid ${CTA_BG}`,
          backgroundColor: "rgba(255,255,255,0.04)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.18)",
          opacity: isUpdating ? 0 : 1,
          transitionDuration: `${FADE_MS / 2}ms`,
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

      {/* Contextual copy line — fades with card */}
      <p
        className="text-center italic font-sans mt-5 transition-opacity ease-out"
        style={{
          fontSize: "13px",
          color: "#b8965a",
          opacity: isUpdating ? 0 : 0.9,
          transitionDuration: `${FADE_MS / 2}ms`,
        }}
      >
        {copy}
      </p>

      {/* Persona summary bar */}
      <PersonaSummaryBar
        role={role}
        strategy={strategy}
        sectors={sectors}
        horizon={horizon}
        workflow={workflow}
        fading={isUpdating}
      />

      {/* Surface preview pills */}
      <SurfacePreviewRow
        strategy={strategy}
        sectors={sectors}
        fading={isUpdating}
      />

      {/* Impact strip — per-row pulse on value change */}
      <ul className="space-y-3 mt-auto pt-6">
        {rows.map((row) => {
          const pulsing = pulsingRows.has(row.surface);
          return (
            <li
              key={row.surface}
              className={cn(
                "grid grid-cols-[140px_20px_1fr] items-start gap-3",
                pulsing ? "onboarding-row-pulse" : "",
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
                style={{ color: "#e8b84b" }}
              >
                {row.value}
              </span>
            </li>
          );
        })}
      </ul>

    </div>
  );
}

/* ─── Persona summary bar (Change 1A) ─── */

function PersonaSummaryBar({
  role,
  strategy,
  sectors,
  horizon,
  workflow,
  fading,
}: {
  role: UserRole | null;
  strategy: StrategyType | null;
  sectors: string[];
  horizon: InvestmentHorizon | null;
  workflow: WorkflowStyle | null;
  fading: boolean;
}) {
  const parts: { label: string; filled: boolean }[] = [
    { label: role ? ROLE_SHORT[role] : "Role", filled: !!role },
    { label: strategy ? STRATEGY_SHORT[strategy] : "Strategy", filled: !!strategy },
    {
      label:
        sectors.length > 0
          ? sectors.length <= 2
            ? sectors.map((s) => s.split(" ")[0]).join(", ")
            : `${sectors[0].split(" ")[0]} +${sectors.length - 1}`
          : "Sectors",
      filled: sectors.length > 0,
    },
    { label: horizon ? HORIZON_SHORT[horizon] : "Horizon", filled: !!horizon },
    { label: workflow ? WORKFLOW_SHORT[workflow] : "Workflow", filled: !!workflow },
  ];

  return (
    <div
      className="mt-5 rounded-lg px-4 py-2.5 transition-opacity ease-out"
      style={{
        backgroundColor: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        opacity: fading ? 0 : 1,
        transitionDuration: `${FADE_MS / 2}ms`,
      }}
    >
      <p
        className="font-mono text-[11px] leading-relaxed tracking-wide"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && (
              <span style={{ color: "#5a4f3a" }}>{" · "}</span>
            )}
            <span style={{ color: p.filled ? CTA_BG : "#5a4f3a" }}>
              {p.label}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}

/* ─── Surface preview pills (Change 1B) ─── */

const SURFACE_NAMES = ["Morning Brief", "Thesis Board", "Evening Wrap"] as const;

function SurfacePreviewRow({
  strategy,
  sectors,
  fading,
}: {
  strategy: StrategyType | null;
  sectors: string[];
  fading: boolean;
}) {
  return (
    <div
      className="mt-5 transition-opacity ease-out"
      style={{
        opacity: fading ? 0 : 1,
        transitionDuration: `${FADE_MS / 2}ms`,
      }}
    >
      <p
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-2.5"
        style={{ color: "#8a7a60" }}
      >
        Your surfaces
      </p>
      <div className="grid grid-cols-3 gap-2">
        {SURFACE_NAMES.map((name) => (
          <div
            key={name}
            className="rounded-lg px-3 py-2.5"
            style={{
              backgroundColor: "rgba(255,255,255,0.025)",
              border: `1px solid rgba(201,168,76,0.2)`,
            }}
          >
            <div
              className="font-sans text-[10px] font-semibold uppercase tracking-wide mb-1"
              style={{ color: "#f5f0e8" }}
            >
              {name.split(" ")[0]}
            </div>
            <div
              className="font-sans text-[10px] leading-snug"
              style={{ color: CTA_BG }}
            >
              {surfaceDescFor(name, strategy, sectors)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 5 right panel (Change 2) ─── */

function Step5Panel({
  role,
  strategy,
  sectors,
  risk,
  horizon,
  workflow,
}: {
  role: UserRole | null;
  strategy: StrategyType | null;
  sectors: string[];
  risk: RiskAppetite;
  horizon: InvestmentHorizon | null;
  workflow: WorkflowStyle | null;
}) {
  const preview = illustrativePreview(role, strategy, sectors, risk);
  const bearCase = strategy ? BEAR_CASE_BY_STRATEGY[strategy] : "Bear case angle";

  // Workflow → scan vs deep mode
  const isScan = workflow === "screening";
  const isDeep = workflow === "deep_dive" || workflow === "monitoring";
  const noneSelected = workflow === null;

  return (
    <div className="flex flex-col h-full max-w-[460px]">
      {/* TOP — Workflow mode thesis split */}
      <div style={{ flex: "0 0 40%" }}>
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-3"
          style={{ color: "#8a7a60" }}
        >
          Workflow mode
        </p>
        <div className="grid grid-cols-2 gap-3">
          {/* Scan mode card */}
          <div
            className="rounded-xl transition-opacity"
            style={{
              padding: "16px",
              backgroundColor: "rgba(255,255,255,0.03)",
              borderLeft: isScan ? `3px solid ${CTA_BG}` : "3px solid transparent",
              opacity: noneSelected ? 0.8 : isScan ? 1 : 0.4,
              transitionDuration: "200ms",
            }}
          >
            <p
              className="font-sans text-[9px] font-bold uppercase tracking-wide mb-2"
              style={{ color: isScan ? CTA_BG : "#8a7a60" }}
            >
              Scan mode
            </p>
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="font-sans text-[8px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ backgroundColor: "rgba(201,168,76,0.15)", color: CTA_BG }}
              >
                {preview.conviction}
              </span>
              <span className="font-sans text-[8px] uppercase" style={{ color: "#8a7a60" }}>
                {preview.sector}
              </span>
            </div>
            <p className="font-sans text-[13px] font-semibold leading-snug" style={{ color: "#f5f0e8" }}>
              {preview.title}
            </p>
          </div>

          {/* Deep mode card */}
          <div
            className="rounded-xl transition-opacity"
            style={{
              padding: "16px",
              backgroundColor: "rgba(255,255,255,0.03)",
              borderLeft: isDeep ? `3px solid ${CTA_BG}` : "3px solid transparent",
              opacity: noneSelected ? 0.8 : isDeep ? 1 : 0.4,
              transitionDuration: "200ms",
            }}
          >
            <p
              className="font-sans text-[9px] font-bold uppercase tracking-wide mb-2"
              style={{ color: isDeep ? CTA_BG : "#8a7a60" }}
            >
              Deep mode
            </p>
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="font-sans text-[8px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ backgroundColor: "rgba(201,168,76,0.15)", color: CTA_BG }}
              >
                {preview.conviction}
              </span>
              <span className="font-sans text-[8px] uppercase" style={{ color: "#8a7a60" }}>
                {preview.sector}
              </span>
            </div>
            <p
              className="font-sans text-[13px] font-semibold leading-snug mb-1.5"
              style={{ color: "#f5f0e8" }}
            >
              {preview.title}
            </p>
            <p className="font-sans text-[11px] leading-relaxed mb-1.5" style={{ color: "#c0a870" }}>
              {preview.rationale}
            </p>
            <p className="font-sans text-[10px] italic" style={{ color: "#8a7a60" }}>
              Bear case: {bearCase}
            </p>
            <p className="font-sans text-[10px] mt-1" style={{ color: "#6a5f4a" }}>
              3 sources
            </p>
          </div>
        </div>
      </div>

      {/* MIDDLE — Horizon timeline */}
      <div style={{ flex: "0 0 30%" }} className="pt-6">
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-3"
          style={{ color: "#8a7a60" }}
        >
          When Signalera fires for you
        </p>
        <div className="grid grid-cols-4 gap-2">
          {HORIZON_SLOTS.map((slot) => {
            const active = horizon !== null && slot.match.includes(horizon);
            return (
              <div key={slot.id} className="text-center">
                <div
                  className="rounded-lg px-2 py-2 mb-1.5 transition-colors"
                  style={{
                    backgroundColor: active ? CTA_BG : "rgba(255,255,255,0.03)",
                    color: active ? CTA_FG : "#8a7a60",
                    transitionDuration: "200ms",
                  }}
                >
                  <span className="font-sans text-[13px] font-bold">
                    {slot.label}
                  </span>
                </div>
                <p
                  className="font-sans text-[10px] leading-snug"
                  style={{ color: "#6a5f4a" }}
                >
                  {slot.catalysts}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* BOTTOM — Risk conviction filter */}
      <div style={{ flex: "0 0 30%" }} className="pt-6">
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-3"
          style={{ color: "#8a7a60" }}
        >
          Your conviction filter
        </p>
        <ConvictionFilterPreview risk={risk} />
      </div>

      {/* Persona bar + surface pills (present on all steps 2-6) */}
      <PersonaSummaryBar
        role={role}
        strategy={strategy}
        sectors={sectors}
        horizon={horizon}
        workflow={workflow}
        fading={false}
      />
      <SurfacePreviewRow strategy={strategy} sectors={sectors} fading={false} />
    </div>
  );
}

function ConvictionFilterPreview({ risk }: { risk: RiskAppetite }) {
  const configs: {
    id: RiskAppetite;
    badge: string;
    badgeColor: string;
    badgeBg: string;
    copy: string;
  }[] = [
    {
      id: "defensive",
      badge: "WATCH",
      badgeColor: "#9ca3af",
      badgeBg: "rgba(156,163,175,0.15)",
      copy: "Showing conservative signals only — WATCH conviction and above",
    },
    {
      id: "balanced",
      badge: "MEDIUM",
      badgeColor: "#d4a03c",
      badgeBg: "rgba(212,160,60,0.15)",
      copy: "Showing MEDIUM and HIGH conviction signals",
    },
    {
      id: "aggressive",
      badge: "HIGH",
      badgeColor: CTA_BG,
      badgeBg: "rgba(201,168,76,0.15)",
      copy: "Showing all signals including speculative WATCH plays",
    },
  ];

  const selected = configs.find((c) => c.id === risk);
  const isDefault = risk === "balanced";

  if (!selected && isDefault) {
    // Show all three badges at equal opacity
    return (
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          {configs.map((c) => (
            <span
              key={c.id}
              className="font-sans text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
              style={{ backgroundColor: c.badgeBg, color: c.badgeColor }}
            >
              {c.badge}
            </span>
          ))}
        </div>
        <p className="font-sans text-[11px]" style={{ color: "#8a7a60" }}>
          Select a risk appetite to see your conviction filter
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="font-sans text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
          style={{
            backgroundColor: selected?.badgeBg,
            color: selected?.badgeColor,
          }}
        >
          {selected?.badge}
        </span>
      </div>
      <p className="font-sans text-[11px] leading-relaxed" style={{ color: "#c0a870" }}>
        {selected?.copy}
      </p>
    </div>
  );
}

/* ─── Step 7 mini feed panel (Change 3) ─── */

function Step7FeedPanel({
  preview,
  loading,
  error,
  onRetry,
  role,
  strategy,
  sectors,
  risk,
  horizon,
  workflow,
}: {
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  role: UserRole | null;
  strategy: StrategyType | null;
  sectors: string[];
  risk: RiskAppetite;
  horizon: InvestmentHorizon | null;
  workflow: WorkflowStyle | null;
}) {
  const morningHL = headlineFor(MORNING_HEADLINES, strategy, sectors);
  const eveningHL = headlineFor(EVENING_HEADLINES, strategy, sectors);
  const dateStr = todayLabel();

  return (
    <div className="flex flex-col h-full max-w-[460px]">
      {/* A. Morning Brief preview (25%) */}
      <div style={{ flex: "0 0 25%" }}>
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-2"
          style={{ color: "#8a7a60" }}
        >
          Morning Brief &middot; {dateStr}
        </p>
        <div
          className="rounded-xl"
          style={{
            padding: "16px",
            borderLeft: `3px solid ${CTA_BG}`,
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <p
            className="font-sans text-[13px] font-semibold leading-snug mb-2"
            style={{ color: "#f5f0e8" }}
          >
            {morningHL}
          </p>
          <p className="font-sans text-[11px]" style={{ color: "#8a7a60" }}>
            3 more stories in your brief &rarr;
          </p>
        </div>
      </div>

      {/* B. Live thesis card (40%) */}
      <div style={{ flex: "0 0 40%" }} className="pt-4">
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-2"
          style={{ color: CTA_BG }}
        >
          Your first signal
        </p>

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
            className="rounded-xl"
            style={{
              padding: "24px",
              borderLeft: `3px solid ${CTA_BG}`,
              backgroundColor: "rgba(255,255,255,0.04)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.18)",
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

      {/* C. Evening Wrap preview (25%) */}
      <div style={{ flex: "0 0 25%" }} className="pt-4">
        <p
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] mb-2"
          style={{ color: "#8a7a60" }}
        >
          Evening Wrap &middot; Today
        </p>
        <div
          className="rounded-xl"
          style={{
            padding: "16px",
            borderLeft: `3px solid ${CTA_BG}`,
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <p
            className="font-sans text-[13px] font-semibold leading-snug mb-2"
            style={{ color: "#f5f0e8" }}
          >
            {eveningHL}
          </p>
          <p className="font-sans text-[11px]" style={{ color: "#8a7a60" }}>
            Full wrap available after market close &rarr;
          </p>
        </div>
      </div>

      {/* D. Persona summary bar (10%) */}
      <div style={{ flex: "0 0 10%" }} className="pt-3">
        <PersonaSummaryBar
          role={role}
          strategy={strategy}
          sectors={sectors}
          horizon={horizon}
          workflow={workflow}
          fading={false}
        />
      </div>
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
  firstName,
  onFirstNameChange,
  firmOrSchool,
  onFirmOrSchoolChange,
}: {
  firstName: string;
  onFirstNameChange: (v: string) => void;
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
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
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
