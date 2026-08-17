"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { USER_ROLES } from "@/lib/user-roles";
import type {
  UserRole,
  RiskAppetite,
  StrategyType,
  InvestmentHorizon,
  WorkflowStyle,
} from "@/lib/user-profile";

/* ── Option data ── */

/* This file used to carry its own copy of the role enum, tracked by no design
 * document, and it had already drifted from both other copies. It now reads
 * the one table. Rulings 5 and 6 live there. */
const ROLES = USER_ROLES;

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

/* Risk appetite options: removed by ruling 7a. The control is gone from the
 * settings UI; the stored value is untouched and still round-trips on save. */

/* ── Props ── */

const DEFAULT_MARKET_CARDS = ["SPY", "VIX", "TNX", "SIGNALS"];

const MARKET_CARD_OPTIONS = [
  "SPY", "QQQ", "DIA", "VIX", "TNX", "DXY",
  "BTC", "ETH", "GOLD", "OIL", "SIGNALS",
];

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
  /* Held, never edited here. Ruling 7a took the control out of the UI only, so
   * the value the profile arrived with is the value that goes back. */
  const [risk] = useState<RiskAppetite>(initialRisk);
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
            <label className="font-sans text-[11px] font-semibold text-text-muted mb-1.5 block">
              First name
            </label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Your first name"
            />
          </div>
          <div>
            <label className="font-sans text-[11px] font-semibold text-text-muted mb-1.5 block">
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
          <label className="font-sans text-[11px] font-semibold text-text-muted mb-2 block">
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
            <label className="font-sans text-[11px] font-semibold text-text-muted mb-2 block">
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
            <label className="font-sans text-[11px] font-semibold text-text-muted mb-2 block">
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
        <p className="font-sans text-[12px] text-text-secondary mb-3">
          {marketCards.length} / 4 selected
          {marketCards.length >= 4 && (
            <span className="ml-2 text-gold-dark font-semibold">Maximum 4 cards</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {MARKET_CARD_OPTIONS.map((sym) => {
            const selected = marketCards.includes(sym);
            const atMax = marketCards.length >= 4 && !selected;
            return (
              <Pill
                key={sym}
                label={sym}
                selected={selected}
                disabled={atMax}
                onClick={() => {
                  if (selected) {
                    setMarketCards((prev) => prev.filter((s) => s !== sym));
                  } else if (!atMax) {
                    setMarketCards((prev) => [...prev, sym]);
                  }
                }}
              />
            );
          })}
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
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3.5 py-2 rounded-lg border font-sans text-[12px] font-medium",
        "transition-all duration-150",
        selected
          ? "border-gold bg-gold-muted text-gold-dark cursor-pointer"
          : disabled
            ? "border-border-base bg-parchment-mid text-text-faint cursor-not-allowed opacity-50"
            : "border-border-base bg-parchment-mid text-text-secondary hover:border-border-hover cursor-pointer",
      )}
    >
      {label}
    </button>
  );
}
