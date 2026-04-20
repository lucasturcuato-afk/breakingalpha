"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  UserRole,
  RiskAppetite,
  StrategyType,
  InvestmentHorizon,
  WorkflowStyle,
} from "@/lib/user-profile";

/* ── Option data ── */

const ROLES: { id: UserRole; label: string }[] = [
  { id: "student_analyst", label: "Student Analyst" },
  { id: "buy_side", label: "Buy-Side Analyst" },
  { id: "sell_side", label: "Sell-Side Analyst" },
  { id: "private_equity", label: "Private Equity" },
  { id: "ria", label: "RIA / Wealth Manager" },
  { id: "family_office", label: "Family Office" },
  { id: "other", label: "Other" },
];

const STRATEGIES: { id: StrategyType; label: string }[] = [
  { id: "pe", label: "Private Equity" },
  { id: "equity", label: "Public Equity" },
  { id: "vc", label: "Venture" },
  { id: "macro", label: "Macro" },
  { id: "credit", label: "Credit" },
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

const HORIZONS: { id: InvestmentHorizon; label: string }[] = [
  { id: "short", label: "Near-term" },
  { id: "medium", label: "Mid-term" },
  { id: "long", label: "Long-term" },
];

const WORKFLOWS: { id: WorkflowStyle; label: string }[] = [
  { id: "deep_dive", label: "Deep Research" },
  { id: "screening", label: "Screening" },
  { id: "monitoring", label: "Monitoring" },
];

const RISK_OPTIONS: { id: RiskAppetite; label: string }[] = [
  { id: "aggressive", label: "Aggressive" },
  { id: "balanced", label: "Balanced" },
  { id: "defensive", label: "Defensive" },
];

/* ── Props ── */

const DEFAULT_MARKET_CARDS = ["SPY", "VIX", "TNX", "SIGNALS"];

interface PreferencesFormProps {
  initialFirstName: string;
  initialFirmOrSchool: string;
  initialRole: UserRole | null;
  initialStrategy: StrategyType | null;
  initialSectors: string[];
  initialHorizon: InvestmentHorizon | null;
  initialWorkflow: WorkflowStyle | null;
  initialRisk: RiskAppetite;
  initialWatchlist: string[];
  initialMarketCards?: string[];
}

/* ── Component ── */

export function PreferencesForm({
  initialFirstName,
  initialFirmOrSchool,
  initialRole,
  initialStrategy,
  initialSectors,
  initialHorizon,
  initialWorkflow,
  initialRisk,
  initialWatchlist,
  initialMarketCards,
}: PreferencesFormProps) {
  const router = useRouter();

  const [firstName, setFirstName] = useState(initialFirstName);
  const [firmOrSchool, setFirmOrSchool] = useState(initialFirmOrSchool);
  const [role, setRole] = useState<UserRole | null>(initialRole);
  const [strategy, setStrategy] = useState<StrategyType | null>(initialStrategy);
  const [sectors, setSectors] = useState<string[]>(initialSectors);
  const [horizon, setHorizon] = useState<InvestmentHorizon | null>(initialHorizon);
  const [workflow, setWorkflow] = useState<WorkflowStyle | null>(initialWorkflow);
  const [risk, setRisk] = useState<RiskAppetite>(initialRisk);
  const [watchlist, setWatchlist] = useState<string[]>(initialWatchlist);
  const [tickerInput, setTickerInput] = useState("");
  const [marketCards, setMarketCards] = useState<string[]>(
    initialMarketCards && initialMarketCards.length > 0 ? initialMarketCards : DEFAULT_MARKET_CARDS,
  );

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleSector = useCallback((s: string) => {
    setSectors((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  function addTicker() {
    const raw = tickerInput.trim().toUpperCase();
    if (!raw) return;
    const tickers = raw.split(/[\s,]+/).filter(Boolean);
    setWatchlist((prev) => {
      const next = [...prev];
      for (const t of tickers) {
        if (!next.includes(t)) next.push(t);
      }
      return next;
    });
    setTickerInput("");
  }

  function removeTicker(t: string) {
    setWatchlist((prev) => prev.filter((x) => x !== t));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setToast(null);

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
          risk_appetite: risk,
          watchlist_tickers: watchlist,
          market_cards: marketCards.filter(Boolean).slice(0, 4),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }

      setToast("Your Signalera has been updated");
      router.refresh();
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SECTION 1 — Identity */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-4">
          Identity
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">
              First name
            </label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Your first name"
            />
          </div>
          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">
              Firm or school
            </label>
            <Input
              value={firmOrSchool}
              onChange={(e) => setFirmOrSchool(e.target.value)}
              placeholder="e.g. Goldman Sachs, MIT"
            />
          </div>
        </div>
        <div>
          <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2 block">
            Role
          </label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <Pill
                key={r.id}
                label={r.label}
                selected={role === r.id}
                onClick={() => setRole(role === r.id ? null : r.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 2 — Strategy */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-4">
          Strategy
        </h2>
        <div className="flex flex-wrap gap-2">
          {STRATEGIES.map((s) => (
            <Pill
              key={s.id}
              label={s.label}
              selected={strategy === s.id}
              onClick={() => setStrategy(strategy === s.id ? null : s.id)}
            />
          ))}
        </div>
      </section>

      {/* SECTION 3 — Sectors */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-1">
          Sectors
        </h2>
        <p className="font-sans text-[12px] text-text-secondary mb-3">
          {sectors.length} selected
        </p>
        <div className="flex flex-wrap gap-2">
          {SECTORS.map((s) => (
            <Pill
              key={s}
              label={s}
              selected={sectors.includes(s)}
              onClick={() => toggleSector(s)}
            />
          ))}
        </div>
      </section>

      {/* SECTION 4 — How you work */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-4">
          How you work
        </h2>

        <div className="space-y-4">
          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2 block">
              Investment horizon
            </label>
            <div className="flex flex-wrap gap-2">
              {HORIZONS.map((h) => (
                <Pill
                  key={h.id}
                  label={h.label}
                  selected={horizon === h.id}
                  onClick={() => setHorizon(horizon === h.id ? null : h.id)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2 block">
              Workflow style
            </label>
            <div className="flex flex-wrap gap-2">
              {WORKFLOWS.map((w) => (
                <Pill
                  key={w.id}
                  label={w.label}
                  selected={workflow === w.id}
                  onClick={() => setWorkflow(workflow === w.id ? null : w.id)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2 block">
              Risk appetite
            </label>
            <div className="flex flex-wrap gap-2">
              {RISK_OPTIONS.map((r) => (
                <Pill
                  key={r.id}
                  label={r.label}
                  selected={risk === r.id}
                  onClick={() => setRisk(r.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 5 — Watchlist tickers */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-3">
          Watchlist tickers
        </h2>
        <div className="flex gap-2 mb-3">
          <Input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTicker();
              }
            }}
            placeholder="e.g. AAPL, MSFT"
            className="max-w-xs"
          />
          <Button variant="ghost" size="sm" onClick={addTicker}>
            Add
          </Button>
        </div>
        {watchlist.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {watchlist.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-parchment-mid border border-border-base font-data text-[10px] font-semibold text-text-primary"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTicker(t)}
                  className="text-text-faint hover:text-signal-dn transition-colors cursor-pointer ml-0.5"
                  aria-label={`Remove ${t}`}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 6 — Dashboard Market Cards */}
      <section className="bg-parchment border border-border-base rounded-2xl p-6">
        <h2 className="font-display text-[16px] font-bold text-espresso mb-1">
          Dashboard Market Cards
        </h2>
        <p className="font-sans text-[12px] text-text-secondary mb-2">
          Choose up to 4 indices or tickers to display on your dashboard.
          Use SIGNALS for the signals counter.
        </p>
        <p className="font-sans text-[10px] text-text-muted mb-4">
          Available: SPY, VIX, TNX, QQQ, DIA, IWM, GLD, TLT, DXY, BTC, ETH, GOLD, OIL, SIGNALS
        </p>
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <label className="font-sans text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1 block">
                Card {i + 1}
              </label>
              <Input
                value={marketCards[i] ?? ""}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9\-^.]/g, "");
                  setMarketCards((prev) => {
                    const next = [...prev];
                    next[i] = val;
                    return next;
                  });
                }}
                placeholder={DEFAULT_MARKET_CARDS[i] ?? "e.g. AAPL"}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button
          variant="gold"
          size="md"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save preferences"}
        </Button>
        {toast && (
          <span className="font-sans text-[12px] text-signal-up font-semibold">
            {toast}
          </span>
        )}
        {error && (
          <span className="font-sans text-[12px] text-signal-dn">
            {error}
          </span>
        )}
      </div>
      <p className="font-sans text-[11px] text-text-muted leading-relaxed">
        Changes to your preferences will be reflected across your dashboard and briefs within a few minutes.
        Some content (like Morning Briefs) updates with the next pipeline run.
      </p>
    </div>
  );
}

/* ── Pill component ── */

function Pill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3.5 py-2 rounded-lg border font-sans text-[12px] font-medium",
        "transition-all duration-150 cursor-pointer",
        selected
          ? "border-gold bg-gold-muted text-gold-dark"
          : "border-border-base bg-parchment-mid text-text-secondary hover:border-border-hover",
      )}
    >
      {label}
    </button>
  );
}
