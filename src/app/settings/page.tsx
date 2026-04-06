"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { User, Bell, Puzzle, Palette, Users, Save, Check } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";

type SettingsTab = "profile" | "notifications" | "integrations" | "appearance" | "team";

const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "Profile", icon: <User size={14} /> },
  { key: "notifications", label: "Notifications", icon: <Bell size={14} /> },
  { key: "integrations", label: "Integrations", icon: <Puzzle size={14} /> },
  { key: "appearance", label: "Appearance", icon: <Palette size={14} /> },
  { key: "team", label: "Team", icon: <Users size={14} /> },
];

const sectors = [
  "Technology M&A", "Venture Capital", "Private Equity", "Public Markets",
  "Geopolitics & Macro", "Real Estate & REITs", "Fintech & Crypto",
  "Healthcare & Biotech", "Energy & Climate", "Consumer & Retail",
];

const modules = [
  "Macro & Rates", "Deals & M&A", "Public Markets", "Sector Signals",
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  return (
    <AppShell pageTitle="Settings" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="flex h-[calc(100vh-var(--topbar-height)-var(--moodbar-height))]">
        {/* Left sub-nav */}
        <div className="w-[200px] flex-shrink-0 border-r border-border-base bg-cream px-3 py-4">
          <nav className="space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg",
                  "font-sans text-[13px] font-medium",
                  "transition-all duration-[var(--duration-base)]",
                  "cursor-pointer text-left",
                  activeTab === tab.key
                    ? "bg-espresso text-cream [&_svg]:text-gold"
                    : "text-text-muted [&_svg]:text-text-faint hover:bg-parchment-mid hover:text-text-primary",
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6 max-w-[640px]">
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "notifications" && <NotificationsTab />}
          {activeTab === "integrations" && <IntegrationsTab />}
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "team" && <TeamTab />}
        </div>
      </div>
    </AppShell>
  );
}

/* ── Profile ── */
function ProfileTab() {
  const [name, setName] = useState("Lucas Turcuato");
  const [email, setEmail] = useState("lucas@signalera.com");
  const [role, setRole] = useState("Analyst");
  const [selectedSectors, setSelectedSectors] = useState<string[]>(["Technology M&A", "Public Markets", "Venture Capital"]);
  const [selectedModules, setSelectedModules] = useState<string[]>(["Macro & Rates", "Deals & M&A"]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load preferences from API + localStorage on mount
  useEffect(() => {
    // Load profile from localStorage
    try {
      const stored = localStorage.getItem("signalera_profile");
      if (stored) {
        const p = JSON.parse(stored);
        if (p.name) setName(p.name);
        if (p.email) setEmail(p.email);
        if (p.role) setRole(p.role);
      }
    } catch { /* ignore */ }

    async function load() {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok) return;
        const { preferences } = await res.json();
        if (preferences) {
          if (preferences.sectors?.length) setSelectedSectors(preferences.sectors);
          if (preferences.modules?.length) setSelectedModules(preferences.modules);
        }
      } catch { /* ignore */ }
    }
    load();
  }, []);

  function toggleItem(item: string, list: string[], setList: (l: string[]) => void) {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      localStorage.setItem("signalera_profile", JSON.stringify({ name, email, role }));
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectors: selectedSectors, modules: selectedModules }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-[18px] font-bold text-espresso mb-1">Profile</h2>
        <p className="font-sans text-[12px] text-text-muted mb-5">Manage your account details and preferences.</p>

        <div className="space-y-4">
          <FormField label="Full Name">
            <Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </FormField>
          <FormField label="Email">
            <Input value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} type="email" />
          </FormField>
          <FormField label="Role">
            <Input value={role} onChange={(e) => { setRole(e.target.value); setSaved(false); }} />
          </FormField>
        </div>
      </div>

      <Divider />

      <div>
        <h3 className="font-sans text-[13px] font-bold text-text-primary mb-1">Sector Interests</h3>
        <p className="font-sans text-[11px] text-text-muted mb-3">These shape your morning brief and feed ranking.</p>
        <div className="flex flex-wrap gap-2">
          {sectors.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleItem(s, selectedSectors, setSelectedSectors)}
              className={cn(
                "px-3 py-1.5 rounded-lg border font-sans text-[11px] font-medium transition-all cursor-pointer",
                selectedSectors.includes(s)
                  ? "border-gold bg-gold-muted text-gold-dark"
                  : "border-border-base bg-white text-text-secondary hover:border-border-hover",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      <div>
        <h3 className="font-sans text-[13px] font-bold text-text-primary mb-1">Brief Modules</h3>
        <p className="font-sans text-[11px] text-text-muted mb-3">Choose which sections appear first in your daily briefs.</p>
        <div className="flex flex-wrap gap-2">
          {modules.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleItem(m, selectedModules, setSelectedModules)}
              className={cn(
                "px-3 py-1.5 rounded-lg border font-sans text-[11px] font-medium transition-all cursor-pointer",
                selectedModules.includes(m)
                  ? "border-gold bg-gold-muted text-gold-dark"
                  : "border-border-base bg-white text-text-secondary hover:border-border-hover",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2">
        <Button variant="gold" size="md" onClick={handleSave} disabled={saving}>
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/* ── Notifications ── */
const NOTIF_KEYS = [
  { key: "breaking_news", label: "Breaking News Alerts", description: "Critical market-moving news in real-time", defaultOn: true },
  { key: "signal_updates", label: "Signal Updates", description: "New signals matching your sectors", defaultOn: true },
  { key: "ai_memo_ready", label: "AI Memo Ready", description: "When an AI-generated memo is complete", defaultOn: true },
  { key: "vix_threshold", label: "VIX Threshold Alerts", description: "Alert when VIX crosses 20 or 30", defaultOn: false },
  { key: "morning_brief", label: "Morning Brief Ready", description: "Notification when your daily brief is available", defaultOn: true },
  { key: "evening_wrap", label: "Evening Wrap Ready", description: "Notification when evening analysis is available", defaultOn: true },
  { key: "watchlist_price", label: "Watchlist Price Alerts", description: "Significant moves in your watched tickers", defaultOn: false },
];

function NotificationsTab() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem("signalera_notif_prefs");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return {};
  });

  const isOn = (key: string, defaultOn: boolean) => prefs[key] ?? defaultOn;

  const handleToggle = (key: string, defaultOn: boolean) => {
    const current = isOn(key, defaultOn);
    const next = { ...prefs, [key]: !current };
    setPrefs(next);
    localStorage.setItem("signalera_notif_prefs", JSON.stringify(next));
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-[18px] font-bold text-espresso mb-1">Notifications</h2>
        <p className="font-sans text-[12px] text-text-muted mb-5">Control what alerts you receive and how.</p>
      </div>

      <div className="space-y-4">
        {NOTIF_KEYS.map((n) => (
          <ToggleRow
            key={n.key}
            label={n.label}
            description={n.description}
            on={isOn(n.key, n.defaultOn)}
            onToggle={() => handleToggle(n.key, n.defaultOn)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Integrations ── */
function IntegrationsTab() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-[18px] font-bold text-espresso mb-1">Integrations</h2>
        <p className="font-sans text-[12px] text-text-muted mb-5">Connect external tools and data sources.</p>
      </div>

      <div className="space-y-3">
        <IntegrationRow name="Slack" description="Get alerts in your Slack workspace" connected={false} />
        <IntegrationRow name="Bloomberg Terminal" description="Import portfolio data and watchlists" connected={false} />
        <IntegrationRow name="Notion" description="Export memos and theses to Notion" connected={false} />
        <IntegrationRow name="Google Sheets" description="Sync watchlist data to spreadsheets" connected={false} />
      </div>
    </div>
  );
}

/* ── Appearance ── */
function AppearanceTab() {
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    if (typeof window === "undefined") return "comfortable";
    return (localStorage.getItem("signalera_density") as "comfortable" | "compact") || "comfortable";
  });
  const [saved, setSaved] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-[18px] font-bold text-espresso mb-1">Appearance</h2>
        <p className="font-sans text-[12px] text-text-muted mb-5">Customize how Signalera looks.</p>
      </div>

      <div>
        <h3 className="font-sans text-[13px] font-bold text-text-primary mb-3">Theme</h3>
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { if (theme !== t) toggleTheme(); }}
              className={cn(
                "px-4 py-2.5 rounded-lg border font-sans text-[12px] font-medium transition-all cursor-pointer capitalize",
                theme === t
                  ? "border-gold bg-gold-muted text-gold-dark"
                  : "border-border-base bg-white text-text-secondary hover:border-border-hover",
              )}
            >
              {t === "light" ? "Cream & Parchment" : "Dark Mode"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-sans text-[13px] font-bold text-text-primary mb-3">Feed Density</h3>
        <div className="flex gap-2">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                "px-4 py-2 rounded-lg border font-sans text-[12px] font-medium transition-all cursor-pointer capitalize",
                density === d
                  ? "border-gold bg-gold-muted text-gold-dark"
                  : "border-border-base bg-white text-text-secondary hover:border-border-hover",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2">
        <Button variant="gold" size="md" onClick={() => {
          localStorage.setItem("signalera_density", density);
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        }}>
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? "Saved" : "Save Preferences"}
        </Button>
      </div>
    </div>
  );
}

/* ── Team ── */
function TeamTab() {
  return (
    <div>
      <h2 className="font-display text-[18px] font-bold text-espresso mb-1">Team</h2>
      <p className="font-sans text-[12px] text-text-muted mb-5">Manage team members and permissions.</p>

      <EmptyState
        icon={<Users size={32} />}
        title="Team features coming soon"
        description="Share watchlists, theses, and memos with your team. Invite colleagues to collaborate on research."
      />
    </div>
  );
}

/* ── Shared helpers ── */

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
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

function ToggleRow({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="font-sans text-[13px] font-medium text-text-primary">{label}</p>
        <p className="font-sans text-[11px] text-text-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-9 h-5 rounded-full p-0.5 transition-colors duration-[var(--duration-base)] cursor-pointer flex-shrink-0",
          on ? "bg-gold" : "bg-border-base",
        )}
      >
        <div
          className={cn(
            "w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-base)]",
            on && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

function IntegrationRow({
  name,
  description,
  connected,
}: {
  name: string;
  description: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border-base bg-white">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="font-sans text-[13px] font-semibold text-text-primary">{name}</h4>
          {connected && <Badge variant="bullish">Connected</Badge>}
        </div>
        <p className="font-sans text-[11px] text-text-muted mt-0.5">{description}</p>
      </div>
      <Button variant={connected ? "ghost" : "secondary"} size="sm">
        {connected ? "Disconnect" : "Connect"}
      </Button>
    </div>
  );
}
