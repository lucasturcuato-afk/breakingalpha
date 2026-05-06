"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Sidebar } from "./sidebar";
import { MoodBar, type MoodType } from "./mood-bar";
import { Topbar } from "./topbar";
import { RightPanel } from "./right-panel";
import { CommandPalette } from "./command-palette";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { PageTransition } from "./page-transition";
import { Footer } from "./footer";

const PANEL_STORAGE_KEY = "signalera_right_panel_open";

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
  const [authed, setAuthed] = useState(false);

  // We only need to know whether the user is signed in here (for the
  // notification bell visibility). The user avatar reads its own auth
  // state inside <UserAvatar /> so both render sites share one source
  // of truth without prop threading.
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user);
    });
    return () => {
      authSub.subscription.unsubscribe();
    };
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
      {/* Skip link: first focusable element so keyboard users can bypass nav. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded focus:bg-espresso focus:text-cream focus:font-sans focus:text-[12px]"
      >
        Skip to main content
      </a>

      {/* Sidebar (fixed, outside flex flow). Visible at md+ (icon-only between
          768-1023px, full at lg+); below md the MobileBottomNav handles
          navigation. */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Main area. Below md: full width (sidebar hidden, MobileBottomNav).
          md to lg-1: offset by 64px icon-only sidebar.
          lg+: offset by full --sidebar-width (220px). */}
      <div className="h-screen flex flex-col md:ml-[64px] lg:ml-[var(--sidebar-width)] overflow-hidden">
        {/* Preview banner */}
        {isPreview && (
          <div
            className="flex items-center justify-between px-5 py-2 font-sans text-[12px]"
            style={{ backgroundColor: "var(--espresso)", color: "var(--cream)" }}
          >
            <span>You&apos;re viewing a live preview of Signalera</span>
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
          authed={authed}
          onCommandOpen={() => setCommandOpen(true)}
        />

        {/* Content + right panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Scrollable content area */}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-parchment pb-[56px] md:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>

          {/* Collapsible right panel — hidden on mobile */}
          {rightPanel && (
            <div className="hidden lg:block">
              <RightPanel open={panelOpen} onToggle={togglePanel}>
                {rightPanel}
              </RightPanel>
            </div>
          )}
        </div>

        <Footer />
      </div>

      {/* Mobile bottom navigation — only visible <md */}
      <MobileBottomNav />

      {/* Command palette overlay */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  );
}
