"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
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
