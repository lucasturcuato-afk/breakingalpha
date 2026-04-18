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

// Notifications — coming soon, wired to empty for now
const notifications: NotificationItem[] = [];

interface AppShellProps {
  pageTitle: string;
  mood?: MoodType;
  moodHeadline?: string;
  moodDetails?: string[];
  rightPanel?: ReactNode;
  isPreview?: boolean;
  children: ReactNode;
}

export function AppShell({
  pageTitle,
  mood = "neutral",
  moodHeadline,
  moodDetails,
  rightPanel,
  isPreview = false,
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
        {/* Preview banner */}
        {isPreview && (
          <div
            className="flex items-center justify-between px-5 py-2 font-sans text-[12px]"
            style={{ backgroundColor: "var(--espresso)", color: "var(--cream)" }}
          >
            <span>You're viewing a live preview of Signalera</span>
            <button
              onClick={() => {
                window.location.href = "/auth";
              }}
              style={{
                color: "var(--gold)",
                fontWeight: 600,
                cursor: "pointer",
                background: "none",
                border: "none",
              }}
            >
              Sign in free →
            </button>
          </div>
        )}

        {/* Mood bar */}
        <MoodBar mood={mood} headline={moodHeadline} details={moodDetails} />

        {/* Topbar */}
        <Topbar
          pageTitle={pageTitle}
          userInitials={userInitials}
          notifications={notifications}
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
