"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Save, Check, Briefcase, TrendingUp, GraduationCap, Building2, Shield, Zap, Scale, BarChart3 } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { ReactNode } from "react";

/* ── Role options (matching user_profiles.role enum) ── */
interface RoleOption {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

const roles: RoleOption[] = [
  { id: "student_analyst", label: "Student Analyst", description: "Building investment knowledge and analytical skills", icon: <GraduationCap size={20} /> },
  { id: "buy_side", label: "Buy-Side Analyst", description: "Investment fund research and portfolio analysis", icon: <TrendingUp size={20} /> },
  { id: "sell_side", label: "Sell-Side Analyst", description: "Equity research and coverage for clients", icon: <BarChart3 size={20} /> },
  { id: "private_equity", label: "Private Equity", description: "Deal evaluation, due diligence, and portfolio ops", icon: <Briefcase size={20} /> },
  { id: "ria", label: "RIA / Advisor", description: "Managing client portfolios and allocations", icon: <Shield size={20} /> },
  { id: "family_office", label: "Family Office", description: "Multi-asset investment management", icon: <Building2 size={20} /> },
  { id: "other", label: "Other", description: "Finance professional with custom needs", icon: <Scale size={20} /> },
];

/* ── Sector chips ── */
const SECTORS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
  "Geopolitics & Macro",
];

/* ── Risk appetite options ── */
interface RiskOption {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

const riskOptions: RiskOption[] = [
  { id: "defensive", label: "Defensive", description: "Prioritize downside protection and macro risks", icon: <Shield size={18} /> },
  { id: "balanced", label: "Balanced", description: "Even weighting of opportunity and risk signals", icon: <Scale size={18} /> },
  { id: "aggressive", label: "Aggressive", description: "Lead with high-conviction asymmetric opportunities", icon: <Zap size={18} /> },
];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function ProfileSettingsPage() {
  const { refetch: refetchGlobalProfile } = useUserProfile();
  const [firstName, setFirstName] = useState("");
  const [firmOrSchool, setFirmOrSchool] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [riskAppetite, setRiskAppetite] = useState<string | null>(null);
  const [watchlistInput, setWatchlistInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current profile on mount — query Supabase directly (bypasses API route)
  useEffect(() => {
    async function loadProfile() {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const { data: profile, error: dbError } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (dbError && dbError.code !== "PGRST116") {
          console.error("Profile load error:", dbError.message);
          setLoading(false);
          return;
        }

        if (profile) {
          setFirstName(profile.first_name ?? "");
          setFirmOrSchool(profile.firm_or_school ?? "");
          setRole(profile.role ?? null);
          setSectors(profile.sectors ?? []);
          setRiskAppetite(profile.risk_appetite ?? null);
          setWatchlistInput((profile.watchlist_tickers ?? []).join(", "));
        }
      } catch {
        // Soft-fail — leave defaults
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const toggleSector = useCallback((s: string) => {
    setSectors((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
    setSaved(false);
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Parse comma-separated tickers
      const tickers = watchlistInput
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0);

      const res = await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName || null,
          firm_or_school: firmOrSchool || null,
          role: role,
          sectors: sectors,
          risk_appetite: riskAppetite,
          watchlist_tickers: tickers,
          onboarding_completed: true,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save profile");
      }

      setSaved(true);
      refetchGlobalProfile(); // propagate to all consumers instantly
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell pageTitle="Profile Settings" mood="neutral" moodHeadline="Markets steady" moodDetails={[]}>
      <div className="p-6 max-w-[640px]">
        {/* Header */}
        <h1 className="font-display text-[24px] font-extrabold text-espresso mb-1">
          Your Preferences
        </h1>
        <p className="font-sans text-[13px] text-text-secondary mb-8">
          Changes save instantly and personalize your entire Signalera experience.
        </p>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-parchment-mid animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Name & Firm */}
            <div className="space-y-4">
              <FormField label="First name">
                <Input
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setSaved(false); }}
                  placeholder="Your first name"
                />
              </FormField>
              <FormField label="Firm or school">
                <Input
                  value={firmOrSchool}
                  onChange={(e) => { setFirmOrSchool(e.target.value); setSaved(false); }}
                  placeholder="Company, institution, or school"
                />
              </FormField>
            </div>

            <Divider />

            {/* Role */}
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary mb-1">Your Role</h3>
              <p className="font-sans text-[11px] text-text-muted mb-3">
                This shapes how briefs and memos are framed for you.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setRole(r.id); setSaved(false); }}
                    className={cn(
                      "flex flex-col items-start gap-2 p-4 rounded-xl border text-left",
                      "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                      "cursor-pointer",
                      role === r.id
                        ? "border-gold bg-gold-muted [&_svg]:text-gold"
                        : "border-border-base bg-white hover:border-border-hover [&_svg]:text-text-faint",
                    )}
                  >
                    {r.icon}
                    <div>
                      <h4 className="font-sans text-[13px] font-bold text-text-primary">{r.label}</h4>
                      <p className="font-sans text-[11px] text-text-muted mt-0.5">{r.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Divider />

            {/* Sectors */}
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary mb-1">Tracked Sectors</h3>
              <p className="font-sans text-[11px] text-text-muted mb-3">
                Signals from these sectors are surfaced first in your briefs.
              </p>
              <div className="flex flex-wrap gap-2">
                {SECTORS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSector(s)}
                    className={cn(
                      "px-3.5 py-2 rounded-lg border",
                      "font-sans text-[12px] font-medium",
                      "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                      "cursor-pointer",
                      sectors.includes(s)
                        ? "border-gold bg-gold-muted text-gold-dark"
                        : "border-border-base bg-white text-text-secondary hover:border-border-hover",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {sectors.length > 0 && (
                <p className="font-sans text-[11px] text-text-muted mt-2">
                  {sectors.length} sector{sectors.length !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>

            <Divider />

            {/* Risk Appetite */}
            <div>
              <h3 className="font-sans text-[13px] font-bold text-text-primary mb-1">Risk Appetite</h3>
              <p className="font-sans text-[11px] text-text-muted mb-3">
                Controls how risk vs. opportunity signals are weighted.
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {riskOptions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setRiskAppetite(r.id); setSaved(false); }}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-xl border text-center",
                      "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                      "cursor-pointer",
                      riskAppetite === r.id
                        ? "border-gold bg-gold-muted [&_svg]:text-gold"
                        : "border-border-base bg-white hover:border-border-hover [&_svg]:text-text-faint",
                    )}
                  >
                    {r.icon}
                    <div>
                      <h4 className="font-sans text-[12px] font-bold text-text-primary">{r.label}</h4>
                      <p className="font-sans text-[10px] text-text-muted mt-0.5">{r.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Divider />

            {/* Watchlist Tickers */}
            <div>
              <FormField label="Watchlist Tickers">
                <Input
                  value={watchlistInput}
                  onChange={(e) => { setWatchlistInput(e.target.value); setSaved(false); }}
                  placeholder="AAPL, NVDA, MSFT, META"
                />
                <p className="font-sans text-[10px] text-text-faint mt-1">
                  Comma-separated ticker symbols. Signals touching these will be surfaced prominently.
                </p>
              </FormField>
            </div>

            {/* Error */}
            {error && (
              <p className="font-sans text-[12px] text-signal-dn">{error}</p>
            )}

            {/* Save */}
            <div className="pt-2">
              <Button variant="gold" size="md" onClick={handleSave} disabled={saving}>
                {saved ? <Check size={13} /> : <Save size={13} />}
                {saving ? "Saving..." : saved ? "Saved" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Toast notifications */}
      {saved && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
          <div className="bg-gold text-cream px-4 py-2.5 rounded-xl shadow-lg font-sans text-[13px] font-semibold">
            Profile updated. ✦
          </div>
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
          <div className="bg-signal-dn text-cream px-4 py-2.5 rounded-xl shadow-lg font-sans text-[13px] font-semibold">
            {error}
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ── Shared helpers ── */

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block font-sans text-[11px] font-semibold text-text-primary mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border-subtle" />;
}
