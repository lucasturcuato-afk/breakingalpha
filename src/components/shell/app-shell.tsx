"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Sidebar } from "./sidebar";
import { MoodBar, type MoodType } from "./mood-bar";
import { Topbar } from "./topbar";
import { RightPanel } from "./right-panel";
import { CommandPalette } from "./command-palette";
import type { NotificationItem } from "./notification-dropdown";

const PANEL_STORAGE_KEY = "signalera_right_panel_open";

// Mock notifications for now — will be wired to real data later
const mockNotifications: NotificationItem[] = [
  { id: "1", type: "breaking", title: "NVDA drops 4% on export restrictions", timestamp: "2m ago", read: false },
  { id: "2", type: "signal", title: "New signal: Fed pivot expectations rising", timestamp: "15m ago", read: false },
  { id: "3", type: "ai-memo", title: "AI Memo ready: AAPL supply chain analysis", timestamp: "1h ago", read: true },
  { id: "4", type: "vix-alert", title: "VIX spike above 20 — risk-off regime", timestamp: "2h ago", read: true },
  { id: "5", type: "brief-ready", title: "Morning Brief is ready", timestamp: "6h ago", read: true },
];

interface AppShellProps {
  pageTitle: string;
  mood?: MoodType;
  moodHeadline?: string;
  moodDetails?: string[];
  rightPanel?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  pageTitle,
  mood = "neutral",
  moodHeadline,
  moodDetails,
  rightPanel,
  children,
}: AppShellProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [userInitials, setUserInitials] = useState("–");

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "";
      const initials = name
        .split(" ")
        .map((w: string) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
      setUserInitials(initials || "–");
    });
  }, []);

  // Persist panel state
  useEffect(() => {
    const stored = localStorage.getItem(PANEL_STORAGE_KEY);
    if (stored !== null) setPanelOpen(stored === "true");
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      localStorage.setItem(PANEL_STORAGE_KEY, String(!prev));
      return !prev;
    });
  }, []);

  // ⌘K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {/* Sidebar (fixed, outside flex flow) */}
      <Sidebar />

      {/* Main area */}
      <div className="h-screen flex flex-col ml-[var(--sidebar-width)] overflow-hidden">
        {/* Mood bar */}
        <MoodBar mood={mood} headline={moodHeadline} details={moodDetails} />

        {/* Topbar */}
        <Topbar
          pageTitle={pageTitle}
          userInitials={userInitials}
          notifications={mockNotifications}
          onCommandOpen={() => setCommandOpen(true)}
        />

        {/* Content + right panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Scrollable content area */}
          <main className="flex-1 overflow-y-auto bg-parchment">
            {children}
          </main>

          {/* Collapsible right panel */}
          {rightPanel && (
            <RightPanel open={panelOpen} onToggle={togglePanel}>
              {rightPanel}
            </RightPanel>
          )}
        </div>
      </div>

      {/* Command palette overlay */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  );
}
