"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour-styles.css";
import { useUserProfile } from "@/hooks/useUserProfile";
import { usePathname, useRouter } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Tour step definitions ───────────────────────────────────────────────────

const TOUR_STEPS: DriveStep[] = [
  {
    popover: {
      title: "Welcome to Signalera",
      description:
        "Here's a 60-second tour of your intelligence platform. We'll walk through the key features so you know exactly where everything lives.",
      side: "over",
      align: "center",
    },
  },
  {
    element: "[data-tour='ai-signal-bar']",
    popover: {
      title: "AI Signal Bar",
      description:
        "Your real-time market intelligence headline — generated from overnight analysis of deals, sentiment, and macro data.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "[data-tour='morning-brief-link']",
    popover: {
      title: "Morning Brief",
      description:
        "Start your day here — a personalized brief with market pulse, top stories, analyst sections, and deal flow. Generated fresh each morning.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='morning-brief-link']",
    popover: {
      title: "Top Stories",
      description:
        "Inside the brief, stories are ranked by relevance to your watchlist and sectors. The 'For You' tab surfaces what matters most.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='personalization-banner']",
    popover: {
      title: "Personalization",
      description:
        "Your content is shaped by your profile — role, sectors, watchlist, and risk appetite. Complete your profile for better signal quality.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "[data-tour='evening-wrap-link']",
    popover: {
      title: "Evening Wrap",
      description:
        "End-of-day recap with market scorecard, morning prediction review, and tomorrow's setup.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='company-link']",
    popover: {
      title: "Company Intel",
      description:
        "Deep-dive on any company — news mentions, key themes, AI-generated research memos, and recent filings.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='intelligence-link']",
    popover: {
      title: "Intelligence Chat",
      description:
        "Ask anything about markets, companies, or your portfolio. AI-powered research assistant with full context.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='radar-link']",
    popover: {
      title: "Thesis Board",
      description:
        "Track your investment theses and let Signalera grade them over time as new evidence arrives.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='radar-link']",
    popover: {
      title: "Track Record",
      description:
        "See how your theses and signals have played out — conviction scoring and historical performance.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='settings-link'], [data-tour='settings-link-desktop']",
    popover: {
      title: "Profile & Preferences",
      description:
        "Tell Signalera about your role, sectors, and risk appetite. Better profile = better personalization across every surface.",
      side: "top",
      align: "start",
    },
  },
  {
    popover: {
      title: "You're all set!",
      description:
        "That's the tour. Use the ? button in the bottom-right corner anytime to replay it. Welcome to Signalera.",
      side: "over",
      align: "center",
    },
  },
];

// ─── Tour logic ──────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "signalera_tour_completed";

function useTourDriver(onComplete: () => void) {
  const driverRef = useRef<Driver | null>(null);

  const start = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy();
    }

    const d = driver({
      showProgress: true,
      steps: TOUR_STEPS,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "signalera-tour-popover",
      stagePadding: 6,
      stageRadius: 8,
      onDestroyStarted: () => {
        // If user is on last step, treat as completed
        if (d.isLastStep()) {
          onComplete();
        }
        d.destroy();
      },
      onDestroyed: () => {
        driverRef.current = null;
      },
    });

    driverRef.current = d;
    d.drive();
  }, [onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  return { start };
}

// ─── SignaleraTour (auto-trigger) ────────────────────────────────────────────

export function SignaleraTour() {
  const { profile, loading, updateProfile } = useUserProfile();
  const pathname = usePathname();
  const [triggered, setTriggered] = useState(false);

  const handleComplete = useCallback(() => {
    // Mark in localStorage immediately
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    } catch {}

    // Persist to DB
    updateProfile({
      tour_completed: true,
      tour_completed_at: new Date().toISOString(),
    } as Record<string, unknown>);
  }, [updateProfile]);

  const { start } = useTourDriver(handleComplete);

  /* Bumped when the desk breakpoint is crossed, purely to re-run the effect
     below. A counter rather than a boolean, so repeated crossings each land. */
  const [deskCrossings, setDeskCrossings] = useState(0);
  const onDeskChange = useCallback(() => setDeskCrossings((n) => n + 1), []);

  useEffect(() => {
    if (loading || triggered) return;
    if (!profile) return;

    // Don't auto-fire if onboarding isn't completed
    if (!profile.onboarding_completed) return;

    // Don't auto-fire if tour already completed (DB or localStorage)
    if ((profile as Record<string, unknown>).tour_completed) return;
    try {
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === "true") return;
    } catch {}

    // Only auto-fire on dashboard
    if (pathname !== "/dashboard") return;

    /* DESK WIDTHS ONLY, and this one has to be JS because there is no element
       to hang a class on: this component renders null and drives driver.js,
       which paints its overlay into <body> itself.

       Measured in a production build at 390x844, signed in, on /dashboard: the
       tour auto-fired and put a full-viewport <svg> at z-index 10000 plus a
       300x176 popover at z-index 1000000000 over the page. `elementFromPoint`
       at all four tab bar pole centres returned the overlay, so the entire
       mobile navigation was unreachable until the tour was dismissed.

       And it could never have worked: nine of the ten TOUR_STEPS point at
       `[data-tour='...']` nodes inside `shell/sidebar.tsx`, which AppShell
       renders in `hidden md:block`. Below md the walkthrough highlights
       elements that are not on the screen.

       768 is the same breakpoint `md:` compiles to, so this and the class gate
       on TourHelpButton below agree by construction. */
    if (typeof window === "undefined") return;
    const desk = window.matchMedia("(min-width: 768px)");
    if (!desk.matches) {
      /* Re-arm on the crossing rather than only sampling once. Read once per
         pathname effect, a reader who loads below 768 and then widens, by
         rotating the device or dragging a window, never became eligible again
         because nothing re-ran this. The class gate on TourHelpButton has no
         such gap, so the two disagreed above the breakpoint. */
      desk.addEventListener("change", onDeskChange);
      return () => desk.removeEventListener("change", onDeskChange);
    }

    // Small delay to let the page render
    const timer = setTimeout(() => {
      setTriggered(true);
      start();
    }, 800);

    return () => clearTimeout(timer);
  }, [loading, profile, pathname, triggered, start, deskCrossings, onDeskChange]);

  return null;
}

// ─── TourHelpButton (manual trigger) ─────────────────────────────────────────

export function TourHelpButton() {
  const { profile, loading } = useUserProfile();
  const pathname = usePathname();

  const handleComplete = useCallback(() => {
    // Manual restart — do NOT update tour_completed
  }, []);

  const { start } = useTourDriver(handleComplete);

  // Don't show on public pages
  if (loading || !profile) return null;
  if (pathname === "/" || pathname === "/auth" || pathname?.startsWith("/auth/")) return null;

  return (
    <button
      type="button"
      onClick={start}
      className={cn(
        /* md AND UP ONLY, and the gate is a class so a responsive rule can own
           it. Two independent reasons, either one sufficient.

           It covered the tab bar. At 390 this button sits at
           {x:330,y:784,w:40,h:40} with z-index 8000, over a tab bar at
           {0,785,390,59} with z-index 40, so `elementFromPoint` at the Ask
           pole's centre returned this button and not the link. The pole was
           unreachable on every signed-in mobile route.

           And it could not have worked there anyway. Nine of the ten steps in
           TOUR_STEPS target `[data-tour='...']` nodes that live in
           `shell/sidebar.tsx`, and AppShell renders the sidebar inside
           `hidden md:block`. Below md the tour has no targets to point at, so
           the trigger offered a walkthrough of elements that are not on the
           screen. The tour is a desk device; this is where it belongs. */
        "hidden md:flex",
        "fixed bottom-5 right-5 z-[8000]",
        "w-10 h-10 rounded-full",
        "bg-espresso text-cream dark:bg-elevated dark:text-foreground",
        "border border-border-base shadow-lg",
        "items-center justify-center",
        "hover:bg-gold hover:text-cream hover:border-gold",
        "transition-all duration-200 cursor-pointer",
        "group",
      )}
      aria-label="Restart product tour"
      title="Restart tour"
    >
      <HelpCircle size={18} className="group-hover:scale-110 transition-transform" />
    </button>
  );
}
